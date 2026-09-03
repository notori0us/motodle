/**
 * §7.2 items 1, 4, 5, 6, 7, 8, 9 — puzzle files, manifest, and payload budgets.
 *
 * `puzzleNumber()` (§4.1) is reproduced here VERBATIM from the frozen algorithm in PLAN.md, not
 * imported from `src/lib/date.ts` — that file belongs to W3 and does not exist while W1 runs
 * alone. This is a one-way check against a fully-specified, frozen formula (not a "do two
 * implementations agree" test — that's item #10's job, and it targets normalize/match, not
 * date arithmetic), so inlining it here carries no drift risk.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate, type JSONSchema } from './validate';
import { DAY_BUDGET_BYTES, CATALOG_GZ_BUDGET_BYTES, DEFAULT_CROP_FRACTIONS } from './constants';

const ROOT = path.join(__dirname, '..');
const PUZZLES_DIR = path.join(ROOT, 'public/puzzles');

// ---- §4.1, reproduced verbatim -----------------------------------------------------------
const LAUNCH_DATE = '2026-09-02';
const PUZZLE_NUMBER_OFFSET = 1;
function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
function puzzleNumber(key: string): number {
  return dayIndex(key) - dayIndex(LAUNCH_DATE) + PUZZLE_NUMBER_OFFSET;
}

function puzzleDateFiles(): string[] {
  return readdirSync(PUZZLES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, 'utf8'));
}

const puzzleSchema: JSONSchema = readJson(path.join(__dirname, 'puzzle.schema.json'));
const manifestSchema: JSONSchema = readJson(path.join(__dirname, 'manifest.schema.json'));
const catalog = readJson(path.join(ROOT, 'public/catalog.json'));
const manifest = readJson(path.join(PUZZLES_DIR, 'manifest.json'));
const puzzleFiles = puzzleDateFiles();
const puzzles = puzzleFiles.map((f) => ({ file: f, data: readJson(path.join(PUZZLES_DIR, f)) }));

it('sanity: at least the 3 fixture puzzles are present', () => {
  expect(puzzleFiles.length).toBeGreaterThanOrEqual(3);
});

describe('§7.2 #1 — every puzzle file validates against puzzle.schema.json', () => {
  for (const { file, data } of puzzles) {
    it(file, () => {
      expect(validate(puzzleSchema, data)).toEqual([]);
    });
  }
});

describe('§7.2 #4 — number/date/id arithmetic', () => {
  for (const { file, data } of puzzles) {
    const dateStem = file.replace(/\.json$/, '');
    it(`${file}: number === puzzleNumber(date), date === filename, id === mtd-NNNN`, () => {
      expect(data.date).toBe(dateStem);
      expect(data.number).toBe(puzzleNumber(data.date));
      expect(data.id).toBe(`mtd-${String(data.number).padStart(4, '0')}`);
    });
  }

  it('every fixtures.json entry agrees with the same arithmetic (fixture-authored id === generated id)', () => {
    const fixturesFile = readJson(path.join(ROOT, 'fixtures/fixtures.json'));
    for (const fx of fixturesFile.fixtures) {
      const number = puzzleNumber(fx.date);
      expect(fx.id).toBe(`mtd-${String(number).padStart(4, '0')}`);
    }
  });
});

// improvement 8 (Opus review): §3.1 states `1885 <= answer.year <= currentYear + 1` for every
// puzzle. schema/puzzle.schema.json can only cap it at a fixed literal (`maximum: 2200`) since a
// JSON Schema cannot know "currentYear" — this is the tight bound §7.2 #12 already enforces for
// catalog `models[].years`, mirrored here for puzzle `answer.year`.
describe('§3.1 — answer.year stays within 1885..currentYear+1 (tight bound; the JSON Schema only caps at 2200)', () => {
  const currentYearPlus1 = new Date().getFullYear() + 1;
  for (const { file, data } of puzzles) {
    it(`${file}: 1885 <= answer.year (${data.answer.year}) <= ${currentYearPlus1}`, () => {
      expect(data.answer.year).toBeGreaterThanOrEqual(1885);
      expect(data.answer.year).toBeLessThanOrEqual(currentYearPlus1);
    });
  }
});

// improvement 6 (Opus review): tools/lib/date.ts (W2) is a second, deliberately-duplicated
// implementation of §4.1's puzzleNumber()/dayIndex() arithmetic — see that file's own comment
// for why it can't just import src/lib/date.ts (W3 may not exist while W2 runs). §7.2 #10 exists
// for the analogous normalizeId duplication but targets normalize/match, not date arithmetic;
// this is that same "two implementations must not drift" guarantee for the date functions.
describe('no-drift — tools/lib/date.ts and src/lib/date.ts must agree on puzzleNumber()/dayIndex()', () => {
  const toolsDatePath = path.join(ROOT, 'tools/lib/date.ts');
  const srcDatePath = path.join(ROOT, 'src/lib/date.ts');

  it(
    'agree across a multi-year sweep of consecutive date keys, including leap days and year boundaries',
    async () => {
      const toolsMod: any = await import(pathToFileURL(toolsDatePath).href);
      const srcMod: any = await import(pathToFileURL(srcDatePath).href);
      expect(typeof toolsMod.puzzleNumber).toBe('function');
      expect(typeof srcMod.puzzleNumber).toBe('function');
      expect(typeof toolsMod.dayIndex).toBe('function');
      expect(typeof srcMod.dayIndex).toBe('function');

      // 2024-01-01 .. ~2029-05-14: >1900 consecutive days, crossing every US/EU DST transition
      // in that span (Northern-hemisphere spring-forward/fall-back included by construction).
      let ms = Date.UTC(2024, 0, 1);
      for (let i = 0; i < 1950; i++) {
        const d = new Date(ms);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        expect(toolsMod.dayIndex(key)).toBe(srcMod.dayIndex(key));
        expect(toolsMod.puzzleNumber(key)).toBe(srcMod.puzzleNumber(key));
        ms += 86_400_000;
      }
    },
  );
});

describe('§7.2 #5 — manifest.json', () => {
  it('validates against manifest.schema.json', () => {
    expect(validate(manifestSchema, manifest)).toEqual([]);
  });

  it('launchDate equals LAUNCH_DATE', () => {
    expect(manifest.launchDate).toBe(LAUNCH_DATE);
  });

  it('lists exactly the puzzle files present, ascending by number', () => {
    const expectedIds = puzzles.map((p) => p.data.id).sort((a, b) => a.localeCompare(b));
    const manifestIds = [...manifest.puzzles].map((p: any) => p.id).sort((a, b) => a.localeCompare(b));
    expect(manifestIds).toEqual(expectedIds);

    const numbers = manifest.puzzles.map((p: any) => p.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('latest matches the highest-numbered puzzle', () => {
    const highest = [...manifest.puzzles].sort((a: any, b: any) => b.number - a.number)[0];
    expect(manifest.latest).toEqual({ date: highest.date, number: highest.number });
  });

  it('contains no answer fields (make/model/year) anywhere in the document', () => {
    const json = JSON.stringify(manifest);
    for (const bad of ['makeId', 'modelId', 'acceptModelIds', '"year"']) {
      expect(json).not.toContain(bad);
    }
  });
});

describe('§7.2 #6 — year evidence is ship-legal', () => {
  for (const { file, data } of puzzles) {
    it(`${file}: confidence !== 'low', approvedBy === 'operator'`, () => {
      expect(data.yearEvidence.confidence).not.toBe('low');
      expect(data.yearEvidence.approvedBy).toBe('operator');
    });
  }
});

const LICENSE_ALLOWLIST = new Set([
  'PD', 'CC0',
  'CC-BY-2.0', 'CC-BY-2.5', 'CC-BY-3.0', 'CC-BY-4.0',
  'CC-BY-SA-2.0', 'CC-BY-SA-2.5', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0',
]);

describe('§7.2 #7 — credit block', () => {
  for (const { file, data } of puzzles) {
    it(`${file}: license on allowlist, author non-empty, credit.modified non-empty`, () => {
      expect(LICENSE_ALLOWLIST.has(data.credit.license.id)).toBe(true);
      expect(data.credit.author.trim().length).toBeGreaterThan(0);
      expect(data.credit.modified.trim().length).toBeGreaterThan(0);
    });
  }
});

describe('§7.2 #8 — crop geometry invariants', () => {
  for (const { file, data } of puzzles) {
    const { cropFractions, levels, full } = data.image;

    it(`${file}: cropFractions strictly increasing, each in (0,1]`, () => {
      expect(cropFractions.length).toBe(5);
      for (const f of cropFractions) {
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThanOrEqual(1);
      }
      for (let i = 1; i < cropFractions.length; i++) {
        expect(cropFractions[i]).toBeGreaterThan(cropFractions[i - 1]);
      }
    });

    it(`${file}: cropFractions is geometric — each ratio within ±3% of r = (f5/f1)^(1/4) (§7.2 #15, §4.7a)`, () => {
      const r = (cropFractions[4] / cropFractions[0]) ** (1 / 4);
      for (let i = 1; i < cropFractions.length; i++) {
        const ratio = cropFractions[i] / cropFractions[i - 1];
        expect(Math.abs(ratio - r) / r).toBeLessThanOrEqual(0.03);
      }
    });

    it(`${file}: levels[].rect.w strictly increasing`, () => {
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i].rect.w).toBeGreaterThan(levels[i - 1].rect.w);
      }
    });

    it(`${file}: levels[].w is non-decreasing`, () => {
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i].w).toBeGreaterThanOrEqual(levels[i - 1].w);
      }
    });

    it(`${file}: levels[].w/h are 4:3 within ±1px`, () => {
      for (const level of levels) {
        const expectedH = Math.round((level.w * 3) / 4);
        expect(Math.abs(level.h - expectedH)).toBeLessThanOrEqual(1);
      }
    });

    it(`${file}: image.full carries no level and no rect, and is exempt from the 4:3 constraint`, () => {
      expect(full.level).toBeUndefined();
      expect(full.rect).toBeUndefined();
      // No aspect assertion here by design (§3.1) — full keeps the source-cropped aspect.
    });
  }
});

describe('§7.2 #9 — payload budgets', () => {
  for (const { file, data } of puzzles) {
    it(`${file}: puzzle JSON + 5 level WebPs <= DAY_BUDGET_BYTES (full.webp excluded)`, () => {
      const jsonBytes = statSync(path.join(PUZZLES_DIR, file)).size;
      const levelBytes = data.image.levels.reduce((sum: number, l: any) => {
        const onDisk = statSync(path.join(PUZZLES_DIR, l.src)).size;
        expect(onDisk).toBe(l.bytes); // recorded bytes must match what's actually on disk
        return sum + onDisk;
      }, 0);
      expect(jsonBytes + levelBytes).toBeLessThanOrEqual(DAY_BUDGET_BYTES);
    });
  }

  it('public/catalog.json gzipped size <= CATALOG_GZ_BUDGET_BYTES', () => {
    const raw = readFileSync(path.join(ROOT, 'public/catalog.json'));
    const gz = gzipSync(raw, { level: 9 });
    expect(gz.length).toBeLessThanOrEqual(CATALOG_GZ_BUDGET_BYTES);
  });

  it('sanity: catalog is non-trivial (models[].makeId all resolve, checked fully in catalog-contracts.test.ts)', () => {
    expect(catalog.models.length).toBeGreaterThan(0);
  });
});

describe('DEFAULT_CROP_FRACTIONS (§4.7a)', () => {
  it('is geometric — each ratio within ±3% of r = (f5/f1)^(1/4) (§7.2 #15)', () => {
    const f = DEFAULT_CROP_FRACTIONS;
    const r = (f[4] / f[0]) ** (1 / 4);
    for (let i = 1; i < f.length; i++) {
      const ratio = f[i] / f[i - 1];
      expect(Math.abs(ratio - r) / r).toBeLessThanOrEqual(0.03);
    }
  });
});
