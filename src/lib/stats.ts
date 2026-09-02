/**
 * Streak + distribution updates (§4.3). Pure. No DOM, no storage — the caller persists the
 * returned `StatsState` through `src/lib/storage.ts`.
 *
 * Practice NEVER reaches this function (§4.6). That is enforced one layer up, at the single
 * call site — `GameStore.onGameEnded()` in `src/state/game.svelte.ts` — which is the only code
 * that calls `recordCompletion`; nothing in here knows about practice mode.
 */
import type { Puzzle, StatsState } from '../../schema/types';
import { dayIndex } from './date';
import { ACHIEVABLE_SCORES } from './score';

export function createInitialStats(): StatsState {
  const scoreDistribution = Object.fromEntries(ACHIEVABLE_SCORES.map((s) => [String(s), 0])) as StatsState['scoreDistribution'];
  return {
    schemaVersion: 1,
    played: 0,
    wins: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastWinDate: null,
    lastCompletedDate: null,
    scoreDistribution,
  };
}

export interface Result {
  won: boolean;
  score: number;
}

/**
 * The ONLY writer of `motodle:stats`. Called once, at game end, for a non-practice game.
 * Everything below is keyed to `puzzle.date`, NEVER the wall clock.
 */
export function recordCompletion(stats: StatsState, puzzle: Puzzle, r: Result): StatsState {
  // IDEMPOTENT: two tabs finishing the same day, or a completion replayed through a cross-tab
  // `subscribe()` event, must not double-count `played`, the distribution or the streak.
  if (stats.lastCompletedDate === puzzle.date) return stats;

  const next: StatsState = { ...stats, scoreDistribution: { ...stats.scoreDistribution } };
  next.played += 1;
  const scoreKey = String(r.score) as keyof StatsState['scoreDistribution'];
  next.scoreDistribution[scoreKey] += 1;
  next.lastCompletedDate = puzzle.date; // always the PUZZLE's date

  if (r.won) {
    next.wins += 1;
    const consecutive =
      stats.lastWinDate !== null && dayIndex(puzzle.date) - dayIndex(stats.lastWinDate) === 1;
    next.currentStreak = consecutive ? stats.currentStreak + 1 : 1;
    next.maxStreak = Math.max(stats.maxStreak, next.currentStreak);
    next.lastWinDate = puzzle.date; // always the PUZZLE's date
  } else {
    next.currentStreak = 0; // lastWinDate is NOT cleared
  }

  return next;
}
