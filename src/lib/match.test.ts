import { describe, expect, it } from 'vitest';
import type { CatalogIndex, CatalogMake, CatalogModel } from '../../schema/types';
import { buildMatchIndex, matchCatalog, normalizeId, rankMatches } from './match';

function buildIndex(makes: CatalogMake[], models: CatalogModel[]): CatalogIndex {
  return { makes: new Map(makes.map((m) => [m.id, m])), models: new Map(models.map((m) => [m.id, m])) };
}

const MAKES: CatalogMake[] = [
  { id: 'triumph', name: 'Triumph', country: 'GB', aliases: [] },
  { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
  { id: 'honda', name: 'Honda', country: 'JP', aliases: [] },
  { id: 'ducati', name: 'Ducati', country: 'IT', aliases: [] },
  { id: 'harley-davidson', name: 'Harley-Davidson', country: 'US', aliases: [] },
  { id: 'cz', name: 'ČZ', country: 'CZ', aliases: [] },
  { id: 'testmoto', name: 'TestMoto', country: 'DE', aliases: [] },
  { id: 'zzz', name: 'Zzz', country: 'US', aliases: [] },
];

const MODELS: CatalogModel[] = [
  { id: 'triumph-bonneville-t120', makeId: 'triumph', name: 'Bonneville T120', aliases: [], years: [1959, 1974] },
  { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] },
  { id: 'honda-cb750', makeId: 'honda', name: 'CB750', aliases: [], years: [1969, 2003] },
  { id: 'honda-cb750-four', makeId: 'honda', name: 'CB750 Four', aliases: [], years: [1969, 2003] },
  { id: 'ducati-916', makeId: 'ducati', name: '916', aliases: [], years: [1994, 1998] },
  { id: 'harley-davidson-sportster', makeId: 'harley-davidson', name: 'Sportster', aliases: [], years: null },
  { id: 'cz-175', makeId: 'cz', name: '175', aliases: [], years: [1955, 1970] },
  { id: 'testmoto-motorrader', makeId: 'testmoto', name: 'Motorräder Classic', aliases: [], years: [1960, 1970] },
  { id: 'zzz-xtriumphx', makeId: 'zzz', name: 'Xtriumphx', aliases: [], years: [1960, 1970] },
];

const index = buildIndex(MAKES, MODELS);
const entries = buildMatchIndex(index);

function modelIds(results: { modelId: string }[]): string[] {
  return results.map((r) => r.modelId);
}

// ---------------------------------------------------------------------------------------------
// §3.2 frozen normalizeId() vector table.
// ---------------------------------------------------------------------------------------------

describe('normalizeId — the §3.2 frozen vector table', () => {
  it.each([
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
  ])('normalizeId(%s) === %s', (input, expected) => {
    expect(normalizeId(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// Tier examples straight from §5.3's table.
// ---------------------------------------------------------------------------------------------

describe('matchCatalog — §5.3 tier examples', () => {
  it('"trium bonn" -> Triumph Bonneville T120 (tier 1, order-independent token match)', () => {
    const results = matchCatalog('trium bonn', entries);
    expect(modelIds(results)).toContain('triumph-bonneville-t120');
    const hit = results.find((r) => r.modelId === 'triumph-bonneville-t120')!;
    expect(hit.tier).toBe(1);
  });

  it('"gs" -> Suzuki GSX-R750 (tier 3, word-prefix)', () => {
    const results = matchCatalog('gs', entries);
    const hit = results.find((r) => r.modelId === 'suzuki-gsxr750');
    expect(hit).toBeDefined();
    expect(hit!.tier).toBe(3);
  });

  it('empty query returns []', () => {
    expect(matchCatalog('', entries)).toEqual([]);
    expect(matchCatalog('   ', entries)).toEqual([]);
  });

  it('"harley davidson" (space) and "harley-davidson" (hyphen) both match Harley-Davidson Sportster', () => {
    const spaced = matchCatalog('harley davidson', entries);
    const hyphenated = matchCatalog('harley-davidson', entries);
    expect(modelIds(spaced)).toContain('harley-davidson-sportster');
    expect(modelIds(hyphenated)).toContain('harley-davidson-sportster');
  });
});

describe('matchCatalog — ranking: exact beats prefix beats substring', () => {
  it('exact beats prefix', () => {
    const results = matchCatalog('honda cb750', entries);
    const exactIdx = results.findIndex((r) => r.modelId === 'honda-cb750');
    const prefixIdx = results.findIndex((r) => r.modelId === 'honda-cb750-four');
    expect(exactIdx).toBeGreaterThanOrEqual(0);
    expect(prefixIdx).toBeGreaterThanOrEqual(0);
    expect(results[exactIdx].tier).toBe(5);
    expect(exactIdx).toBeLessThan(prefixIdx);
  });

  it('prefix beats substring', () => {
    // "Triumph Bonneville T120" starts with "triumph" (tier 4); "Zzz Xtriumphx" merely CONTAINS
    // "triumph" mid-word, not at a word boundary, so it lands at tier 2.
    const results = matchCatalog('triumph', entries);
    const prefixHit = results.find((r) => r.modelId === 'triumph-bonneville-t120')!;
    const substringHit = results.find((r) => r.modelId === 'zzz-xtriumphx')!;
    expect(prefixHit.tier).toBe(4);
    expect(substringHit.tier).toBe(2);
    expect(results.indexOf(prefixHit)).toBeLessThan(results.indexOf(substringHit));
  });
});

describe('matchCatalog — <=10 results', () => {
  it('never returns more than 10 options, even when many entries match', () => {
    const manyMakes: CatalogMake[] = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, name: `Test${i}`, country: 'US', aliases: [] }));
    const manyModels: CatalogModel[] = [];
    for (let i = 0; i < 15; i++) {
      manyModels.push({ id: `m0-model${i}`, makeId: 'm0', name: `Model ${i}`, aliases: [], years: null });
    }
    const bigIndex = buildIndex(manyMakes, manyModels);
    const bigEntries = buildMatchIndex(bigIndex);
    const results = matchCatalog('test0 model', bigEntries);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results.length).toBe(10);
  });
});

describe('matchCatalog — diacritics (ČZ, Motorräder)', () => {
  it('typing "cz" (no caron) matches the make "ČZ"', () => {
    const results = matchCatalog('cz', entries);
    expect(modelIds(results)).toContain('cz-175');
  });

  it('typing the accented "č" also matches', () => {
    const results = matchCatalog('č', entries);
    expect(modelIds(results)).toContain('cz-175');
  });

  it('typing "motorrader" (no umlaut) matches a label containing "Motorräder"', () => {
    const results = matchCatalog('motorrader', entries);
    expect(modelIds(results)).toContain('testmoto-motorrader');
  });
});

describe('matchCatalog — incremental narrowing agrees with a fresh scan', () => {
  it('filtering a FULL (untruncated) prior result set down to a longer query matches a fresh scan of the whole catalog', () => {
    const shortQuery = 'tri';
    const longQuery = 'trium';

    const fullShort = rankMatches(shortQuery, entries); // untruncated
    const narrowedEntries = entries.filter((e) => fullShort.some((r) => r.modelId === e.modelId));
    const narrowed = matchCatalog(longQuery, narrowedEntries);
    const fresh = matchCatalog(longQuery, entries);

    expect(narrowed).toEqual(fresh);
  });

  it('every match for the longer query also matched the shorter prefix (monotonic containment)', () => {
    const shortQuery = 'ho';
    const longQuery = 'honda cb750';
    const shortIds = new Set(modelIds(rankMatches(shortQuery, entries)));
    const longResults = rankMatches(longQuery, entries);
    for (const r of longResults) {
      expect(shortIds.has(r.modelId)).toBe(true);
    }
  });
});

describe('matchCatalog — locked-make filtering (§5.3)', () => {
  it('with the make locked to suzuki, "suz gsx" still matches GSX-R750 (make tokens stay searchable)', () => {
    const results = matchCatalog('suz gsx', entries, { lockedMakeId: 'suzuki' });
    expect(modelIds(results)).toContain('suzuki-gsxr750');
  });

  it('with the make locked to suzuki, "honda" returns [] (no Honda entries in the locked slice)', () => {
    const results = matchCatalog('honda', entries, { lockedMakeId: 'suzuki' });
    expect(results).toEqual([]);
  });

  it('a locked entry keeps its FULL label ("{make} {model}") — truncation for display is a UI concern, not match.ts\'s', () => {
    const results = matchCatalog('gsx', entries, { lockedMakeId: 'suzuki' });
    const hit = results.find((r) => r.modelId === 'suzuki-gsxr750')!;
    expect(hit.label).toBe('Suzuki GSX-R750');
  });
});
