import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayIndex, msUntilNextLocalMidnight, nextLocalMidnight, puzzleNumber, todayKey } from './date';

// §7.1: "Anything that reads 'now' pins it with vi.setSystemTime(...) in a beforeEach, with
// vi.useRealTimers() after — no unit test may depend on the day it runs." Every test below either
// passes an explicit local Date, or pins the clock and restores real timers afterward.

describe('todayKey', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the LOCAL calendar components, not toISOString (which is UTC)', () => {
    const d = new Date(2026, 8, 2, 23, 30, 0); // local: 2026-09-02 23:30 (month index 8 = Sep)
    expect(todayKey(d)).toBe('2026-09-02');
    // Whatever the host TZ, todayKey must equal the Date's own local y/m/d getters, never a
    // UTC-derived string.
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(todayKey(d)).toBe(expected);
  });

  it('pads single-digit months and days to two digits', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05'); // Jan 5
    expect(todayKey(new Date(2026, 8, 2))).toBe('2026-09-02'); // Sep 2
  });

  it('defaults to `new Date()`, honouring a pinned system clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2, 12, 0, 0));
    expect(todayKey()).toBe('2026-09-02');
  });
});

describe('puzzleNumber (§4.1)', () => {
  it('2026-09-02 (LAUNCH_DATE) is #1 — operator decision D1', () => {
    expect(puzzleNumber('2026-09-02')).toBe(1);
  });

  it('2026-09-03 is #2', () => {
    expect(puzzleNumber('2026-09-03')).toBe(2);
  });

  it('2026-09-01 is #0 — the day before launch', () => {
    expect(puzzleNumber('2026-09-01')).toBe(0);
  });

  it('DST-crossing: 2026-11-02 is exactly 61 days after launch, #62 — spans the US DST end (2026-11-01) without shifting', () => {
    expect(puzzleNumber('2026-11-02')).toBe(62);
  });

  it('is a pure function of the date string alone — same input, same output, regardless of the system clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1999, 0, 1));
      expect(puzzleNumber('2026-09-02')).toBe(1);
      expect(puzzleNumber('2026-11-02')).toBe(62);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('dayIndex', () => {
  it('is exported (stats.ts imports it — §4.3 recordCompletion)', () => {
    expect(typeof dayIndex).toBe('function');
  });

  it('consecutive calendar dates differ by exactly 1', () => {
    expect(dayIndex('2026-09-03') - dayIndex('2026-09-02')).toBe(1);
    expect(dayIndex('2026-01-01') - dayIndex('2025-12-31')).toBe(1);
  });

  it('is DST-proof across the US fall-back boundary (2026-11-01)', () => {
    // Oct has 31 days; a naive local-Date-object subtraction in a DST-observing zone can be off
    // by the DST delta on exactly this boundary. dayIndex never touches a wall clock.
    expect(dayIndex('2026-11-02') - dayIndex('2026-10-02')).toBe(31);
  });
});

describe('nextLocalMidnight (§4.5 stats-modal countdown target)', () => {
  it('returns local midnight of the following day', () => {
    const d = new Date(2026, 8, 2, 15, 45, 30, 250);
    const next = nextLocalMidnight(d);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(3);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
    expect(next.getSeconds()).toBe(0);
    expect(next.getMilliseconds()).toBe(0);
  });

  it('rolls over a month/year boundary correctly', () => {
    const next = nextLocalMidnight(new Date(2026, 11, 31, 23, 59, 59));
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  it('when `d` is already exactly local midnight, the target is the NEXT day, not today', () => {
    const next = nextLocalMidnight(new Date(2026, 8, 2, 0, 0, 0, 0));
    expect(next.getDate()).toBe(3);
  });
});

describe('msUntilNextLocalMidnight', () => {
  it('is positive and shrinks as the clock approaches midnight', () => {
    const early = msUntilNextLocalMidnight(new Date(2026, 8, 2, 0, 0, 1));
    const late = msUntilNextLocalMidnight(new Date(2026, 8, 2, 23, 59, 0));
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThanOrEqual(60_000);
  });
});
