/**
 * Guess evaluation, locking, win/lose/give-up state machine (§4.2, §4.3). Pure. No DOM.
 *
 * `evaluateGuess()` is THE single evaluator (§3.7 frozen signature) — every tile colour in the
 * app, in the tests and in the e2e specs comes from this function and nowhere else.
 */
import type {
  CatalogIndex,
  GuessInput,
  GuessRecord,
  PuzzleAnswer,
  TileResult,
  TileStates,
  TodayState,
} from '../../schema/types';
import { computeScore, pointsFromLocks } from './score';

/** years = [from, to] | null.  to === null  ⇒ still on sale ⇒ treated as currentYear + 1.
 *  years === null (unknown) ⇒ never yellow. */
function onSaleIn(years: [number, number | null] | null, answerYear: number): boolean {
  if (years === null) return false;
  const [from, to] = years;
  return answerYear >= from && answerYear <= (to ?? new Date().getFullYear() + 1);
}

/**
 * Pure. No DOM, no storage, no clock (aside from RULE B's `to: null` "still on sale" fallback,
 * which reads the real year — same as the frozen §4.2 pseudocode). Imported by the game store,
 * by `game.test.ts`, and by the §7.2 contract suite. Never re-implemented.
 */
export function evaluateGuess(guess: GuessInput, answer: PuzzleAnswer, catalog: CatalogIndex): TileStates {
  const gMake = catalog.makes.get(guess.makeId);
  const aMake = catalog.makes.get(answer.makeId);
  const gModel = catalog.models.get(guess.modelId);
  if (!gMake) throw new Error(`evaluateGuess: unknown make id "${guess.makeId}"`);
  if (!aMake) throw new Error(`evaluateGuess: unknown make id "${answer.makeId}"`);
  if (!gModel) throw new Error(`evaluateGuess: unknown model id "${guess.modelId}"`);

  // ---- RULE A: MAKE -------------------------------------------------------
  const make: TileResult =
    guess.makeId === answer.makeId ? 'green' : gMake.country === aMake.country ? 'yellow' : 'red';

  // ---- RULE B: MODEL ------------------------------------------------------
  // NOTE: the range is tested against the ANSWER's year, never the year the player typed.
  const model: TileResult = answer.acceptModelIds.includes(guess.modelId)
    ? 'green'
    : onSaleIn(gModel.years, answer.year)
      ? 'yellow'
      : 'red';

  // ---- YEAR (unchanged) ---------------------------------------------------
  const d = Math.abs(guess.year - answer.year);
  const year: TileResult = d <= 2 ? 'green' : d <= 10 ? 'yellow' : 'red';

  return { make, model, year };
}

/** The player-supplied side of a guess, beyond the frozen `GuessInput` (§3.7): the denormalized
 *  display strings a `GuessRecord` needs so the board can render without the catalog (§3.5). */
export interface SubmitGuessInput {
  makeId: string;
  modelId: string;
  year: number;
  make: string;
  model: string;
}

/** Once a category locks, its stored value is FIXED forever — a later guess only ever forces
 *  that tile green (above), it never re-writes the lock. Locking only ever transitions
 *  null -> a value, exactly once, from the guess that first went green. */
function nextLocks(locks: TodayState['locks'], guess: SubmitGuessInput, result: TileStates): TodayState['locks'] {
  return {
    makeId: locks.makeId !== null ? locks.makeId : result.make === 'green' ? guess.makeId : null,
    modelId: locks.modelId !== null ? locks.modelId : result.model === 'green' ? guess.modelId : null,
    year: locks.year !== null ? locks.year : result.year === 'green' ? guess.year : null,
  };
}

/**
 * Applies one guess to `state`: evaluates it, appends the (denormalized) guess record, updates
 * locks, and — if this guess wins or is the 5th — ends the game and writes the score.
 *
 * A locked category is re-scored as green on every subsequent guess (§4.3: "it is not re-entered
 * and cannot regress") — enforced here from `state.locks` (the locks BEFORE this guess), not
 * merely by the UI disabling the field, so the double-count/regression bug class (Cardle's C8) is
 * structurally impossible even if a caller passes an inconsistent guess for a locked category.
 *
 * Throws if the game has already ended, or if a 6th guess is attempted.
 */
export function submitGuess(
  state: TodayState,
  guess: SubmitGuessInput,
  answer: PuzzleAnswer,
  catalog: CatalogIndex,
): TodayState {
  if (state.status !== 'in_progress') {
    throw new Error('submitGuess: the game has already ended');
  }
  if (state.guesses.length >= 5) {
    throw new Error('submitGuess: a 6th guess is not allowed');
  }

  const raw = evaluateGuess({ makeId: guess.makeId, modelId: guess.modelId, year: guess.year }, answer, catalog);
  const result: TileStates = {
    make: state.locks.makeId !== null ? 'green' : raw.make,
    model: state.locks.modelId !== null ? 'green' : raw.model,
    year: state.locks.year !== null ? 'green' : raw.year,
  };

  const record: GuessRecord = {
    modelId: guess.modelId,
    make: guess.make,
    model: guess.model,
    year: guess.year,
    result,
  };
  const guesses = [...state.guesses, record];
  const locks = nextLocks(state.locks, guess, result);
  const guessNumber = guesses.length;
  const won = result.make === 'green' && result.model === 'green' && result.year === 'green';

  if (won) {
    const points = pointsFromLocks(locks);
    return {
      ...state,
      guesses,
      locks,
      status: 'won',
      endedAtGuess: guessNumber,
      score: computeScore(points, guessNumber, true),
    };
  }

  if (guessNumber >= 5) {
    const points = pointsFromLocks(locks);
    return {
      ...state,
      guesses,
      locks,
      status: 'lost',
      endedAtGuess: guessNumber,
      score: computeScore(points, guessNumber, false),
    };
  }

  return { ...state, guesses, locks };
}

/**
 * Give-up: irreversible, counts as a loss, multiplier 1. Appends NO guess row (§4.4) —
 * `endedAtGuess = guesses.length + 1` is the guess number the player was ABOUT to make.
 */
export function giveUp(state: TodayState): TodayState {
  if (state.status !== 'in_progress') {
    throw new Error('giveUp: the game has already ended');
  }
  const endedAtGuess = state.guesses.length + 1;
  const points = pointsFromLocks(state.locks);
  return { ...state, status: 'lost', endedAtGuess, score: computeScore(points, endedAtGuess, false) };
}
