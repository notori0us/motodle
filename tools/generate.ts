/**
 * `tools/generate.ts` — crop + schedule over `fixtures/`, the OFFLINE `npm run generate` (§6.1,
 * §6.2). No CLI arguments. Reads `fixtures/fixtures.json` + `fixtures/images/*`; writes
 * `public/puzzles/**` and `docs/ATTRIBUTION.md`.
 *
 * OFFLINE BY CONSTRUCTION: this file never imports `tools/lib/wikimedia.ts` (directly or
 * transitively) and never calls the global `fetch` function or touches `node:http(s)`/`undici`.
 * `tools/generate.test.ts` proves that statically by walking this file's import graph (§7.2 #14)
 * — a clean clone cannot prove "no network call happened" by observation alone (there may be
 * nothing to observe), so the guarantee is structural instead.
 *
 * IDEMPOTENT (§6.1, §6.3): each fixture's `id` is copied verbatim, never re-minted; every run
 * overwrites `public/puzzles/**` unconditionally and regenerates `manifest.json` and
 * `docs/ATTRIBUTION.md` WHOLESALE (never appended) from whatever puzzle files exist afterwards.
 * Two consecutive runs over an unchanged `fixtures/` therefore leave byte-identical output —
 * WebP encoding is deterministic for a fixed sharp/libvips build (§7.5 note).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNCH_DATE } from '../schema/constants';
import type { FixtureSource } from '../schema/types';
import { renderAttribution } from './lib/attribution';
import { puzzleId, puzzleNumber } from './lib/date';
import { buildPuzzle, readAllPuzzles, writeJson, writeManifest } from './lib/puzzle-build';

// `package.json` declares `"type": "module"`, so this runs as an ES module under `tsx` — no
// `__dirname` global. Derive it from `import.meta.url` instead (vitest's own transform DOES
// polyfill `__dirname`, which is why the test file for this module can use it directly, but a
// direct `tsx tools/generate.ts` invocation cannot).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const FIXTURES_DIR = path.join(ROOT, 'fixtures');
const FIXTURES_FILE = path.join(FIXTURES_DIR, 'fixtures.json');
const PUZZLES_DIR = path.join(ROOT, 'public/puzzles');
const ATTRIBUTION_FILE = path.join(ROOT, 'docs/ATTRIBUTION.md');

interface FixturesDoc {
  schema: 1;
  fixtures: FixtureSource[];
}

async function loadFixtures(): Promise<FixtureSource[]> {
  const raw = await fs.readFile(FIXTURES_FILE, 'utf8');
  const doc = JSON.parse(raw) as FixturesDoc;
  return doc.fixtures;
}

export interface GenerateResult {
  dates: string[];
  manifestPath: string;
  attributionPath: string;
}

export async function generate(): Promise<GenerateResult> {
  const fixtures = await loadFixtures();
  const dates: string[] = [];

  for (const fixture of fixtures) {
    // id/idempotency rule (§6.3): the fixture's id is the single source of truth, copied
    // verbatim — never re-minted, never renumbered. Still sanity-checked here so a hand-edit
    // mistake in fixtures.json fails loudly at generate time instead of silently downstream.
    const number = puzzleNumber(fixture.date);
    const expectedId = puzzleId(number);
    if (fixture.id !== expectedId) {
      throw new Error(
        `generate.ts: fixtures.json entry for ${fixture.date} has id "${fixture.id}" but ` +
          `puzzleNumber(date) implies "${expectedId}" — fix fixtures.json (ids are authored, never derived)`,
      );
    }

    const paddedNumber = String(number).padStart(4, '0');
    const puzzle = await buildPuzzle({
      id: fixture.id,
      number,
      date: fixture.date,
      answer: fixture.answer,
      inputPath: path.join(FIXTURES_DIR, fixture.file),
      outDir: path.join(PUZZLES_DIR, 'img', paddedNumber),
      srcPrefix: `img/${paddedNumber}/`,
      focus: fixture.focus,
      sourceCrop: fixture.sourceCrop,
      cropFractions: fixture.cropFractions,
      credit: fixture.credit,
      yearEvidence: fixture.yearEvidence,
    });

    await writeJson(path.join(PUZZLES_DIR, `${fixture.date}.json`), puzzle);
    dates.push(fixture.date);
  }

  // Wholesale regeneration (§6.3): read back EVERY puzzle file on disk (not just the ones this
  // run touched — a prior `schedule` run may have added more) and rebuild manifest.json +
  // ATTRIBUTION.md from that complete, sorted set.
  const allPuzzles = await readAllPuzzles(PUZZLES_DIR);
  await writeManifest(PUZZLES_DIR, LAUNCH_DATE, allPuzzles);

  await fs.mkdir(path.dirname(ATTRIBUTION_FILE), { recursive: true });
  await fs.writeFile(ATTRIBUTION_FILE, renderAttribution(allPuzzles));

  return {
    dates,
    manifestPath: path.join(PUZZLES_DIR, 'manifest.json'),
    attributionPath: ATTRIBUTION_FILE,
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  generate()
    .then((result) => {
      console.log(`generate: wrote ${result.dates.length} puzzle(s): ${result.dates.join(', ')}`);
      console.log('generate: regenerated manifest.json and docs/ATTRIBUTION.md');
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
