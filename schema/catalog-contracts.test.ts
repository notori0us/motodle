/**
 * §7.2 items 2, 3, 10, 11, 12 — catalog shape, cross-file id resolution, normalizeId no-drift,
 * and the RULE A / RULE B data invariants.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate, type JSONSchema } from './validate';
import { COUNTRY_NAMES } from './constants';

const ROOT = path.join(__dirname, '..');
const PUZZLES_DIR = path.join(ROOT, 'public/puzzles');

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, 'utf8'));
}

const catalogSchema: JSONSchema = readJson(path.join(__dirname, 'catalog.schema.json'));
const catalog = readJson(path.join(ROOT, 'public/catalog.json'));
const makesById = new Map<string, any>(catalog.makes.map((m: any) => [m.id, m]));
const modelsById = new Map<string, any>(catalog.models.map((m: any) => [m.id, m]));

const puzzleFiles = readdirSync(PUZZLES_DIR)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort();
const puzzles = puzzleFiles.map((f) => readJson(path.join(PUZZLES_DIR, f)));

describe('§7.2 #2 — catalog.schema.json + makeId FK resolution', () => {
  it('public/catalog.json validates against catalog.schema.json', () => {
    expect(validate(catalogSchema, catalog)).toEqual([]);
  });

  it('every models[].makeId resolves to a makes[].id', () => {
    for (const model of catalog.models) {
      expect(makesById.has(model.makeId), `model "${model.id}" has unknown makeId "${model.makeId}"`).toBe(true);
    }
  });

  it('make ids and model ids are each unique', () => {
    expect(makesById.size).toBe(catalog.makes.length);
    expect(modelsById.size).toBe(catalog.models.length);
  });
});

describe('§7.2 #3 — every answer.modelId / acceptModelIds[] resolves in the catalog', () => {
  for (const puzzle of puzzles) {
    it(`${puzzle.id}: answer.modelId, answer.makeId, and every acceptModelIds entry resolve`, () => {
      expect(makesById.has(puzzle.answer.makeId)).toBe(true);
      const answerModel = modelsById.get(puzzle.answer.modelId);
      expect(answerModel, `answer.modelId "${puzzle.answer.modelId}" missing from catalog`).toBeDefined();
      expect(answerModel.makeId).toBe(puzzle.answer.makeId);
      expect(puzzle.answer.acceptModelIds).toContain(puzzle.answer.modelId);
      for (const id of puzzle.answer.acceptModelIds) {
        const m = modelsById.get(id);
        expect(m, `acceptModelIds entry "${id}" missing from catalog`).toBeDefined();
        expect(m.makeId).toBe(puzzle.answer.makeId);
      }
    });
  }
});

describe('§7.2 #10 — tools/lib/normalize.ts and src/lib/match.ts must not drift', () => {
  // Both files belong to other workstreams (W2, W3) and do not exist while W1 runs alone —
  // this activates once they land. It is intentionally excluded from nothing: once both files
  // exist, this test enforces the real invariant instead of skipping.
  const normalizePath = path.join(ROOT, 'tools/lib/normalize.ts');
  const matchPath = path.join(ROOT, 'src/lib/match.ts');
  const bothExist = existsSync(normalizePath) && existsSync(matchPath);

  const FROZEN_VECTORS: [string, string][] = [
    ['GSX-R 750', 'gsxr750'],
    ['GSX-R750', 'gsxr750'],
    ['gsxr750', 'gsxr750'],
    ['Suzuki GSX-R750', 'suzuki-gsxr750'],
    ['Honda CB750', 'honda-cb750'],
    ['Honda FT 500', 'honda-ft500'],
    ['Harley-Davidson', 'harley-davidson'],
    ['Harley Davidson', 'harley-davidson'],
    ['Ninja ZX-6R', 'ninja-zx6r'],
    ['Kawasaki Ninja ZX-6R', 'kawasaki-ninja-zx6r'],
    ['Ducati 916', 'ducati-916'],
    ['ČZ', 'cz'],
  ];

  it.skipIf(!bothExist)(
    'tools/lib/normalize.ts#normalizeId and src/lib/match.ts#normalizeId agree on every frozen vector and every catalog name',
    async () => {
      const normalizeMod: any = await import(pathToFileURL(normalizePath).href);
      const matchMod: any = await import(pathToFileURL(matchPath).href);
      const a = normalizeMod.normalizeId;
      const b = matchMod.normalizeId;
      expect(typeof a).toBe('function');
      expect(typeof b).toBe('function');
      for (const [input] of FROZEN_VECTORS) {
        expect(b(input)).toBe(a(input));
      }
      for (const make of catalog.makes) expect(b(make.name)).toBe(a(make.name));
      for (const model of catalog.models) {
        const make = makesById.get(model.makeId);
        const full = `${make.name} ${model.name}`;
        expect(b(full)).toBe(a(full));
      }
    },
  );

  if (!bothExist) {
    it('(informational) not yet activated — tools/lib/normalize.ts and/or src/lib/match.ts do not exist yet (W2/W3)', () => {
      expect(bothExist).toBe(false);
    });
  }
});

// normalizeId(), reproduced verbatim from PLAN.md §3.2 (the frozen literal function body).
// `tools/lib/normalize.ts` (W2) and `src/lib/match.ts` (W3) must contain this same code — that
// cross-file agreement is item #10 above (gated on those files existing). THIS block instead
// checks the catalog W1 actually generated: every id in public/catalog.json must equal what this
// frozen algorithm produces, and the §3.2 vector table itself must hold — independent of whether
// W2/W3 have landed.
const RUN = /[a-z]+|[0-9]+/g;
const isShortRun = (r: string): boolean => /^[0-9]/.test(r) || r.length <= 3;
function normalizeId(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base === '') return '';
  const segments = base.split('-');
  const firstRun = (seg: string) => (seg.match(RUN) ?? [seg])[0];
  const lastRun = (seg: string) => (seg.match(RUN) ?? [seg]).at(-1)!;
  let out = segments[0];
  for (let i = 1; i < segments.length; i++) {
    const join = isShortRun(lastRun(segments[i - 1])) && isShortRun(firstRun(segments[i]));
    out += (join ? '' : '-') + segments[i];
  }
  return out;
}

describe('§3.2 frozen normalizeId() vector table', () => {
  const VECTORS: [string, string][] = [
    ['GSX-R 750', 'gsxr750'],
    ['GSX-R750', 'gsxr750'],
    ['gsxr750', 'gsxr750'],
    ['Suzuki GSX-R750', 'suzuki-gsxr750'],
    ['Honda CB750', 'honda-cb750'],
    ['Honda FT 500', 'honda-ft500'],
    ['Harley-Davidson', 'harley-davidson'],
    ['Harley Davidson', 'harley-davidson'],
    ['Ninja ZX-6R', 'ninja-zx6r'],
    ['Kawasaki Ninja ZX-6R', 'kawasaki-ninja-zx6r'],
    ['Ducati 916', 'ducati-916'],
    ['ČZ', 'cz'],
  ];
  for (const [input, expected] of VECTORS) {
    it(`normalizeId(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
      expect(normalizeId(input)).toBe(expected);
    });
  }

  it('every make id in public/catalog.json matches normalizeId(name)', () => {
    for (const make of catalog.makes) expect(make.id).toBe(normalizeId(make.name));
  });

  it('every model id in public/catalog.json matches normalizeId(make.name + " " + model.name)', () => {
    for (const model of catalog.models) {
      const make = makesById.get(model.makeId);
      expect(model.id).toBe(normalizeId(`${make.name} ${model.name}`));
    }
  });
});

describe('§7.2 #11 — every makes[].country is valid and resolves in COUNTRY_NAMES', () => {
  for (const make of catalog.makes) {
    it(`${make.id}: country "${make.country}"`, () => {
      expect(make.country).toMatch(/^[A-Z]{2}$/);
      expect(make.country).not.toBe('??');
      expect(COUNTRY_NAMES[make.country], `country "${make.country}" missing from COUNTRY_NAMES`).toBeDefined();
    });
  }
});

describe('§7.2 #12 — every non-null models[].years satisfies 1885 <= from <= to <= currentYear+1', () => {
  const currentYearPlus1 = new Date().getFullYear() + 1;
  for (const model of catalog.models) {
    it(`${model.id}: years = ${JSON.stringify(model.years)}`, () => {
      if (model.years === null) return; // null is always legal
      const [from, to] = model.years;
      expect(from).toBeGreaterThanOrEqual(1885);
      const effectiveTo = to === null ? currentYearPlus1 : to;
      expect(from).toBeLessThanOrEqual(effectiveTo);
      expect(effectiveTo).toBeLessThanOrEqual(currentYearPlus1);
    });
  }
});

describe('seed catalog authoring standard (§6.10) — sanity bounds, not exhaustive fact-checking', () => {
  it('has 40-60 makes', () => {
    expect(catalog.makes.length).toBeGreaterThanOrEqual(40);
    expect(catalog.makes.length).toBeLessThanOrEqual(60);
  });

  it('has 300-500 models', () => {
    expect(catalog.models.length).toBeGreaterThanOrEqual(300);
    expect(catalog.models.length).toBeLessThanOrEqual(500);
  });

  it('does not carry a KTM 990 Adventure entry (operator decision C9, §6.10)', () => {
    const ktm = makesById.get('ktm');
    expect(ktm).toBeDefined();
    const hasIt = catalog.models.some(
      (m: any) => m.makeId === 'ktm' && /990\s*adventure/i.test(m.name),
    );
    expect(hasIt).toBe(false);
  });

  it('carries both the "Ducati Monster" family and its depth-2 "Ducati Monster 900" variant (D4)', () => {
    expect(modelsById.has('ducati-monster')).toBe(true);
    expect(modelsById.has('ducati-monster-900')).toBe(true);
  });
});
