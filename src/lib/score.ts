/**
 * Points, multiplier, final score (§4.3). Pure. No DOM.
 *
 *   points     = number of categories GREEN at game end        (0..3)
 *   multiplier = won ? 6 - endedAtGuess : 1                    (win: 5,4,3,2,1 for guesses 1..5)
 *   score      = points * multiplier                           (0..15)
 */

/** The exactly 8 achievable scores (§4.3) — also the fixed `scoreDistribution` bucket set. */
export const ACHIEVABLE_SCORES = [0, 1, 2, 3, 6, 9, 12, 15] as const;

/** Shape-compatible with `TodayState['locks']` (schema/types.ts) without importing the whole
 *  type just for this one field. */
export interface Locks {
  makeId: string | null;
  modelId: string | null;
  year: number | null;
}

/** Points = how many of the three categories are locked green. */
export function pointsFromLocks(locks: Locks): number {
  return (locks.makeId !== null ? 1 : 0) + (locks.modelId !== null ? 1 : 0) + (locks.year !== null ? 1 : 0);
}

/** A loss and a give-up both use multiplier 1 (§4.3). */
export function multiplier(won: boolean, endedAtGuess: number): number {
  return won ? 6 - endedAtGuess : 1;
}

export function computeScore(points: number, endedAtGuess: number, won: boolean): number {
  return points * multiplier(won, endedAtGuess);
}
