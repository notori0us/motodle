import { describe, expect, it, vi } from 'vitest';
import type { Puzzle, StatsState } from '../../schema/types';
import { ACHIEVABLE_SCORES } from './score';
import { createInitialStats, recordCompletion } from './stats';

function puzzleOn(date: string, number = 1): Puzzle {
  return {
    schema: 1,
    id: `mtd-${String(number).padStart(4, '0')}`,
    number,
    date,
    answer: { makeId: 'suzuki', make: 'Suzuki', modelId: 'suzuki-gsxr750', model: 'GSX-R750', year: 2004, acceptModelIds: ['suzuki-gsxr750'] },
    image: {
      aspect: '4:3',
      focus: { x: 0.5, y: 0.5 },
      sourceCrop: null,
      cropFractions: [0.15, 0.25, 0.4, 0.62, 0.95],
      levels: [],
      full: { src: 'full.webp', w: 1, h: 1, bytes: 1 },
    },
    credit: {
      fileTitle: 'x',
      descriptionUrl: 'x',
      author: 'x',
      license: { id: 'PD', name: 'Public domain', url: 'x', jurisdiction: null },
      attributionRequired: false,
      modified: 'cropped, resized, re-encoded to WebP',
      creditNote: null,
    },
    yearEvidence: { confidence: 'operator', source: 'operator', note: 'x', approvedBy: 'operator', approvedOn: date },
  };
}

describe('createInitialStats', () => {
  it('all 8 achievable-score buckets present, zeroed', () => {
    const stats = createInitialStats();
    for (const score of ACHIEVABLE_SCORES) {
      expect(stats.scoreDistribution[String(score) as keyof StatsState['scoreDistribution']]).toBe(0);
    }
    expect(Object.keys(stats.scoreDistribution).sort()).toEqual(['0', '1', '12', '15', '2', '3', '6', '9'].sort());
  });
});

describe('recordCompletion — streak arithmetic (§4.3)', () => {
  it('a win the day after lastWinDate extends the streak by 1', () => {
    const stats: StatsState = { ...createInitialStats(), currentStreak: 3, maxStreak: 5, lastWinDate: '2026-09-01', lastCompletedDate: '2026-09-01' };
    const next = recordCompletion(stats, puzzleOn('2026-09-02'), { won: true, score: 15 });
    expect(next.currentStreak).toBe(4);
    expect(next.maxStreak).toBe(5);
    expect(next.lastWinDate).toBe('2026-09-02');
  });

  it('a win with a gap (not exactly the next day) resets the streak to 1', () => {
    const stats: StatsState = { ...createInitialStats(), currentStreak: 3, maxStreak: 5, lastWinDate: '2026-08-30', lastCompletedDate: '2026-08-30' };
    const next = recordCompletion(stats, puzzleOn('2026-09-02'), { won: true, score: 15 });
    expect(next.currentStreak).toBe(1);
  });

  it('a win with no prior lastWinDate starts the streak at 1', () => {
    const next = recordCompletion(createInitialStats(), puzzleOn('2026-09-02'), { won: true, score: 15 });
    expect(next.currentStreak).toBe(1);
    expect(next.maxStreak).toBe(1);
  });

  it('maxStreak is monotone — never decreases even after a later, shorter streak', () => {
    let stats: StatsState = { ...createInitialStats(), currentStreak: 5, maxStreak: 5, lastWinDate: '2026-09-01', lastCompletedDate: '2026-09-01' };
    stats = recordCompletion(stats, puzzleOn('2026-09-02', 2), { won: false, score: 0 }); // streak resets to 0
    expect(stats.maxStreak).toBe(5);
    stats = recordCompletion(stats, puzzleOn('2026-09-03', 3), { won: true, score: 3 }); // streak -> 1
    expect(stats.currentStreak).toBe(1);
    expect(stats.maxStreak).toBe(5); // still 5, unaffected by the smaller streak
  });

  it('a loss resets currentStreak to 0 but leaves lastWinDate UNTOUCHED', () => {
    const stats: StatsState = { ...createInitialStats(), currentStreak: 3, maxStreak: 5, lastWinDate: '2026-09-01', lastCompletedDate: '2026-09-01' };
    const next = recordCompletion(stats, puzzleOn('2026-09-02', 2), { won: false, score: 1 });
    expect(next.currentStreak).toBe(0);
    expect(next.lastWinDate).toBe('2026-09-01'); // untouched
  });

  it('a give-up (also `won: false`) resets currentStreak to 0 and leaves lastWinDate untouched', () => {
    const stats: StatsState = { ...createInitialStats(), currentStreak: 2, maxStreak: 2, lastWinDate: '2026-09-01', lastCompletedDate: '2026-09-01' };
    const next = recordCompletion(stats, puzzleOn('2026-09-02', 2), { won: false, score: 0 });
    expect(next.currentStreak).toBe(0);
    expect(next.lastWinDate).toBe('2026-09-01');
  });

  it('lastWinDate and lastCompletedDate are always the PUZZLE date, keyed correctly even after real local midnight', () => {
    vi.useFakeTimers();
    // Player finishes YESTERDAY's puzzle (2026-09-02) at 00:30 on 2026-09-03 — this must extend
    // yesterday's streak, keyed to the puzzle's date, never to "now".
    vi.setSystemTime(new Date(2026, 8, 3, 0, 30, 0));
    const stats: StatsState = { ...createInitialStats(), currentStreak: 1, maxStreak: 1, lastWinDate: '2026-09-01', lastCompletedDate: '2026-09-01' };
    const next = recordCompletion(stats, puzzleOn('2026-09-02', 1), { won: true, score: 9 });
    expect(next.lastWinDate).toBe('2026-09-02'); // the PUZZLE's date, not 2026-09-03 (today's wall date)
    expect(next.lastCompletedDate).toBe('2026-09-02');
    expect(next.currentStreak).toBe(2); // 2026-09-02 is exactly 1 day after 2026-09-01
    vi.useRealTimers();
  });
});

describe('recordCompletion — idempotency', () => {
  it('is a no-op when lastCompletedDate === puzzle.date (replayed completion, e.g. cross-tab subscribe)', () => {
    const stats: StatsState = { ...createInitialStats(), played: 1, wins: 1, currentStreak: 1, maxStreak: 1, lastWinDate: '2026-09-02', lastCompletedDate: '2026-09-02' };
    const next = recordCompletion(stats, puzzleOn('2026-09-02'), { won: true, score: 15 });
    expect(next).toBe(stats); // same reference — a true no-op, not just equal values
  });

  it('played, the distribution and the streak all stay unchanged across a replay', () => {
    let stats = recordCompletion(createInitialStats(), puzzleOn('2026-09-02'), { won: true, score: 15 });
    const afterFirst = stats;
    stats = recordCompletion(stats, puzzleOn('2026-09-02'), { won: true, score: 15 }); // replay same date
    expect(stats).toEqual(afterFirst);
  });
});

describe('recordCompletion — distribution buckets', () => {
  it('increments exactly the bucket matching the score', () => {
    const next = recordCompletion(createInitialStats(), puzzleOn('2026-09-02'), { won: true, score: 9 });
    expect(next.scoreDistribution['9']).toBe(1);
    expect(next.scoreDistribution['15']).toBe(0);
  });

  it('played counts every completion, win or loss', () => {
    let stats = createInitialStats();
    stats = recordCompletion(stats, puzzleOn('2026-09-02', 1), { won: true, score: 15 });
    stats = recordCompletion(stats, puzzleOn('2026-09-03', 2), { won: false, score: 0 });
    expect(stats.played).toBe(2);
    expect(stats.wins).toBe(1);
  });
});
