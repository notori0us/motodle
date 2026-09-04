/**
 * `tools/check.ts` — offline OCR (and, someday, face) gate between `prefetch` and `schedule`
 * (docs/CONTENT-WITHOUT-AI.md §3/§5, PLAN §6.6). For each selected candidate: OCR the ORIGINAL
 * image after `operator.sourceCrop`, and OCR each of the five rendered crop levels + the full
 * reveal (rendered with the SAME `tools/crop.ts` geometry `tools/schedule.ts` uses), looking for
 * a legible year (`\b(18|19|20)\d\d\b`, §6.6). Results are written back into each candidate's
 * `check` block in the review file, which `tools/schedule.ts` then refuses to publish through
 * unless the operator adds the literal token `OCR-OK` to `operator.note`.
 *
 * Network: cache-only for the source image — the original comes from `.cache/wikimedia` via the
 * SAME `WikimediaClient({ dryRun: true })` pattern `tools/schedule.ts` uses; this tool never
 * downloads anything itself. OCR language data is a SEPARATE concern: `tesseract.js` has no
 * "cache-only" mode of its own and will silently try to fetch `<lang>.traineddata` from a CDN if
 * it is not already on disk — and an offline fetch failure THERE is an uncaught crash (verified:
 * `unshare -rn` plus a missing cache file kills the process with an unhandled "TypeError: fetch
 * failed" that bypasses a try/catch around `createWorker()`), not a catchable rejection. So this
 * tool checks for the file itself FIRST (existence only — an interrupted download that left a
 * truncated file on disk still "exists" and will fail inside tesseract.js instead, with a less
 * friendly error) and refuses with a one-time download command rather than ever letting
 * `tesseract.js` attempt that fallback itself. `createTesseractEngine()` also sets `langPath` to
 * the same dir, so an exists-but-unreadable file's fallback reads locally, never the CDN:
 *
 *   mkdir -p .cache/tesseract-lang && curl -fsSL \
 *     https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz \
 *     | gunzip > .cache/tesseract-lang/eng.traineddata
 *
 * (the exact URL `tesseract.js` v7's LSTM_ONLY engine mode would itself fetch — see
 * `traineddataDownloadUrl()` below, which is the single source of this string). Needs real
 * network access; this tool never runs it for you.
 *
 * Faces (§3(b) of the plan): NOT implemented. See the TODO below.
 *
 * CLI:
 *   tsx tools/check.ts --review data/review/<batch>.json [--decisions approve]
 *                       [--cache .cache/wikimedia] [--lang-cache .cache/tesseract-lang] [--faces]
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { CheckOcrHit, CheckResult, ReviewCandidate, ReviewFile, SourceCrop } from '../schema/types';
import { validate, type JSONSchema } from '../schema/validate';
import { cropImage } from './crop';
import { WikimediaClient } from './lib/wikimedia';
import { writeJson } from './lib/puzzle-build';

// -------------------------------------------------------------------------------------------
// TODO — face detection (§3(b), CONTENT-WITHOUT-AI.md §3): NOT implemented.
//
// The plan calls for YuNet (opencv_zoo) via `onnxruntime-node`, gated on two conditions: it
// installs cleanly, AND the opencv_zoo model licence is permissive. `onnxruntime-node` itself
// checks out (npm registry metadata: v1.29.0, MIT, ~296 MB unpacked — not installed here, since
// installing it would be pointless without clearing the second gate first). The second gate does
// NOT check out under this task's network rails: verifying a specific model's licence means
// reading `https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE`,
// and this session's network access is restricted to `tools/lib/wikimedia.ts`'s client — "nothing
// else". opencv_zoo's repo-root licence is recalled to be Apache-2.0 (not verified in-session —
// see above), but recon in CONTENT-WITHOUT-AI.md §3
// already flags that per-model folders can carry their own LICENSE file, which is exactly the
// case that needs checking and was NOT verifiable in this session. Do not enable `--faces` (it
// currently only prints a warning and runs OCR-only) until a human has actually opened that URL
// and confirmed the model's own licence permits this use.
// -------------------------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const DEFAULT_CACHE_DIR = path.join(ROOT, '.cache/wikimedia');
const DEFAULT_LANG_CACHE_DIR = path.join(ROOT, '.cache/tesseract-lang');
const REVIEW_SCHEMA_PATH = path.join(ROOT, 'schema/review.schema.json');

export const DEFAULT_LANG = 'eng';

/** Every level name `check.ts` can write into `CheckOcrHit.level`: the ORIGINAL after
 *  `operator.sourceCrop` (full resolution), the five rendered crop levels, and the full reveal. */
export type CheckLevel = 'original' | 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'full';

/** §6.6: any 4-digit year-shaped token, anywhere in a word. Precision does not matter (the
 *  operator skims anyway); recall does. */
export const YEAR_RE = /\b(18|19|20)\d\d\b/;

// -------------------------------------------------------------------------------------------
// Pure geometry / text helpers — no I/O, unit-tested directly.
// -------------------------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The SAME `sourceCrop` math `tools/crop.ts` applies to the original before level extraction —
 *  reproduced here (not imported) because this is a full-resolution pass over the pre-level
 *  image, which `crop.ts` never produces on its own. Returns `null` for "use the whole image",
 *  matching `sourceCrop: null`. */
export function sourceCropRect(
  W: number,
  H: number,
  sourceCrop: SourceCrop | null,
): { left: number; top: number; width: number; height: number } | null {
  if (!sourceCrop) return null;
  const left = clamp(Math.round(sourceCrop.x * W), 0, W - 1);
  const top = clamp(Math.round(sourceCrop.y * H), 0, H - 1);
  const width = clamp(Math.round(sourceCrop.w * W), 1, W - left);
  const height = clamp(Math.round(sourceCrop.h * H), 1, H - top);
  return { left, top, width, height };
}

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Flattens tesseract's blocks -> paragraphs -> lines -> words tree (the shape `recognize(img,
 *  {}, { blocks: true })` returns) into a flat word list. A `null` `blocks` (OCR skipped, or the
 *  `blocks` output was never requested) yields no words rather than throwing. */
export function wordsFromPage(page: {
  blocks: Array<{ paragraphs: Array<{ lines: Array<{ words: Array<{ text: string; bbox: OcrWord['bbox'] }> }> }> }> | null;
}): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({ text: word.text, bbox: word.bbox });
        }
      }
    }
  }
  return words;
}

/** Pure: word boxes -> year hits, bbox expressed as fractions of `width` x `height` (the SAME
 *  image the words' pixel bboxes were measured against). Tested per-word against `YEAR_RE`
 *  (never against the joined page text) so a whitelist-free OCR pass on "SUZUKI 1995" still
 *  reports only the "1995" word's own box, not the whole line's. */
export function findYearHits(
  words: OcrWord[],
  width: number,
  height: number,
): Array<{ text: string; bbox: CheckOcrHit['bbox'] }> {
  const hits: Array<{ text: string; bbox: CheckOcrHit['bbox'] }> = [];
  for (const word of words) {
    const m = word.text.match(YEAR_RE);
    if (!m) continue;
    hits.push({
      text: m[0],
      bbox: {
        x: word.bbox.x0 / width,
        y: word.bbox.y0 / height,
        w: (word.bbox.x1 - word.bbox.x0) / width,
        h: (word.bbox.y1 - word.bbox.y0) / height,
      },
    });
  }
  return hits;
}

/** Same `--decisions` convention as `tools/prefetch.ts`: `"approve"` by default (the only
 *  decision `prefetch` caches originals for, so it is the only one `check.ts` can run over
 *  cache-only without also having run `--decisions pending,approve` through prefetch first),
 *  `"all"`, or a comma list. */
export function selectCandidates(candidates: ReviewCandidate[], decisionsSpec = 'approve'): ReviewCandidate[] {
  const spec = decisionsSpec.trim();
  if (spec === 'all') return candidates;
  const wanted = new Set(spec.split(',').map((s) => s.trim()));
  return candidates.filter((c) => wanted.has(c.decision));
}

// -------------------------------------------------------------------------------------------
// tesseract.js language data — see the file-header comment for WHY this is checked up front
// rather than left to tesseract.js's own (crash-prone) network fallback.
// -------------------------------------------------------------------------------------------

export function traineddataPath(langCacheDir: string, lang: string = DEFAULT_LANG): string {
  return path.join(langCacheDir, `${lang}.traineddata`);
}

/** The exact URL `tesseract.js` itself would fall back to for this lang under the OEM this tool
 *  uses (`LSTM_ONLY` -> the smaller "best_int" data) — read out of
 *  `node_modules/tesseract.js/src/worker-script/index.js`, not guessed, so the documented
 *  download command actually matches what a real run would have fetched. */
export function traineddataDownloadUrl(lang: string = DEFAULT_LANG): string {
  return `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
}

export async function assertTraineddataPresent(langCacheDir: string, lang: string = DEFAULT_LANG): Promise<void> {
  const file = traineddataPath(langCacheDir, lang);
  try {
    await fs.access(file);
  } catch {
    throw new Error(
      `check.ts: ${lang}.traineddata not found at "${file}". tesseract.js has no offline mode of its own — ` +
        'if this file is missing it will try to fetch it itself, and an offline fetch failure there crashes ' +
        'the process uncatchably, so this tool refuses first instead. One-time download (run manually, needs ' +
        'real network access — this tool never does this itself):\n' +
        `  mkdir -p "${langCacheDir}" && curl -fsSL "${traineddataDownloadUrl(lang)}" | gunzip > "${file}"`,
    );
  }
}

export interface OcrEngine {
  recognizeWords(png: Buffer): Promise<OcrWord[]>;
}

/** Wraps a live `tesseract.js` worker. Kept separate from `OcrEngine`'s consumers so
 *  `checkCandidate`/`runCheck` can be exercised in tests with a fake engine and no traineddata. */
export async function createTesseractEngine(
  langCacheDir: string,
  lang: string = DEFAULT_LANG,
): Promise<{ engine: OcrEngine; close: () => Promise<void> }> {
  await assertTraineddataPresent(langCacheDir, lang);
  const worker = await Tesseract.createWorker(lang, Tesseract.OEM.LSTM_ONLY, {
    cachePath: langCacheDir,
    langPath: langCacheDir, // fallback reads the local dir, never the CDN
    gzip: false, // ...as an uncompressed <lang>.traineddata
    cacheMethod: 'read',
    logger: () => {},
  });
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
  return {
    engine: {
      async recognizeWords(png: Buffer): Promise<OcrWord[]> {
        const { data } = await worker.recognize(png, {}, { blocks: true });
        return wordsFromPage(data);
      },
    },
    close: () => worker.terminate().then(() => undefined),
  };
}

// -------------------------------------------------------------------------------------------
// Per-candidate check
// -------------------------------------------------------------------------------------------

async function ocrLevel(
  engine: OcrEngine,
  png: Buffer,
  width: number,
  height: number,
  level: CheckLevel,
): Promise<CheckOcrHit[]> {
  const words = await engine.recognizeWords(png);
  return findYearHits(words, width, height).map((hit) => ({ ...hit, level }));
}

export interface CheckCandidateOptions {
  cacheDir: string;
  engine: OcrEngine;
}

/** OCRs (a) the ORIGINAL after `operator.sourceCrop` at full resolution, and (b) each of the
 *  five rendered crop levels + the full reveal, rendered by the SAME `cropImage()` `schedule.ts`
 *  calls (§4.7 geometry, no re-derivation). Cache-only: throws if the original is not already in
 *  `cacheDir` rather than downloading it (schedule.ts's own refusal style). */
export async function checkCandidate(candidate: ReviewCandidate, opts: CheckCandidateOptions): Promise<CheckResult> {
  const client = new WikimediaClient({ cacheDir: opts.cacheDir, dryRun: true });
  const result = await client.requestBinary(candidate.originalUrl);
  if (result.wouldFetch || !result.data) {
    throw new Error(
      `check.ts: candidate ${candidate.candidateId} original is not cached at ${opts.cacheDir} — run ` +
        '"npm run prefetch" first (check.ts never downloads anything itself).',
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'motodle-check-'));
  try {
    const originalPath = path.join(tmpDir, 'original');
    await fs.writeFile(originalPath, result.data);

    const hits: CheckOcrHit[] = [];

    // (a) ORIGINAL after operator.sourceCrop, full resolution.
    const meta = await sharp(originalPath).metadata();
    if (!meta.width || !meta.height) {
      throw new Error(`check.ts: candidate ${candidate.candidateId}: could not read source image dimensions`);
    }
    const rect = sourceCropRect(meta.width, meta.height, candidate.operator.sourceCrop);
    const originalBuf = rect
      ? await sharp(originalPath).extract(rect).png().toBuffer()
      : await sharp(originalPath).png().toBuffer();
    hits.push(...(await ocrLevel(opts.engine, originalBuf, rect?.width ?? meta.width, rect?.height ?? meta.height, 'original')));

    // (b) the five rendered levels + the full reveal — same geometry schedule.ts's buildPuzzle
    // ultimately uses, via the one shared cropImage() implementation (§4.7).
    const cropOutDir = path.join(tmpDir, 'crop');
    const cropped = await cropImage({
      inputPath: originalPath,
      outDir: cropOutDir,
      focus: candidate.operator.focus ?? undefined,
      sourceCrop: candidate.operator.sourceCrop,
      cropFractions: candidate.operator.cropFractions ?? undefined,
    });

    for (const level of cropped.levels) {
      const buf = await sharp(path.join(cropOutDir, level.src)).png().toBuffer();
      hits.push(...(await ocrLevel(opts.engine, buf, level.w, level.h, `l${level.level}` as CheckLevel)));
    }
    const fullBuf = await sharp(path.join(cropOutDir, cropped.full.src)).png().toBuffer();
    hits.push(...(await ocrLevel(opts.engine, fullBuf, cropped.full.w, cropped.full.h, 'full')));

    return { ranAt: new Date().toISOString(), ocr: hits, faces: null };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------------------------------------
// Batch entry point — writes results back into the review file in place.
// -------------------------------------------------------------------------------------------

export interface CheckOptions {
  reviewPath: string;
  decisions?: string;
  cacheDir?: string;
  engine: OcrEngine;
}

export interface CheckRunResult {
  checked: number;
  hits: number;
  failed: Array<{ candidateId: string; error: string }>;
  /** Per-candidate OCR hits, in the same order as `selected` — lets the CLI print box + level for
   *  every hit instead of a bare count (§3(a)/§5: "print the bbox as a fraction"). Candidates
   *  with zero hits are omitted. */
  hitsByCandidate: Array<{ candidateId: string; ocr: CheckOcrHit[] }>;
}

export async function runCheck(opts: CheckOptions): Promise<CheckRunResult> {
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const review = JSON.parse(await fs.readFile(opts.reviewPath, 'utf8')) as ReviewFile;
  const schema = JSON.parse(await fs.readFile(REVIEW_SCHEMA_PATH, 'utf8')) as JSONSchema;

  const before = validate(schema, review);
  if (before.length > 0) {
    throw new Error(
      `check.ts: "${opts.reviewPath}" does not validate against review.schema.json:\n` +
        before.map((e) => `  ${e.path}: ${e.message}`).join('\n'),
    );
  }

  const selected = selectCandidates(review.candidates, opts.decisions);
  const failed: CheckRunResult['failed'] = [];
  const hitsByCandidate: CheckRunResult['hitsByCandidate'] = [];
  let checked = 0;
  let hits = 0;

  for (const candidate of selected) {
    try {
      const check = await checkCandidate(candidate, { cacheDir, engine: opts.engine });
      candidate.check = check;
      checked += 1;
      hits += check.ocr.length;
      if (check.ocr.length > 0) hitsByCandidate.push({ candidateId: candidate.candidateId, ocr: check.ocr });
    } catch (err) {
      failed.push({ candidateId: candidate.candidateId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Never write a review file check.ts's own writes would make invalid.
  const after = validate(schema, review);
  if (after.length > 0) {
    throw new Error(
      `check.ts: internal error — writing check results would produce an invalid review file:\n` +
        after.map((e) => `  ${e.path}: ${e.message}`).join('\n'),
    );
  }
  await writeJson(opts.reviewPath, review);

  return { checked, hits, failed, hitsByCandidate };
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
  if (!reviewPath) {
    console.error(
      'usage: tsx tools/check.ts --review data/review/<batch>.json [--decisions approve] ' +
        '[--cache .cache/wikimedia] [--lang-cache .cache/tesseract-lang] [--faces]',
    );
    process.exitCode = 1;
    return;
  }
  const cacheDir = typeof args.cache === 'string' ? args.cache : DEFAULT_CACHE_DIR;
  const langCacheDir = typeof args['lang-cache'] === 'string' ? args['lang-cache'] : DEFAULT_LANG_CACHE_DIR;
  const decisions = typeof args.decisions === 'string' ? args.decisions : undefined;

  if (args.faces === true) {
    console.warn(
      'check.ts: --faces is not implemented (see the TODO at the top of tools/check.ts) — running OCR only.',
    );
  }

  const { engine, close } = await createTesseractEngine(langCacheDir, DEFAULT_LANG);
  try {
    const result = await runCheck({ reviewPath: path.resolve(reviewPath), decisions, cacheDir, engine });
    console.log(`check: ${result.checked} candidate(s) checked, ${result.hits} OCR year hit(s) found`);
    for (const c of result.hitsByCandidate) {
      for (const h of c.ocr) {
        console.log(
          `check: ${c.candidateId} ${h.level} "${h.text}" ` +
            `bbox x=${h.bbox.x.toFixed(3)} y=${h.bbox.y.toFixed(3)} w=${h.bbox.w.toFixed(3)} h=${h.bbox.h.toFixed(3)}`,
        );
      }
    }
    for (const f of result.failed) {
      console.error(`check: ${f.candidateId}: ${f.error}`);
    }
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    await close();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
