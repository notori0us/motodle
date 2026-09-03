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
  ReviewDecision,
  ReviewFile,
} from '../schema/types';
import { baseRect } from './crop';
import { decideLicense } from './lib/licence';
import { assembleUserAgent, WikimediaClient } from './lib/wikimedia';
import { autoDecisionFor, scanYearCandidates } from './lib/year';
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

/** Leading 4-digit year out of an EXIF-style (`2013:11:09 ...`) or ISO DateTimeOriginal string. */
export function dateTimeOriginalYear(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = /^(\d{4})/.exec(value.trim());
  return m ? Number(m[1]) : null;
}

/** Guesses a Commons category from a catalog make+model — the recon-verified pattern
 *  (`Category:${make} ${model}`, §6.7). Commons category naming is not fully regular, so this
 *  is a starting point the operator can override via `--models-file` entries shaped as
 *  `modelId|Category override` (one per line) rather than a bare model id. */
export function guessCategory(make: CatalogMake, model: CatalogModel): string {
  return `Category:${make.name} ${model.name}`;
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
}

/** Wire shape of a `prop=imageinfo` page under `formatversion=2`: `imageinfo` is an ARRAY (one
 *  entry per revision; `iilimit` defaults to 1) and is absent for pages that carry no file. The
 *  first live run (2026-09-03) crashed on `.extmetadata` of that array — normalize before use. */
export interface RawQueryPage {
  pageid: number;
  title: string;
  imageinfo?: RawFilePage['imageinfo'] | RawFilePage['imageinfo'][];
}

/** Collapses the wire shape to the object shape `buildReviewCandidate()` reads; `null` when the
 *  page has no usable imageinfo (caller logs and skips — never a crash). */
export function normalizeQueryPage(page: RawQueryPage): RawFilePage | null {
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : page.imageinfo;
  if (!info || !info.extmetadata) return null;
  return { pageid: page.pageid, title: page.title, imageinfo: info };
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

  const dtoYear = dateTimeOriginalYear(meta.DateTimeOriginal?.value);
  const currentYear = (params.now ?? new Date()).getFullYear();
  const yearScan = scanYearCandidates({
    title: stripHtml(meta.ObjectName?.value),
    description: stripHtml(meta.ImageDescription?.value),
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

  let decision: ReviewDecision = 'pending';
  if (!author) {
    decision = 'reject';
    warnings.push('no-machine-readable-author');
  } else if (restrictions.includes('personality')) {
    decision = 'reject';
  } else if (autoDecisionFor(yearScan.yearConfidence) === 'reject') {
    decision = 'reject';
  }

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

interface WbGetEntitiesResponse {
  entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>> }>;
}

async function fetchP275(client: WikimediaClient, mIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (mIds.length === 0) return out;
  const url = `https://commons.wikimedia.org/w/api.php?action=wbgetentities&ids=${mIds.join('|')}&props=claims`;
  const result = await client.requestJson<WbGetEntitiesResponse>(url);
  const entities = result.data?.entities ?? {};
  for (const mId of mIds) {
    const claims = entities[mId]?.claims?.P275 ?? [];
    const qids = claims.map((c) => c.mainsnak?.datavalue?.value?.id).filter((v): v is string => !!v);
    out.set(mId, qids);
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

  const client = new WikimediaClient({ cacheDir, dryRun: opts.dryRun ?? false });
  const candidates: ReviewCandidate[] = [];
  let filteredLicence = 0;
  let filteredFamily = 0;

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
    const category = guessCategory(make, model);

    const queryUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&` +
      `gcmtitle=${encodeURIComponent(category)}&gcmtype=file&gcmlimit=${perModel}&gcmsort=timestamp&gcmdir=desc&` +
      `prop=imageinfo&iiprop=extmetadata%7Curl%7Csize%7Cmime%7Ctimestamp&iiurlwidth=800&` +
      `iiextmetadatafilter=LicenseShortName%7CLicense%7CUsageTerms%7CArtist%7CCredit%7CAttribution%7C` +
      `AttributionRequired%7CCopyrighted%7CRestrictions%7CImageDescription%7CDateTimeOriginal%7CObjectName%7CLicenseUrl`;

    const queryResult = await client.requestJson<QueryResponse>(queryUrl);
    const pages = queryResult.data?.query?.pages ?? [];
    if (queryResult.wouldFetch) continue; // dry-run cache miss — nothing more to do for this model

    const mIds = pages.map((p) => `M${p.pageid}`);
    const p275Map = await fetchP275(client, mIds);

    for (const rawPage of pages) {
      const page = normalizeQueryPage(rawPage);
      if (!page) {
        console.error(`fetch.ts: "${rawPage.title}" has no imageinfo — skipping`);
        continue;
      }
      const built = buildReviewCandidate({
        page,
        makeId: make.id,
        modelId: model.id,
        sourceCategory: category,
        p275: p275Map.get(`M${page.pageid}`) ?? [],
        minSourceWidth: minWidth,
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
