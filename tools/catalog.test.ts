import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../schema/types';
import {
  buildCatalog,
  deriveBrandName,
  deriveModelName,
  discoverMakesAndModels,
  mergeCatalog,
  renderCatalogReview,
  type DiscoveredMake,
  type DiscoveredModel,
} from './catalog';
import { WikimediaClient } from './lib/wikimedia';

const SCRATCH_ROOT = os.tmpdir();

// -----------------------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------------------

describe('deriveBrandName', () => {
  it('strips "Category:" and a trailing "motorcycles"/"motorbikes"', () => {
    expect(deriveBrandName('Category:Suzuki motorcycles')).toBe('Suzuki');
    expect(deriveBrandName('Category:Triumph motorbikes')).toBe('Triumph');
  });
  it('leaves an already-bare brand name alone', () => {
    expect(deriveBrandName('Category:Ducati')).toBe('Ducati');
  });
});

describe('deriveModelName', () => {
  it('strips a leading repeat of the make name', () => {
    expect(deriveModelName('Category:Suzuki GSX-R750', 'Suzuki')).toBe('GSX-R750');
  });
  it('is case-insensitive on the make-name prefix', () => {
    expect(deriveModelName('Category:suzuki GSX-R750', 'Suzuki')).toBe('GSX-R750');
  });
  it('returns the bare name unchanged when the make is not repeated', () => {
    expect(deriveModelName('Category:GSX-R750', 'Suzuki')).toBe('GSX-R750');
  });
  it('returns null when nothing is left after stripping (make-only category)', () => {
    expect(deriveModelName('Category:Suzuki', 'Suzuki')).toBeNull();
  });
});

// -----------------------------------------------------------------------------------------
// mergeCatalog — §3.2: hand-authored country/years ALWAYS win; new makes get "??" and are
// reported, never silently dropped.
// -----------------------------------------------------------------------------------------

const EXISTING: Catalog = {
  schema: 1,
  generatedAt: '2026-09-02',
  source: 'seed',
  makes: [{ id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: ['suz'] }],
  models: [{ id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] }],
};

describe('mergeCatalog', () => {
  it('an already-known make/model is left completely untouched (country/years preserved)', () => {
    const discoveredMakes: DiscoveredMake[] = [{ id: 'suzuki', name: 'Suzuki', aliases: [] }];
    const discoveredModels: DiscoveredModel[] = [
      { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [] },
    ];
    const { catalog, newMakesNeedingCountry } = mergeCatalog(EXISTING, discoveredMakes, discoveredModels, '2026-09-10');
    expect(catalog.makes).toEqual(EXISTING.makes); // country "JP" and aliases untouched
    expect(catalog.models).toEqual(EXISTING.models); // years [1985, null] untouched
    expect(newMakesNeedingCountry).toEqual([]);
  });

  it('a newly discovered make is added with country "??" and reported', () => {
    const discoveredMakes: DiscoveredMake[] = [{ id: 'ducati', name: 'Ducati', aliases: [] }];
    const { catalog, newMakesNeedingCountry } = mergeCatalog(EXISTING, discoveredMakes, [], '2026-09-10');
    const ducati = catalog.makes.find((m) => m.id === 'ducati');
    expect(ducati).toEqual({ id: 'ducati', name: 'Ducati', country: '??', aliases: [] });
    expect(newMakesNeedingCountry).toEqual(['ducati']);
    // The existing entry is unaffected and still present.
    expect(catalog.makes.find((m) => m.id === 'suzuki')).toEqual(EXISTING.makes[0]);
  });

  it('a newly discovered model is added with years: null (never a guessed range)', () => {
    const discoveredModels: DiscoveredModel[] = [
      { id: 'suzuki-hayabusa', makeId: 'suzuki', name: 'Hayabusa', aliases: [] },
    ];
    const { catalog } = mergeCatalog(EXISTING, [], discoveredModels, '2026-09-10');
    const hayabusa = catalog.models.find((m) => m.id === 'suzuki-hayabusa');
    expect(hayabusa).toEqual({ id: 'suzuki-hayabusa', makeId: 'suzuki', name: 'Hayabusa', aliases: [], years: null });
  });

  it('never duplicates an id that already exists, even if discovery finds it again', () => {
    const discoveredMakes: DiscoveredMake[] = [{ id: 'suzuki', name: 'Suzuki (different casing)', aliases: ['x'] }];
    const { catalog } = mergeCatalog(EXISTING, discoveredMakes, [], '2026-09-10');
    expect(catalog.makes.filter((m) => m.id === 'suzuki')).toHaveLength(1);
  });

  it('sets generatedAt to the value passed in', () => {
    const { catalog } = mergeCatalog(EXISTING, [], [], '2026-09-10');
    expect(catalog.generatedAt).toBe('2026-09-10');
  });

  it('an empty starting catalog merges cleanly (first-ever run)', () => {
    const empty: Catalog = { schema: 1, generatedAt: '', source: 'wikimedia-commons', makes: [], models: [] };
    const { catalog, newMakesNeedingCountry } = mergeCatalog(
      empty,
      [{ id: 'honda', name: 'Honda', aliases: [] }],
      [{ id: 'honda-cb750', makeId: 'honda', name: 'CB750', aliases: [] }],
      '2026-09-10',
    );
    expect(catalog.makes).toHaveLength(1);
    expect(catalog.models).toHaveLength(1);
    expect(newMakesNeedingCountry).toEqual(['honda']);
  });
});

// -----------------------------------------------------------------------------------------
// renderCatalogReview — offline markdown table (§6.10)
// -----------------------------------------------------------------------------------------

describe('renderCatalogReview', () => {
  const catalog: Catalog = {
    schema: 1,
    generatedAt: '2026-09-02',
    source: 'seed',
    makes: [
      { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
      { id: 'ducati', name: 'Ducati', country: 'IT', aliases: [] },
    ],
    models: [
      { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] },
      { id: 'ducati-916', makeId: 'ducati', name: '916', aliases: [], years: [1994, 1998] },
    ],
  };

  it('renders a markdown table with make/country/model/years/source columns', () => {
    const md = renderCatalogReview(catalog);
    expect(md).toContain('| Make | Country | Model | Years | Source |');
    expect(md).toContain('| Ducati | IT | 916 | 1994–1998 | seed |');
    expect(md).toContain('| Suzuki | JP | GSX-R750 | 1985–present | seed |');
  });

  it('is sorted by make name (Ducati before Suzuki)', () => {
    const md = renderCatalogReview(catalog);
    expect(md.indexOf('Ducati')).toBeLessThan(md.indexOf('Suzuki'));
  });

  it('a make with no models still gets a row', () => {
    const withEmpty: Catalog = {
      ...catalog,
      makes: [...catalog.makes, { id: 'triumph', name: 'Triumph', country: 'GB', aliases: [] }],
    };
    const md = renderCatalogReview(withEmpty);
    expect(md).toContain('_(no models)_');
  });

  it('ends with exactly one trailing newline', () => {
    const md = renderCatalogReview(catalog);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------
// discoverMakesAndModels / buildCatalog — offline behaviour
// -----------------------------------------------------------------------------------------

let workDir: string;
let cacheDir: string;
let catalogPath: string;
let reviewPath: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(SCRATCH_ROOT, 'catalog-'));
  cacheDir = path.join(workDir, 'cache');
  catalogPath = path.join(workDir, 'catalog.json');
  reviewPath = path.join(workDir, 'CATALOG-REVIEW.md');
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('discoverMakesAndModels — dry-run on an empty cache makes no network call', () => {
  it('returns empty results without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new WikimediaClient({ cacheDir, dryRun: true });
    const result = await discoverMakesAndModels(client, 40, 2);
    expect(result.makes).toEqual([]);
    expect(result.models).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('buildCatalog — --dry-run', () => {
  it('exits cleanly, writes nothing, makes no network call on an empty cache', async () => {
    await fs.writeFile(catalogPath, JSON.stringify(EXISTING, null, 2));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await buildCatalog({ outPath: catalogPath, cacheDir, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const stillOriginal = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    expect(stillOriginal).toEqual(EXISTING); // dry-run never writes
    fetchSpy.mockRestore();
  });
});

describe('buildCatalog — --review-only', () => {
  it('reads the existing catalog and renders docs/CATALOG-REVIEW.md, touching no network', async () => {
    await fs.writeFile(catalogPath, JSON.stringify(EXISTING, null, 2));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await buildCatalog({ outPath: catalogPath, reviewOnly: true, reviewOutPath: reviewPath });

    expect(result.reviewOnly).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const content = await fs.readFile(reviewPath, 'utf8');
    expect(content).toContain('Suzuki');
    expect(content).toContain('GSX-R750');
    fetchSpy.mockRestore();
  });

  it('regenerates wholesale — a second run with a changed catalog fully replaces the file', async () => {
    await fs.writeFile(catalogPath, JSON.stringify(EXISTING, null, 2));
    await buildCatalog({ outPath: catalogPath, reviewOnly: true, reviewOutPath: reviewPath });
    const first = await fs.readFile(reviewPath, 'utf8');
    expect(first).not.toContain('Ducati');

    const withDucati: Catalog = {
      ...EXISTING,
      makes: [...EXISTING.makes, { id: 'ducati', name: 'Ducati', country: 'IT', aliases: [] }],
    };
    await fs.writeFile(catalogPath, JSON.stringify(withDucati, null, 2));
    await buildCatalog({ outPath: catalogPath, reviewOnly: true, reviewOutPath: reviewPath });
    const second = await fs.readFile(reviewPath, 'utf8');
    expect(second).toContain('Ducati');
  });
});

// -----------------------------------------------------------------------------------------
// The committed docs/CATALOG-REVIEW.md is a render of public/catalog.json (§6.10: regenerated
// wholesale, never hand-edited). A catalog edit without `npm run catalog -- --review-only` would
// otherwise leave the operator's review sheet silently stale.
// -----------------------------------------------------------------------------------------

describe('docs/CATALOG-REVIEW.md is in sync with public/catalog.json', () => {
  it('equals renderCatalogReview(public/catalog.json) byte for byte', async () => {
    const root = path.join(__dirname, '..');
    const catalog: Catalog = JSON.parse(await fs.readFile(path.join(root, 'public/catalog.json'), 'utf8'));
    const committed = await fs.readFile(path.join(root, 'docs/CATALOG-REVIEW.md'), 'utf8');
    expect(committed).toBe(renderCatalogReview(catalog));
  });
});
