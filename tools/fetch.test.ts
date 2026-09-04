import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReviewCandidate,
  computeHardGateWarnings,
  dateTimeOriginalYear,
  fetchCandidates,
  guessCategory,
  licenseFamilyOf,
  parseLicenseFamilies,
  parseRestrictions,
  stripFileTitle,
  stripHtml,
  normalizeQueryPage,
  type HardGateInput,
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

  // CONTENT-WITHOUT-AI.md §5 gate 3 — real Commons free-text HTML (verified against
  // .cache/wikimedia: M152990445 "Ducati Monster in 2024.jpg" and M98436361 "Helsingin
  // olympialaiset 1952…"). The old leading-token-only regex returned null for both.
  it('strips tags and finds the year in "19 August 2024 (according to <span>Exif</span> data)"', () => {
    const raw =
      '19 August 2024 (according to <span lang="en" dir="ltr">' +
      '<a href="https://en.wikipedia.org/wiki/Exif" class="extiw" title="en:Exif">Exif</a></span> data)';
    expect(dateTimeOriginalYear(raw)).toBe(2024);
  });

  it('strips tags and finds the year in "July 1952<div…>QS:P571,+1952-…</div>", no digit-adjacent false boundary', () => {
    const raw = 'July 1952<div style="display: none;">date QS:P571,+1952-07-00T00:00:00Z/10</div>';
    expect(dateTimeOriginalYear(raw)).toBe(1952);
  });

  it('ignores an out-of-range token via the minYear/maxYear bounds', () => {
    expect(dateTimeOriginalYear('scan 0042 batch', 1885, 2027)).toBeNull();
  });
});

describe('stripFileTitle', () => {
  it('drops the "File:" prefix and extension', () => {
    expect(stripFileTitle('File:2004 Suzuki GSXR-750 Left SIde.jpg')).toBe('2004 Suzuki GSXR-750 Left SIde');
    expect(stripFileTitle('File:Puch PLUS-PROGRAM 1977.PNG')).toBe('Puch PLUS-PROGRAM 1977');
  });
  it('can diverge from ObjectName (real recon: a filename-only detail suffix)', () => {
    // "File:Yamaha Fz8 (25976223) instrument-panel.jpeg" vs. ObjectName "Yamaha Fz8" — the
    // detail-token gate (7) reads THIS, never ObjectName, for exactly this reason.
    expect(stripFileTitle('File:Yamaha Fz8 (25976223) instrument-panel.jpeg')).toBe('Yamaha Fz8 (25976223) instrument-panel');
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

// -----------------------------------------------------------------------------------------
// computeHardGateWarnings — the EIGHT hard gates (CONTENT-WITHOUT-AI.md §5). One real-batch
// example per gate (from docs/content-review/2026-09-03-batch01.json, all genuine rejects),
// plus the two lost-pass traps the spec explicitly calls out.
// -----------------------------------------------------------------------------------------

function gateInput(overrides: Partial<HardGateInput> = {}): HardGateInput {
  return {
    title: 'Suzuki GSX-R750',
    description: 'A Suzuki GSX-R750.',
    filename: 'Suzuki GSX-R750',
    mime: 'image/jpeg',
    dtoYear: null,
    officialYearScan: { yearProposed: null, source: '' },
    modelYears: null,
    makeNames: [],
    currentYear: 2026,
    ...overrides,
  };
}

describe('computeHardGateWarnings', () => {
  it('gate 1: non-jpeg mime -> not-a-photograph', () => {
    expect(computeHardGateWarnings(gateInput({ mime: 'image/png' }))).toContain('not-a-photograph');
  });

  it('gate 1: poster/scale-model wording -> not-a-photograph (real: "Modello in scala della Moto Guzzi Falcone 500…")', () => {
    const warnings = computeHardGateWarnings(
      gateInput({
        filename: 'Moto Guzzi Falcone 500 model Polstrada (1967)',
        description: 'Modello in scala della Moto Guzzi Falcone 500 utilizzata dalla Polizia Stradale.',
      }),
    );
    expect(warnings).toContain('not-a-photograph');
  });

  it('gate 2: yearProposed outside catalog.models[].years widened by ±1', () => {
    const warnings = computeHardGateWarnings(
      gateInput({ officialYearScan: { yearProposed: 1928, source: 'title' }, modelYears: [2015, null] }),
    );
    expect(warnings).toContain('year-outside-catalog-window');
  });

  it('gate 2: inside the ±1 widened window does NOT fire', () => {
    const warnings = computeHardGateWarnings(
      gateInput({ officialYearScan: { yearProposed: 2014, source: 'title' }, modelYears: [2015, null] }),
    );
    expect(warnings).not.toContain('year-outside-catalog-window');
  });

  it('gate 2: null upper bound (still on sale) never rejects a recent year', () => {
    const warnings = computeHardGateWarnings(
      gateInput({ officialYearScan: { yearProposed: 2026, source: 'title' }, modelYears: [2015, null] }),
    );
    expect(warnings).not.toContain('year-outside-catalog-window');
  });

  it('gate 3: proposed year equals the capture year and is not title-leading (real: "Ducati Monster in 2024")', () => {
    // Title/description both "Ducati Monster in 2024" — 2024 is not title-LEADING (the title
    // starts with "Ducati"), and it equals the real DateTimeOriginal year (19 August 2024).
    const warnings = computeHardGateWarnings(
      gateInput({
        title: 'Ducati Monster in 2024',
        description: 'Ducati Monster in 2024',
        officialYearScan: { yearProposed: null, source: '' }, // the with-discard scan strips it to nothing
        dtoYear: 2024,
      }),
    );
    expect(warnings).toContain('year-matches-capture-date');
  });

  it('gate 3: a title-LEADING year equal to the capture year is exempt', () => {
    const warnings = computeHardGateWarnings(
      gateInput({
        title: '2024 Ducati Monster',
        description: '2024 Ducati Monster',
        officialYearScan: { yearProposed: null, source: '' },
        dtoYear: 2024,
      }),
    );
    expect(warnings).not.toContain('year-matches-capture-date');
  });

  it('gate 4: a second, different catalog make right after " - " (real: "Kawasaki Z650 FOUR - Yamaha TX750")', () => {
    const warnings = computeHardGateWarnings(
      gateInput({ filename: 'Kawasaki Z650 FOUR - Yamaha TX750 (23110313245)', makeNames: ['Kawasaki', 'Yamaha', 'Honda'] }),
    );
    expect(warnings).toContain('second-make-in-title');
  });

  it('gate 4: own make mentioned incidentally, no hyphen listing -> does NOT fire (real lost-pass trap)', () => {
    // Ground truth: M36340402, decision "pending" — a museum-row filename naming three
    // exhibits without a " - " separator must NOT be caught by this gate.
    const warnings = computeHardGateWarnings(
      gateInput({
        filename: '1996 Kawasaki ZG1000 Concours 1983 Honda CB550 Nighthawk 2001 Aprilia Futura NMUSAF 26Sept09',
        makeNames: ['Kawasaki', 'Honda', 'Aprilia'],
      }),
    );
    expect(warnings).not.toContain('second-make-in-title');
  });

  it('gate 5: sidecar wording in the FILENAME (real: "2016 Triumph Thruxton R with sidecar 1.2")', () => {
    expect(computeHardGateWarnings(gateInput({ filename: '2016 Triumph Thruxton R with sidecar 1.2' }))).toContain(
      'sidecar-in-title',
    );
  });

  it('gate 5: sidecar named only in the DESCRIPTION (a neighbouring bike) does NOT fire', () => {
    const warnings = computeHardGateWarnings(
      gateInput({ filename: 'Moto Guzzi California Stone', description: 'Parked next to a sidecar rig.' }),
    );
    expect(warnings).not.toContain('sidecar-in-title');
  });

  it('gate 6: production-span prose in the description, year not title-leading (real: "Bauzeit 1953 bis 1970")', () => {
    const warnings = computeHardGateWarnings(
      gateInput({
        description: 'Puch 250 SGS, Bauzeit 1953 bis 1970, Zweitakt-Doppelkolbenmotor.',
        officialYearScan: { yearProposed: 1953, source: 'description' },
      }),
    );
    expect(warnings).toContain('production-span-prose');
  });

  it('gate 6: a bare "YYYY–YYYY" in the title is NOT this rule', () => {
    const warnings = computeHardGateWarnings(
      gateInput({
        title: 'Velocette Venom 1955-1970',
        description: 'A Velocette Venom.',
        officialYearScan: { yearProposed: null, source: '' },
      }),
    );
    expect(warnings).not.toContain('production-span-prose');
  });

  it('gate 6: production-span prose is exempt when the year IS title-leading', () => {
    const warnings = computeHardGateWarnings(
      gateInput({
        description: 'Bauzeit 1953 bis 1970.',
        officialYearScan: { yearProposed: 1953, source: 'title' },
      }),
    );
    expect(warnings).not.toContain('production-span-prose');
  });

  it('gate 7: detail token in the filename (real: "V4 engine with right crankcase cover removed"), never front/rear/left/right', () => {
    expect(
      computeHardGateWarnings(gateInput({ filename: '2000 Honda VFR800 V4 engine with right crankcase cover removed' })),
    ).toContain('detail-token-in-filename');
    expect(computeHardGateWarnings(gateInput({ filename: '2004 Suzuki GSXR-750, front left' }))).not.toContain(
      'detail-token-in-filename',
    );
  });

  it('gate 8: event token in the filename (real: "Hatfield Heath Festival 2023")', () => {
    expect(computeHardGateWarnings(gateInput({ filename: '2007 Triumph Rocket III 2294 cc Hatfield Heath Festival 2023 A' }))).toContain(
      'event-token-in-filename',
    );
  });

  it('gate 8: "concours d\'Elegance" fires, but a bare "Concours" (Kawasaki\'s own model name) does NOT', () => {
    // Found scanning catalog.models[] against this regex: "Concours (ZG1000/1400)" is a real
    // catalog model — a bare "concours" match would reject every candidate of it outright.
    expect(computeHardGateWarnings(gateInput({ filename: "2023 Greenwich Concours d'Elegance" }))).toContain(
      'event-token-in-filename',
    );
    expect(computeHardGateWarnings(gateInput({ filename: 'Kawasaki Concours 1000' }))).not.toContain('event-token-in-filename');
  });

  it('no gate fires on a clean pass-shaped candidate', () => {
    expect(
      computeHardGateWarnings(
        gateInput({
          title: '2004 Suzuki GSXR-750 Left SIde',
          description: '2004 Suzuki GSXR-750, US market model.',
          filename: '2004 Suzuki GSXR-750 Left SIde',
          officialYearScan: { yearProposed: 2004, source: 'title+description' },
          modelYears: [1985, null],
          makeNames: ['Suzuki', 'Honda'],
        }),
      ),
    ).toEqual([]);
  });
});

describe('buildReviewCandidate — hard gates wired end-to-end', () => {
  it('a hard-gate hit forces decision=reject even though the year alone would only be "medium" (stays pending)', () => {
    const candidate = buildReviewCandidate({
      page: page({
        ObjectName: { value: 'Kawasaki Z650 FOUR - Yamaha TX750 (23110313245)' },
        ImageDescription: { value: 'Kawasaki Z650 FOUR and Yamaha TX750 side by side, both built in 1978, museum row.' },
      }, { title: 'File:Kawasaki Z650 FOUR - Yamaha TX750 (23110313245).jpg' }),
      makeId: 'kawasaki',
      modelId: 'kawasaki-z650',
      sourceCategory: 'x',
      p275: [],
      makeNames: ['Kawasaki', 'Yamaha', 'Suzuki'],
      now: NOW_2026,
    });
    expect(candidate!.yearConfidence).toBe('medium'); // would stay "pending" on its own
    expect(candidate!.decision).toBe('reject');
    expect(candidate!.warnings).toContain('second-make-in-title');
  });

  it('the catalog-year gate uses the passed-in model, ±1 widened', () => {
    const candidate = buildReviewCandidate({
      page: page({
        ObjectName: { value: '1928 Indian 101 Scout' },
        ImageDescription: { value: '1928 Indian 101 Scout, restored.' },
      }),
      makeId: 'indian',
      modelId: 'indian-scout',
      sourceCategory: 'x',
      p275: [],
      model: { id: 'indian-scout', makeId: 'indian', name: 'Scout', aliases: [], years: [2015, null] },
      now: NOW_2026,
    });
    expect(candidate!.decision).toBe('reject');
    expect(candidate!.warnings).toContain('year-outside-catalog-window');
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
// signals — RANKING only, never gates (§5). Optional field; must stay schema-valid either way.
// -----------------------------------------------------------------------------------------

describe('buildReviewCandidate — signals (never gates)', () => {
  it('populates every signal and stays schema-valid', async () => {
    const candidate = buildReviewCandidate({
      page: page(
        {
          ObjectName: { value: 'Suzuki GSX-R750 at the Barber Vintage Motorsports Museum (2)' },
          ImageDescription: { value: 'On display at the museum, no year stated here.' },
        },
        { title: 'File:Suzuki GSX-R750 at the Barber Vintage Motorsports Museum (2).jpg', categories: [{ title: 'Category:Barber Vintage Motorsports Museum' }] },
      ),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'Category:Suzuki GSX-R750',
      p275: [],
      p180: ['Q34493'],
      categoryQid: 'Q7374148',
      model: { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] },
      now: NOW_2026,
    })!;
    expect(candidate.signals).toEqual({
      museumWord: true,
      seriesMarker: true,
      portrait: false,
      descriptionOnlyYear: false, // no year anywhere here at all
      modelNameAbsent: false, // "GSX-R750" IS in the title
      p180Present: true,
      p180Matches: false, // Q34493 (generic "motorcycle") != the category's own Q7374148
      uploader: candidate.author,
      categories: ['Category:Barber Vintage Motorsports Museum'],
    });

    const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'schema/review.schema.json'), 'utf8')) as JSONSchema;
    const reviewFile = {
      schema: 1,
      batch: 'x',
      generatedAt: '2026-09-02',
      userAgent: 'motodle/0.1 (https://playmotodle.com; homelab hobby project) node-fetch',
      candidates: [candidate],
    };
    expect(validate(schema, reviewFile)).toEqual([]);
  });

  it('modelNameAbsent is true when the model name appears in neither title nor description', () => {
    const candidate = buildReviewCandidate({
      page: page({ ObjectName: { value: 'A random motorcycle' }, ImageDescription: { value: 'Nice bike.' } }),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      model: { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: null },
      now: NOW_2026,
    })!;
    expect(candidate.signals?.modelNameAbsent).toBe(true);
  });

  it('p180Matches is null when P180 is absent, and null (not false) when the category Q-id is unresolved', () => {
    const noP180 = buildReviewCandidate({
      page: page(),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      categoryQid: 'Q7374148',
      now: NOW_2026,
    })!;
    expect(noP180.signals?.p180Present).toBe(false);
    expect(noP180.signals?.p180Matches).toBeNull();

    const unresolvedCategory = buildReviewCandidate({
      page: page(),
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      sourceCategory: 'x',
      p275: [],
      p180: ['Q7374148'],
      categoryQid: null,
      now: NOW_2026,
    })!;
    expect(unresolvedCategory.signals?.p180Present).toBe(true);
    expect(unresolvedCategory.signals?.p180Matches).toBeNull();
  });

  it('a review file with no `signals` on any candidate (pre-existing files) still validates', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(ROOT, 'docs/content-review/2026-09-03-batch01.json'), 'utf8'));
    const schema = JSON.parse(await fs.readFile(path.join(ROOT, 'schema/review.schema.json'), 'utf8')) as JSONSchema;
    expect(validate(schema, { ...raw, candidates: raw.candidates.slice(0, 5) })).toEqual([]);
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
      `prop=imageinfo%7Ccategories&cllimit=max&iiprop=extmetadata%7Curl%7Csize%7Cmime%7Ctimestamp&iiurlwidth=800&` +
      `iiextmetadatafilter=LicenseShortName%7CLicense%7CUsageTerms%7CArtist%7CCredit%7CAttribution%7C` +
      `AttributionRequired%7CCopyrighted%7CRestrictions%7CImageDescription%7CDateTimeOriginal%7CObjectName%7CLicenseUrl`;
    const categoryQidUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&prop=categoryinfo%7Cpageprops&` +
      `titles=${encodeURIComponent(category)}`;

    const allowedPage = page(); // pageid 12193306, PD — passes the licence gate and the "pd" family filter
    const gfdlPage = page({ LicenseShortName: { value: 'GFDL 1.2' } }, { pageid: 555001, title: 'File:GFDL example.jpg' });
    const ccBySaPage = page(
      { LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } },
      { pageid: 555002, title: 'File:CC BY-SA example.jpg' },
    );

    await seedJsonResponse(queryUrl, { query: { pages: [allowedPage, gfdlPage, ccBySaPage] } });
    await seedJsonResponse(categoryQidUrl, { query: { pages: [{ title: category }] } }); // no wikibase_item — p180Matches stays null

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

describe('fetchCandidates — SDC P275/P180 live under `statements`, not `claims` (real API shape)', () => {
  it('a sole-GFDL P275 under `statements` is actually denied (this was silently inert before the fix)', async () => {
    const category = 'Category:Suzuki GSX-R750';
    const perModel = 20;
    const queryUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&` +
      `gcmtitle=${encodeURIComponent(category)}&gcmtype=file&gcmlimit=${perModel}&gcmsort=timestamp&gcmdir=desc&` +
      `prop=imageinfo%7Ccategories&cllimit=max&iiprop=extmetadata%7Curl%7Csize%7Cmime%7Ctimestamp&iiurlwidth=800&` +
      `iiextmetadatafilter=LicenseShortName%7CLicense%7CUsageTerms%7CArtist%7CCredit%7CAttribution%7C` +
      `AttributionRequired%7CCopyrighted%7CRestrictions%7CImageDescription%7CDateTimeOriginal%7CObjectName%7CLicenseUrl`;
    const categoryQidUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&prop=categoryinfo%7Cpageprops&` +
      `titles=${encodeURIComponent(category)}`;

    // LicenseShortName looks fine on its own — only the SDC P275 statement (dual-licence collapse,
    // §6.5) reveals the sole GFDL. If `fetchEntityClaims` still read `.claims` instead of
    // `.statements`, this candidate would slip through as CC-BY-SA-3.0.
    const gfdlBySdc = page(
      { LicenseShortName: { value: 'CC BY-SA 3.0' } },
      { pageid: 777001, title: 'File:GFDL by SDC.jpg' },
    );
    const p180Page = page({}, { pageid: 777002, title: 'File:Has P180.jpg' });

    await seedJsonResponse(queryUrl, { query: { pages: [gfdlBySdc, p180Page] } });
    await seedJsonResponse(categoryQidUrl, { query: { pages: [{ title: category, pageprops: { wikibase_item: 'Q7374148' } }] } });

    const mIds = [gfdlBySdc, p180Page].map((p) => `M${p.pageid}`);
    const wbUrl = `https://commons.wikimedia.org/w/api.php?action=wbgetentities&ids=${mIds.join('|')}&props=claims`;
    await seedJsonResponse(wbUrl, {
      entities: {
        [`M${gfdlBySdc.pageid}`]: {
          type: 'mediainfo',
          statements: { P275: [{ mainsnak: { datavalue: { value: { id: 'Q26921686' } } } }] }, // GFDL 1.2, sole value
        },
        [`M${p180Page.pageid}`]: {
          type: 'mediainfo',
          statements: { P180: [{ mainsnak: { datavalue: { value: { id: 'Q7374148' } } } }] },
        },
      },
    });

    const result = await fetchCandidates({
      modelIds: ['suzuki-gsxr750'],
      outPath,
      batch: 'test-batch',
      cacheDir,
      catalogPath,
    });

    expect(result.filteredLicence).toBe(1); // the sole-GFDL-by-SDC file, denied only via `statements`
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].candidateId).toBe(`M${p180Page.pageid}`);
    expect(result.candidates[0].signals?.p180Present).toBe(true);
    expect(result.candidates[0].signals?.p180Matches).toBe(true); // matches the resolved category Q-id
    expect(result.stats.networkRequests).toBe(0); // everything served from the seeded cache
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

  it('carries `categories` (prop=categories, §6.7) through untouched', () => {
    const wire = {
      pageid: 5,
      title: 'File:x.jpg',
      imageinfo: [page().imageinfo],
      categories: [{ title: 'Category:Suzuki GSX-R750' }, { title: 'Category:1985 motorcycles' }],
    };
    expect(normalizeQueryPage(wire)?.categories).toEqual([
      { title: 'Category:Suzuki GSX-R750' },
      { title: 'Category:1985 motorcycles' },
    ]);
  });

  it('a page with no categories at all leaves the field absent, never a crash', () => {
    expect(normalizeQueryPage({ pageid: 6, title: 'File:x.jpg', imageinfo: [page().imageinfo] })?.categories).toBeUndefined();
  });
});
