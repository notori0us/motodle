/**
 * `tools/add.ts` — the no-AI manual path (docs/ROADMAP.md item 3): one command from a Commons
 * file or an operator's own photo to a scheduled puzzle + an eyeball-able preview page. Reuses
 * every gate the AI batch path uses — `buildReviewCandidate()` (fetch.ts), the review schema,
 * and `schedule.ts`'s pre-flight asserts + `scheduleApproved()` itself — so nothing downstream
 * of `data/review/*.json` needs to know which path produced a candidate (docs/CONTENT-RUNBOOK.md
 * "Manual path").
 *
 * CLI:
 *   tsx tools/add.ts --commons "File:…" --model <catalogModelId> --year <yyyy> --date <yyyy-mm-dd>
 *                     [--focus x,y] [--crop x,y,w,h] [--note "…"] [--review data/review/manual.json]
 *                     [--dry-run]
 *   tsx tools/add.ts --file <path> --author "<name>" [--license CC0|PD] --model <id> --year <yyyy>
 *                     --date <yyyy-mm-dd> [--focus x,y] [--crop x,y,w,h] [--note "…"]
 *                     [--review data/review/manual.json] [--dry-run]
 *
 * `--dry-run` skips ONLY the final `scheduleApproved()` call and the preview-page write — the
 * Commons query (for `--commons`), the schema validation, the review-file upsert, the original
 * being cached, and the schedule.ts pre-flight checks all still run for real. That is what makes
 * `--dry-run` useful as the "prove the query recipe works" smoke test: it is not an offline mode.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Catalog, CatalogMake, CatalogModel, LicenseId, OperatorOverride, Puzzle, ReviewCandidate, ReviewFile } from '../schema/types';
import { validate, type JSONSchema } from '../schema/validate';
import { buildReviewCandidate, guessCategory, normalizeQueryPage, type RawQueryPage } from './fetch';
import { assembleUserAgent, cacheKeyFor, WikimediaClient } from './lib/wikimedia';
import { localToday } from './lib/date';
import { assertAuthorPresent, assertSourceWidthApprovable, needsYearRescue, scheduleApproved, type ScheduleResult } from './schedule';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DEFAULT_CATALOG_PATH = path.join(ROOT, 'public/catalog.json');
const DEFAULT_CACHE_DIR = path.join(ROOT, '.cache/wikimedia');
const DEFAULT_PUZZLES_DIR = path.join(ROOT, 'public/puzzles');
const DEFAULT_ATTRIBUTION_PATH = path.join(ROOT, 'docs/ATTRIBUTION.md');
const DEFAULT_REVIEW_PATH = path.join(ROOT, 'data/review/manual.json');
const DEFAULT_PREVIEW_DIR = path.join(ROOT, 'data/preview');
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
// Pure helpers — argument parsing, URL builders, candidate assembly. No I/O below this section
// except where a function name says otherwise; all are unit-tested directly (tools/add.test.ts).
// -------------------------------------------------------------------------------------------

export interface FocusArg {
  x: number;
  y: number;
}

export interface CropArg {
  x: number;
  y: number;
  w: number;
  h: number;
}

function assertFraction(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`tools/add.ts: ${name} must be a number in [0,1], got "${v}"`);
  }
}

/** "0.4,0.5" -> {x:0.4,y:0.5}. Bounds match `schema/review.schema.json`'s `operatorFocus`. */
export function parseFocusArg(spec: string): FocusArg {
  const parts = spec.split(',').map(Number);
  if (parts.length !== 2) throw new Error(`tools/add.ts: --focus must be "x,y", got "${spec}"`);
  const [x, y] = parts;
  assertFraction('--focus x', x);
  assertFraction('--focus y', y);
  return { x, y };
}

/** "0,0,1,0.9" -> {x:0,y:0,w:1,h:0.9}. Bounds match `operatorSourceCrop`. */
export function parseCropArg(spec: string): CropArg {
  const parts = spec.split(',').map(Number);
  if (parts.length !== 4) throw new Error(`tools/add.ts: --crop must be "x,y,w,h", got "${spec}"`);
  const [x, y, w, h] = parts;
  assertFraction('--crop x', x);
  assertFraction('--crop y', y);
  assertFraction('--crop w', w);
  assertFraction('--crop h', h);
  return { x, y, w, h };
}

/** Same `YYYY-MM-DD` check `schedule.ts` runs — checked here too so `--dry-run` (which never
 *  reaches `scheduleApproved()`) still fails loudly on a bad `--date`. */
export function isValidDateArg(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
}

/** The one-file equivalent of `tools/fetch.ts`'s category-walk query: same `iiprop` /
 *  `iiextmetadatafilter` recipe (§6.7), `titles=` instead of `generator=categorymembers`. */
export function commonsFileQueryUrl(fileTitle: string): string {
  const title = fileTitle.startsWith('File:') ? fileTitle : `File:${fileTitle}`;
  return (
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&` +
    `prop=imageinfo%7Ccategories&cllimit=max&iiprop=extmetadata%7Curl%7Csize%7Cmime%7Ctimestamp&iiurlwidth=800&` +
    `iiextmetadatafilter=LicenseShortName%7CLicense%7CUsageTerms%7CArtist%7CCredit%7CAttribution%7C` +
    `AttributionRequired%7CCopyrighted%7CRestrictions%7CImageDescription%7CDateTimeOriginal%7CObjectName%7CLicenseUrl`
  );
}

/** SDC P275 for exactly one file (§6.5) — the single-id equivalent of `fetch.ts`'s batched
 *  `fetchEntityClaims()`, which is not exported. */
export function wbgetentitiesUrl(mId: string): string {
  return `https://commons.wikimedia.org/w/api.php?action=wbgetentities&ids=${mId}&props=claims`;
}

type ClaimBag = Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>>;
interface WbGetEntitiesResponse {
  entities?: Record<string, { claims?: ClaimBag; statements?: ClaimBag }>;
}

/** Extracts P275 Q-ids for one M-id from a `wbgetentities` response — reads `statements` first,
 *  falling back to `claims` (fetch.ts's fix for the same live-shape gotcha, §6.5). */
export function extractP275(response: WbGetEntitiesResponse, mId: string): string[] {
  const bag = response.entities?.[mId]?.statements ?? response.entities?.[mId]?.claims ?? {};
  return (bag.P275 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter((v): v is string => !!v);
}

const LICENSE_PRESETS: Record<'CC0' | 'PD', { name: string; url: string }> = {
  CC0: { name: 'CC0 1.0 Universal', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  PD: { name: 'Public domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
};

const FORMAT_TO_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
};

/** The synthetic cache key for an own photo — never a real URL, so it can't collide with (or be
 *  mistaken for) an actual Commons request; keyed by content hash so re-adding the same file
 *  re-uses the same cache entry. `requestBinary()` never appends mandatory params (§6.7's
 *  `withMandatoryParams` is an `api.php` convention), so `cacheKeyFor(url)` here matches exactly
 *  what `schedule.ts`'s cache-only read will look up. */
export function localUploadUrl(sha256: string): string {
  return `motodle://local-upload/${sha256}`;
}

/** `M` + the decimal value of the file's first 12 sha256 hex digits. `schema/review.schema.json`
 *  requires `candidateId` to match `^M[0-9]+$` (real Commons M-ids are "M" + a numeric pageid) —
 *  editing that pattern is outside this lane, so an own photo's id is derived numerically rather
 *  than the literal `sub-<hash>` shape docs/ROADMAP.md sketches. A 48-bit value is many orders of
 *  magnitude past any real Commons pageid today, so it cannot collide with one; deriving it from
 *  the file's own bytes keeps re-running `add` on the same photo an upsert, not a duplicate. */
export function ownPhotoCandidateId(sha256Hex: string): string {
  return `M${BigInt(`0x${sha256Hex.slice(0, 12)}`).toString()}`;
}

/** Pure: create-or-replace-by-candidateId into a `ReviewFile`'s candidate list. */
export function upsertCandidate(file: ReviewFile, candidate: ReviewCandidate): ReviewFile {
  const idx = file.candidates.findIndex((c) => c.candidateId === candidate.candidateId);
  const candidates =
    idx === -1 ? [...file.candidates, candidate] : file.candidates.map((c, i) => (i === idx ? candidate : c));
  return { ...file, generatedAt: localToday(), candidates };
}

// -------------------------------------------------------------------------------------------
// Options
// -------------------------------------------------------------------------------------------

export interface AddOptions {
  commons?: string;
  file?: string;
  author?: string;
  license?: 'CC0' | 'PD';
  model: string;
  year: number;
  date: string;
  focus?: FocusArg;
  crop?: CropArg;
  note?: string;
  dryRun?: boolean;
  reviewPath?: string;
  catalogPath?: string;
  cacheDir?: string;
  puzzlesDir?: string;
  attributionPath?: string;
  previewDir?: string;
}

interface ResolvedAddOptions extends AddOptions {
  reviewPath: string;
  catalogPath: string;
  cacheDir: string;
  puzzlesDir: string;
  attributionPath: string;
  previewDir: string;
}

function resolveOptions(opts: AddOptions): ResolvedAddOptions {
  if (!opts.commons && !opts.file) {
    throw new Error('tools/add.ts: pass either --commons "File:…" or --file <path>');
  }
  if (opts.commons && opts.file) {
    throw new Error('tools/add.ts: --commons and --file are mutually exclusive');
  }
  if (opts.file && !opts.author) {
    throw new Error('tools/add.ts: --file requires --author "<name>"');
  }
  if (!opts.model) throw new Error('tools/add.ts: --model is required');
  if (!Number.isInteger(opts.year)) throw new Error('tools/add.ts: --year must be an integer, e.g. 1996');
  if (!opts.date || !isValidDateArg(opts.date)) {
    throw new Error(`tools/add.ts: --date must be a valid YYYY-MM-DD date, got "${opts.date}"`);
  }
  return {
    ...opts,
    reviewPath: opts.reviewPath ?? DEFAULT_REVIEW_PATH,
    catalogPath: opts.catalogPath ?? DEFAULT_CATALOG_PATH,
    cacheDir: opts.cacheDir ?? DEFAULT_CACHE_DIR,
    puzzlesDir: opts.puzzlesDir ?? DEFAULT_PUZZLES_DIR,
    attributionPath: opts.attributionPath ?? DEFAULT_ATTRIBUTION_PATH,
    previewDir: opts.previewDir ?? DEFAULT_PREVIEW_DIR,
  };
}

// -------------------------------------------------------------------------------------------
// Candidate construction — one path per mode.
// -------------------------------------------------------------------------------------------

async function buildFromCommons(
  opts: ResolvedAddOptions,
  make: CatalogMake,
  model: CatalogModel,
  catalog: Catalog,
  client: WikimediaClient,
): Promise<ReviewCandidate> {
  const title = opts.commons!.startsWith('File:') ? opts.commons! : `File:${opts.commons}`;
  const queryResult = await client.requestJson<{ query?: { pages?: RawQueryPage[] } }>(commonsFileQueryUrl(title));
  const rawPage = queryResult.data?.query?.pages?.[0];
  const page = rawPage ? normalizeQueryPage(rawPage) : null;
  if (!page) {
    throw new Error(`tools/add.ts: "${title}" was not found on Commons (or has no imageinfo — not a file page?)`);
  }

  const mId = `M${page.pageid}`;
  const wbResult = await client.requestJson<WbGetEntitiesResponse>(wbgetentitiesUrl(mId));
  const p275 = wbResult.data ? extractP275(wbResult.data, mId) : [];

  const built = buildReviewCandidate({
    page,
    makeId: make.id,
    modelId: model.id,
    sourceCategory: guessCategory(make, model),
    p275,
    model,
    makeNames: catalog.makes.map((m) => m.name),
  });
  if (!built) {
    throw new Error(
      `tools/add.ts: "${title}"'s licence is not on the schema/PLAN §6.5 allow-list — cannot add this file`,
    );
  }
  return built;
}

async function buildFromFile(opts: ResolvedAddOptions): Promise<{ candidate: ReviewCandidate; originalUrl: string; bytes: Buffer }> {
  const bytes = await fs.readFile(opts.file!);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`tools/add.ts: could not read image dimensions of "${opts.file}"`);
  }
  const licenseId: 'CC0' | 'PD' = opts.license ?? 'CC0';
  const preset = LICENSE_PRESETS[licenseId];
  const originalUrl = localUploadUrl(sha256);

  const candidate: ReviewCandidate = {
    candidateId: ownPhotoCandidateId(sha256),
    decision: 'pending', // runAdd() sets 'approve' uniformly for both modes
    makeId: '', // filled in by the caller, which has make/model in scope
    modelId: '',
    sourceCategory: 'manual-upload',
    fileTitle: path.basename(opts.file!),
    descriptionUrl: 'https://playmotodle.com/about.html', // own photo: no source page; must stay an https URL (credit link)
    thumbUrl: originalUrl,
    originalUrl,
    width: meta.width,
    height: meta.height,
    mime: FORMAT_TO_MIME[meta.format ?? ''] ?? 'application/octet-stream',
    license: { id: licenseId, name: preset.name, url: preset.url, jurisdiction: null, sdcP275: [], attributionRequired: false },
    author: opts.author!,
    creditNote: null,
    restrictions: [],
    yearCandidates: [],
    yearProposed: null,
    yearConfidence: 'none',
    warnings: [],
    // No fetcher proposal exists to compare against for an own photo — the operator's --year IS
    // the only evidence, so it is always an operator override (never left to needsYearRescue).
    operator: { ...EMPTY_OPERATOR_OVERRIDE, year: opts.year },
  };
  return { candidate, originalUrl, bytes };
}

// -------------------------------------------------------------------------------------------
// Cache warming
// -------------------------------------------------------------------------------------------

/** Mirrors `tools/lib/wikimedia.ts`'s private `CacheEnvelope` shape by convention (not imported —
 *  `writeCacheEntry` isn't exported) so `schedule.ts`'s cache-only `requestBinary()` finds a hit. */
async function writeSyntheticCacheEntry(cacheDir: string, url: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${cacheKeyFor(url)}.json`);
  await fs.writeFile(
    file,
    JSON.stringify({ url, fetchedAt: new Date().toISOString(), encoding: 'base64', body: bytes.toString('base64') }),
  );
}

// -------------------------------------------------------------------------------------------
// Review file I/O
// -------------------------------------------------------------------------------------------

async function loadOrCreateReviewFile(reviewPath: string): Promise<ReviewFile> {
  try {
    const raw = await fs.readFile(reviewPath, 'utf8');
    return JSON.parse(raw) as ReviewFile;
  } catch {
    const batch = path.basename(reviewPath).replace(/\.json$/, '');
    return { schema: 1, batch, generatedAt: localToday(), userAgent: assembleUserAgent(), candidates: [] };
  }
}

async function writeReviewFile(reviewPath: string, file: ReviewFile): Promise<void> {
  await fs.mkdir(path.dirname(reviewPath), { recursive: true });
  await fs.writeFile(reviewPath, `${JSON.stringify(file, null, 2)}\n`);
}

// -------------------------------------------------------------------------------------------
// Preview page
// -------------------------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = { '.webp': 'image/webp' };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function dataUri(puzzlesDir: string, relSrc: string): Promise<string> {
  const bytes = await fs.readFile(path.join(puzzlesDir, relSrc));
  const ext = path.extname(relSrc).toLowerCase();
  return `data:${MIME_BY_EXT[ext] ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`;
}

async function writePreviewPage(previewPath: string, puzzlesDir: string, puzzle: Puzzle): Promise<void> {
  const levelImgs = await Promise.all(
    puzzle.image.levels.map(async (l) => ({ ...l, dataUri: await dataUri(puzzlesDir, l.src) })),
  );
  const fullDataUri = await dataUri(puzzlesDir, puzzle.image.full.src);

  const levelsHtml = levelImgs
    .map(
      (l) => `
    <figure>
      <img src="${l.dataUri}" alt="level ${l.level}" width="${l.w}" height="${l.h}">
      <figcaption>l${l.level} — ${l.w}×${l.h}px, ${l.bytes.toLocaleString()} bytes</figcaption>
    </figure>`,
    )
    .join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Motodle preview — ${escapeHtml(puzzle.id)}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; background: #111; color: #eee; padding: 24px; }
  h1 { font-size: 18px; }
  .levels { display: flex; flex-wrap: wrap; gap: 16px; }
  figure { margin: 0; }
  figure img { display: block; background: #222; max-width: 320px; }
  figcaption { font-size: 12px; color: #aaa; margin-top: 4px; }
  .full img { max-width: 640px; }
  .answer { font-size: 20px; font-weight: 600; margin: 16px 0; }
  .credit { font-size: 12px; color: #aaa; margin-top: 24px; }
  .credit a { color: #8ab4ff; }
</style>
</head>
<body>
<h1>${escapeHtml(puzzle.id)} — ${escapeHtml(puzzle.date)} (puzzle #${puzzle.number})</h1>
<div class="answer">Answer: ${escapeHtml(puzzle.answer.make)} ${escapeHtml(puzzle.answer.model)} (${puzzle.answer.year})</div>
<div class="levels">
${levelsHtml}
  <figure class="full">
    <img src="${fullDataUri}" alt="full reveal">
    <figcaption>full — ${puzzle.image.full.w}×${puzzle.image.full.h}px, ${puzzle.image.full.bytes.toLocaleString()} bytes</figcaption>
  </figure>
</div>
<div class="credit">
  ${escapeHtml(puzzle.credit.fileTitle)} by ${escapeHtml(puzzle.credit.author)} —
  <a href="${escapeHtml(puzzle.credit.descriptionUrl)}">${escapeHtml(puzzle.credit.license.name)}</a>,
  ${escapeHtml(puzzle.credit.modified)}${puzzle.credit.creditNote ? ` — ${escapeHtml(puzzle.credit.creditNote)}` : ''}
  <br>Year evidence (${puzzle.yearEvidence.confidence}, ${escapeHtml(puzzle.yearEvidence.source)}): ${escapeHtml(puzzle.yearEvidence.note)}
</div>
</body>
</html>
`;
  await fs.mkdir(path.dirname(previewPath), { recursive: true });
  await fs.writeFile(previewPath, html);
}

// -------------------------------------------------------------------------------------------
// Public entry point
// -------------------------------------------------------------------------------------------

export interface AddResult {
  candidate: ReviewCandidate;
  reviewPath: string;
  scheduled: boolean;
  previewPath: string | null;
  scheduleResult?: ScheduleResult;
}

export async function runAdd(rawOpts: AddOptions): Promise<AddResult> {
  const opts = resolveOptions(rawOpts);
  const catalog: Catalog = JSON.parse(await fs.readFile(opts.catalogPath, 'utf8'));
  const model = catalog.models.find((m) => m.id === opts.model);
  if (!model) throw new Error(`tools/add.ts: modelId "${opts.model}" not found in ${opts.catalogPath}`);
  const make = catalog.makes.find((m) => m.id === model.makeId);
  if (!make) throw new Error(`tools/add.ts: model "${opts.model}" has unknown makeId "${model.makeId}"`);

  let candidate: ReviewCandidate;
  let warmCache: () => Promise<void>;

  if (opts.commons) {
    const client = new WikimediaClient({ cacheDir: opts.cacheDir, dryRun: false });
    candidate = await buildFromCommons(opts, make, model, catalog, client);
    warmCache = async () => {
      await client.requestBinary(candidate.originalUrl); // prefetch.ts's own logic — cache the original
    };
  } else {
    const built = await buildFromFile(opts);
    candidate = { ...built.candidate, makeId: make.id, modelId: model.id };
    warmCache = () => writeSyntheticCacheEntry(opts.cacheDir, built.originalUrl, built.bytes);
  }

  if (candidate.restrictions.includes('personality')) {
    throw new Error(
      `tools/add.ts: candidate ${candidate.candidateId} carries the uploader's "personality" restriction — ` +
        'auto-reject of record (PLAN §6, identifiable people). No override.',
    );
  }
  candidate.decision = 'approve';
  if (opts.focus) candidate.operator = { ...candidate.operator, focus: opts.focus };
  if (opts.crop) candidate.operator = { ...candidate.operator, sourceCrop: opts.crop };
  if (opts.note) candidate.operator = { ...candidate.operator, note: opts.note };
  if (opts.commons) {
    // Only override when the operator's --year disagrees with the fetcher proposal, OR the
    // proposal's own confidence could never ship unrescued anyway (§6.4) — an operator who
    // types --year 1978 against a proposal that already reads 1978 at "low" confidence still
    // needs a rescue; without this clause they would hit needsYearRescue()'s hard failure below
    // with no way to confirm the year they already typed. Preserves the richer fetcher-derived
    // yearEvidence (title/description sourcing) whenever it already agrees at high/medium.
    const lowOrNone = candidate.yearConfidence === 'low' || candidate.yearConfidence === 'none';
    if (candidate.yearProposed !== opts.year || lowOrNone) {
      candidate.operator = { ...candidate.operator, year: opts.year };
    }
  }

  const reviewSchema = JSON.parse(await fs.readFile(REVIEW_SCHEMA_PATH, 'utf8')) as JSONSchema;
  const existing = await loadOrCreateReviewFile(opts.reviewPath);
  const merged = upsertCandidate(existing, candidate);
  const errors = validate(reviewSchema, merged);
  if (errors.length > 0) {
    const detail = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`tools/add.ts: candidate does not validate against review.schema.json:\n${detail}`);
  }
  await writeReviewFile(opts.reviewPath, merged);
  await warmCache();

  if (needsYearRescue(candidate)) {
    // Unreachable for --file (always operator-sourced) and for --commons given the clause above —
    // kept as a hard stop rather than silently scheduling an unsupported year (§3.4, §6.3).
    throw new Error(
      `tools/add.ts: candidate ${candidate.candidateId} has yearConfidence "${candidate.yearConfidence}" and ` +
        'no operator.year rescue — this should be unreachable; pass a --year the operator can stand behind.',
    );
  }
  assertSourceWidthApprovable(candidate);
  assertAuthorPresent(candidate);

  const result: AddResult = { candidate, reviewPath: opts.reviewPath, scheduled: false, previewPath: null };
  if (opts.dryRun) return result;

  // Scope the actual schedule run to ONLY this candidate. scheduleApproved() sweeps every
  // decision:"approve" row in the given review file onto sequential dates starting at
  // --start (schedule.ts §6.3) — running it against the accumulated data/review/manual.json
  // would silently re-date every earlier manual add too. "For exactly that date" (ROADMAP item
  // 3) means a throwaway single-candidate file, scheduled once, then discarded.
  const scratchPath = path.join(os.tmpdir(), `motodle-add-schedule-${candidate.candidateId}-${process.pid}-${Date.now()}.json`);
  const scratchFile: ReviewFile = {
    schema: 1,
    batch: 'manual-add-scratch',
    generatedAt: localToday(),
    userAgent: assembleUserAgent(),
    candidates: [candidate],
  };
  let scheduleResult: ScheduleResult;
  try {
    await fs.writeFile(scratchPath, JSON.stringify(scratchFile, null, 2));
    scheduleResult = await scheduleApproved({
      reviewPath: scratchPath,
      startDate: opts.date,
      puzzlesDir: opts.puzzlesDir,
      catalogPath: opts.catalogPath,
      cacheDir: opts.cacheDir,
      attributionPath: opts.attributionPath,
    });
  } finally {
    await fs.rm(scratchPath, { force: true });
  }

  const puzzleRaw = await fs.readFile(path.join(opts.puzzlesDir, `${opts.date}.json`), 'utf8');
  const puzzle = JSON.parse(puzzleRaw) as Puzzle;
  const previewPath = path.join(opts.previewDir, `${opts.date}.html`);
  await writePreviewPage(previewPath, opts.puzzlesDir, puzzle);

  return { ...result, scheduled: true, previewPath, scheduleResult };
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

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const commons = str(args.commons);
  const file = str(args.file);
  if (!commons && !file) {
    console.error(
      'usage: tsx tools/add.ts --commons "File:…" | --file <path> --author "<name>" [--license CC0|PD] ' +
        '--model <catalogModelId> --year <yyyy> --date <yyyy-mm-dd> [--focus x,y] [--crop x,y,w,h] ' +
        '[--note "…"] [--review data/review/manual.json] [--dry-run]',
    );
    process.exitCode = 1;
    return;
  }

  const license = str(args.license);
  if (license !== undefined && license !== 'CC0' && license !== 'PD') {
    console.error('usage: --license must be CC0 or PD');
    process.exitCode = 1;
    return;
  }

  const opts: AddOptions = {
    commons,
    file,
    author: str(args.author),
    license: license as 'CC0' | 'PD' | undefined,
    model: str(args.model) ?? '',
    year: Number(str(args.year)),
    date: str(args.date) ?? '',
    focus: str(args.focus) ? parseFocusArg(str(args.focus)!) : undefined,
    crop: str(args.crop) ? parseCropArg(str(args.crop)!) : undefined,
    note: str(args.note),
    reviewPath: str(args.review) ? path.resolve(str(args.review)!) : undefined,
    dryRun: args['dry-run'] === true,
  };

  const result = await runAdd(opts);

  console.log(`add: candidate ${result.candidate.candidateId} upserted into ${result.reviewPath}`);
  if (result.candidate.warnings.length > 0) {
    console.log(`add: candidate warnings (approved over them by operator choice): ${result.candidate.warnings.join(', ')}`);
  }
  if (!result.scheduled) {
    console.log(`add: --dry-run — would schedule ${opts.date} for ${opts.model} (${opts.year})`);
    return;
  }
  const scheduled = result.scheduleResult!.scheduled[0];
  console.log(`add: scheduled ${scheduled.date} (${scheduled.id}) <- candidate ${scheduled.candidateId}`);
  console.log(`add: preview written to ${result.previewPath}`);
  console.log('add: next — open the preview in a browser, then `npm run generate`, `npm test`, commit, push.');
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
