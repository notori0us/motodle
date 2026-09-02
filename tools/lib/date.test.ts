import { describe, expect, it } from 'vitest';
import { addDays, dayIndex, localToday, puzzleId, puzzleNumber } from './date';

describe('puzzleNumber — §4.1 worked examples', () => {
  it('LAUNCH_DATE is puzzle #1', () => {
    expect(puzzleNumber('2026-09-02')).toBe(1);
  });
  it('the next day is #2', () => {
    expect(puzzleNumber('2026-09-03')).toBe(2);
  });
  it('the day before launch is #0 (before launch)', () => {
    expect(puzzleNumber('2026-09-01')).toBe(0);
  });
  it('spans the US DST end exactly 61 days later -> #62', () => {
    expect(puzzleNumber('2026-11-02')).toBe(62);
  });
});

describe('dayIndex', () => {
  it('is monotonically increasing by exactly 1 per local calendar day', () => {
    expect(dayIndex('2026-09-03') - dayIndex('2026-09-02')).toBe(1);
  });
});

describe('puzzleId', () => {
  it('pads to 4 digits', () => {
    expect(puzzleId(1)).toBe('mtd-0001');
    expect(puzzleId(62)).toBe('mtd-0062');
    expect(puzzleId(1234)).toBe('mtd-1234');
  });
});

describe('addDays', () => {
  it('n=0 is a no-op', () => {
    expect(addDays('2026-09-02', 0)).toBe('2026-09-02');
  });
  it('adds within a month', () => {
    expect(addDays('2026-09-02', 1)).toBe('2026-09-03');
    expect(addDays('2026-09-02', 2)).toBe('2026-09-04');
  });
  it('rolls over a month boundary', () => {
    expect(addDays('2026-09-29', 3)).toBe('2026-10-02');
  });
  it('rolls over the US DST end (2026-11-01) without drifting', () => {
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
  });
  it('is the exact inverse of dayIndex subtraction', () => {
    const start = '2026-09-02';
    for (let n = 0; n < 40; n++) {
      expect(dayIndex(addDays(start, n)) - dayIndex(start)).toBe(n);
    }
  });
});

describe('localToday', () => {
  it('formats a given Date using local y/m/d components, not toISOString', () => {
    const d = new Date(2026, 8, 2, 23, 30); // local: Sep 2 2026, 23:30 (month is 0-indexed)
    expect(localToday(d)).toBe('2026-09-02');
  });
});
