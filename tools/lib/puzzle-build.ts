/**
 * `tools/lib/puzzle-build.ts` — shared plumbing between `tools/generate.ts` and
 * `tools/schedule.ts`: turn a (source image + geometry + credit + yearEvidence) tuple into a
 * `Puzzle` JSON + WebP levels via `tools/crop.ts`, and regenerate `public/puzzles/manifest.json`
 * wholesale from whatever puzzle files exist on disk afterwards (§6.1, §6.3).
 *
 * Offline only: imports `tools/crop.ts` (sharp, no network) and Node built-ins only. NEVER
 * imports `tools/lib/wikimedia.ts` — that is load-bearing for `tools/generate.ts`'s §7.2 #14
 * import-graph test, since `generate.ts` imports THIS file.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cropImage } from '../crop';
import type {
  CreditBlock,
  FocusPoint,
  Manifest,
  ManifestEntry,
  Puzzle,
  PuzzleAnswer,
  SourceCrop,
  YearEvidence,
} from '../../schema/types';

export interface BuildPuzzleParams {
  /** The single source of truth for this id — copied verbatim, never minted here (§3.6, §6.3). */
  id: string;
  number: number;
  date: string;
  answer: PuzzleAnswer;
  inputPath: string;
  /** Where `tools/crop.ts` writes the WebP files (an absolute or cwd-relative filesystem path). */
  outDir: string;
  /** `image.levels[].src` / `image.full.src` are relative to `PUZZLE_BASE_URL`, i.e. to
   *  `public/puzzles/` (§3) — NOT to `outDir`. `tools/crop.ts` returns bare filenames
   *  ("l1.webp") relative to `outDir`; this prefix (e.g. `"img/0001/"`) is prepended to
   *  reconstruct the puzzle-relative path. Must end with `/`. */
  srcPrefix: string;
  focus: FocusPoint;
  sourceCrop: SourceCrop | null;
  cropFractions: readonly number[];
  credit: CreditBlock;
  yearEvidence: YearEvidence;
}

export async function buildPuzzle(params: BuildPuzzleParams): Promise<Puzzle> {
  const cropped = await cropImage({
    inputPath: params.inputPath,
    outDir: params.outDir,
    focus: params.focus,
    sourceCrop: params.sourceCrop,
    cropFractions: params.cropFractions,
  });

  return {
    schema: 1,
    id: params.id,
    number: params.number,
    date: params.date,
    answer: params.answer,
    image: {
      aspect: '4:3',
      focus: params.focus,
      sourceCrop: params.sourceCrop,
      cropFractions: params.cropFractions as unknown as readonly [number, number, number, number, number],
      levels: cropped.levels.map((l) => ({ ...l, src: `${params.srcPrefix}${l.src}` })),
      full: { ...cropped.full, src: `${params.srcPrefix}${cropped.full.src}` },
    },
    credit: params.credit,
    yearEvidence: params.yearEvidence,
  };
}

/** 2-space indent + exactly one trailing newline — the convention every JSON file in this repo
 *  already uses. Deterministic key order comes for free: object literals are always built in
 *  the same field order by the caller, so two runs over the same input produce identical bytes. */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

const PUZZLE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

/** Every `YYYY-MM-DD.json` in `puzzlesDir`, parsed and sorted by `number`. Missing directory
 *  (a truly empty clean clone before anything has ever been generated) returns `[]`, not a
 *  crash. */
export async function readAllPuzzles(puzzlesDir: string): Promise<Puzzle[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(puzzlesDir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => PUZZLE_FILE_RE.test(f)).sort();
  const puzzles: Puzzle[] = [];
  for (const file of files) {
    const raw = await fs.readFile(path.join(puzzlesDir, file), 'utf8');
    puzzles.push(JSON.parse(raw) as Puzzle);
  }
  puzzles.sort((a, b) => a.number - b.number);
  return puzzles;
}

/** Pure — §3.3: ascending by number, no answer fields. */
export function buildManifest(puzzles: Puzzle[], launchDate: string): Manifest {
  const sorted = [...puzzles].sort((a, b) => a.number - b.number);
  const entries: ManifestEntry[] = sorted.map((p) => ({ date: p.date, number: p.number, id: p.id }));
  const highest = sorted[sorted.length - 1];
  return {
    schema: 1,
    launchDate,
    latest: highest ? { date: highest.date, number: highest.number } : { date: launchDate, number: 0 },
    puzzles: entries,
  };
}

export async function writeManifest(puzzlesDir: string, launchDate: string, puzzles: Puzzle[]): Promise<void> {
  await writeJson(path.join(puzzlesDir, 'manifest.json'), buildManifest(puzzles, launchDate));
}
