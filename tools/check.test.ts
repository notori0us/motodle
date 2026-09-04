/** @vitest-environment node -- tesseract.js spawns a Node worker; under jsdom its path resolves as a URL. */
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OperatorOverride, ReviewCandidate, ReviewFile } from '../schema/types';
import { validate, type JSONSchema } from '../schema/validate';
import { cacheKeyFor } from './lib/wikimedia';
import {
  DEFAULT_LANG,
  YEAR_RE,
  assertTraineddataPresent,
  checkCandidate,
  createTesseractEngine,
  findYearHits,
  runCheck,
  selectCandidates,
  sourceCropRect,
  traineddataDownloadUrl,
  traineddataPath,
  wordsFromPage,
  type OcrEngine,
  type OcrWord,
} from './check';

const SCRATCH_ROOT = os.tmpdir();
const ROOT = path.join(__dirname, '..');
const FIXTURE_IMAGE = path.join(ROOT, 'fixtures/images/2004-suzuki-gsxr750.jpg'); // 800x600, PLAN §6.9
const REVIEW_SCHEMA_PATH = path.join(ROOT, 'schema/review.schema.json');

// Same shape as fixture 1's real params (§6.9, C4): 800px is below MIN_SOURCE_WIDTH, so a
// cropFractions override is required to clear MIN_LEVEL1_PX at level 1 — mirrors
// tools/schedule.test.ts's WORKING_CROP_FRACTIONS exactly.
const WORKING_CROP_FRACTIONS = [0.4, 0.52, 0.66, 0.82, 1.0] as const;

const NO_OVERRIDE: OperatorOverride = {
  year: null,
  focus: null,
  sourceCrop: null,
  cropFractions: null,
  modelIdOverride: null,
  note: null,
};
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
    yearCandidates: [{ year: 2004, source: 'title', pattern: 'leading', confidence: 'high' }],
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
    userAgent: 'motodle/0.1 (https://playmotodle.com; homelab hobby project) node-fetch',
    candidates,
  };
}

let workDir: string;
let cacheDir: string;
let reviewPath: string;

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
  workDir = await fs.mkdtemp(path.join(SCRATCH_ROOT, 'check-'));
  cacheDir = path.join(workDir, 'cache');
  reviewPath = path.join(workDir, 'review.json');
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------------------

describe('YEAR_RE / findYearHits (§6.6)', () => {
  it('matches a bare 4-digit year in range', () => {
    expect('1995').toMatch(YEAR_RE);
    expect('2004').toMatch(YEAR_RE);
    expect('1885').toMatch(YEAR_RE);
  });

  it('does not match a 5-digit run (no false positive on a longer number)', () => {
    expect('20264').not.toMatch(YEAR_RE);
    expect('119955').not.toMatch(YEAR_RE);
  });

  it('does not match a word with no digits', () => {
    expect('SUZUKI').not.toMatch(YEAR_RE);
  });

  it('finds a hit per word, bbox as fractions of the given width/height, ignores non-matching words', () => {
    const words: OcrWord[] = [
      { text: 'SUZUKI', bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },
      { text: '1995,', bbox: { x0: 40, y0: 30, x1: 80, y1: 60 } }, // trailing punctuation still matches
    ];
    const hits = findYearHits(words, 400, 300);
    expect(hits).toEqual([{ text: '1995', bbox: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }]);
  });

  it('reports every matching word, not just the first', () => {
    const words: OcrWord[] = [
      { text: '1995', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
      { text: '2004', bbox: { x0: 20, y0: 20, x1: 30, y1: 30 } },
    ];
    expect(findYearHits(words, 100, 100).map((h) => h.text)).toEqual(['1995', '2004']);
  });
});

describe('wordsFromPage', () => {
  it('flattens blocks -> paragraphs -> lines -> words', () => {
    const page = {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    { text: 'A', bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
                    { text: 'B', bbox: { x0: 1, y0: 1, x1: 2, y1: 2 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(wordsFromPage(page).map((w) => w.text)).toEqual(['A', 'B']);
  });

  it('null blocks -> no words, does not throw', () => {
    expect(wordsFromPage({ blocks: null })).toEqual([]);
  });
});

describe('sourceCropRect', () => {
  it('null sourceCrop -> null (whole image)', () => {
    expect(sourceCropRect(800, 600, null)).toBeNull();
  });

  it('computes the same clamp/round math tools/crop.ts uses for its own sourceCrop step', () => {
    expect(sourceCropRect(2048, 1536, { x: 0.08, y: 0.02, w: 0.71, h: 0.72 })).toEqual({
      left: 164,
      top: 31,
      width: 1454,
      height: 1106,
    });
  });

  it('clamps width/height so the rect never runs past the image bounds', () => {
    expect(sourceCropRect(800, 600, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 })).toEqual({
      left: 720,
      top: 540,
      width: 80,
      height: 60,
    });
  });
});

describe('selectCandidates (matches tools/prefetch.ts\'s --decisions convention)', () => {
  const c = (id: string, decision: ReviewCandidate['decision']) => candidate({ candidateId: id, decision });
  const all = [c('M1', 'approve'), c('M2', 'pending'), c('M3', 'reject')];

  it('defaults to "approve" only', () => {
    expect(selectCandidates(all).map((x) => x.candidateId)).toEqual(['M1']);
  });
  it('"all" returns everything', () => {
    expect(selectCandidates(all, 'all').map((x) => x.candidateId)).toEqual(['M1', 'M2', 'M3']);
  });
  it('a comma list filters to exactly those decisions', () => {
    expect(selectCandidates(all, 'pending,approve').map((x) => x.candidateId).sort()).toEqual(['M1', 'M2']);
  });
});

describe('traineddataPath / traineddataDownloadUrl / assertTraineddataPresent', () => {
  it('traineddataPath joins the cache dir and "<lang>.traineddata"', () => {
    expect(traineddataPath('/tmp/x', 'eng')).toBe(path.join('/tmp/x', 'eng.traineddata'));
  });

  it('traineddataDownloadUrl points at the exact URL tesseract.js itself would fetch (LSTM_ONLY -> best_int)', () => {
    expect(traineddataDownloadUrl('eng')).toBe(
      'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    );
  });

  it('throws with a one-time download command when the file is absent', async () => {
    await expect(assertTraineddataPresent(workDir, 'eng')).rejects.toThrow(/eng\.traineddata not found/);
    await expect(assertTraineddataPresent(workDir, 'eng')).rejects.toThrow(/curl -fsSL/);
  });

  it('resolves without throwing once the file exists', async () => {
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(path.join(workDir, 'eng.traineddata'), 'stub');
    await expect(assertTraineddataPresent(workDir, 'eng')).resolves.toBeUndefined();
  });
});

// -----------------------------------------------------------------------------------------
// checkCandidate / runCheck — a FAKE OcrEngine, so this needs no traineddata and no tesseract
// worker at all. What's under test is the ORCHESTRATION: cache-only original read, sourceCrop
// application to the full-res original, cropImage rendering of the five levels + full, level
// tagging, and the review-file read/validate/write round trip.
// -----------------------------------------------------------------------------------------

/** Returns pre-programmed word lists in call order. checkCandidate always calls the engine in
 *  the fixed order [original, l1, l2, l3, l4, l5, full] (7 calls) — index accordingly. */
function fakeEngine(perCallWords: OcrWord[][]): OcrEngine {
  let i = 0;
  return {
    async recognizeWords(): Promise<OcrWord[]> {
      const words = perCallWords[i] ?? [];
      i += 1;
      return words;
    },
  };
}

describe('checkCandidate', () => {
  it('runs OCR over "original" + l1..l5 + full, in that order, and tags hits with the right level', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    const engine = fakeEngine([
      [], // original
      [], // l1
      [], // l2
      [], // l3
      [{ text: '1995', bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } }], // l4
      [], // l5
      [], // full
    ]);

    const result = await checkCandidate(candidate(), { cacheDir, engine });

    expect(result.faces).toBeNull();
    expect(typeof result.ranAt).toBe('string');
    expect(new Date(result.ranAt).toString()).not.toBe('Invalid Date');
    expect(result.ocr).toHaveLength(1);
    expect(result.ocr[0].level).toBe('l4');
    expect(result.ocr[0].text).toBe('1995');
    expect(result.ocr[0].bbox.x).toBeGreaterThanOrEqual(0);
    expect(result.ocr[0].bbox.x).toBeLessThanOrEqual(1);
  });

  it('applies operator.sourceCrop to the ORIGINAL before OCR-ing it (the "original" level)', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    // 800x600 source; sourceCrop {0,0,0.75,0.75} -> 600x450 cropped rect (chosen so
    // WORKING_CROP_FRACTIONS' level 1 (0.4 * 600 = 240px) still clears MIN_LEVEL1_PX exactly).
    const engine = fakeEngine([
      [{ text: '1995', bbox: { x0: 60, y0: 45, x1: 120, y1: 90 } }], // original: 10% box of 600x450
    ]);
    const withCrop = candidate({
      operator: { ...WORKING_OVERRIDE, sourceCrop: { x: 0, y: 0, w: 0.75, h: 0.75 } },
    });

    const result = await checkCandidate(withCrop, { cacheDir, engine });

    const originalHit = result.ocr.find((h) => h.level === 'original');
    expect(originalHit).toEqual({ level: 'original', text: '1995', bbox: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } });
  });

  it('reports no hits when nothing matches on any level', async () => {
    await seedOriginal(candidate().originalUrl, FIXTURE_IMAGE);
    const engine = fakeEngine([[], [], [], [], [], [], []]);
    const result = await checkCandidate(candidate(), { cacheDir, engine });
    expect(result.ocr).toEqual([]);
  });

  it('throws when the original is not cached (cache-only, never downloads)', async () => {
    const engine = fakeEngine([]);
    await expect(checkCandidate(candidate(), { cacheDir, engine })).rejects.toThrow(/not cached/);
  });
});

describe('runCheck', () => {
  it('writes a check block into each selected candidate and leaves the file schema-valid', async () => {
    const a = candidate({ candidateId: 'M1', decision: 'approve', originalUrl: 'https://upload.example/a.jpg' });
    const p = candidate({ candidateId: 'M2', decision: 'pending', originalUrl: 'https://upload.example/p.jpg' });
    await seedOriginal(a.originalUrl, FIXTURE_IMAGE);
    await seedOriginal(p.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([a, p]));

    const engine = fakeEngine([]); // no hits on any of the 7 calls for the one selected candidate
    const result = await runCheck({ reviewPath, cacheDir, engine }); // default --decisions "approve"

    expect(result).toEqual({ checked: 1, hits: 0, failed: [], hitsByCandidate: [] });

    const written = JSON.parse(await fs.readFile(reviewPath, 'utf8')) as ReviewFile;
    const writtenA = written.candidates.find((c) => c.candidateId === 'M1')!;
    const writtenP = written.candidates.find((c) => c.candidateId === 'M2')!;
    expect(writtenA.check).toBeDefined();
    expect(writtenA.check!.ocr).toEqual([]);
    expect(writtenP.check).toBeUndefined(); // "pending" was not selected by the default filter

    const schema = JSON.parse(await fs.readFile(REVIEW_SCHEMA_PATH, 'utf8')) as JSONSchema;
    expect(validate(schema, written)).toEqual([]);
  });

  it('records a per-candidate failure without aborting the rest of the batch', async () => {
    const cached = candidate({ candidateId: 'M1', originalUrl: 'https://upload.example/cached.jpg' });
    const missing = candidate({ candidateId: 'M2', originalUrl: 'https://upload.example/missing.jpg' });
    await seedOriginal(cached.originalUrl, FIXTURE_IMAGE);
    // missing.originalUrl deliberately NOT seeded.
    await writeReview(reviewFile([cached, missing]));

    const result = await runCheck({ reviewPath, cacheDir, engine: fakeEngine([]) });

    expect(result.checked).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].candidateId).toBe('M2');
    expect(result.failed[0].error).toMatch(/not cached/);

    const written = JSON.parse(await fs.readFile(reviewPath, 'utf8')) as ReviewFile;
    expect(written.candidates.find((c) => c.candidateId === 'M1')!.check).toBeDefined();
    expect(written.candidates.find((c) => c.candidateId === 'M2')!.check).toBeUndefined();
  });

  it('refuses a review file that does not validate against the schema, before touching anything', async () => {
    await fs.writeFile(reviewPath, JSON.stringify({ schema: 1, candidates: [] })); // missing required fields
    await expect(runCheck({ reviewPath, cacheDir, engine: fakeEngine([]) })).rejects.toThrow(/does not validate/);
  });

  it('collects hitsByCandidate with the level, text and bbox so the CLI can print them', async () => {
    const a = candidate({ candidateId: 'M1', decision: 'approve', originalUrl: 'https://upload.example/a.jpg' });
    await seedOriginal(a.originalUrl, FIXTURE_IMAGE);
    await writeReview(reviewFile([a]));

    const engine = fakeEngine([
      [], // original
      [], // l1
      [], // l2
      [], // l3
      [{ text: '1995', bbox: { x0: 10, y0: 10, x1: 50, y1: 30 } }], // l4
      [], // l5
      [], // full
    ]);
    const result = await runCheck({ reviewPath, cacheDir, engine });

    expect(result.hits).toBe(1);
    expect(result.hitsByCandidate).toHaveLength(1);
    expect(result.hitsByCandidate[0].candidateId).toBe('M1');
    expect(result.hitsByCandidate[0].ocr).toHaveLength(1);
    expect(result.hitsByCandidate[0].ocr[0].level).toBe('l4');
    expect(result.hitsByCandidate[0].ocr[0].text).toBe('1995');
  });
});

// -----------------------------------------------------------------------------------------
// Real OCR, end to end, over a synthetic image generated with sharp (white canvas + an SVG text
// overlay it rasterizes) — needs `eng.traineddata` on disk. Not fetched by this test (see
// tools/check.ts's file-header comment on why check.ts never fetches it itself); skipped with a
// clear message when the file is absent, which it will be in a clean CI checkout. One-time local
// setup: `mkdir -p .cache/tesseract-lang && curl -fsSL
// https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz | gunzip
// > .cache/tesseract-lang/eng.traineddata`.
// -----------------------------------------------------------------------------------------

const LANG_CACHE_DIR = path.join(ROOT, '.cache/tesseract-lang');
const hasTraineddata = existsSync(path.join(LANG_CACHE_DIR, `${DEFAULT_LANG}.traineddata`));

if (!hasTraineddata) {
  // eslint-disable-next-line no-console
  console.log(
    `tools/check.test.ts: skipping the real-OCR test — ${DEFAULT_LANG}.traineddata is not present at ` +
      `${LANG_CACHE_DIR} (see tools/check.ts's header comment for the one-time download command).`,
  );
}

describe.skipIf(!hasTraineddata)('real OCR (needs eng.traineddata on disk)', () => {
  it('reads a legible year off a synthetic "1995" image', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120">' +
        '<rect width="100%" height="100%" fill="white"/>' +
        '<text x="20" y="80" font-size="64" font-family="sans-serif" fill="black">1995</text>' +
        '</svg>',
    );
    const png = await sharp(svg).png().toBuffer();

    // Sanity check: the rasterized image is not blank (fontconfig actually drew something) —
    // otherwise a missing-font environment would pass this test for the wrong reason.
    const stats = await sharp(png).stats();
    expect(stats.channels[0].min).toBeLessThan(50);

    const { engine, close } = await createTesseractEngine(LANG_CACHE_DIR, DEFAULT_LANG);
    try {
      const words = await engine.recognizeWords(png);
      const hits = findYearHits(words, 400, 120);
      expect(hits.some((h) => h.text === '1995')).toBe(true);
    } finally {
      await close();
    }
  }, 30_000);
});
