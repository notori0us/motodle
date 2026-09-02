/**
 * Payload budget enforcement (§5.9). Wired as `"build": "vite build && tsx tools/check-budget.ts"`
 * so a violation fails the build. Gzips every artifact in memory (`zlib.gzipSync`, level 9,
 * matching what an HTTP server actually sends), measures every raw-byte artifact off disk, prints
 * one row per measurement, and exits non-zero if ANY row breaches its limit.
 *
 * Every limit is imported from `schema/constants.ts` — never re-typed here (§5.9 table).
 *
 * Scans `<repo root>/dist` by default. An optional first CLI arg overrides the directory scanned
 * — `npm run build` never passes one; it exists only so this script can be pointed at a scratch
 * copy of `dist/` to prove it catches a deliberately over-budget artifact (§8 W5 DoD) without
 * touching the real build output.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  CATALOG_GZ_BUDGET_BYTES,
  CSS_GZ_BUDGET_BYTES,
  DAY_BUDGET_BYTES,
  FULL_BUDGET_BYTES,
  JS_GZ_BUDGET_BYTES,
} from '../schema/constants';
import type { Manifest, Puzzle } from '../schema/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DIST_DIR = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist'));

interface Row {
  name: string;
  bytes: number;
  budget: number;
  pass: boolean;
}

const rows: Row[] = [];

function record(name: string, bytes: number, budget: number): void {
  rows.push({ name, bytes, budget, pass: bytes <= budget });
}

function fmtKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function fileGzipBytes(p: string): number {
  return gzipSync(readFileSync(p), { level: 9 }).length;
}

function fileRawBytes(p: string): number {
  return statSync(p).size;
}

/** Non-recursive: `dist/assets/` is a flat directory (Vite's default output layout). */
function listFilesWithExt(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.join(dir, e.name));
}

function main(): void {
  if (!existsSync(DIST_DIR)) {
    console.error(`check-budget: dist directory not found at ${DIST_DIR} — run \`vite build\` first.`);
    process.exit(1);
  }

  // ---- App JS, gzipped: sum of dist/assets/*.js, each file gzipped individually (that is how
  // the bytes actually travel over HTTP — one gzip stream per requested file). ----------------
  const assetsDir = path.join(DIST_DIR, 'assets');
  const jsFiles = listFilesWithExt(assetsDir, '.js');
  const jsGzBytes = jsFiles.reduce((sum, f) => sum + fileGzipBytes(f), 0);
  record(`App JS, gzipped (${jsFiles.length} file${jsFiles.length === 1 ? '' : 's'})`, jsGzBytes, JS_GZ_BUDGET_BYTES);

  // ---- App CSS, gzipped: sum of dist/assets/*.css. -------------------------------------------
  const cssFiles = listFilesWithExt(assetsDir, '.css');
  const cssGzBytes = cssFiles.reduce((sum, f) => sum + fileGzipBytes(f), 0);
  record(
    `App CSS, gzipped (${cssFiles.length} file${cssFiles.length === 1 ? '' : 's'})`,
    cssGzBytes,
    CSS_GZ_BUDGET_BYTES,
  );

  // ---- Catalog, gzipped. ----------------------------------------------------------------------
  const catalogPath = path.join(DIST_DIR, 'catalog.json');
  if (existsSync(catalogPath)) {
    record('catalog.json, gzipped', fileGzipBytes(catalogPath), CATALOG_GZ_BUDGET_BYTES);
  } else {
    console.error(`check-budget: ${catalogPath} not found.`);
    process.exitCode = 1;
  }

  // ---- Per-day payload: puzzles/<date>.json + its 5 level WebPs, RAW bytes, for EVERY
  // committed puzzle. Full reveal is measured separately (excluded from the day budget — it is
  // fetched lazily, only at game end). -----------------------------------------------------------
  const puzzlesDir = path.join(DIST_DIR, 'puzzles');
  const puzzleFiles = existsSync(puzzlesDir)
    ? readdirSync(puzzlesDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.json') && e.name !== 'manifest.json')
        .map((e) => path.join(puzzlesDir, e.name))
        .sort()
    : [];

  if (puzzleFiles.length === 0) {
    console.error(`check-budget: no puzzle JSON files found under ${puzzlesDir}.`);
    process.exitCode = 1;
  }

  // ---- Cross-check against manifest.json (I6): a stale dist/ or a publicDir misconfiguration
  // must fail loudly rather than silently under-measure — an over-budget day whose puzzle.json
  // never made it into dist/ would otherwise let the build stay green. ---------------------------
  const manifestPath = path.join(puzzlesDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Manifest;
    const manifestDates = new Set(manifest.puzzles.map((p) => p.date));
    const measuredDates = new Set(puzzleFiles.map((f) => path.basename(f, '.json')));
    const missingFromDist = [...manifestDates].filter((d) => !measuredDates.has(d));
    const extraInDist = [...measuredDates].filter((d) => !manifestDates.has(d));
    if (missingFromDist.length > 0 || extraInDist.length > 0) {
      console.error(
        `check-budget: dist/puzzles/ does not match manifest.json's puzzle set — ` +
          `missing from dist: [${missingFromDist.join(', ')}], not in manifest: [${extraInDist.join(', ')}]. ` +
          `Re-run \`npm run build\` (or \`npm run generate\` first) — a stale dist/ silently under-measures.`,
      );
      process.exitCode = 1;
    }
  } else {
    console.error(`check-budget: ${manifestPath} not found.`);
    process.exitCode = 1;
  }

  for (const puzzleFile of puzzleFiles) {
    const puzzle = JSON.parse(readFileSync(puzzleFile, 'utf-8')) as Puzzle;
    const jsonBytes = fileRawBytes(puzzleFile);
    const levelBytes = puzzle.image.levels.reduce((sum, level) => {
      const levelPath = path.join(puzzlesDir, level.src);
      return sum + (existsSync(levelPath) ? fileRawBytes(levelPath) : 0);
    }, 0);
    const missingLevels = puzzle.image.levels.filter((l) => !existsSync(path.join(puzzlesDir, l.src)));
    if (missingLevels.length > 0) {
      console.error(
        `check-budget: puzzle ${puzzle.date} is missing level image(s) on disk: ` +
          missingLevels.map((l) => l.src).join(', '),
      );
      process.exitCode = 1;
    }
    record(
      `Day payload ${puzzle.date} (#${puzzle.number}, puzzle.json + 5 levels, raw)`,
      jsonBytes + levelBytes,
      DAY_BUDGET_BYTES,
    );

    const fullPath = path.join(puzzlesDir, puzzle.image.full.src);
    if (existsSync(fullPath)) {
      record(`Full reveal ${puzzle.date} (#${puzzle.number}, raw, lazy — outside the day budget)`, fileRawBytes(fullPath), FULL_BUDGET_BYTES);
    } else {
      console.error(`check-budget: puzzle ${puzzle.date} is missing its full reveal image on disk: ${puzzle.image.full.src}`);
      process.exitCode = 1;
    }
  }

  // ---- Print the table. -------------------------------------------------------------------------
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 'Measurement'.length);
  console.log('');
  console.log('Payload budgets (§5.9)');
  console.log('='.repeat(nameWidth + 34));
  console.log(`${'Measurement'.padEnd(nameWidth)}  ${'Bytes'.padStart(11)}  ${'Limit'.padStart(11)}  Status`);
  console.log('-'.repeat(nameWidth + 34));
  let anyFail = false;
  for (const r of rows) {
    if (!r.pass) anyFail = true;
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(`${r.name.padEnd(nameWidth)}  ${fmtKB(r.bytes).padStart(11)}  ${fmtKB(r.budget).padStart(11)}  ${status}`);
  }
  console.log('='.repeat(nameWidth + 34));

  if (anyFail || process.exitCode === 1) {
    console.error('\nbudgets: FAIL — one or more artifacts exceed their limit.');
    process.exit(1);
  }
  console.log('\nbudgets: all green.');
}

main();
