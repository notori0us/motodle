import { describe, expect, it } from 'vitest';
import {
  checkP275,
  classifyLicenseShortName,
  decideLicense,
  GFDL_QIDS,
  KNOWN_LICENSE_QIDS,
} from './licence';

// §6.5 / §7.1 — "all 13 observed LicenseShortName strings": 10 allowed CC/PD variants + one
// jurisdiction-suffixed CC BY-SA + the two denied strings (GFDL 1.2, Copyrighted free use).
describe('classifyLicenseShortName — the 13 observed LicenseShortName strings', () => {
  const ALLOWED: [string, string, string | null][] = [
    ['Public domain', 'PD', null],
    ['CC0 1.0 Universal Public Domain Dedication', 'CC0', null],
    ['CC BY 2.0', 'CC-BY-2.0', null],
    ['CC BY 2.5', 'CC-BY-2.5', null],
    ['CC BY 3.0', 'CC-BY-3.0', null],
    ['CC BY 4.0', 'CC-BY-4.0', null],
    ['CC BY-SA 2.0', 'CC-BY-SA-2.0', null],
    ['CC BY-SA 2.5', 'CC-BY-SA-2.5', null],
    ['CC BY-SA 3.0', 'CC-BY-SA-3.0', null],
    ['CC BY-SA 4.0', 'CC-BY-SA-4.0', null],
    ['CC BY-SA 2.0 de', 'CC-BY-SA-2.0', 'de'],
  ];

  for (const [shortName, id, jurisdiction] of ALLOWED) {
    it(`allows "${shortName}" -> ${id}${jurisdiction ? ` (jurisdiction ${jurisdiction})` : ''}`, () => {
      const result = classifyLicenseShortName(shortName);
      expect(result.allowed).toBe(true);
      expect(result.id).toBe(id);
      expect(result.jurisdiction ?? null).toBe(jurisdiction);
    });
  }

  const DENIED: [string, string][] = [
    ['GFDL 1.2', 'gfdl'],
    ['Copyrighted free use', 'copyrighted-free-use'],
  ];

  for (const [shortName, reason] of DENIED) {
    it(`denies "${shortName}" (${reason})`, () => {
      const result = classifyLicenseShortName(shortName);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(reason);
    });
  }

  it('denies empty/absent', () => {
    expect(classifyLicenseShortName('').allowed).toBe(false);
    expect(classifyLicenseShortName(null).allowed).toBe(false);
    expect(classifyLicenseShortName(undefined).allowed).toBe(false);
  });

  it('denies any other GFDL variant by substring match', () => {
    expect(classifyLicenseShortName('GNU Free Documentation License 1.3').allowed).toBe(false);
  });

  it('denies an unrecognised string that matches no allow pattern', () => {
    const result = classifyLicenseShortName('All rights reserved');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('unrecognised');
  });

  it('a ported CC BY-SA never falls through to the unported pattern (SA checked before BY)', () => {
    const result = classifyLicenseShortName('CC BY-SA 3.0');
    expect(result.id).toBe('CC-BY-SA-3.0');
  });
});

describe('checkP275 — GFDL-1.2-only reject', () => {
  it('denies when the sole P275 value is GFDL 1.2', () => {
    expect(checkP275(['Q26921686'])).toEqual({ denied: true, unknownQids: [] });
  });

  it('denies when the sole P275 value is GFDL 1.2+', () => {
    expect(checkP275(['Q50829104'])).toEqual({ denied: true, unknownQids: [] });
  });
});

describe('checkP275 — dual-licence case (M142102925: GFDL-1.2+ AND CC BY-SA 3.0)', () => {
  it('is NOT denied — GFDL is not the sole value', () => {
    const result = checkP275(['Q50829104', 'Q14946043']);
    expect(result.denied).toBe(false);
    expect(result.unknownQids).toEqual([]);
  });
});

describe('checkP275 — unrecognised Q-id', () => {
  it('flags an unrecognised Q-id without denying, when a known allowed value is also present', () => {
    const result = checkP275(['Q19125117', 'Q999999999']);
    expect(result.denied).toBe(false);
    expect(result.unknownQids).toEqual(['Q999999999']);
  });

  it('flags an unrecognised-only P275 (no GFDL, no known licence) as unknown, not denied', () => {
    const result = checkP275(['Q999999999']);
    expect(result.denied).toBe(false);
    expect(result.unknownQids).toEqual(['Q999999999']);
  });
});

describe('GFDL_QIDS / KNOWN_LICENSE_QIDS — coverage sanity', () => {
  it('GFDL Q-ids are not also listed as known-allowed', () => {
    for (const q of GFDL_QIDS) expect(KNOWN_LICENSE_QIDS.has(q)).toBe(false);
  });
});

describe('decideLicense — the combined gate tools/fetch.ts calls', () => {
  it('allows a clean PD candidate and copies name/url verbatim', () => {
    const result = decideLicense({
      shortName: 'Public domain',
      licenseUrl: 'https://commons.wikimedia.org/wiki/Template:PD-user',
      p275: ['Q98592850'],
    });
    expect(result.outcome).toBe('allow');
    expect(result.license).toEqual({
      id: 'PD',
      name: 'Public domain',
      url: 'https://commons.wikimedia.org/wiki/Template:PD-user',
      jurisdiction: null,
    });
    expect(result.warnings).toEqual([]);
  });

  it('rejects outright when P275 is solely GFDL, even if LicenseShortName looks fine', () => {
    // Pathological input a real API would never actually return together — proves P275 is
    // authoritative for denial regardless of what extmetadata says (§6.5 precedence rule).
    const result = decideLicense({
      shortName: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
      p275: ['Q26921686'],
    });
    expect(result.outcome).toBe('reject');
    expect(result.reason).toBe('gfdl-p275');
  });

  it('allows the dual-licence case (M142102925) — GFDL present but not sole, CC BY-SA 3.0 wins', () => {
    const result = decideLicense({
      shortName: 'CC BY-SA 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
      p275: ['Q50829104', 'Q14946043'],
    });
    expect(result.outcome).toBe('allow');
    expect(result.license?.id).toBe('CC-BY-SA-3.0');
  });

  it('an unrecognised P275 Q-id => unknown-p275 warning + still allowed (pending), not a reject', () => {
    const result = decideLicense({
      shortName: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      p275: ['Q18199165', 'Q1234567890'],
    });
    expect(result.outcome).toBe('allow');
    expect(result.warnings).toContain('unknown-p275');
  });

  it('rejects when LicenseShortName is denied even though P275 is fine', () => {
    const result = decideLicense({
      shortName: 'GFDL 1.2',
      licenseUrl: 'https://www.gnu.org/licenses/old-licenses/fdl-1.2.html',
      p275: ['Q26921686'],
    });
    expect(result.outcome).toBe('reject');
  });

  it('keeps the jurisdiction suffix and does not fold it into id (CC BY-SA 2.0 de)', () => {
    const result = decideLicense({
      shortName: 'CC BY-SA 2.0 de',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/de/',
      p275: ['Q19068220'],
    });
    expect(result.outcome).toBe('allow');
    expect(result.license?.id).toBe('CC-BY-SA-2.0');
    expect(result.license?.jurisdiction).toBe('de');
    expect(result.license?.url).toBe('https://creativecommons.org/licenses/by-sa/2.0/de/');
  });

  it('warns missing-license-url (but still allows) when LicenseUrl is absent', () => {
    const result = decideLicense({
      shortName: 'Public domain',
      licenseUrl: null,
      p275: ['Q98592850'],
    });
    expect(result.outcome).toBe('allow');
    expect(result.warnings).toContain('missing-license-url');
    expect(result.license?.url).toBe('');
  });

  it('never gates on extmetadata.Copyrighted (CC0 files report Copyrighted=true, §6.5)', () => {
    // decideLicense never even looks at a "Copyrighted" flag — proven by construction: CC0
    // still allows regardless of any such input, because there is no such parameter.
    const result = decideLicense({
      shortName: 'CC0 1.0 Universal Public Domain Dedication',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      p275: ['Q6938433'],
    });
    expect(result.outcome).toBe('allow');
    expect(result.license?.id).toBe('CC0');
  });
});
