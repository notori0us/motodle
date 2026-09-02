/**
 * `tools/schedule.ts` — approved review candidates -> `public/puzzles/**` (§6.2, §6.3). Offline
 * (Network: ✗, §6.1): every source image byte it needs was already downloaded and cached by
 * `npm run fetch`; this tool only ever reads `.cache/wikimedia/` in cache-only mode (never makes
 * a real HTTP request) and refuses loudly when something it needs is not already cached.
 *
 * CLI:
 *   tsx tools/schedule.ts --review data/review/<batch>.json --start 2026-09-05 [--dry-run] [--force]
 *
 * Two-phase: PLAN every approved candidate first (resolve catalog ids, year evidence, crop
 * params, check for an existing-date conflict, confirm the source original is cached) — any
 * failure aborts before anything is written, so a bad batch never leaves a half-written puzzle
 * set. Then EXECUTE (crop + write) unless `--dry-run`.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CROP_FRACTIONS, DEFAULT_FOCUS, LAUNCH_DATE, MIN_LEVEL1_PX, MIN_SOURCE_WIDTH } from '../schema/constants';
import type {
  Catalog,
  CreditBlock,
  FocusPoint,
  OperatorOverride,
  ReviewCandidate,
  ReviewFile,
  SourceCrop,
  YearConfidence,
  YearEvidence,
} from '../schema/types';
import { validate, type JSONSchema } from '../schema/validate';
import { renderAttribution } from './lib/attribution';
import { addDays, localToday, puzzleId, puzzleNumber } from './lib/date';
import { baseRect, computeExtractRects } from './crop';
import { buildPuzzle, readAllPuzzles, writeJson, writeManifest } from './lib/puzzle-build';
import { WikimediaClient } from './lib/wikimedia';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const DEFAULT_PUZZLES_DIR = path.join(ROOT, 'public/puzzles');
const DEFAULT_CATALOG_PATH = path.join(ROOT, 'public/catalog.json');
const DEFAULT_CACHE_DIR = path.join(ROOT, '.cache/wikimedia');
const DEFAULT_ATTRIBUTION_PATH = path.join(ROOT, 'docs/ATTRIBUTION.md');

const MODIFIED_TEXT = 'cropped, resized, re-encoded to WebP'; // §6.5a, constant for this pipeline

// -------------------------------------------------------------------------------------------
// Options / result shapes
// -------------------------------------------------------------------------------------------

export interface ScheduleOptions {
  reviewPath: string;
  startDate: string;
  dryRun?: boolean;
  force?: boolean;
  puzzlesDir?: string;
  catalogPath?: string;
  cacheDir?: string;
  attributionPath?: string;
  launchDate?: string;
}

export interface ScheduledEntry {
  date: string;
  id: string;
  candidateId: string;
}

export interface ScheduleResult {
  scheduled: ScheduledEntry[];
  dryRun: boolean;
}

interface Plan {
  date: string;
  number: number;
  id: string;
  candidate: ReviewCandidate;
  makeId: string;
  make: string;
  modelId: string;
  model: string;
  year: number;
  acceptModelIds: string[];
  focus: FocusPoint;
  sourceCrop: SourceCrop | null;
  cropFractions: readonly number[];
  credit: CreditBlock;
  yearEvidence: YearEvidence;
  originalBytes: Buffer;
  originalMime: string;
}

// -------------------------------------------------------------------------------------------
// Pure helpers (unit-tested directly)
// -------------------------------------------------------------------------------------------

/** §3.4/§6.3: the whole run refuses if ANY approved candidate has yearConfidence low/none and
 *  no operator.year rescue. */
export function needsYearRescue(candidate: ReviewCandidate): boolean {
  const lowOrNone: YearConfidence[] = ['low', 'none'];
  return candidate.operator.year === null && lowOrNone.includes(candidate.yearConfidence);
}

export function deriveYearEvidence(candidate: ReviewCandidate, approvedOn: string): YearEvidence {
  const override = candidate.operator;
  if (override.year !== null) {
    return {
      confidence: 'operator',
      source: 'operator',
      note: override.note ?? `Operator-supplied year ${override.year}, overriding the fetcher proposal.`,
      approvedBy: 'operator',
      approvedOn,
    };
  }
  // needsYearRescue() already ruled out low/none reaching here.
  const confidence = candidate.yearConfidence as 'high' | 'medium';
  const matching = candidate.yearCandidates.filter((yc) => yc.year === candidate.yearProposed);
  const sources = [...new Set(matching.map((yc) => yc.source))];
  const source = sources.length > 0 ? sources.join('+') : 'title';
  return {
    confidence,
    source,
    note:
      override.note ??
      `Fetcher-proposed year ${candidate.yearProposed} (confidence ${confidence}) from ${source}.`,
    approvedBy: 'operator',
    approvedOn,
  };
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
};

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? '.bin';
}

function effectiveFocus(override: OperatorOverride): FocusPoint {
  return override.focus ?? DEFAULT_FOCUS;
}

function effectiveSourceCrop(override: OperatorOverride): SourceCrop | null {
  return override.sourceCrop ?? null;
}

function effectiveCropFractions(override: OperatorOverride): readonly number[] {
  return override.cropFractions ?? DEFAULT_CROP_FRACTIONS;
}

/** §3.4/§6.3: "one rule, stated once" — the fetcher only WARNS on a below-minimum source and
 *  leaves `decision: "pending"`; `schedule` is where the refusal actually lives. An `approve` on
 *  a source whose usable 4:3 width (`baseRect().bw0`, the SAME expression `tools/fetch.ts`'s
 *  `source-width-below-min` warning uses — imported, not re-derived, so the two tools cannot
 *  disagree, §4.7) is below `MIN_SOURCE_WIDTH` is refused UNLESS `operator.cropFractions` is a
 *  non-null override that still clears `MIN_LEVEL1_PX` at level 1. Throws to refuse the entire
 *  run, matching `needsYearRescue`'s refusal style. */
export function assertSourceWidthApprovable(candidate: ReviewCandidate): void {
  const sourceCrop = effectiveSourceCrop(candidate.operator);
  const W = sourceCrop ? Math.round(sourceCrop.w * candidate.width) : candidate.width;
  const H = sourceCrop ? Math.round(sourceCrop.h * candidate.height) : candidate.height;
  const usableWidth = baseRect(W, H).bw0;
  if (usableWidth >= MIN_SOURCE_WIDTH) return;

  const level1 = computeExtractRects(
    W,
    H,
    effectiveFocus(candidate.operator),
    effectiveCropFractions(candidate.operator),
  )[0];
  if (candidate.operator.cropFractions === null || level1.bw < MIN_LEVEL1_PX) {
    throw new Error(
      `schedule.ts: candidate ${candidate.candidateId} source is below MIN_SOURCE_WIDTH ` +
        `(${usableWidth}px usable 4:3 width < ${MIN_SOURCE_WIDTH}px) and has no operator.cropFractions ` +
        `override yielding a level-1 rect >= ${MIN_LEVEL1_PX}px (§3.4, §6.3).`,
    );
  }
}

/** §3.1/§6.9: belt-and-braces — `credit.author` may never be empty or the literal "Unknown"
 *  (that string is a fetcher-side reject marker, not a value). `buildReviewCandidate()` in
 *  `tools/fetch.ts` already auto-rejects a missing Artist, but a hand-edited review file could
 *  still set `decision: "approve"` on one, so schedule refuses it here too. */
export function assertAuthorPresent(candidate: ReviewCandidate): void {
  if (!candidate.author || candidate.author === 'Unknown') {
    throw new Error(
      `schedule.ts: candidate ${candidate.candidateId} has no machine-readable author ` +
        `(author="${candidate.author}") — never approve this (§3.1, §6.9).`,
    );
  }
}

function stripLicenseForCredit(candidate: ReviewCandidate): CreditBlock['license'] {
  const { id, name, url, jurisdiction } = candidate.license;
  return { id, name, url, jurisdiction };
}

// -------------------------------------------------------------------------------------------
// Review file loading
// -------------------------------------------------------------------------------------------

async function loadReviewFile(reviewPath: string): Promise<ReviewFile> {
  const raw = await fs.readFile(reviewPath, 'utf8');
  const data = JSON.parse(raw) as ReviewFile;
  const schemaPath = path.join(ROOT, 'schema/review.schema.json');
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8')) as JSONSchema;
  const errors = validate(schema, data);
  if (errors.length > 0) {
    const detail = errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new Error(`schedule.ts: "${reviewPath}" does not validate against review.schema.json:\n${detail}`);
  }
  return data;
}

async function loadCatalog(catalogPath: string): Promise<Catalog> {
  const raw = await fs.readFile(catalogPath, 'utf8');
  return JSON.parse(raw) as Catalog;
}

// -------------------------------------------------------------------------------------------
// Planning
// -------------------------------------------------------------------------------------------

async function planCandidate(
  candidate: ReviewCandidate,
  date: string,
  catalog: Catalog,
  cacheDir: string,
  approvedOn: string,
): Promise<Plan> {
  const number = puzzleNumber(date);
  const id = puzzleId(number);

  const modelId = candidate.operator.modelIdOverride ?? candidate.modelId;
  const makeId = candidate.makeId;

  const makeEntry = catalog.makes.find((m) => m.id === makeId);
  if (!makeEntry) {
    throw new Error(`schedule.ts: candidate ${candidate.candidateId}: makeId "${makeId}" not found in catalog`);
  }
  const modelEntry = catalog.models.find((m) => m.id === modelId);
  if (!modelEntry) {
    throw new Error(`schedule.ts: candidate ${candidate.candidateId}: modelId "${modelId}" not found in catalog`);
  }
  if (modelEntry.makeId !== makeId) {
    throw new Error(
      `schedule.ts: candidate ${candidate.candidateId}: model "${modelId}" belongs to make ` +
        `"${modelEntry.makeId}", not "${makeId}"`,
    );
  }

  const year = candidate.operator.year ?? candidate.yearProposed;
  if (year === null) {
    // Unreachable given needsYearRescue() gating, but keeps this function total under `strict`.
    throw new Error(`schedule.ts: candidate ${candidate.candidateId} has no resolvable year`);
  }

  const yearEvidence = deriveYearEvidence(candidate, approvedOn);

  const credit: CreditBlock = {
    fileTitle: candidate.fileTitle,
    descriptionUrl: candidate.descriptionUrl,
    author: candidate.author,
    license: stripLicenseForCredit(candidate),
    attributionRequired: candidate.license.attributionRequired,
    modified: MODIFIED_TEXT,
    creditNote: candidate.creditNote,
  };

  // Cache-only read (§6.1: schedule.ts is offline) — dryRun:true on the CLIENT unconditionally,
  // independent of this tool's OWN --dry-run flag, so a real network call is structurally
  // impossible here regardless of how schedule.ts itself is invoked.
  const client = new WikimediaClient({ cacheDir, dryRun: true });
  const result = await client.requestBinary(candidate.originalUrl);
  if (result.wouldFetch || !result.data) {
    throw new Error(
      `schedule.ts: candidate ${candidate.candidateId}: original image is not cached at ` +
        `${cacheDir} — run "npm run fetch" first (schedule.ts never downloads anything itself)`,
    );
  }

  return {
    date,
    number,
    id,
    candidate,
    makeId,
    make: makeEntry.name,
    modelId,
    model: modelEntry.name,
    year,
    acceptModelIds: [modelId],
    focus: effectiveFocus(candidate.operator),
    sourceCrop: effectiveSourceCrop(candidate.operator),
    cropFractions: effectiveCropFractions(candidate.operator),
    credit,
    yearEvidence,
    originalBytes: result.data,
    originalMime: candidate.mime,
  };
}

async function checkDateConflict(plan: Plan, puzzlesDir: string, force: boolean): Promise<void> {
  const filePath = path.join(puzzlesDir, `${plan.date}.json`);
  let existingRaw: string;
  try {
    existingRaw = await fs.readFile(filePath, 'utf8');
  } catch {
    return; // no existing file — nothing to conflict with
  }
  const existing = JSON.parse(existingRaw) as { credit?: { fileTitle?: string } };
  if (existing.credit?.fileTitle === plan.credit.fileTitle) {
    return; // same source re-scheduled — idempotent overwrite, no force needed
  }
  if (!force) {
    throw new Error(
      `schedule.ts: ${plan.date} is already scheduled with a different source ` +
        `("${existing.credit?.fileTitle}" != "${plan.credit.fileTitle}") — pass --force to re-point it`,
    );
  }
}

// -------------------------------------------------------------------------------------------
// Public entry point
// -------------------------------------------------------------------------------------------

export async function scheduleApproved(opts: ScheduleOptions): Promise<ScheduleResult> {
  const puzzlesDir = opts.puzzlesDir ?? DEFAULT_PUZZLES_DIR;
  const catalogPath = opts.catalogPath ?? DEFAULT_CATALOG_PATH;
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const attributionPath = opts.attributionPath ?? DEFAULT_ATTRIBUTION_PATH;
  const launchDate = opts.launchDate ?? LAUNCH_DATE;
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;

  // A malformed --start would otherwise flow through addDays() into "NaN-NaN-NaN.json" files.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.startDate) || Number.isNaN(Date.parse(opts.startDate))) {
    throw new Error(`schedule.ts: --start must be a valid YYYY-MM-DD date, got "${opts.startDate}"`);
  }

  const review = await loadReviewFile(opts.reviewPath);
  const catalog = await loadCatalog(catalogPath);
  const approvedOn = localToday();

  const approved = review.candidates.filter((c) => c.decision === 'approve');

  for (const candidate of approved) {
    if (needsYearRescue(candidate)) {
      throw new Error(
        `schedule.ts: candidate ${candidate.candidateId} has yearConfidence "${candidate.yearConfidence}" ` +
          'and no operator.year rescue — refusing the ENTIRE run (§3.4, §6.3). Set operator.year or reject it.',
      );
    }
    assertSourceWidthApprovable(candidate);
    assertAuthorPresent(candidate);
  }

  // Phase 1: PLAN every approved candidate, sequential dates starting at --start.
  const plans: Plan[] = [];
  for (let i = 0; i < approved.length; i++) {
    const date = addDays(opts.startDate, i);
    const plan = await planCandidate(approved[i], date, catalog, cacheDir, approvedOn);
    await checkDateConflict(plan, puzzlesDir, force);
    plans.push(plan);
  }

  if (dryRun) {
    return {
      dryRun: true,
      scheduled: plans.map((p) => ({ date: p.date, id: p.id, candidateId: p.candidate.candidateId })),
    };
  }

  // Phase 2: EXECUTE — crop + write. Validation already happened in phase 1, so a crop failure
  // here (e.g. the level-1-rect-too-small case §4.7 invariant 1) is the only way this can still
  // throw mid-batch; earlier plans in this same run are already written to disk at that point
  // (schedule.ts does not roll back partial batches — re-running after fixing the input is safe
  // because every write is unconditional-overwrite, §6.3).
  for (const plan of plans) {
    const paddedNumber = String(plan.number).padStart(4, '0');
    const outDir = path.join(puzzlesDir, 'img', paddedNumber);
    const tmpDir = path.join(cacheDir, 'originals');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpPath = path.join(
      tmpDir,
      `${plan.candidate.candidateId}-${createHash('sha256').update(plan.candidate.originalUrl).digest('hex').slice(0, 8)}${extensionForMime(plan.originalMime)}`,
    );
    await fs.writeFile(tmpPath, plan.originalBytes);

    const puzzle = await buildPuzzle({
      id: plan.id,
      number: plan.number,
      date: plan.date,
      answer: {
        makeId: plan.makeId,
        make: plan.make,
        modelId: plan.modelId,
        model: plan.model,
        year: plan.year,
        acceptModelIds: plan.acceptModelIds,
      },
      inputPath: tmpPath,
      outDir,
      srcPrefix: `img/${paddedNumber}/`,
      focus: plan.focus,
      sourceCrop: plan.sourceCrop,
      cropFractions: plan.cropFractions,
      credit: plan.credit,
      yearEvidence: plan.yearEvidence,
    });

    await writeJson(path.join(puzzlesDir, `${plan.date}.json`), puzzle);
  }

  const allPuzzles = await readAllPuzzles(puzzlesDir);
  await writeManifest(puzzlesDir, launchDate, allPuzzles);
  await fs.mkdir(path.dirname(attributionPath), { recursive: true });
  await fs.writeFile(attributionPath, renderAttribution(allPuzzles));

  return {
    dryRun: false,
    scheduled: plans.map((p) => ({ date: p.date, id: p.id, candidateId: p.candidate.candidateId })),
  };
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const reviewPath = typeof args.review === 'string' ? args.review : undefined;
  const startDate = typeof args.start === 'string' ? args.start : undefined;
  if (!reviewPath || !startDate) {
    console.error(
      'usage: tsx tools/schedule.ts --review data/review/<batch>.json --start YYYY-MM-DD [--dry-run] [--force]',
    );
    process.exitCode = 1;
    return;
  }

  const result = await scheduleApproved({
    reviewPath: path.resolve(reviewPath),
    startDate,
    dryRun: args['dry-run'] === true,
    force: args.force === true,
  });

  if (result.scheduled.length === 0) {
    console.log('schedule: no approved candidates in the review file — nothing to do');
    return;
  }
  const verb = result.dryRun ? 'would schedule' : 'scheduled';
  for (const s of result.scheduled) {
    console.log(`schedule: ${verb} ${s.date} (${s.id}) <- candidate ${s.candidateId}`);
  }
  if (!result.dryRun) {
    console.log('schedule: regenerated manifest.json and docs/ATTRIBUTION.md');
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
