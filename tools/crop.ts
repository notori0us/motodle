/**
 * `tools/crop.ts` — source image + params -> 5 WebP crop levels + one full reveal (§4.7, §6.2).
 * Offline only: no network, no `tools/lib/wikimedia.ts` import (§7.2 #14 depends on that being
 * true transitively for every tool that imports this one, e.g. `tools/generate.ts`, W2).
 *
 * This is the ONE implementation of the crop geometry (§4.7) — W1 owns it, W2 imports
 * `cropImage()` from `tools/generate.ts` rather than re-deriving the algorithm, which is exactly
 * what keeps the §7.2 #10 no-drift guarantee meaningful for geometry too.
 *
 * CLI:
 *   tsx tools/crop.ts --in <image> --out <dir> --focus 0.5,0.5 [--source-crop x,y,w,h]
 *                      [--fractions 0.11,0.19,0.32,0.55,0.95] [--quality auto]
 * Prints the resulting `CropOutput` as JSON to stdout on success.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import {
  CROP_ASPECT,
  CROP_TARGET_WIDTH,
  MIN_LEVEL1_PX,
  DEFAULT_CROP_FRACTIONS,
  DEFAULT_FOCUS,
  CROP_BUDGET_BYTES,
  FULL_BUDGET_BYTES,
  FULL_TARGET_WIDTH,
  WEBP_QUALITY_START,
  WEBP_QUALITY_MIN,
  WEBP_QUALITY_STEP,
} from '../schema/constants';
import type { CropLevel, FocusPoint, SourceCrop } from '../schema/types';

// sharp.concurrency(2): keep libvips thread use predictable when several crop runs (or crop +
// other sharp-using tooling) happen concurrently on the same host (§4.7 note carried over from
// the toolchain probe).
sharp.concurrency(2);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// -------------------------------------------------------------------------------------------
// Pure geometry — no I/O, unit-tested directly by tools/crop.test.ts.
// -------------------------------------------------------------------------------------------

/** The largest 4:3 rect that fits inside a W x H image (§4.7). */
export function baseRect(W: number, H: number): { bw0: number; bh0: number } {
  if (W / H >= CROP_ASPECT) {
    return { bw0: Math.round(H * CROP_ASPECT), bh0: H };
  }
  return { bw0: W, bh0: Math.round(W / CROP_ASPECT) };
}

export interface ExtractRect {
  left: number;
  top: number;
  bw: number;
  bh: number;
}

/**
 * One extract rect per fraction, centred on `focus` (fractions of the W x H image) and clamped
 * into bounds. `focus`/W/H are always in SOURCE-CROPPED space — the caller applies `sourceCrop`
 * first and passes the resulting dimensions here (§4.7).
 */
export function computeExtractRects(
  W: number,
  H: number,
  focus: FocusPoint,
  fractions: readonly number[],
): ExtractRect[] {
  const { bw0, bh0 } = baseRect(W, H);
  return fractions.map((f) => {
    let bw = Math.min(Math.round(f * bw0), W);
    let bh = Math.min(Math.round(bw / CROP_ASPECT), H);
    bw = Math.min(bw, Math.round(bh * CROP_ASPECT)); // re-fit aspect after clamping
    const left = clamp(Math.round(focus.x * W - bw / 2), 0, W - bw);
    const top = clamp(Math.round(focus.y * H - bh / 2), 0, H - bh);
    return { left, top, bw, bh };
  });
}

/**
 * The two invariants §4.7 requires: level-1 rect >= MIN_LEVEL1_PX, and `rect.w` strictly
 * increasing across levels (a tie means the fractions collapsed against a clamp and the reveal
 * would stall — hard error, distinct from `levels[].w`, which is only non-decreasing).
 */
export function assertInvariants(rects: ExtractRect[]): void {
  if (rects.length === 0) throw new Error('crop.ts: no cropFractions supplied');
  if (rects[0].bw < MIN_LEVEL1_PX) {
    throw new Error(
      `crop.ts: source too small — level-1 rect width ${rects[0].bw}px is below MIN_LEVEL1_PX ` +
        `(${MIN_LEVEL1_PX}px). Supply --fractions (a level-1 override) or a larger source.`,
    );
  }
  for (let i = 1; i < rects.length; i++) {
    if (rects[i].bw <= rects[i - 1].bw) {
      throw new Error(
        `crop.ts: levels[].rect.w must be strictly increasing — level ${i + 1} (${rects[i].bw}px) ` +
          `does not exceed level ${i} (${rects[i - 1].bw}px).`,
      );
    }
  }
}

// -------------------------------------------------------------------------------------------
// Quality search (§4.7): descending from WEBP_QUALITY_START to WEBP_QUALITY_MIN, first quality
// where the summed encoded size fits the budget wins. Inputs are already-extracted/resized
// lossless PNG buffers so only the cheap final webp() re-encode repeats per candidate quality.
// -------------------------------------------------------------------------------------------

async function searchQuality(
  losslessBuffers: Buffer[],
  budgetBytes: number,
): Promise<{ buffers: Buffer[]; quality: number }> {
  for (let q = WEBP_QUALITY_START; q >= WEBP_QUALITY_MIN; q -= WEBP_QUALITY_STEP) {
    const encoded = await Promise.all(losslessBuffers.map((b) => sharp(b).webp({ quality: q }).toBuffer()));
    const sum = encoded.reduce((a, b) => a + b.length, 0);
    if (sum <= budgetBytes) return { buffers: encoded, quality: q };
  }
  throw new Error(
    `crop.ts: no WebP quality in [${WEBP_QUALITY_MIN},${WEBP_QUALITY_START}] fits budget ${budgetBytes} bytes`,
  );
}

// -------------------------------------------------------------------------------------------
// I/O — reads `inputPath`, writes l1..l5.webp + full.webp into `outDir`.
// -------------------------------------------------------------------------------------------

export interface CropOptions {
  inputPath: string;
  outDir: string;
  focus?: FocusPoint;
  sourceCrop?: SourceCrop | null;
  cropFractions?: readonly number[];
}

export interface CropOutput {
  levels: CropLevel[];
  full: { src: string; w: number; h: number; bytes: number };
}

export async function cropImage(opts: CropOptions): Promise<CropOutput> {
  const focus = opts.focus ?? DEFAULT_FOCUS;
  const sourceCrop = opts.sourceCrop ?? null;
  const cropFractions = opts.cropFractions ?? DEFAULT_CROP_FRACTIONS;

  await fs.mkdir(opts.outDir, { recursive: true });

  const meta = await sharp(opts.inputPath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`crop.ts: could not read dimensions of ${opts.inputPath}`);
  }

  // Materialize the source-crop step (if any) into a fresh, lossless buffer BEFORE any level
  // extraction. Every level's `.clone().extract(...)` below then performs exactly one extract
  // against a pipeline that itself carries zero prior operations — this sidesteps any question
  // of how sharp composes chained `.extract()` calls, in either the sourceCrop or no-sourceCrop
  // case.
  let baseImage: Sharp;
  let W: number;
  let H: number;

  if (sourceCrop) {
    const left = clamp(Math.round(sourceCrop.x * meta.width), 0, meta.width - 1);
    const top = clamp(Math.round(sourceCrop.y * meta.height), 0, meta.height - 1);
    const width = clamp(Math.round(sourceCrop.w * meta.width), 1, meta.width - left);
    const height = clamp(Math.round(sourceCrop.h * meta.height), 1, meta.height - top);
    const croppedBuffer = await sharp(opts.inputPath).extract({ left, top, width, height }).png().toBuffer();
    baseImage = sharp(croppedBuffer);
    W = width;
    H = height;
  } else {
    baseImage = sharp(opts.inputPath);
    W = meta.width;
    H = meta.height;
  }

  const rects = computeExtractRects(W, H, focus, cropFractions);
  assertInvariants(rects);

  const rendered = await Promise.all(
    rects.map((r) =>
      baseImage
        .clone()
        .extract({ left: r.left, top: r.top, width: r.bw, height: r.bh })
        .resize({ width: Math.min(CROP_TARGET_WIDTH, r.bw), withoutEnlargement: true })
        .png()
        .toBuffer(),
    ),
  );

  const { buffers: levelBuffers } = await searchQuality(rendered, CROP_BUDGET_BYTES);

  const levels: CropLevel[] = [];
  for (let i = 0; i < rects.length; i++) {
    const buf = levelBuffers[i];
    const info = await sharp(buf).metadata();
    const src = `l${i + 1}.webp`;
    await fs.writeFile(path.join(opts.outDir, src), buf);
    levels.push({
      level: i + 1,
      src,
      w: info.width!,
      h: info.height!,
      rect: { w: rects[i].bw, h: rects[i].bh },
      bytes: buf.length,
    });
  }

  // Full reveal: from the SOURCE-CROPPED image (never the original — sourceCrop must stay
  // removed), no 4:3 constraint, its own quality search against FULL_BUDGET_BYTES.
  const fullOutW = Math.min(FULL_TARGET_WIDTH, W);
  const fullRendered = await baseImage.clone().resize({ width: fullOutW, withoutEnlargement: true }).png().toBuffer();
  const { buffers: fullBuffers } = await searchQuality([fullRendered], FULL_BUDGET_BYTES);
  const fullBuf = fullBuffers[0];
  const fullInfo = await sharp(fullBuf).metadata();
  const fullSrc = 'full.webp';
  await fs.writeFile(path.join(opts.outDir, fullSrc), fullBuf);

  return {
    levels,
    full: { src: fullSrc, w: fullInfo.width!, h: fullInfo.height!, bytes: fullBuf.length },
  };
}

// -------------------------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function parsePoint(s: string): FocusPoint {
  const [x, y] = s.split(',').map(Number);
  return { x, y };
}

function parseSourceCrop(s: string): SourceCrop {
  const [x, y, w, h] = s.split(',').map(Number);
  return { x, y, w, h };
}

function parseFractions(s: string): number[] {
  return s.split(',').map(Number);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in || !args.out) {
    console.error(
      'usage: tsx tools/crop.ts --in <image> --out <dir> --focus 0.5,0.5 ' +
        '[--source-crop x,y,w,h] [--fractions 0.11,0.19,0.32,0.55,0.95] [--quality auto]',
    );
    process.exitCode = 1;
    return;
  }
  const result = await cropImage({
    inputPath: args.in,
    outDir: args.out,
    focus: args.focus ? parsePoint(args.focus) : undefined,
    sourceCrop: args['source-crop'] ? parseSourceCrop(args['source-crop']) : null,
    cropFractions: args.fractions ? parseFractions(args.fractions) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
