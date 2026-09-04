import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, ReviewCandidate, ReviewFile } from '../schema/types';
import { validate, type JSONSchema } from '../schema/validate';
import { cacheKeyFor, withMandatoryParams } from './lib/wikimedia';
import {
  commonsFileQueryUrl,
  extractP275,
  isValidDateArg,
  localUploadUrl,
  ownPhotoCandidateId,
  parseCropArg,
  parseFocusArg,
  runAdd,
  upsertCandidate,
  wbgetentitiesUrl,
  type AddOptions,
} from './add';

const SCRATCH_ROOT = os.tmpdir();
const ROOT = path.join(__dirname, '..');
const REVIEW_SCHEMA_PATH = path.join(ROOT, 'schema/review.schema.json');
const PUZZLE_SCHEMA_PATH = path.join(ROOT, 'schema/puzzle.schema.json');

// -----------------------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------------------

describe('parseFocusArg', () => {
  it('parses "x,y"', () => {
    expect(parseFocusArg('0.4,0.55')).toEqual({ x: 0.4, y: 0.55 });
  });
  it('rejects the wrong number of parts', () => {
    expect(() => parseFocusArg('0.4')).toThrow(/--focus must be "x,y"/);
  });
  it('rejects an out-of-range fraction', () => {
    expect(() => parseFocusArg('1.5,0.5')).toThrow(/\[0,1\]/);
    expect(() => parseFocusArg('0.5,-0.1')).toThrow(/\[0,1\]/);
  });
});

describe('parseCropArg', () => {
  it('parses "x,y,w,h"', () => {
    expect(parseCropArg('0,0,1,0.9')).toEqual({ x: 0, y: 0, w: 1, h: 0.9 });
  });
  it('rejects the wrong number of parts', () => {
    expect(() => parseCropArg('0,0,1')).toThrow(/--crop must be "x,y,w,h"/);
  });
});

describe('isValidDateArg', () => {
  it('accepts a real calendar date', () => {
    expect(isValidDateArg('2026-11-02')).toBe(true);
  });
  it('rejects malformed or impossible dates', () => {
    expect(isValidDateArg('2026-11-2')).toBe(false);
    expect(isValidDateArg('2026-13-45')).toBe(false);
    expect(isValidDateArg('not-a-date')).toBe(false);
  });
});

describe('commonsFileQueryUrl / wbgetentitiesUrl', () => {
  it('adds the "File:" prefix if missing, and mirrors fetch.ts\'s iiprop/iiextmetadatafilter recipe', () => {
    const url = commonsFileQueryUrl('Foo Bar.jpg');
    expect(url).toContain('titles=File%3AFoo%20Bar.jpg');
    expect(url).toContain('iiprop=extmetadata%7Curl%7Csize%7Cmime%7Ctimestamp');
    expect(url).toContain('iiextmetadatafilter=LicenseShortName');
  });
  it('leaves an already-prefixed title alone', () => {
    expect(commonsFileQueryUrl('File:Foo.jpg')).toContain('titles=File%3AFoo.jpg');
  });
  it('wbgetentitiesUrl requests exactly one id', () => {
    expect(wbgetentitiesUrl('M123')).toBe(
      'https://commons.wikimedia.org/w/api.php?action=wbgetentities&ids=M123&props=claims',
    );
  });
});

describe('extractP275', () => {
  it('reads P275 from `statements` (the live shape)', () => {
    const p275 = extractP275(
      { entities: { M1: { statements: { P275: [{ mainsnak: { datavalue: { value: { id: 'Q6938433' } } } }] } } } },
      'M1',
    );
    expect(p275).toEqual(['Q6938433']);
  });
  it('falls back to `claims`', () => {
    const p275 = extractP275(
      { entities: { M1: { claims: { P275: [{ mainsnak: { datavalue: { value: { id: 'Q6938433' } } } }] } } } },
      'M1',
    );
    expect(p275).toEqual(['Q6938433']);
  });
  it('absent entity -> []', () => {
    expect(extractP275({ entities: {} }, 'M1')).toEqual([]);
  });
});

describe('localUploadUrl / ownPhotoCandidateId', () => {
  it('is a non-http synthetic scheme, keyed by the hash', () => {
    expect(localUploadUrl('abc123')).toBe('motodle://local-upload/abc123');
  });
  it('candidateId matches the schema\'s "^M[0-9]+$" pattern', () => {
    const id = ownPhotoCandidateId('0123456789abcdef');
    expect(id).toMatch(/^M[0-9]+$/);
  });
  it('is deterministic for the same hash, distinct for different hashes', () => {
    expect(ownPhotoCandidateId('aaaaaaaaaaaa')).toBe(ownPhotoCandidateId('aaaaaaaaaaaa'));
    expect(ownPhotoCandidateId('aaaaaaaaaaaa')).not.toBe(ownPhotoCandidateId('bbbbbbbbbbbb'));
  });
});

function makeCandidate(id: string): ReviewCandidate {
  return {
    candidateId: id,
    decision: 'approve',
    makeId: 'suzuki',
    modelId: 'suzuki-gsxr750',
    sourceCategory: 'manual-upload',
    fileTitle: 'a.jpg',
    descriptionUrl: 'https://playmotodle.com/about.html',
    thumbUrl: 'motodle://local-upload/x',
    originalUrl: 'motodle://local-upload/x',
    width: 2400,
    height: 1800,
    mime: 'image/jpeg',
    license: { id: 'CC0', name: 'CC0 1.0 Universal', url: 'https://creativecommons.org/publicdomain/zero/1.0/', jurisdiction: null, sdcP275: [], attributionRequired: false },
    author: 'Someone',
    creditNote: null,
    restrictions: [],
    yearCandidates: [],
    yearProposed: null,
    yearConfidence: 'none',
    warnings: [],
    operator: { year: 2004, focus: null, sourceCrop: null, cropFractions: null, modelIdOverride: null, note: null },
  };
}

describe('upsertCandidate', () => {
  const empty: ReviewFile = { schema: 1, batch: 'manual', generatedAt: '2026-01-01', userAgent: 'ua', candidates: [] };

  it('creates when the file has no candidates', () => {
    const out = upsertCandidate(empty, makeCandidate('M1'));
    expect(out.candidates.map((c) => c.candidateId)).toEqual(['M1']);
  });
  it('appends a new candidateId, leaving others untouched', () => {
    const withOne = upsertCandidate(empty, makeCandidate('M1'));
    const withTwo = upsertCandidate(withOne, makeCandidate('M2'));
    expect(withTwo.candidates.map((c) => c.candidateId)).toEqual(['M1', 'M2']);
  });
  it('replaces an existing entry with the same candidateId in place', () => {
    const withOne = upsertCandidate(empty, makeCandidate('M1'));
    const replaced = upsertCandidate(withOne, { ...makeCandidate('M1'), author: 'Someone Else' });
    expect(replaced.candidates).toHaveLength(1);
    expect(replaced.candidates[0].author).toBe('Someone Else');
  });
});

// -----------------------------------------------------------------------------------------
// runAdd() — --file mode, fully offline (no network import even touched)
// -----------------------------------------------------------------------------------------

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
let reviewPath: string;
let catalogPath: string;
let cacheDir: string;
let puzzlesDir: string;
let attributionPath: string;
let previewDir: string;

function baseOpts(overrides: Partial<AddOptions> = {}): AddOptions {
  return {
    model: 'suzuki-gsxr750',
    year: 2004,
    date: '2026-09-05',
    reviewPath,
    catalogPath,
    cacheDir,
    puzzlesDir,
    attributionPath,
    previewDir,
    ...overrides,
  } as AddOptions;
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(SCRATCH_ROOT, 'add-'));
  reviewPath = path.join(workDir, 'review.json');
  catalogPath = path.join(workDir, 'catalog.json');
  cacheDir = path.join(workDir, 'cache');
  puzzlesDir = path.join(workDir, 'puzzles');
  attributionPath = path.join(workDir, 'ATTRIBUTION.md');
  previewDir = path.join(workDir, 'preview');
  await fs.mkdir(puzzlesDir, { recursive: true });
  await fs.writeFile(catalogPath, JSON.stringify(CATALOG, null, 2));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

/** A flat-colour JPEG, big enough to clear MIN_SOURCE_WIDTH (2182px usable) without a
 *  cropFractions override, and small enough post-encode to clear the WebP byte budgets. */
async function makePhoto(dir: string, name: string, opts: { width: number; height: number; rgb: [number, number, number] }): Promise<string> {
  const filePath = path.join(dir, name);
  await sharp({ create: { width: opts.width, height: opts.height, channels: 3, background: { r: opts.rgb[0], g: opts.rgb[1], b: opts.rgb[2] } } })
    .jpeg()
    .toFile(filePath);
  return filePath;
}

describe('runAdd — --file requires --author', () => {
  it('throws before touching the filesystem', async () => {
    const photo = await makePhoto(workDir, 'p.jpg', { width: 2400, height: 1800, rgb: [10, 20, 30] });
    await expect(runAdd(baseOpts({ file: photo }))).rejects.toThrow(/--author/);
  });
});

describe('runAdd — --commons and --file are mutually exclusive / one is required', () => {
  it('throws when neither is set', async () => {
    await expect(runAdd(baseOpts())).rejects.toThrow(/either --commons.*or --file/);
  });
  it('throws when both are set', async () => {
    await expect(runAdd(baseOpts({ commons: 'File:X.jpg', file: '/tmp/x.jpg', author: 'A' }))).rejects.toThrow(
      /mutually exclusive/,
    );
  });
});

describe('runAdd — --file, --dry-run', () => {
  it('validates, upserts the review file, warms the cache, and stops before scheduling', async () => {
    const photo = await makePhoto(workDir, 'p.jpg', { width: 2400, height: 1800, rgb: [10, 20, 30] });
    const result = await runAdd(baseOpts({ file: photo, author: 'Chris', license: 'CC0', dryRun: true }));

    expect(result.scheduled).toBe(false);
    expect(result.previewPath).toBeNull();
    expect(result.candidate.candidateId).toMatch(/^M[0-9]+$/);
    expect(result.candidate.decision).toBe('approve');
    expect(result.candidate.operator.year).toBe(2004); // own photo: always operator-sourced

    const written = JSON.parse(await fs.readFile(reviewPath, 'utf8')) as ReviewFile;
    expect(written.candidates).toHaveLength(1);
    expect(written.candidates[0].candidateId).toBe(result.candidate.candidateId);
    const schema = JSON.parse(await fs.readFile(REVIEW_SCHEMA_PATH, 'utf8')) as JSONSchema;
    expect(validate(schema, written)).toEqual([]);

    // Cache warmed even under --dry-run (only scheduling/preview are skipped).
    const cacheFiles = await fs.readdir(cacheDir);
    expect(cacheFiles.length).toBeGreaterThan(0);

    // Nothing scheduled.
    expect(await fs.readdir(puzzlesDir)).toEqual([]);
  });
});

describe('runAdd — --file, real schedule (own photo, no network anywhere)', () => {
  it('produces a contract-valid puzzle and a preview page with embedded data URIs', async () => {
    const photo = await makePhoto(workDir, 'p.jpg', { width: 2400, height: 1800, rgb: [80, 40, 40] });
    const result = await runAdd(
      baseOpts({ file: photo, author: 'Chris', license: 'CC0', focus: { x: 0.5, y: 0.5 }, note: 'own photo, taken 2004' }),
    );

    expect(result.scheduled).toBe(true);
    expect(result.scheduleResult?.scheduled).toEqual([
      { date: '2026-09-05', id: 'mtd-0004', candidateId: result.candidate.candidateId },
    ]);

    const puzzleRaw = await fs.readFile(path.join(puzzlesDir, '2026-09-05.json'), 'utf8');
    const puzzle = JSON.parse(puzzleRaw);
    expect(puzzle.answer).toEqual({
      makeId: 'suzuki',
      make: 'Suzuki',
      modelId: 'suzuki-gsxr750',
      model: 'GSX-R750',
      year: 2004,
      acceptModelIds: ['suzuki-gsxr750'],
    });
    expect(puzzle.credit.author).toBe('Chris');
    expect(puzzle.credit.license.id).toBe('CC0');
    expect(puzzle.credit.descriptionUrl).toMatch(/^https:\/\//); // own photo: never a dead file:// link
    expect(puzzle.yearEvidence.confidence).toBe('operator');

    const puzzleSchema = JSON.parse(await fs.readFile(PUZZLE_SCHEMA_PATH, 'utf8')) as JSONSchema;
    expect(validate(puzzleSchema, puzzle)).toEqual([]);

    expect(result.previewPath).toBe(path.join(previewDir, '2026-09-05.html'));
    const html = await fs.readFile(result.previewPath!, 'utf8');
    expect(html).toContain('data:image/webp;base64,');
    expect(html).toContain('Suzuki GSX-R750 (2004)');
    expect((html.match(/data:image\/webp;base64,/g) ?? []).length).toBe(6); // 5 levels + full

    // docs/ATTRIBUTION.md was regenerated at the given (temp) path, never the real repo file.
    const attribution = await fs.readFile(attributionPath, 'utf8');
    expect(attribution).toContain('Puzzle #4');
  });
});

describe('runAdd — --file rejects a source below MIN_SOURCE_WIDTH, same gate as schedule.ts', () => {
  it('throws before writing anything to puzzlesDir', async () => {
    const photo = await makePhoto(workDir, 'tiny.jpg', { width: 300, height: 225, rgb: [1, 2, 3] });
    await expect(runAdd(baseOpts({ file: photo, author: 'Chris', dryRun: true }))).rejects.toThrow(/MIN_SOURCE_WIDTH/);
  });
});

describe('runAdd — re-adding the same file upserts rather than duplicating', () => {
  it('keeps exactly one candidate after two runs against the same photo', async () => {
    const photo = await makePhoto(workDir, 'p.jpg', { width: 2400, height: 1800, rgb: [50, 60, 70] });
    const first = await runAdd(baseOpts({ file: photo, author: 'Chris', note: 'first pass', dryRun: true }));
    const second = await runAdd(baseOpts({ file: photo, author: 'Chris', note: 'second pass, tighter focus', dryRun: true }));

    expect(second.candidate.candidateId).toBe(first.candidate.candidateId);
    const written = JSON.parse(await fs.readFile(reviewPath, 'utf8')) as ReviewFile;
    expect(written.candidates).toHaveLength(1);
    expect(written.candidates[0].operator.note).toBe('second pass, tighter focus');
  });
});

describe('runAdd — scheduling is scoped to exactly the one candidate (scratch-file isolation)', () => {
  it('two --file adds to the SAME review file, on two dates, do not re-date each other', async () => {
    const photoA = await makePhoto(workDir, 'a.jpg', { width: 2400, height: 1800, rgb: [200, 0, 0] });
    const photoB = await makePhoto(workDir, 'b.jpg', { width: 2400, height: 1800, rgb: [0, 200, 0] });

    const addA = await runAdd(
      baseOpts({ file: photoA, author: 'Chris', model: 'suzuki-gsxr750', year: 2004, date: '2026-09-05' }),
    );
    const addB = await runAdd(
      baseOpts({ file: photoB, author: 'Chris', model: 'honda-cb750', year: 1970, date: '2026-09-09' }),
    );

    expect(addA.scheduled).toBe(true);
    expect(addB.scheduled).toBe(true);

    const puzzleA = JSON.parse(await fs.readFile(path.join(puzzlesDir, '2026-09-05.json'), 'utf8'));
    const puzzleB = JSON.parse(await fs.readFile(path.join(puzzlesDir, '2026-09-09.json'), 'utf8'));
    expect(puzzleA.answer.modelId).toBe('suzuki-gsxr750');
    expect(puzzleA.answer.year).toBe(2004);
    expect(puzzleB.answer.modelId).toBe('honda-cb750');
    expect(puzzleB.answer.year).toBe(1970);

    // No candidate landed on an unintended in-between date (2026-09-06/07/08).
    for (const d of ['2026-09-06', '2026-09-07', '2026-09-08']) {
      await expect(fs.access(path.join(puzzlesDir, `${d}.json`))).rejects.toThrow();
    }

    // The durable review file accumulated both, as the "working database" (CONTENT-RUNBOOK.md).
    const written = JSON.parse(await fs.readFile(reviewPath, 'utf8')) as ReviewFile;
    expect(written.candidates.map((c) => c.modelId).sort()).toEqual(['honda-cb750', 'suzuki-gsxr750']);
  });
});

// -----------------------------------------------------------------------------------------
// runAdd() — --commons mode, fully offline via a seeded cache (no network, mirrors
// tools/fetch.test.ts's seedJsonResponse pattern so this stays inside the "zero live calls in
// vitest" invariant; the one real live check is a manual CLI invocation, see tools/add.test.ts's
// header note in the PR description / report, not a test here).
// -----------------------------------------------------------------------------------------

async function seedJsonResponse(dir: string, url: string, body: unknown): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const key = cacheKeyFor(withMandatoryParams(url));
  await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify({ url, fetchedAt: new Date().toISOString(), encoding: 'json', body }));
}

async function seedOriginal(dir: string, url: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const key = cacheKeyFor(url); // requestBinary() never runs withMandatoryParams (§6.7 is an api.php convention)
  await fs.writeFile(
    path.join(dir, `${key}.json`),
    JSON.stringify({ url, fetchedAt: new Date().toISOString(), encoding: 'base64', body: bytes.toString('base64') }),
  );
}

function commonsPage(overrides: Record<string, unknown> = {}, extmeta: Record<string, unknown> = {}) {
  return {
    pageid: 555001,
    title: 'File:Test Suzuki GSXR750.jpg',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/t/te/Test_Suzuki_GSXR750.jpg',
        thumburl: 'https://upload.wikimedia.org/wikipedia/commons/t/te/Test_Suzuki_GSXR750.jpg?utm_content=thumb',
        width: 2400,
        height: 1800,
        mime: 'image/jpeg',
        extmetadata: {
          LicenseShortName: { value: 'CC0' },
          LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' },
          Artist: { value: 'A Photographer' },
          AttributionRequired: { value: 'false' },
          ObjectName: { value: '2004 Suzuki GSXR750' },
          ImageDescription: { value: 'A 2004 Suzuki GSX-R750 at a rally.' },
          ...extmeta,
        },
      },
    ],
    categories: [{ title: 'Category:Suzuki GSX-R750' }],
    ...overrides,
  };
}

/** `runAdd()` warms the original-image cache unconditionally (only scheduling/preview are
 *  gated behind `--dry-run`, per docs/CONTENT-RUNBOOK.md's "Manual path"), so every --commons
 *  test needs SOME cached bytes at `imageinfo.url` even when it never reaches `scheduleApproved`. */
async function seedFakeOriginal(): Promise<void> {
  await seedOriginal(cacheDir, commonsPage().imageinfo[0].url, Buffer.from('fake-original-bytes'));
}

describe('runAdd — --commons, fully offline (seeded cache)', () => {
  // Prove these tests never fall through to a real network call on a cache-key drift — a
  // passthrough spy still lets one live request happen, but afterEach then fails loudly.
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not override operator.year when it already matches a high-confidence proposal', async () => {
    await seedJsonResponse(cacheDir, commonsFileQueryUrl('File:Test Suzuki GSXR750.jpg'), { query: { pages: [commonsPage()] } });
    await seedJsonResponse(cacheDir, wbgetentitiesUrl('M555001'), { entities: {} });
    await seedFakeOriginal();

    const result = await runAdd(baseOpts({ commons: 'File:Test Suzuki GSXR750.jpg', year: 2004, dryRun: true }));

    expect(result.candidate.yearProposed).toBe(2004);
    expect(result.candidate.yearConfidence).toBe('high');
    expect(result.candidate.operator.year).toBeNull(); // richer fetcher-derived evidence kept
  });

  it('overrides operator.year when it differs from the proposal', async () => {
    await seedJsonResponse(cacheDir, commonsFileQueryUrl('File:Test Suzuki GSXR750.jpg'), { query: { pages: [commonsPage()] } });
    await seedJsonResponse(cacheDir, wbgetentitiesUrl('M555001'), { entities: {} });
    await seedFakeOriginal();

    const result = await runAdd(baseOpts({ commons: 'File:Test Suzuki GSXR750.jpg', year: 1999, dryRun: true }));
    expect(result.candidate.operator.year).toBe(1999);
  });

  it('overrides operator.year even when it matches, if the proposal\'s own confidence is low (no-escape-hatch fix)', async () => {
    const lowConfidencePage = commonsPage(
      {},
      {
        ObjectName: { value: 'Suzuki GSXR750 side view' }, // no leading year token
        ImageDescription: { value: 'Photographed at a show - 2004 -' }, // hyphen-flanked -> date-shaped -> low
      },
    );
    await seedJsonResponse(cacheDir, commonsFileQueryUrl('File:Test Suzuki GSXR750.jpg'), { query: { pages: [lowConfidencePage] } });
    await seedJsonResponse(cacheDir, wbgetentitiesUrl('M555001'), { entities: {} });
    await seedFakeOriginal();

    const result = await runAdd(baseOpts({ commons: 'File:Test Suzuki GSXR750.jpg', year: 2004, dryRun: true }));
    expect(result.candidate.yearConfidence).toBe('low');
    expect(result.candidate.yearProposed).toBe(2004);
    expect(result.candidate.operator.year).toBe(2004); // rescued despite matching the proposal
  });

  it('throws a clear error when the licence is not on the allow-list', async () => {
    const gfdlPage = commonsPage({}, { LicenseShortName: { value: 'GFDL 1.2' }, LicenseUrl: { value: '' } });
    await seedJsonResponse(cacheDir, commonsFileQueryUrl('File:Test Suzuki GSXR750.jpg'), { query: { pages: [gfdlPage] } });
    await seedJsonResponse(cacheDir, wbgetentitiesUrl('M555001'), { entities: {} });

    await expect(runAdd(baseOpts({ commons: 'File:Test Suzuki GSXR750.jpg', year: 2004, dryRun: true }))).rejects.toThrow(
      /licence is not on the .* allow-list/,
    );
  });

  it('throws a clear error when the file does not exist', async () => {
    await seedJsonResponse(cacheDir, commonsFileQueryUrl('File:Nope.jpg'), {
      query: { pages: [{ ns: 6, title: 'File:Nope.jpg', missing: true }] },
    });
    await expect(runAdd(baseOpts({ commons: 'File:Nope.jpg', year: 2004, dryRun: true }))).rejects.toThrow(/not found/);
  });

  it('full schedule run: caches the original via the same client prefetch.ts uses, then schedules it', async () => {
    await seedJsonResponse(cacheDir, commonsFileQueryUrl('File:Test Suzuki GSXR750.jpg'), { query: { pages: [commonsPage()] } });
    await seedJsonResponse(cacheDir, wbgetentitiesUrl('M555001'), { entities: {} });
    const bytes = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 10, g: 10, b: 200 } } }).jpeg().toBuffer();
    await seedOriginal(cacheDir, commonsPage().imageinfo[0].url, bytes);

    const result = await runAdd(baseOpts({ commons: 'File:Test Suzuki GSXR750.jpg', year: 2004, date: '2026-10-01' }));

    expect(result.scheduled).toBe(true);
    const puzzle = JSON.parse(await fs.readFile(path.join(puzzlesDir, '2026-10-01.json'), 'utf8'));
    expect(puzzle.answer.year).toBe(2004);
    expect(puzzle.credit.license.id).toBe('CC0');
    expect(puzzle.yearEvidence.confidence).toBe('high'); // kept the fetcher-derived evidence, not flattened to "operator"
  });

  it('throws on the uploader\'s "personality" restriction, never approves or writes the review file', async () => {
    const restrictedPage = commonsPage({}, { Restrictions: { value: 'Personality' } });
    await seedJsonResponse(cacheDir, commonsFileQueryUrl('File:Test Suzuki GSXR750.jpg'), { query: { pages: [restrictedPage] } });
    await seedJsonResponse(cacheDir, wbgetentitiesUrl('M555001'), { entities: {} });

    await expect(runAdd(baseOpts({ commons: 'File:Test Suzuki GSXR750.jpg', year: 2004, dryRun: true }))).rejects.toThrow(
      /personality" restriction/,
    );
    await expect(fs.access(reviewPath)).rejects.toThrow(); // no silent approve — nothing written
  });
});
