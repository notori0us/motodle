import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReviewCandidate,
  dateTimeOriginalYear,
  fetchCandidates,
  guessCategory,
  licenseFamilyOf,
  parseLicenseFamilies,
  parseRestrictions,
  stripHtml,
  normalizeQueryPage,
  type RawFilePage,
} from './fetch';
import { validate, type JSONSchema } from '../schema/validate';
import { cacheKeyFor, withMandatoryParams } from './lib/wikimedia';

const SCRATCH_ROOT = os.tmpdir();
const ROOT = path.join(__dirname, '..');

// -----------------------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------------------

describe('stripHtml', () => {
  it('removes tags and decodes common entities', () => {
    expect(stripHtml('<a href="x">O&#39;Brien &lt;Racing&gt;</a>')).toBe("O'Brien <Racing>");
    expect(stripHtml('Foo &amp; Bar')).toBe('Foo & Bar');
  });
  it('collapses internal whitespace', () => {
    expect(stripHtml('<span>A</span>\n  <span>B</span>')).toBe('A B');
  });
  it('handles null/undefined', () => {
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml(null)).toBe('');
  });
});

describe('parseRestrictions', () => {
  it('splits on "|" and lowercases', () => {
    expect(parseRestrictions('Personality|Trademarked')).toEqual(['personality', 'trademarked']);
  });
  it('empty/absent yields []', () => {
    expect(parseRestrictions('')).toEqual([]);
    expect(parseRestrictions(undefined)).toEqual([]);
  });
});

describe('dateTimeOriginalYear', () => {
  it('reads the leading year from an EXIF-style timestamp', () => {
    expect(dateTimeOriginalYear('2013:11:09 14:23:01')).toBe(2013);
  });
  it('reads the leading year from an ISO timestamp', () => {
    expect(dateTimeOriginalYear('2013-11-09T14:23:01Z')).toBe(2013);
  });
  it('null/undefined -> null', () => {
    expect(dateTimeOriginalYear(undefined)).toBeNull();
    expect(dateTimeOriginalYear(null)).toBeNull();
  });
});

describe('guessCategory', () => {
  it('composes "Category:<make> <model>" (§6.7)', () => {
    expect(guessCategory({ id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] }, {
      id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: null,
    })).toBe('Category:Suzuki GSX-R750');
  });
});

describe('licenseFamilyOf / parseLicenseFamilies', () => {
  it('classifies each LicenseId into its family', () => {
    expect(licenseFamilyOf('PD')).toBe('pd');
    expect(licenseFamilyOf('CC0')).toBe('cc0');
    expect(licenseFamilyOf('CC-BY-4.0')).toBe('cc-by');
    expect(licenseFamilyOf('CC-BY-SA-4.0')).toBe('cc-by-sa');
  });
  it('defaults to all four families when unset', () => {
    expect(parseLicenseFamilies(undefined)).toEqual(new Set(['pd', 'cc0', 'cc-by', 'cc-by-sa']));
  });
  it('parses a comma list', () => {
    expect(parseLicenseFamilies('pd,cc0')).toEqual(new Set(['pd', 'cc0']));
  });
});

// -----------------------------------------------------------------------------------------
// buildReviewCandidate — the core decision logic, fully offline
// -----------------------------------------------------------------------------------------

function page(overrides: Partial<RawFilePage['imageinfo']['extmetadata']> = {}, pageOverrides: Partial<RawFilePage> = {}): RawFilePage {
  return {
    pageid: 12193306,
    title: 'File:2004 Suzuki GSXR-750 Left SIde.jpg',
    imageinfo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg',
      thumburl: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg?utm_content=thumbnail_unscaled&utm_medium=off',
      width: 800,
      height: 600,
      mime: 'image/jpeg',
      extmetadata: {
        LicenseShortName: { value: 'Public domain' },
        LicenseUrl: { value: 'https://commons.wikimedia.org/wiki/Template:PD-user' },
        Artist: { value: 'Pawlex' },
        AttributionRequired: { value: 'false' },
        ObjectName: { value: '2004 Suzuki GSXR-750 Left SIde' },
        ImageDescription: { value: '2004 Suzuki GSXR-750, US market model.' },
        ...overrides,
      },
    },
    ...pageOverrides,
  };
}

const NOW_2026 = new Date('2026-09-02T12:00:00');

describe('buildReviewCandidate — allowed licence, high-confidence year', () => {
  it('produces a pending candidate with the right shape', () => {
    const candidate = buildReviewCandidate({
      page: page(),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'Category:Suzuki GSX-R 750',
      p275: ['Q98592850'],
      now: NOW_2026,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.candidateId).toBe('M12193306');
    expect(candidate!.decision).toBe('pending');
    expect(candidate!.license).toEqual({
      id: 'PD',
      name: 'Public domain',
      url: 'https://commons.wikimedia.org/wiki/Template:PD-user',
      jurisdiction: null,
      sdcP275: ['Q98592850'],
      attributionRequired: false,
    });
    expect(candidate!.yearProposed).toBe(2004);
    expect(candidate!.yearConfidence).toBe('high');
    expect(candidate!.author).toBe('Pawlex');
    expect(candidate!.warnings).toContain('source-width-below-min'); // 800 < MIN_SOURCE_WIDTH
  });

  it('strips utm_* params from thumbUrl but leaves originalUrl untouched', () => {
    const candidate = buildReviewCandidate({
      page: page(),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'Category:Suzuki GSX-R 750',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate!.thumbUrl).not.toMatch(/utm_/);
    expect(candidate!.originalUrl).toBe(page().imageinfo.url);
  });

  it('no source-width warning when the usable 4:3 width meets MIN_SOURCE_WIDTH (large in both axes)', () => {
    // 2400x1800: usable width = min(2400, round(1800*4/3)) = min(2400, 2400) = 2400 >= 2182.
    // (2000x1500 no longer clears MIN_SOURCE_WIDTH post-§4.7a: usable 2000 < 2182 — a 2000px
    // source at f1=0.11 yields a 220px level-1 rect, under the 240px floor.)
    const candidate = buildReviewCandidate({
      page: page({}, { imageinfo: { ...page().imageinfo, width: 2400, height: 1800 } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate!.warnings).not.toContain('source-width-below-min');
  });

  it('warns on a wide-but-short panorama whose USABLE 4:3 width fails even though the raw width passes (§4.7)', () => {
    // 3000x1000: raw width 3000 >= 2182, but usable width = min(3000, round(1000*4/3)) = 1333 < 2182.
    const candidate = buildReviewCandidate({
      page: page({}, { imageinfo: { ...page().imageinfo, width: 3000, height: 1000 } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate!.warnings).toContain('source-width-below-min');
  });
});

describe('buildReviewCandidate — licence gate (§6.5)', () => {
  it('returns null (filtered out entirely) when the licence is GFDL', () => {
    const candidate = buildReviewCandidate({
      page: page({ LicenseShortName: { value: 'GFDL 1.2' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: ['Q26921686'],
      now: NOW_2026,
    });
    expect(candidate).toBeNull();
  });

  it('returns null when P275 is solely GFDL even if LicenseShortName looks fine', () => {
    const candidate = buildReviewCandidate({
      page: page({ LicenseShortName: { value: 'CC BY-SA 3.0' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: ['Q26921686'],
      now: NOW_2026,
    });
    expect(candidate).toBeNull();
  });

  it('allows the dual-licence case (GFDL present but not sole)', () => {
    const candidate = buildReviewCandidate({
      page: page({ LicenseShortName: { value: 'CC BY-SA 3.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0/' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: ['Q50829104', 'Q14946043'],
      now: NOW_2026,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.license.id).toBe('CC-BY-SA-3.0');
  });
});

describe('buildReviewCandidate — auto-reject reasons that STILL produce a candidate', () => {
  it('yearConfidence low/none -> decision reject (still a candidate, licence permitting)', () => {
    const candidate = buildReviewCandidate({
      page: page({ ObjectName: { value: 'Bonhams Auction 1970 lot 42' }, ImageDescription: { value: '' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.decision).toBe('reject');
    expect(['low', 'none']).toContain(candidate!.yearConfidence);
  });

  it('restrictions containing "personality" -> decision reject', () => {
    const candidate = buildReviewCandidate({
      page: page({ Restrictions: { value: 'Personality' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.decision).toBe('reject');
    expect(candidate!.restrictions).toContain('personality');
  });

  it('an unknown P275 Q-id yields the unknown-p275 warning but stays pending', () => {
    const candidate = buildReviewCandidate({
      page: page(),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: ['Q98592850', 'Q999999999'],
      now: NOW_2026,
    });
    expect(candidate!.decision).toBe('pending');
    expect(candidate!.warnings).toContain('unknown-p275');
  });
});

describe('buildReviewCandidate — DateTimeOriginal negative evidence', () => {
  it('a capture-year token is discarded rather than demoting confidence', () => {
    const candidate = buildReviewCandidate({
      page: page({
        ObjectName: { value: '1966 Triumph Bonneville T120 TT' },
        ImageDescription: { value: 'Triumph Bonneville T120 TT, 1966, photographed in 2013 at a show.' },
        DateTimeOriginal: { value: '2013:06:01 10:00:00' },
      }),
      makeId: 'triumph',
      modelId: 'triumph-bonneville-t120',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate!.yearConfidence).toBe('high');
    expect(candidate!.yearProposed).toBe(1966);
    expect(candidate!.yearCandidates.some((c) => c.year === 2013)).toBe(false);
  });
});

describe('buildReviewCandidate — author/creditNote', () => {
  it('auto-rejects when Artist is empty — "Unknown" is a reject, never a value (§3.1, §6.9)', () => {
    const candidate = buildReviewCandidate({
      page: page({ Artist: { value: '' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.decision).toBe('reject');
    expect(candidate!.author).not.toBe('Unknown');
    expect(candidate!.author).toBeTruthy();
    expect(candidate!.warnings).toContain('no-machine-readable-author');
  });

  it('also auto-rejects when Artist is absent entirely', () => {
    const candidate = buildReviewCandidate({
      page: page({ Artist: undefined }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(candidate!.decision).toBe('reject');
    expect(candidate!.warnings).toContain('no-machine-readable-author');
  });

  it('creditNote is null when Credit duplicates Artist, non-null when it adds a prose request', () => {
    const noNote = buildReviewCandidate({
      page: page({ Credit: { value: 'Pawlex' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(noNote!.creditNote).toBeNull();

    const withNote = buildReviewCandidate({
      page: page({ Credit: { value: 'Please credit as Przemysław Jahr / Wikimedia Commons' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      now: NOW_2026,
    });
    expect(withNote!.creditNote).toBe('Please credit as Przemysław Jahr / Wikimedia Commons');
  });
});

describe('buildReviewCandidate result validates against review.schema.json', () => {
  it('a built candidate slots into a full ReviewFile that validates', async () => {
    const candidate = buildReviewCandidate({
      page: page(),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'Category:Suzuki GSX-R 750',
      p275: ['Q98592850'],
      now: NOW_2026,
    })!;
    const reviewFile = {
      schema: 1,
      batch: '2026-09-02-batch01',
      generatedAt: '2026-09-02',
      userAgent: 'motodle/0.1 (https://playmotodle.com; homelab hobby project) node-fetch',
      candidates: [candidate],
    };
    const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'schema/review.schema.json'), 'utf8')) as JSONSchema;
    expect(validate(schema, reviewFile)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// fetchCandidates — offline behaviour (§8 DoD: dry-run / empty cache -> zero network calls)
// -----------------------------------------------------------------------------------------

let workDir: string;
let cacheDir: string;
let catalogPath: string;
let outPath: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(SCRATCH_ROOT, 'fetch-'));
  cacheDir = path.join(workDir, 'cache');
  catalogPath = path.join(workDir, 'catalog.json');
  outPath = path.join(workDir, 'review.json');
  await fs.writeFile(
    catalogPath,
    JSON.stringify({
      schema: 1,
      generatedAt: '2026-09-02',
      source: 'seed',
      makes: [{ id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] }],
      models: [{ id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] }],
    }),
  );
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

/** Seeds a pre-populated JSON API response into the on-disk cache, keyed exactly the way
 *  `WikimediaClient` keys it (`cacheKeyFor(withMandatoryParams(url))`), so `fetchCandidates` — a
 *  cache hit — never makes a real network call. */
async function seedJsonResponse(url: string, body: unknown): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const key = cacheKeyFor(withMandatoryParams(url));
  await fs.writeFile(
    path.join(cacheDir, `${key}.json`),
    JSON.stringify({ url, fetchedAt: new Date().toISOString(), encoding: 'json', body }),
  );
}

describe('fetchCandidates — dry-run on an empty (clean-clone) cache', () => {
  it('exits cleanly with zero candidates and makes no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchCandidates({
      modelIds: ['suzuki-gsxr750'],
      outPath,
      batch: 'test-batch',
      cacheDir,
      catalogPath,
      dryRun: true,
    });
    expect(result.candidates).toEqual([]);
    expect(result.stats.networkRequests).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(fs.readFile(outPath)).rejects.toThrow(); // dry-run writes nothing
    fetchSpy.mockRestore();
  });

  it('skips an unknown modelId with a warning instead of crashing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchCandidates({
      modelIds: ['nonexistent-model'],
      outPath,
      batch: 'test-batch',
      cacheDir,
      catalogPath,
      dryRun: true,
    });
    expect(result.candidates).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('fetchCandidates — counts licence-rejected/family-filtered candidates and validates before writing', () => {
  it('reports filteredLicence/filteredFamily (§6.5 precedence) and writes a schema-valid review file (improvements 2 & 3)', async () => {
    const category = 'Category:Suzuki GSX-R750'; // guessCategory("Suzuki", "GSX-R750")
    const perModel = 20;
    const queryUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&` +
      `gcmtitle=${encodeURIComponent(category)}&gcmtype=file&gcmlimit=${perModel}&gcmsort=timestamp&gcmdir=desc&` +
      `prop=imageinfo&iiprop=extmetadata%7Curl%7Csize%7Cmime%7Ctimestamp&iiurlwidth=800&` +
      `iiextmetadatafilter=LicenseShortName%7CLicense%7CUsageTerms%7CArtist%7CCredit%7CAttribution%7C` +
      `AttributionRequired%7CCopyrighted%7CRestrictions%7CImageDescription%7CDateTimeOriginal%7CObjectName%7CLicenseUrl`;

    const allowedPage = page(); // pageid 12193306, PD — passes the licence gate and the "pd" family filter
    const gfdlPage = page({ LicenseShortName: { value: 'GFDL 1.2' } }, { pageid: 555001, title: 'File:GFDL example.jpg' });
    const ccBySaPage = page(
      { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } },
      { pageid: 555002, title: 'File:CC BY-SA example.jpg' },
    );

    await seedJsonResponse(queryUrl, { query: { pages: [allowedPage, gfdlPage, ccBySaPage] } });

    const mIds = [allowedPage, gfdlPage, ccBySaPage].map((p) => `M${p.pageid}`);
    const wbUrl = `https://commons.wikimedia.org/w/api.php?action=wbgetentities&ids=${mIds.join('|')}&props=claims`;
    await seedJsonResponse(wbUrl, { entities: {} });

    const result = await fetchCandidates({
      modelIds: ['suzuki-gsxr750'],
      outPath,
      batch: 'test-batch',
      cacheDir,
      catalogPath,
      licenses: 'pd', // excludes the CC BY-SA page by family, independent of the GFDL rejection
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].candidateId).toBe(`M${allowedPage.pageid}`);
    expect(result.filteredLicence).toBe(1); // the GFDL page
    expect(result.filteredFamily).toBe(1); // the CC BY-SA page, outside --licenses pd
    expect(result.stats.networkRequests).toBe(0); // everything served from the seeded cache

    const written = JSON.parse(await fs.readFile(outPath, 'utf8'));
    expect(written.candidates).toHaveLength(1);
    const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'schema/review.schema.json'), 'utf8')) as JSONSchema;
    expect(validate(schema, written)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------
// normalizeQueryPage — formatversion=2 returns `imageinfo` as an ARRAY (live run 2026-09-03)
// -----------------------------------------------------------------------------------------

describe('normalizeQueryPage', () => {
  it('collapses the formatversion=2 array to the object shape', () => {
    const wire = { pageid: 1, title: 'File:x.jpg', imageinfo: [page().imageinfo] };
    expect(normalizeQueryPage(wire)).toEqual(page({}, { pageid: 1, title: 'File:x.jpg' }));
  });

  it('passes an already-object imageinfo through unchanged', () => {
    expect(normalizeQueryPage(page())).toEqual(page());
  });

  it('returns null (never throws) for a page with no imageinfo or no extmetadata', () => {
    expect(normalizeQueryPage({ pageid: 2, title: 'File:none.jpg' })).toBeNull();
    expect(normalizeQueryPage({ pageid: 3, title: 'File:empty.jpg', imageinfo: [] })).toBeNull();
    const noMeta = { ...page().imageinfo, extmetadata: undefined as unknown as RawFilePage['imageinfo']['extmetadata'] };
    expect(normalizeQueryPage({ pageid: 4, title: 'File:nometa.jpg', imageinfo: [noMeta] })).toBeNull();
  });
});
