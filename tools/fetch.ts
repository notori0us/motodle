/**
 * `tools/fetch.ts` — find candidate photos on Wikimedia Commons for a set of catalog model ids,
 * and write a review file for the operator (§6.2, §6.3). Network — but every real request goes
 * through `tools/lib/wikimedia.ts`'s serial, rate-limited, cached client, and `--dry-run` (or an
 * empty on-disk cache) makes none at all.
 *
 * CLI:
 *   tsx tools/fetch.ts --models <id,id,…> | --models-file <path>
 *                       --out data/review/<batch>.json [--per-model 20] [--min-width 2182]
 *                       [--licenses pd,cc0,cc-by,cc-by-sa] [--cache .cache/wikimedia] [--dry-run]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_SOURCE_WIDTH } from '../schema/constants';
import type {
  Catalog,
  CatalogMake,
  CatalogModel,
  LicenseId,
  OperatorOverride,
  ReviewCandidate,
  ReviewCandidateSignals,
  ReviewDecision,
  ReviewFile,
} from '../schema/types';
import { baseRect } from './crop';
import { decideLicense } from './lib/licence';
import { assembleUserAgent, WikimediaClient } from './lib/wikimedia';
import { autoDecisionFor, scanYearCandidates, type YearScan } from './lib/year';
import { validate, type JSONSchema } from '../schema/validate';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DEFAULT_CATALOG_PATH = path.join(ROOT, 'public/catalog.json');
const DEFAULT_CACHE_DIR = path.join(ROOT, '.cache/wikimedia');
const REVIEW_SCHEMA_PATH = path.join(ROOT, 'schema/review.schema.json');

const EMPTY_OPERATOR_OVERRIDE: OperatorOverride = {
  year: null,
  focus: null,
  sourceCrop: null,
  cropFractions: null,
  modelIdOverride: null,
  note: null,
};

// -------------------------------------------------------------------------------------------
// Pure helpers (unit-tested directly — no network involved anywhere in this section)
// -------------------------------------------------------------------------------------------

/** Strips HTML tags and decodes the handful of entities Commons `extmetadata` actually uses.
 *  `Artist`/`Credit` are HTML fragments (recon: "Attribution was empty on every sampled file;
 *  the usable credit is Artist, HTML stripped, plus Credit", §6.5). */
export function stripHtml(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** `extmetadata.Restrictions.value` is a Commons multi-value field, "|"-separated. */
export function parseRestrictions(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split('|')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/**
 * The capture year out of `extmetadata.DateTimeOriginal` — an EXIF-style (`2013:11:09 ...`) or
 * ISO timestamp on most files, but Commons often returns free-text HTML instead:
 * `"19 August 2024 (according to <span…>Exif</span> data)"`, `"July 1952<div…>QS:P571,+1952-…"`.
 * Strip tags, then take the first IN-RANGE 4-digit run (CONTENT-WITHOUT-AI.md §5 gate 3) — not
 * just a leading token, and not `\b`-bounded, since a stripped free-text value can butt a year
 * straight up against a letter ("1952date"): `\b` fails there, `(?!\d)` doesn't.
 */
export function dateTimeOriginalYear(
  value: string | undefined | null,
  minYear = 1885,
  maxYear: number = new Date().getFullYear() + 1,
): number | null {
  if (!value) return null;
  const stripped = stripHtml(value);
  const re = /(?<!\d)(\d{4})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const year = Number(m[1]);
    if (year >= minYear && year <= maxYear) return year;
  }
  return null;
}

/** Guesses a Commons category from a catalog make+model — the recon-verified pattern
 *  (`Category:${make} ${model}`, §6.7). Commons category naming is not fully regular, so this
 *  is a starting point the operator can override via `--models-file` entries shaped as
 *  `modelId|Category override` (one per line) rather than a bare model id. */
export function guessCategory(make: CatalogMake, model: CatalogModel): string {
  return `Category:${make.name} ${model.name}`;
}

/** The Commons page title minus the "File:" prefix and extension — the actual on-wiki FILENAME,
 *  which is not always identical to `extmetadata.ObjectName` (recon: a `<div class="fn">…</div>`
 *  wrapper on ObjectName, or a filename-only suffix like "… instrument-panel" that ObjectName
 *  drops). The filename-based gates below (4, 5, 7, 8) read this, never ObjectName. */
export function stripFileTitle(title: string): string {
  return title.replace(/^File:/, '').replace(/\.(jpe?g|png|tiff?|gif|webp)$/i, '');
}

// -------------------------------------------------------------------------------------------
// The EIGHT hard gates (CONTENT-WITHOUT-AI.md §5) — deterministic auto-reject, measured on
// docs/content-review/2026-09-03-batch01.json (125 reviewed candidates): 27 of 79 rejects
// caught, 0 of 46 passes lost. Each gate contributes exactly one warning string so the operator
// (and the confusion-matrix check) can see which one fired.
// -------------------------------------------------------------------------------------------

const POSTER_WORDS_RE = /poster|Prospekt|Plakat|Modello in scala|scale model|die-cast|drawing/i;
const SIDECAR_RE = /sidecar|Gespann|Seitenwagen|side-car/i;
const PRODUCTION_SPAN_RE =
  /Bauzeit|Produktionszeitraum|between\s+\d{4}\s+and\s+\d{4}|introduced in|was made from|entre\s+\d{4}\s+et\s+\d{4}/i;
const DETAIL_TOKEN_RE =
  /\bengine\b|\(Motor\)|\bdashboard\b|\bcockpit\b|Tableau de bord|\bHeck\b|\bdetail\b|\binstrument\b|\bcrankcase\b|close-up/i;
// "concours d" (not bare "concours") — Kawasaki's own "Concours (ZG1000/1400)" is a catalog
// model name, and a bare match would reject every candidate of it outright (found scanning
// catalog.models[] against this regex, not present in the 125-file labelled sample).
const EVENT_TOKEN_RE = /\bSalon\b|Bonhams|concours d|Wiki Loves|\bOlympia\b|Jahrestreffen|Festival|\bParade\b|\bPride\b/i;

// -------------------------------------------------------------------------------------------
// Ranking signals (§5) — NEVER gates. Written into the optional `signals` object.
// -------------------------------------------------------------------------------------------

const MUSEUM_OR_SHOW_WORD_RE = /museum|show/i;
/** A trailing small parenthesised index, e.g. "...(2)" — NOT a long Flickr id like "(23110313245)". */
const SERIES_MARKER_RE = /\(\d{1,2}\)$/;

/** True when `source` (a `YearScan.source`) resolved via a title-LEADING token — the exemption
 *  gates 3 and 6 both key off ("…when the token is not title-leading"). */
function isTitleLeadingSource(source: string): boolean {
  return source === 'title' || source === 'title+description';
}

/** A second, DIFFERENT catalog make leading the segment right after a " - " split, e.g.
 *  "Kawasaki Z650 FOUR - Yamaha TX750" (gate 4). Deliberately narrow — an "and"/"&"/comma-joined
 *  two-bike title, or a make name buried mid-sentence ("… in the Honda Collection Hall"), is
 *  left to the human; widening this past the hyphenated-listing shape cost real passes in
 *  measurement (own make mentioned incidentally: "1996 Kawasaki ZG1000 … 1983 Honda CB550 …"). */
function findLeadingMake(segment: string, makeNames: string[]): string | null {
  const s = segment.trim().toLowerCase();
  return makeNames.find((m) => s.startsWith(m.toLowerCase())) ?? null;
}

function secondMakeInTitle(filename: string, makeNames: string[]): boolean {
  const parts = filename.split(/\s-\s/);
  for (let i = 0; i < parts.length - 1; i++) {
    const a = findLeadingMake(parts[i], makeNames);
    const b = findLeadingMake(parts[i + 1], makeNames);
    if (a && b && a.toLowerCase() !== b.toLowerCase()) return true;
  }
  return false;
}

export interface HardGateInput {
  /** `extmetadata.ObjectName`, HTML-stripped — the year-scan "title" (§6.4), NOT the filename. */
  title: string;
  /** `extmetadata.ImageDescription`, HTML-stripped. */
  description: string;
  /** The on-wiki filename, `stripFileTitle(page.title)`. */
  filename: string;
  mime: string;
  /** `dateTimeOriginalYear()` on the raw `extmetadata.DateTimeOriginal` value. */
  dtoYear: number | null;
  /** The discard-applied scan already computed for the candidate's own `yearProposed`/
   *  `yearConfidence` fields — passed in rather than recomputed. */
  officialYearScan: Pick<YearScan, 'yearProposed' | 'source'>;
  /** `catalog.models[].years` for this candidate's model; `null` = no constraint (RULE B). */
  modelYears: [number, number | null] | null;
  /** Every catalog make's display name (gate 4). */
  makeNames: string[];
  currentYear: number;
}

/** Runs the eight gates and returns the warning string for each one that fired (never throws,
 *  never itself decides `decision` — the caller does that). */
export function computeHardGateWarnings(input: HardGateInput): string[] {
  const { title, description, filename, mime, dtoYear, officialYearScan, modelYears, makeNames, currentYear } = input;
  const warnings: string[] = [];

  // Gate 1 — not a photograph: wrong mime, or poster/scale-model/drawing wording.
  if (mime !== 'image/jpeg' || POSTER_WORDS_RE.test(filename) || POSTER_WORDS_RE.test(description)) {
    warnings.push('not-a-photograph');
  }

  // Gate 2 — yearProposed outside catalog.models[].years widened by ±1.
  if (modelYears && officialYearScan.yearProposed !== null) {
    const lo = modelYears[0] - 1;
    const hi = (modelYears[1] ?? currentYear) + 1;
    if (officialYearScan.yearProposed < lo || officialYearScan.yearProposed > hi) {
      warnings.push('year-outside-catalog-window');
    }
  }

  // Gate 3 — the proposed year is just the capture date, and wasn't asserted as a title-leading
  // claim. Checked against the RAW (undiscarded) scan: the with-discard scan used for the
  // candidate's own fields already strips any token equal to `dtoYear`, so by construction it
  // can never equal `dtoYear` there — this gate is what actually catches the coincidence.
  if (dtoYear !== null) {
    const rawScan = scanYearCandidates({ title, description, minYear: 1885, maxYear: currentYear + 1 });
    if (rawScan.yearProposed === dtoYear && !isTitleLeadingSource(rawScan.source)) {
      warnings.push('year-matches-capture-date');
    }
  }

  // Gate 4 — a second catalog make in the filename.
  if (secondMakeInTitle(filename, makeNames)) {
    warnings.push('second-make-in-title');
  }

  // Gate 5 — sidecar wording in the filename (NOT the description — a neighbouring bike in the
  // description caused a real lost pass in measurement).
  if (SIDECAR_RE.test(filename)) {
    warnings.push('sidecar-in-title');
  }

  // Gate 6 — production-span PROSE in the description (a bare "YYYY–YYYY" is not this rule),
  // when the year wasn't asserted as a title-leading claim.
  if (PRODUCTION_SPAN_RE.test(description) && !isTitleLeadingSource(officialYearScan.source)) {
    warnings.push('production-span-prose');
  }

  // Gate 7 — detail token in the filename. Deliberately excludes front/rear/left/right.
  if (DETAIL_TOKEN_RE.test(filename)) {
    warnings.push('detail-token-in-filename');
  }

  // Gate 8 — event token in the filename.
  if (EVENT_TOKEN_RE.test(filename)) {
    warnings.push('event-token-in-filename');
  }

  return warnings;
}

/** Verbatim `imageinfo.extmetadata` shape this module reads — a subset of what the §6.7 recipe
 *  requests via `iiextmetadatafilter`. */
export interface RawExtMetadata {
  LicenseShortName?: { value: string };
  LicenseUrl?: { value: string };
  Artist?: { value: string };
  Credit?: { value: string };
  AttributionRequired?: { value: string };
  Restrictions?: { value: string };
  ImageDescription?: { value: string };
  DateTimeOriginal?: { value: string };
  ObjectName?: { value: string };
}

/** Wire shape of `prop=categories` under `formatversion=2`. */
export interface RawCategory {
  title: string; // "Category:...."
}

export interface RawFilePage {
  pageid: number;
  title: string; // "File:....jpg"
  imageinfo: {
    url: string;
    thumburl: string;
    width: number;
    height: number;
    mime: string;
    extmetadata: RawExtMetadata;
  };
  /** From `prop=categories` (§6.7) — a PAGE-level sibling of `imageinfo`, absent on a page that
   *  belongs to no category (rare, but possible). */
  categories?: RawCategory[];
}

/** Wire shape of a `prop=imageinfo` page under `formatversion=2`: `imageinfo` is an ARRAY (one
 *  entry per revision; `iilimit` defaults to 1) and is absent for pages that carry no file. The
 *  first live run (2026-09-03) crashed on `.extmetadata` of that array — normalize before use. */
export interface RawQueryPage {
  pageid: number;
  title: string;
  imageinfo?: RawFilePage['imageinfo'] | RawFilePage['imageinfo'][];
  categories?: RawCategory[];
}

/** Collapses the wire shape to the object shape `buildReviewCandidate()` reads; `null` when the
 *  page has no usable imageinfo (caller logs and skips — never a crash). */
export function normalizeQueryPage(page: RawQueryPage): RawFilePage | null {
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : page.imageinfo;
  if (!info || !info.extmetadata) return null;
  return { pageid: page.pageid, title: page.title, imageinfo: info, categories: page.categories };
}

export interface BuildCandidateParams {
  page: RawFilePage;
  makeId: string;
  modelId: string;
  sourceCategory: string;
  /** Structured Data P275 Q-ids for this file, from `wbgetentities` (§6.5). */
  p275: string[];
  minSourceWidth?: number;
  /** Injectable for deterministic tests; defaults to "now" (real fetches only). */
  now?: Date;
  /** The catalog model, for gate 2 (catalog-year window) and the `modelNameAbsent` signal.
   *  Optional — omitted by tests that need neither; the real call site always has it. */
  model?: CatalogModel;
  /** Every catalog make's display name, for gate 4 (second make in the filename). Optional —
   *  defaults to `[]` (gate never fires without the list). */
  makeNames?: string[];
  /** Structured Data P180 ("depicts") Q-ids, from the SAME `wbgetentities` call as `p275`. */
  p180?: string[];
  /** The source category's own Wikidata Q-id (`pageprops.wikibase_item`), if resolved —
   *  `p180Matches` signal only. */
  categoryQid?: string | null;
}

function stripUtmParams(url: string): string {
  try {
    const u = new URL(url);
    [...u.searchParams.keys()].filter((k) => k.startsWith('utm_')).forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

function descriptionUrlFor(fileTitle: string): string {
  return `https://commons.wikimedia.org/wiki/${fileTitle.replace(/ /g, '_')}`;
}

/**
 * Builds one `ReviewCandidate` from a raw Commons API file page, or returns `null` when the
 * licence gate itself rejects the file (§6.5) — a licence-denied file has no valid
 * `license.id` to report (the schema's `id` enum is the ALLOW list only), so it is filtered out
 * of the review file entirely rather than added with a fabricated license. Every OTHER
 * auto-reject reason (year confidence, `personality` restriction) still produces a candidate
 * with `decision: "reject"`, exactly as §3.4 describes.
 */
export function buildReviewCandidate(params: BuildCandidateParams): ReviewCandidate | null {
  const { page, makeId, modelId, sourceCategory, p275 } = params;
  const minSourceWidth = params.minSourceWidth ?? MIN_SOURCE_WIDTH;
  const meta = page.imageinfo.extmetadata;

  const licenseDecision = decideLicense({
    shortName: meta.LicenseShortName?.value,
    licenseUrl: meta.LicenseUrl?.value,
    p275,
  });
  if (licenseDecision.outcome === 'reject') return null;

  const currentYear = (params.now ?? new Date()).getFullYear();
  const dtoYear = dateTimeOriginalYear(meta.DateTimeOriginal?.value, 1885, currentYear + 1);
  const title = stripHtml(meta.ObjectName?.value);
  const description = stripHtml(meta.ImageDescription?.value);
  const filename = stripFileTitle(page.title);
  const yearScan = scanYearCandidates({
    title,
    description,
    dateTimeOriginalYear: dtoYear,
    minYear: 1885,
    maxYear: currentYear + 1,
  });

  const warnings = [...licenseDecision.warnings];
  // §4.7: gated on the USABLE 4:3 width (min(W, round(H*CROP_ASPECT))), not the raw width — a
  // wide-but-short panorama can fail this even with a large raw width. Same expression as
  // tools/crop.ts's `baseRect().bw0`, imported rather than re-derived, so this tool and the crop
  // tool cannot disagree (§4.7).
  if (baseRect(page.imageinfo.width, page.imageinfo.height).bw0 < minSourceWidth) {
    warnings.push('source-width-below-min');
  }

  const restrictions = parseRestrictions(meta.Restrictions?.value);

  // §3.1: `credit.author` is never empty and never the literal "Unknown" — that string is a
  // reject, not a value (§6.9's Kawasaki ZX-6R 636.JPG). A missing Artist auto-rejects here,
  // ahead of the personality/year-confidence checks.
  const author = stripHtml(meta.Artist?.value);
  // NOTE (§6.9 fixture 3): a prose credit REQUEST (e.g. "Please credit as X / Wikimedia Commons")
  // is observed in practice inside `Artist`'s free text, not only in `Credit` — the committed
  // fixture hand-authors `creditNote` correctly, but a live fetch of that same file may still
  // derive `null` here since only `extmetadata.Credit` is consulted below.
  const creditText = stripHtml(meta.Credit?.value);
  const creditNote = creditText && creditText !== author ? creditText : null;

  const gateWarnings = computeHardGateWarnings({
    title,
    description,
    filename,
    mime: page.imageinfo.mime,
    dtoYear,
    officialYearScan: yearScan,
    modelYears: params.model?.years ?? null,
    makeNames: params.makeNames ?? [],
    currentYear,
  });
  warnings.push(...gateWarnings);

  let decision: ReviewDecision = 'pending';
  if (!author) {
    decision = 'reject';
    warnings.push('no-machine-readable-author');
  } else if (restrictions.includes('personality')) {
    decision = 'reject';
  } else if (autoDecisionFor(yearScan.yearConfidence) === 'reject') {
    decision = 'reject';
  }
  if (gateWarnings.length > 0) decision = 'reject'; // the eight hard gates (§5), unconditionally

  const categories = (page.categories ?? []).map((c) => c.title);
  const p180 = params.p180 ?? [];
  const combinedText = `${title} ${description}`.toLowerCase();
  const signals: ReviewCandidateSignals = {
    museumWord:
      MUSEUM_OR_SHOW_WORD_RE.test(title) ||
      MUSEUM_OR_SHOW_WORD_RE.test(description) ||
      categories.some((c) => MUSEUM_OR_SHOW_WORD_RE.test(c)),
    seriesMarker: SERIES_MARKER_RE.test(filename),
    portrait: page.imageinfo.height > 1.15 * page.imageinfo.width,
    descriptionOnlyYear: yearScan.source === 'description',
    modelNameAbsent: params.model ? !combinedText.includes(params.model.name.toLowerCase()) : false,
    p180Present: p180.length > 0,
    p180Matches: p180.length === 0 || !params.categoryQid ? null : p180.includes(params.categoryQid),
    uploader: author || '(no machine-readable author)',
    categories,
  };

  return {
    candidateId: `M${page.pageid}`,
    decision,
    makeId,
    modelId,
    sourceCategory,
    fileTitle: page.title,
    descriptionUrl: descriptionUrlFor(page.title),
    thumbUrl: stripUtmParams(page.imageinfo.thumburl),
    originalUrl: page.imageinfo.url,
    width: page.imageinfo.width,
    height: page.imageinfo.height,
    mime: page.imageinfo.mime,
    license: {
      ...licenseDecision.license!,
      sdcP275: p275,
      attributionRequired: meta.AttributionRequired?.value === 'true',
    },
    author: author || '(no machine-readable author)', // never the bare word "Unknown" (§3.1)
    creditNote,
    restrictions,
    yearCandidates: yearScan.candidates,
    yearProposed: yearScan.yearProposed,
    yearConfidence: yearScan.yearConfidence,
    warnings,
    operator: EMPTY_OPERATOR_OVERRIDE,
    signals,
  };
}

// -------------------------------------------------------------------------------------------
// License family filter (--licenses pd,cc0,cc-by,cc-by-sa)
// -------------------------------------------------------------------------------------------

export type LicenseFamily = 'pd' | 'cc0' | 'cc-by' | 'cc-by-sa';

export function licenseFamilyOf(id: LicenseId): LicenseFamily {
  if (id === 'PD') return 'pd';
  if (id === 'CC0') return 'cc0';
  if (id.startsWith('CC-BY-SA-')) return 'cc-by-sa';
  return 'cc-by';
}

export function parseLicenseFamilies(spec: string | undefined): Set<LicenseFamily> {
  if (!spec) return new Set(['pd', 'cc0', 'cc-by', 'cc-by-sa']);
  return new Set(spec.split(',').map((s) => s.trim().toLowerCase()) as LicenseFamily[]);
}

// -------------------------------------------------------------------------------------------
// Network orchestration — walks each requested model's guessed category via WikimediaClient.
// Untestable without live network access; kept structurally simple and delegating every
// request through the client so --dry-run / an empty cache is mechanically offline (§8 DoD).
// -------------------------------------------------------------------------------------------

interface QueryResponse {
  query?: {
    pages?: RawQueryPage[];
  };
}

type ClaimBag = Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>>;

interface WbGetEntitiesResponse {
  // A MediaInfo entity ("M..." id) reports its properties under `statements` on every real
  // response verified against .cache/wikimedia — `claims` is the generic Wikibase alias that
  // never actually appears live. Reading both means a future API shape change can't silently
  // zero out P275/P180 again the way `statements`-only did before this fix.
  entities?: Record<string, { claims?: ClaimBag; statements?: ClaimBag }>;
}

export interface EntityClaims {
  /** Structured Data P275 (licence), authoritative for denial only (§6.5). */
  p275: string[];
  /** Structured Data P180 ("depicts") — signal only (§5), never a gate. */
  p180: string[];
}

/** One `wbgetentities` call for every file page in a walk, split into P275 (existing licence
 *  gate) and P180 (new `p180Present`/`p180Matches` signals) — same response, zero extra cost. */
async function fetchEntityClaims(client: WikimediaClient, mIds: string[]): Promise<Map<string, EntityClaims>> {
  const out = new Map<string, EntityClaims>();
  if (mIds.length === 0) return out;
  const url = `https://commons.wikimedia.org/w/api.php?action=wbgetentities&ids=${mIds.join('|')}&props=claims`;
  const result = await client.requestJson<WbGetEntitiesResponse>(url);
  const entities = result.data?.entities ?? {};
  for (const mId of mIds) {
    const bag = entities[mId]?.statements ?? entities[mId]?.claims ?? {};
    const qidsFor = (prop: string) =>
      (bag[prop] ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter((v): v is string => !!v);
    out.set(mId, { p275: qidsFor('P275'), p180: qidsFor('P180') });
  }
  return out;
}

interface CategoryInfoResponse {
  query?: { pages?: Array<{ title: string; pageprops?: { wikibase_item?: string } }> };
}

/** Resolves each category's own Wikidata Q-id (`pageprops.wikibase_item`, §6.7) for the
 *  `p180Matches` signal, batched 50 titles per call — no `redirects=1` (unlike the soft-redirect
 *  detection recipe): a redirected category's `pages[].title` would come back as the redirect
 *  TARGET, so a `Map` keyed by the guessed title would silently miss it. Without it, a redirect
 *  just resolves no Q-id (`p180Matches: null`), which is the safe failure here. */
async function fetchCategoryQids(client: WikimediaClient, categories: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(categories)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&prop=categoryinfo%7Cpageprops&` +
      `titles=${chunk.map(encodeURIComponent).join('%7C')}`;
    const result = await client.requestJson<CategoryInfoResponse>(url);
    if (result.wouldFetch) continue;
    for (const p of result.data?.query?.pages ?? []) {
      if (p.pageprops?.wikibase_item) out.set(p.title, p.pageprops.wikibase_item);
    }
  }
  return out;
}

export interface FetchOptions {
  modelIds: string[];
  outPath: string;
  batch: string;
  perModel?: number;
  minWidth?: number;
  licenses?: string;
  cacheDir?: string;
  catalogPath?: string;
  dryRun?: boolean;
}

export interface FetchResult {
  candidates: ReviewCandidate[];
  dryRun: boolean;
  stats: { cacheHits: number; networkRequests: number; wouldFetch: number };
  /** §6.5's precedence rule: the operator sees the gap instead of losing candidates invisibly. */
  filteredLicence: number;
  filteredFamily: number;
}

export async function fetchCandidates(opts: FetchOptions): Promise<FetchResult> {
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const catalogPath = opts.catalogPath ?? DEFAULT_CATALOG_PATH;
  const perModel = opts.perModel ?? 20;
  const minWidth = opts.minWidth ?? MIN_SOURCE_WIDTH;
  const families = parseLicenseFamilies(opts.licenses);

  const catalog: Catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  const makesById = new Map(catalog.makes.map((m) => [m.id, m]));
  const modelsById = new Map(catalog.models.map((m) => [m.id, m]));
  const makeNames = catalog.makes.map((m) => m.name); // gate 4 (second make in the filename)

  const client = new WikimediaClient({ cacheDir, dryRun: opts.dryRun ?? false });
  const candidates: ReviewCandidate[] = [];
  let filteredLicence = 0;
  let filteredFamily = 0;

  // Resolve (model, make, category) up front so category-Wikidata-item resolution (the
  // `p180Matches` signal) can be ONE batched call across every requested model instead of one
  // per model — unknown ids are still reported here, in the original per-model order.
  const walks: Array<{ model: CatalogModel; make: CatalogMake; category: string }> = [];
  for (const modelId of opts.modelIds) {
    const model = modelsById.get(modelId);
    if (!model) {
      console.error(`fetch.ts: unknown modelId "${modelId}" — skipping (not in ${catalogPath})`);
      continue;
    }
    const make = makesById.get(model.makeId);
    if (!make) {
      console.error(`fetch.ts: model "${modelId}" has unknown makeId "${model.makeId}" — skipping`);
      continue;
    }
    walks.push({ model, make, category: guessCategory(make, model) });
  }
  const categoryQids = await fetchCategoryQids(client, walks.map((w) => w.category));

  for (const { model, make, category } of walks) {
    const queryUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&` +
      `gcmtitle=${encodeURIComponent(category)}&gcmtype=file&gcmlimit=${perModel}&gcmsort=timestamp&gcmdir=desc&` +
      `prop=imageinfo%7Ccategories&cllimit=max&iiprop=extmetadata%7Curl%7Csize%7Cmime%7Ctimestamp&iiurlwidth=800&` +
      `iiextmetadatafilter=LicenseShortName%7CLicense%7CUsageTerms%7CArtist%7CCredit%7CAttribution%7C` +
      `AttributionRequired%7CCopyrighted%7CRestrictions%7CImageDescription%7CDateTimeOriginal%7CObjectName%7CLicenseUrl`;

    const queryResult = await client.requestJson<QueryResponse>(queryUrl);
    const pages = queryResult.data?.query?.pages ?? [];
    if (queryResult.wouldFetch) continue; // dry-run cache miss — nothing more to do for this model

    const mIds = pages.map((p) => `M${p.pageid}`);
    const claimsMap = await fetchEntityClaims(client, mIds);

    for (const rawPage of pages) {
      const page = normalizeQueryPage(rawPage);
      if (!page) {
        console.error(`fetch.ts: "${rawPage.title}" has no imageinfo — skipping`);
        continue;
      }
      const claims = claimsMap.get(`M${page.pageid}`);
      const built = buildReviewCandidate({
        page,
        makeId: make.id,
        modelId: model.id,
        sourceCategory: category,
        p275: claims?.p275 ?? [],
        p180: claims?.p180 ?? [],
        categoryQid: categoryQids.get(category) ?? null,
        minSourceWidth: minWidth,
        model,
        makeNames,
      });
      if (!built) {
        filteredLicence++;
        continue;
      }
      if (!families.has(licenseFamilyOf(built.license.id))) {
        filteredFamily++;
        continue;
      }
      candidates.push(built);
    }
  }

  if (!opts.dryRun) {
    const reviewFile: ReviewFile = {
      schema: 1,
      batch: opts.batch,
      generatedAt: new Date().toISOString().slice(0, 10),
      userAgent: assembleUserAgent(),
      candidates,
    };
    // Catch a fetcher-side shape drift here, before the operator ever hand-edits the file —
    // mirrors the read-side validate() tools/schedule.ts already runs in loadReviewFile().
    const reviewSchema = JSON.parse(await fs.readFile(REVIEW_SCHEMA_PATH, 'utf8')) as JSONSchema;
    const errors = validate(reviewSchema, reviewFile);
    if (errors.length > 0) {
      const detail = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
      throw new Error(`fetch.ts: built review file does not validate against review.schema.json:\n${detail}`);
    }
    await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
    await fs.writeFile(opts.outPath, `${JSON.stringify(reviewFile, null, 2)}\n`);
  }

  return { candidates, dryRun: opts.dryRun ?? false, stats: client.getStats(), filteredLicence, filteredFamily };
}

// -------------------------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function loadModelIds(args: Record<string, string | boolean>): Promise<string[]> {
  if (typeof args.models === 'string') {
    return args.models.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof args['models-file'] === 'string') {
    const raw = await fs.readFile(args['models-file'], 'utf8');
    return raw
      .split('\n')
      .map((line) => line.split('|')[0].trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }
  return [];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const modelIds = await loadModelIds(args);
  const outPath = typeof args.out === 'string' ? args.out : undefined;

  if (modelIds.length === 0 || !outPath) {
    console.error(
      'usage: tsx tools/fetch.ts --models <id,id,…> | --models-file <path> --out data/review/<batch>.json ' +
        '[--per-model 20] [--min-width 2182] [--licenses pd,cc0,cc-by,cc-by-sa] [--cache .cache/wikimedia] [--dry-run]',
    );
    process.exitCode = 1;
    return;
  }

  const batch = path.basename(outPath).replace(/\.json$/, '');
  const result = await fetchCandidates({
    modelIds,
    outPath: path.resolve(outPath),
    batch,
    perModel: args['per-model'] ? Number(args['per-model']) : undefined,
    minWidth: args['min-width'] ? Number(args['min-width']) : undefined,
    licenses: typeof args.licenses === 'string' ? args.licenses : undefined,
    cacheDir: typeof args.cache === 'string' ? args.cache : undefined,
    dryRun: args['dry-run'] === true,
  });

  console.log(
    `fetch: ${result.candidates.length} candidate(s); ${result.filteredLicence} licence-rejected, ` +
      `${result.filteredFamily} outside --licenses; cache hits=${result.stats.cacheHits} ` +
      `network=${result.stats.networkRequests} would-fetch=${result.stats.wouldFetch}`,
  );
  if (!result.dryRun) console.log(`fetch: wrote ${outPath}`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
