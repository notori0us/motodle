import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Catalog, OperatorOverride, ReviewCandidate, ReviewFile } from '../schema/types';
import { validate, type JSONSchema } from '../schema/validate';
import { cacheKeyFor } from './lib/wikimedia';
import {
  assertAuthorPresent,
  assertSourceWidthApprovable,
  deriveYearEvidence,
  extensionForMime,
  needsYearRescue,
  scheduleApproved,
  type ScheduleOptions,
} from './schedule';

const SCRATCH_ROOT = '/tmp/claude-1000/-home-chris-workspace/852d5747-63d4-4155-bc73-5cf062e93be6/scratchpad/build-w2';
const ROOT = path.join(__dirname, '..');
const FIXTURE_IMAGE = path.join(ROOT, 'fixtures/images/2004-suzuki-gsxr750.jpg');
const PUZZLE_SCHEMA_PATH = path.join(ROOT, 'schema/puzzle.schema.json');

const NO_OVERRIDE: OperatorOverride = {
  year: null,
  focus: null,
  sourceCrop: null,
  cropFractions: null,
  modelIdOverride: null,
  note: null,
};

// The stand-in "original" every test downloads is the real 800x600 GSX-R750 fixture JPEG
// (read-only, borrowed from fixtures/images/ — never written to). 800px is below
// MIN_SOURCE_WIDTH (1867), so — exactly like the real fixture 1 (§6.9, C4) — it needs this same
// explicit cropFractions override to clear MIN_LEVEL1_PX. Tests that care about crop geometry
// override this explicitly; everything else just needs SOME crop that succeeds.
const WORKING_CROP_FRACTIONS = [0.4, 0.52, 0.66, 0.82, 1.0] as const;
const WORKING_OVERRIDE: OperatorOverride = { ...NO_OVERRIDE, cropFractions: WORKING_CROP_FRACTIONS };

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: 'M12193306',
    decision: 'approve',
    makeId: 'suzuki',
    modelId: 'suzuki-gsxr750',
    sourceCategory: 'Category:Suzuki GSX-R 750',
    fileTitle: 'File:2004 Suzuki GSXR-750 Left SIde.jpg',
    descriptionUrl: 'https://commons.wikimedia.org/wiki/File:2004_Suzuki_GSXR-750_Left_SIde.jpg',
    thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg',
    originalUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg',
    width: 800,
    height: 600,
    mime: 'image/jpeg',
    license: {
      id: 'PD',
      name: 'Public domain',
      url: 'https://commons.wikimedia.org/wiki/Template:PD-user',
      jurisdiction: null,
      sdcP275: ['Q98592850'],
      attributionRequired: false,
    },
    author: 'Pawlex',
    creditNote: null,
    restrictions: [],
    yearCandidates: [
      { year: 2004, source: 'title', pattern: 'leading', confidence: 'high' },
      { year: 2004, source: 'description', pattern: 'leading', confidence: 'high' },
    ],
    yearProposed: 2004,
    yearConfidence: 'high',
    warnings: [],
    operator: WORKING_OVERRIDE,
    ...overrides,
  };
}

function reviewFile(candidates: ReviewCandidate[]): ReviewFile {
  return {
    schema: 1,
    batch: '2026-09-05-batch01',
    generatedAt: '2026-09-05',
    userAgent: 'motodle/0.1 (https://github.com/reenchree/motodle; homelab hobby project) node-fetch',
    candidates,
  };
}

const CATALOG: Catalog = {
  schema: 1,
  generatedAt: '2026-09-02',
  source: 'seed',
  makes: [
    { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
    { id: 'honda', name: 'Honda', country: 'JP', aliases: [] },
  ],
  models: [
    { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] },
    { id: 'honda-cb750', makeId: 'honda', name: 'CB750', aliases: [], years: [1969, 2003] },
  ],
};

let workDir: string;
let puzzlesDir: string;
let catalogPath: string;
let cacheDir: string;
let reviewPath: string;
let attributionPath: string;

/** Every option EXCEPT `reviewPath`/`startDate` points at this test's own temp directory — in
 *  particular `attributionPath`, so a non-dry-run test never writes the real repo's
 *  `docs/ATTRIBUTION.md`. Callers override individual fields as needed. */
function baseOpts(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return {
    reviewPath,
    startDate: '2026-09-05',
    puzzlesDir,
    catalogPath,
    cacheDir,
    attributionPath,
    ...overrides,
  };
}

async function seedOriginal(url: string, filePath: string): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const bytes = await fs.readFile(filePath);
  const key = cacheKeyFor(url);
  await fs.writeFile(
    path.join(cacheDir, `${key}.json`),
    JSON.stringify({ url, fetchedAt: new Date().toISOString(), encoding: 'base64', body: bytes.toString('base64') }),
  );
}

async function writeReview(file: ReviewFile): Promise<void> {
  await fs.writeFile(reviewPath, JSON.stringify(file, null, 2));
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(SCRATCH_ROOT, 'schedule-'));
  puzzlesDir = path.join(workDir, 'puzzles');
  catalogPath = path.join(workDir, 'catalog.json');
  cacheDir = path.join(workDir, 'cache');
  reviewPath = path.join(workDir, 'review.json');
  attributionPath = path.join(workDir, 'ATTRIBUTION.md');
  await fs.mkdir(puzzlesDir, { recursive: true });
  await fs.writeFile(catalogPath, JSON.stringify(CATALOG, null, 2));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------------------

describe('needsYearRescue', () => {
  it('true when confidence is low/none and operator.year is null', () => {
    expect(needsYearRescue(candidate({ yearConfidence: 'low' }))).toBe(true);
    expect(needsYearRescue(candidate({ yearConfidence: 'none', yearProposed: null }))).toBe(true);
  });
  it('false when confidence is high/medium', () => {
    expect(needsYearRescue(candidate({ yearConfidence: 'high' }))).toBe(false);
    expect(needsYearRescue(candidate({ yearConfidence: 'medium' }))).toBe(false);
  });
  it('false when low/none but operator.year rescues it', () => {
    expect(needsYearRescue(candidate({ yearConfidence: 'low', operator: { ...NO_OVERRIDE, year: 1995 } }))).toBe(
      false,
    );
  });
});

describe('deriveYearEvidence', () => {
  it('operator override -> confidence "operator", source "operator"', () => {
    const ev = deriveYearEvidence(
      candidate({ operator: { ...NO_OVERRIDE, year: 1995, note: 'placard confirms' } }),
      '2026-09-05',
    );
    expect(ev.confidence).toBe('operator');
    expect(ev.source).toBe('operator');
    expect(ev.note).toBe('placard confirms');
    expect(ev.approvedBy).toBe('operator');
    expect(ev.approvedOn).toBe('2026-09-05');
  });

  it('fetcher-derived: copies confidence/source from the winning yearCandidates', () => {
    const ev = deriveYearEvidence(candidate(), '2026-09-05');
    expect(ev.confidence).toBe('high');
    expect(ev.source).toBe('title+description');
  });
});

describe('assertSourceWidthApprovable (§3.4/§6.3)', () => {
  it('does nothing when the usable 4:3 width already clears MIN_SOURCE_WIDTH', () => {
    expect(() =>
      assertSourceWidthApprovable(candidate({ width: 2000, height: 1500, operator: NO_OVERRIDE })),
    ).not.toThrow();
  });

  it('throws when below MIN_SOURCE_WIDTH and operator.cropFractions is null', () => {
    expect(() => assertSourceWidthApprovable(candidate({ operator: NO_OVERRIDE }))).toThrow(
      /MIN_SOURCE_WIDTH/,
    );
  });

  it('accepts a below-minimum source when operator.cropFractions clears MIN_LEVEL1_PX (real fixture-1 shape: 800x600 + [0.40,...] -> 320px)', () => {
    expect(() =>
      assertSourceWidthApprovable(candidate({ width: 800, height: 600, operator: WORKING_OVERRIDE })),
    ).not.toThrow();
  });

  it('still throws when operator.cropFractions is set but its level-1 rect stays below MIN_LEVEL1_PX', () => {
    const tooTight = [0.1, 0.2, 0.4, 0.6, 0.8] as const; // 0.1 * 800 = 80px, well under 280
    expect(() =>
      assertSourceWidthApprovable(candidate({ operator: { ...NO_OVERRIDE, cropFractions: tooTight } })),
    ).toThrow(/MIN_SOURCE_WIDTH/);
  });
});

describe('assertAuthorPresent (§3.1/§6.9)', () => {
  it('does nothing for a real author', () => {
    expect(() => assertAuthorPresent(candidate({ author: 'Pawlex' }))).not.toThrow();
  });
  it('throws for an empty author', () => {
    expect(() => assertAuthorPresent(candidate({ author: '' }))).toThrow(/no machine-readable author/);
  });
  it('throws for the literal "Unknown"', () => {
    expect(() => assertAuthorPresent(candidate({ author: 'Unknown' }))).toThrow(/no machine-readable author/);
  });
});

describe('extensionForMime', () => {
  it('maps known mimes', () => {
    expect(extensionForMime('image/jpeg')).toBe('.jpg');
    expect(extensionForMime('image/png')).toBe('.png');
  });
  it('falls back to .bin for unknown mimes', () => {
    expect(extensionForMime('application/octet-stream')).toBe('.bin');
  });
});

// -----------------------------------------------------------------------------------------
// scheduleApproved — end to end over synthetic, fully-offline fixtures
// -----------------------------------------------------------------------------------------

describe('scheduleApproved — happy path', () => {
  it('produces a contract-valid puzzle and manifest', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([candidate()]));

    const result = await scheduleApproved(baseOpts());

    expect(result.dryRun).toBe(false);
    expect(result.scheduled).toEqual([{ date: '2026-09-05', id: 'mtd-0004', candidateId: 'M12193306' }]);

    const puzzleRaw = await fs.readFile(path.join(puzzlesDir, '2026-09-05.json'), 'utf8');
    const puzzle = JSON.parse(puzzleRaw);
    expect(puzzle.id).toBe('mtd-0004');
    expect(puzzle.number).toBe(4);
    expect(puzzle.answer).toEqual({
      makeId: 'suzuki',
      make: 'Suzuki',
      modelId: 'suzuki-gsxr750',
      model: 'GSX-R750',
      year: 2004,
      acceptModelIds: ['suzuki-gsxr750'],
    });
    expect(puzzle.yearEvidence.confidence).toBe('high');
    expect(puzzle.image.levels[0].src).toBe('img/0004/l1.webp');

    const schema = JSON.parse(await fs.readFile(PUZZLE_SCHEMA_PATH, 'utf8')) as JSONSchema;
    expect(validate(schema, puzzle)).toEqual([]);

    const manifest = JSON.parse(await fs.readFile(path.join(puzzlesDir, 'manifest.json'), 'utf8'));
    expect(manifest.puzzles).toEqual([{ date: '2026-09-05', number: 4, id: 'mtd-0004' }]);
  });

  it('renders ATTRIBUTION.md at the given attributionPath (never the real repo docs/)', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([candidate()]));

    await scheduleApproved(baseOpts());

    const content = await fs.readFile(attributionPath, 'utf8');
    expect(content).toContain('Puzzle #4');
    expect(content).toContain("not** covered by this");
  });

  it('is idempotent — running it twice leaves the puzzle file and ATTRIBUTION.md byte-identical', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([candidate()]));

    await scheduleApproved(baseOpts());
    const first = await fs.readFile(path.join(puzzlesDir, '2026-09-05.json'), 'utf8');
    const firstAttribution = await fs.readFile(attributionPath, 'utf8');

    await scheduleApproved(baseOpts());
    const second = await fs.readFile(path.join(puzzlesDir, '2026-09-05.json'), 'utf8');
    const secondAttribution = await fs.readFile(attributionPath, 'utf8');

    expect(second).toBe(first);
    expect(secondAttribution).toBe(firstAttribution);
  });

  it('assigns consecutive approved candidates to consecutive dates starting at --start', async () => {
    const c1 = candidate({ candidateId: 'M1', originalUrl: 'https://upload.example/one.jpg' });
    const c2 = candidate({
      candidateId: 'M2',
      originalUrl: 'https://upload.example/two.jpg',
      makeId: 'honda',
      modelId: 'honda-cb750',
      fileTitle: 'File:Honda CB750.jpg',
      yearProposed: 1998,
    });
    await seedOriginal(c1.originalUrl, FIXTURE_IMAGE);
    await seedOriginal(c2.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([c1, c2]));

    const result = await scheduleApproved(baseOpts());
    expect(result.scheduled.map((s) => s.date)).toEqual(['2026-09-05', '2026-09-06']);
  });

  it('skips candidates whose decision is pending or reject', async () => {
    const approved = candidate();
    const pending = candidate({ candidateId: 'M9001', decision: 'pending' });
    const rejected = candidate({ candidateId: 'M9002', decision: 'reject' });
    await seedOriginal(approved.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([pending, approved, rejected]));

    const result = await scheduleApproved(baseOpts());
    expect(result.scheduled).toHaveLength(1);
    expect(result.scheduled[0].candidateId).toBe('M12193306');
  });
});

describe('scheduleApproved — refusals', () => {
  it('refuses the ENTIRE run when any approved candidate needs a year rescue', async () => {
    const good = candidate({ candidateId: 'M9003', originalUrl: 'https://upload.example/good.jpg' });
    const bad = candidate({
      candidateId: 'M9004',
      originalUrl: 'https://upload.example/bad.jpg',
      yearConfidence: 'low',
      yearProposed: null,
    });
    await seedOriginal(good.originalUrl, FIXTURE_IMAGE);
    await seedOriginal(bad.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([good, bad]));

    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/M9004/);

    // Nothing was written — the refusal happens before phase 2 (execute) even for the good one.
    await expect(fs.readFile(path.join(puzzlesDir, '2026-09-05.json'))).rejects.toThrow();
  });

  it('an operator.year rescue on the low-confidence candidate allows the run to proceed', async () => {
    const good = candidate({ candidateId: 'M9005', originalUrl: 'https://upload.example/good.jpg' });
    const rescued = candidate({
      candidateId: 'M9006',
      originalUrl: 'https://upload.example/rescued.jpg',
      yearConfidence: 'low',
      yearProposed: null,
      operator: { ...WORKING_OVERRIDE, year: 1999 },
    });
    await seedOriginal(good.originalUrl, FIXTURE_IMAGE);
    await seedOriginal(rescued.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([good, rescued]));

    const result = await scheduleApproved(baseOpts());
    expect(result.scheduled).toHaveLength(2);
  });

  it('refuses an approve whose source is below MIN_SOURCE_WIDTH with no cropFractions override (§3.4/§6.3)', async () => {
    const bad = candidate({ candidateId: 'M9009', operator: NO_OVERRIDE });
    await seedOriginal(bad.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([bad]));

    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/MIN_SOURCE_WIDTH/);
    await expect(fs.readFile(path.join(puzzlesDir, '2026-09-05.json'))).rejects.toThrow();
  });

  it('refuses an approve whose author is empty or the literal "Unknown" (§3.1/§6.9)', async () => {
    const bad = candidate({ candidateId: 'M9010', author: 'Unknown' });
    await seedOriginal(bad.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([bad]));

    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/no machine-readable author/);
  });

  it('refuses when the source original is not cached (network required, schedule.ts is offline)', async () => {
    await writeReview(reviewFile([candidate()])); // deliberately NOT seeded

    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/not cached.*npm run fetch/s);
  });

  it('refuses when makeId is not in the catalog', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([candidate({ makeId: 'nonexistent-make' })]));

    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/makeId "nonexistent-make" not found/);
  });

  it('refuses when modelId is not in the catalog', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([candidate({ modelId: 'nonexistent-model' })]));

    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/modelId "nonexistent-model" not found/);
  });

  it('refuses to re-point an already-scheduled date to a different source without --force', async () => {
    const first = candidate({ originalUrl: 'https://upload.example/first.jpg' });
    await seedOriginal(first.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([first]));
    await scheduleApproved(baseOpts());

    const second = candidate({
      candidateId: 'M9007',
      originalUrl: 'https://upload.example/second.jpg',
      fileTitle: 'File:A different photo.jpg',
    });
    await seedOriginal(second.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([second]));

    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/already scheduled with a different source/);
  });

  it('allows re-pointing an already-scheduled date with --force', async () => {
    const first = candidate({ originalUrl: 'https://upload.example/first.jpg' });
    await seedOriginal(first.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([first]));
    await scheduleApproved(baseOpts());

    const second = candidate({
      candidateId: 'M9008',
      originalUrl: 'https://upload.example/second.jpg',
      fileTitle: 'File:A different photo.jpg',
      makeId: 'honda',
      modelId: 'honda-cb750',
    });
    await seedOriginal(second.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([second]));

    const result = await scheduleApproved(baseOpts({ force: true }));
    expect(result.scheduled[0].candidateId).toBe('M9008');
    const puzzle = JSON.parse(await fs.readFile(path.join(puzzlesDir, '2026-09-05.json'), 'utf8'));
    expect(puzzle.credit.fileTitle).toBe('File:A different photo.jpg');
    expect(puzzle.id).toBe('mtd-0004'); // id is a pure function of date — unchanged by --force
  });

  it('re-running with the SAME source (no change) never requires --force', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([candidate()]));
    await scheduleApproved(baseOpts());

    await expect(scheduleApproved(baseOpts())).resolves.toBeDefined();
  });
});

describe('scheduleApproved — dry-run', () => {
  it('reports the plan but writes nothing (not even at the given attributionPath)', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([candidate()]));

    const result = await scheduleApproved(baseOpts({ dryRun: true }));

    expect(result.dryRun).toBe(true);
    expect(result.scheduled).toEqual([{ date: '2026-09-05', id: 'mtd-0004', candidateId: 'M12193306' }]);
    await expect(fs.readFile(path.join(puzzlesDir, '2026-09-05.json'))).rejects.toThrow();
    await expect(fs.readFile(path.join(puzzlesDir, 'manifest.json'))).rejects.toThrow();
    await expect(fs.readFile(attributionPath)).rejects.toThrow();
  });

  it('still surfaces validation errors (a bad batch fails loudly even in dry-run)', async () => {
    await writeReview(reviewFile([candidate({ makeId: 'nonexistent-make' })])); // not seeded, and bad makeId

    await expect(scheduleApproved(baseOpts({ dryRun: true }))).rejects.toThrow();
  });
});

describe('scheduleApproved — review.schema.json validation', () => {
  it('refuses a review file that does not validate against the schema', async () => {
    await fs.writeFile(reviewPath, JSON.stringify({ schema: 1, batch: 'x' })); // missing required fields
    await expect(scheduleApproved(baseOpts())).rejects.toThrow(/does not validate/);
  });
});
