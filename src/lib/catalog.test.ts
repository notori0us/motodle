import { describe, expect, it } from 'vitest';
import type { Catalog } from '../../schema/types';
import { buildCatalogIndex, getMake, getModel, loadCatalog, modelsForMake } from './catalog';

const CATALOG: Catalog = {
  schema: 1,
  generatedAt: '2026-09-02',
  source: 'seed',
  makes: [
    { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
    { id: 'honda', name: 'Honda', country: 'JP', aliases: [] },
    { id: 'ducati', name: 'Ducati', country: 'IT', aliases: [] },
  ],
  models: [
    { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] },
    { id: 'suzuki-hayabusa', makeId: 'suzuki', name: 'Hayabusa', aliases: [], years: [1999, null] },
    { id: 'honda-cb750', makeId: 'honda', name: 'CB750', aliases: [], years: [1969, 2003] },
    { id: 'ducati-916', makeId: 'ducati', name: '916', aliases: [], years: [1994, 2004] },
  ],
};

describe('buildCatalogIndex', () => {
  const index = buildCatalogIndex(CATALOG);

  it('builds Map indexes keyed by id', () => {
    expect(index.makes.size).toBe(3);
    expect(index.models.size).toBe(4);
  });

  it('makes.get(id).country and models.get(id).years are reachable — evaluateGuess depends on both (RULES A and B)', () => {
    expect(index.makes.get('suzuki')?.country).toBe('JP');
    expect(index.models.get('honda-cb750')?.years).toEqual([1969, 2003]);
  });
});

describe('getMake / getModel', () => {
  const index = buildCatalogIndex(CATALOG);

  it('returns the entry for a known id', () => {
    expect(getMake(index, 'ducati').country).toBe('IT');
    expect(getModel(index, 'ducati-916').years).toEqual([1994, 2004]);
  });

  it('rejects an unknown id', () => {
    expect(() => getMake(index, 'nonexistent')).toThrow();
    expect(() => getModel(index, 'nonexistent')).toThrow();
  });
});

describe('modelsForMake — locked-make filtering', () => {
  const index = buildCatalogIndex(CATALOG);

  it('returns only that make\'s models', () => {
    const suzukiModels = modelsForMake(index, 'suzuki').map((m) => m.id).sort();
    expect(suzukiModels).toEqual(['suzuki-gsxr750', 'suzuki-hayabusa']);
  });

  it('returns [] for a make with no models in the index', () => {
    expect(modelsForMake(index, 'nonexistent-make')).toEqual([]);
  });
});

describe('loadCatalog', () => {
  it('resolves ok on a 200 with schema: 1', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, json: async () => CATALOG });
    const result = await loadCatalog(fetchImpl);
    expect(result).toEqual({ status: 'ok', catalog: CATALOG });
  });

  it('load-failed on a non-2xx response', async () => {
    const fetchImpl = async () => ({ status: 500, ok: false, json: async () => ({}) });
    const result = await loadCatalog(fetchImpl);
    expect(result.status).toBe('load-failed');
  });

  it('load-failed on a schema mismatch', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, json: async () => ({ schema: 2 }) });
    const result = await loadCatalog(fetchImpl);
    expect(result.status).toBe('load-failed');
  });

  it('load-failed (not a throw) on a network error', async () => {
    const fetchImpl = async () => {
      throw new Error('network down');
    };
    const result = await loadCatalog(fetchImpl);
    expect(result.status).toBe('load-failed');
  });
});
