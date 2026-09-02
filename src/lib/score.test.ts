import { describe, expect, it } from 'vitest';
import { ACHIEVABLE_SCORES, computeScore, multiplier, pointsFromLocks } from './score';

// §4.3 achievable-score table, literal:
//
// | Outcome                    | points | mult | score |
// | Win on guess 1              |   3    |  5   |  15   |
// | Win on guess 2              |   3    |  4   |  12   |
// | Win on guess 3              |   3    |  3   |   9   |
// | Win on guess 4              |   3    |  2   |   6   |
// | Win on guess 5              |   3    |  1   |   3   |
// | Loss / give-up, 2 green     |   2    |  1   |   2   |
// | Loss / give-up, 1 green     |   1    |  1   |   1   |
// | Loss / give-up, 0 green     |   0    |  1   |   0   |
describe('§4.3 achievable-score table', () => {
  it.each([
    [3, 1, true, 15],
    [3, 2, true, 12],
    [3, 3, true, 9],
    [3, 4, true, 6],
    [3, 5, true, 3],
    [2, 5, false, 2],
    [1, 5, false, 1],
    [0, 5, false, 0],
  ])('points=%s endedAtGuess=%s won=%s -> score=%s', (points, endedAtGuess, won, expected) => {
    expect(computeScore(points, endedAtGuess, won)).toBe(expected);
  });
});

describe('multiplier', () => {
  it.each([
    [1, 5],
    [2, 4],
    [3, 3],
    [4, 2],
    [5, 1],
  ])('win at guess %s -> multiplier %s', (endedAtGuess, expected) => {
    expect(multiplier(true, endedAtGuess)).toBe(expected);
  });

  it('a loss or give-up always uses multiplier 1, regardless of endedAtGuess', () => {
    for (let endedAtGuess = 1; endedAtGuess <= 5; endedAtGuess++) {
      expect(multiplier(false, endedAtGuess)).toBe(1);
    }
  });
});

describe('pointsFromLocks', () => {
  it('counts the number of non-null locks (0..3)', () => {
    expect(pointsFromLocks({ makeId: null, modelId: null, year: null })).toBe(0);
    expect(pointsFromLocks({ makeId: 'suzuki', modelId: null, year: null })).toBe(1);
    expect(pointsFromLocks({ makeId: 'suzuki', modelId: 'suzuki-gsxr750', year: null })).toBe(2);
    expect(pointsFromLocks({ makeId: 'suzuki', modelId: 'suzuki-gsxr750', year: 2004 })).toBe(3);
  });
});

describe('the achievable score set is EXACTLY {0,1,2,3,6,9,12,15} — exhaustive over all reachable states', () => {
  it('ACHIEVABLE_SCORES is exactly the frozen 8-value set', () => {
    expect([...ACHIEVABLE_SCORES]).toEqual([0, 1, 2, 3, 6, 9, 12, 15]);
  });

  it('enumerating every reachable (points, endedAtGuess, won) combination yields exactly the 8 values', () => {
    // Reachable states: a WIN requires all three categories green (points === 3); a LOSS or
    // give-up can only ever have 0, 1 or 2 green (3 green would have already ended the game as a
    // win). endedAtGuess only varies the multiplier for a win — a loss/give-up is always
    // multiplier 1 regardless of which guess it happened on.
    const reached = new Set<number>();
    for (let endedAtGuess = 1; endedAtGuess <= 5; endedAtGuess++) {
      reached.add(computeScore(3, endedAtGuess, true));
    }
    for (const points of [0, 1, 2]) {
      for (let endedAtGuess = 1; endedAtGuess <= 5; endedAtGuess++) {
        reached.add(computeScore(points, endedAtGuess, false));
      }
    }
    expect([...reached].sort((a, b) => a - b)).toEqual([...ACHIEVABLE_SCORES]);
  });

  it('a loss (or give-up) can never score more than 2', () => {
    for (const points of [0, 1, 2]) {
      for (let endedAtGuess = 1; endedAtGuess <= 5; endedAtGuess++) {
        expect(computeScore(points, endedAtGuess, false)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('a win always scores 3 or more (points is always 3)', () => {
    for (let endedAtGuess = 1; endedAtGuess <= 5; endedAtGuess++) {
      expect(computeScore(3, endedAtGuess, true)).toBeGreaterThanOrEqual(3);
    }
  });
});
