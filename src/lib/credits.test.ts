import { describe, expect, it } from 'vitest';
import type { Manifest } from '../../schema/types';
import { CREDITS_PAGE_SIZE, eligibleCreditDates, nextCreditBatch } from './credits';

/** The committed fixture set's shape (§7.4a): 2026-09-02..04, "today" pinned to the middle day. */
function threeDayManifest(): Manifest {
  return {
    schema: 1,
    launchDate: '2026-09-02',
    latest: { date: '2026-09-04', number: 3 },
    puzzles: [
      { date: '2026-09-02', number: 1, id: 'mtd-0001' },
      { date: '2026-09-03', number: 2, id: 'mtd-0002' },
      { date: '2026-09-04', number: 3, id: 'mtd-0003' },
    ],
  };
}

function yearManifest(days: number): Manifest {
  const puzzles = Array.from({ length: days }, (_, i) => {
    const n = i + 1;
    const date = `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    return { date, number: n, id: `mtd-${String(n).padStart(4, '0')}` };
  });
  return { schema: 1, launchDate: puzzles[0].date, latest: { date: puzzles.at(-1)!.date, number: days }, puzzles };
}

describe('eligibleCreditDates', () => {
  it('returns days strictly before todayDateKey, newest first, and never a future day', () => {
    const manifest = threeDayManifest();
    expect(eligibleCreditDates(manifest, '2026-09-03', false)).toEqual(['2026-09-02']);
  });

  it("today's own date is excluded when todayFinished is false", () => {
    const manifest = threeDayManifest();
    expect(eligibleCreditDates(manifest, '2026-09-03', false)).not.toContain('2026-09-03');
  });

  it("today's own date is included, newest-first, when todayFinished is true", () => {
    const manifest = threeDayManifest();
    expect(eligibleCreditDates(manifest, '2026-09-03', true)).toEqual(['2026-09-03', '2026-09-02']);
  });

  it('a manifest with only future days yields [] (the launch-day empty state)', () => {
    const manifest = threeDayManifest();
    // "today" is before every scheduled puzzle: every entry is a future day.
    expect(eligibleCreditDates(manifest, '2026-09-01', false)).toEqual([]);
    expect(eligibleCreditDates(manifest, '2026-09-01', true)).toEqual([]);
  });

  it('never includes a date after todayDateKey, regardless of todayFinished', () => {
    const manifest = threeDayManifest();
    const result = eligibleCreditDates(manifest, '2026-09-02', true);
    expect(result).not.toContain('2026-09-03');
    expect(result).not.toContain('2026-09-04');
    expect(result).toEqual(['2026-09-02']);
  });
});

describe('nextCreditBatch', () => {
  it('returns at most CREDITS_PAGE_SIZE (20) dates', () => {
    const manifest = yearManifest(365);
    const eligible = eligibleCreditDates(manifest, '2027-09-03', true); // every day is past/today-finished
    expect(eligible.length).toBe(365);
    expect(nextCreditBatch(eligible, 0)).toHaveLength(20);
    expect(CREDITS_PAGE_SIZE).toBe(20);
  });

  it('resumes at loadedCount, and never returns 365 in one call across a 365-day manifest', () => {
    const manifest = yearManifest(365);
    const eligible = eligibleCreditDates(manifest, '2027-09-03', true);
    const first = nextCreditBatch(eligible, 0);
    const second = nextCreditBatch(eligible, 20);
    expect(first).toHaveLength(20);
    expect(second).toHaveLength(20);
    expect(second[0]).toBe(eligible[20]);
    expect(new Set([...first, ...second]).size).toBe(40); // no overlap
  });

  it('returns [] once everything is loaded', () => {
    const manifest = threeDayManifest();
    const eligible = eligibleCreditDates(manifest, '2026-09-05', true);
    expect(eligible).toHaveLength(3);
    expect(nextCreditBatch(eligible, 3)).toEqual([]);
  });
});
