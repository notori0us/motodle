import { describe, expect, it } from 'vitest';
import { autoDecisionFor, scanYearCandidates } from './year';

const BOUNDS = { minYear: 1885, maxYear: 2030 };

describe('scanYearCandidates — the four confidence tiers (§6.4)', () => {
  it('high: leading title token + same year in description + no other distinct token', () => {
    const result = scanYearCandidates({
      // `title` is `extmetadata.ObjectName` — the "File:" prefix and extension are already
      // stripped by the caller (tools/fetch.ts) before this function ever sees it.
      title: '2004 Suzuki GSXR-750 Left SIde',
      description: '2004 Suzuki GSXR-750, US market model.',
      ...BOUNDS,
    });
    expect(result.yearConfidence).toBe('high');
    expect(result.yearProposed).toBe(2004);
    expect(result.source).toBe('title+description');
  });

  it('medium: leading title token, but a second distinct 4-digit token exists elsewhere', () => {
    const result = scanYearCandidates({
      title: '2002 kawasaki zx-6r',
      description: 'Photographed in 2015 at a private collection.',
      ...BOUNDS,
    });
    expect(result.yearConfidence).toBe('medium');
    expect(result.yearProposed).toBe(2002);
  });

  it('medium: the year appears only in the description (no leading title token)', () => {
    const result = scanYearCandidates({
      title: 'Suzuki GSX-R750 studio shot',
      description: 'This is a 2004 Suzuki GSX-R750, photographed at a dealership.',
      ...BOUNDS,
    });
    expect(result.yearConfidence).toBe('medium');
    expect(result.yearProposed).toBe(2004);
    expect(result.source).toBe('description');
  });

  it('low: a date-shaped token (YYYY-MM-DD) forces low even though it is the only token', () => {
    const result = scanYearCandidates({
      title: 'Photographed 2013-11-09, vintage motorcycle',
      description: '',
      ...BOUNDS,
    });
    expect(result.yearConfidence).toBe('low');
  });

  it('low: an event-adjacent token (Bonhams) forces low even though it is leading', () => {
    const result = scanYearCandidates({
      title: '1970 Bonhams Auction Motorcycle',
      description: '',
      ...BOUNDS,
    });
    expect(result.yearConfidence).toBe('low');
  });

  it('low: a trailing token after a hyphen-separated event name', () => {
    const result = scanYearCandidates({
      title: 'Wiki Loves Monuments - 2016',
      description: '',
      ...BOUNDS,
    });
    expect(result.yearConfidence).toBe('low');
  });

  it('none: no 4-digit token in range anywhere', () => {
    const result = scanYearCandidates({
      title: 'Motorcycle photo',
      description: 'A nice ride at the coast.',
      ...BOUNDS,
    });
    expect(result.yearConfidence).toBe('none');
    expect(result.yearProposed).toBeNull();
  });
});

describe('scanYearCandidates — DateTimeOriginal is negative evidence, not a source (§6.4)', () => {
  const title = '1966 Triumph Bonneville T120 TT';
  const description = 'Triumph Bonneville T120 TT, 1966, photographed in 2013 at a show.';

  it('without discarding the capture year, the extra 2013 token demotes confidence to medium', () => {
    const result = scanYearCandidates({ title, description, ...BOUNDS });
    expect(result.yearConfidence).toBe('medium');
  });

  it('discarding the DateTimeOriginal year (2013) removes it as evidence, restoring high', () => {
    const result = scanYearCandidates({ title, description, dateTimeOriginalYear: 2013, ...BOUNDS });
    expect(result.yearConfidence).toBe('high');
    expect(result.yearProposed).toBe(1966);
  });

  it('a DateTimeOriginal-equal token is never counted against the "no other token" high requirement,\
 nor added to the candidates list', () => {
    const result = scanYearCandidates({ title, description, dateTimeOriginalYear: 2013, ...BOUNDS });
    expect(result.candidates.some((c) => c.year === 2013)).toBe(false);
  });
});

describe('scanYearCandidates — bounds', () => {
  it('ignores 4-digit tokens outside [minYear, maxYear]', () => {
    const result = scanYearCandidates({
      title: '1650 Motorcycle Replica Display',
      description: '',
      ...BOUNDS,
    });
    // 1650 is out of range (before 1885) -> not a candidate at all -> none.
    expect(result.yearConfidence).toBe('none');
  });
});

describe('autoDecisionFor (§3.4)', () => {
  it('low and none auto-reject', () => {
    expect(autoDecisionFor('low')).toBe('reject');
    expect(autoDecisionFor('none')).toBe('reject');
  });
  it('high, medium and operator stay pending', () => {
    expect(autoDecisionFor('high')).toBe('pending');
    expect(autoDecisionFor('medium')).toBe('pending');
    expect(autoDecisionFor('operator')).toBe('pending');
  });
});
