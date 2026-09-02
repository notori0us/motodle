import { describe, expect, it } from 'vitest';
import type { CatalogIndex, CatalogMake, CatalogModel, GuessRecord, PuzzleAnswer, TodayState } from '../../schema/types';
import { evaluateGuess, giveUp, submitGuess, type SubmitGuessInput } from './game';

// ---------------------------------------------------------------------------------------------
// Fixture catalog — mirrors the §4.2 worked tables exactly (answer = Suzuki GSX-R750, 2004, JP).
// ---------------------------------------------------------------------------------------------

function buildIndex(makes: CatalogMake[], models: CatalogModel[]): CatalogIndex {
  return { makes: new Map(makes.map((m) => [m.id, m])), models: new Map(models.map((m) => [m.id, m])) };
}

const MAKES: CatalogMake[] = [
  { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
  { id: 'honda', name: 'Honda', country: 'JP', aliases: [] },
  { id: 'kawasaki', name: 'Kawasaki', country: 'JP', aliases: [] },
  { id: 'yamaha', name: 'Yamaha', country: 'JP', aliases: [] },
  { id: 'ducati', name: 'Ducati', country: 'IT', aliases: [] },
  { id: 'triumph', name: 'Triumph', country: 'GB', aliases: [] },
  { id: 'harley-davidson', name: 'Harley-Davidson', country: 'US', aliases: [] },
];

const MODELS: CatalogModel[] = [
  { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] },
  { id: 'suzuki-hayabusa', makeId: 'suzuki', name: 'Hayabusa', aliases: [], years: [1999, null] }, // decoy
  { id: 'honda-cbr600f', makeId: 'honda', name: 'CBR600F', aliases: [], years: [1987, 2007] },
  { id: 'honda-cb750', makeId: 'honda', name: 'CB750', aliases: [], years: [1969, 2003] },
  { id: 'yamaha-r1', makeId: 'yamaha', name: 'YZF-R1', aliases: [], years: [1998, null] },
  { id: 'ducati-916', makeId: 'ducati', name: '916', aliases: [], years: [1994, 2004] },
  { id: 'kawasaki-zx10r', makeId: 'kawasaki', name: 'Ninja ZX-10R', aliases: [], years: [2004, null] },
  { id: 'kawasaki-h2r', makeId: 'kawasaki', name: 'H2R', aliases: [], years: [2005, 2020] },
  { id: 'harley-sportster', makeId: 'harley-davidson', name: 'Sportster', aliases: [], years: null },
  { id: 'triumph-bonneville-t120', makeId: 'triumph', name: 'Bonneville T120', aliases: [], years: [1959, 1974] },
  { id: 'triumph-speed-triple', makeId: 'triumph', name: 'Speed Triple', aliases: [], years: [1994, null] }, // decoy
];

const catalog = buildIndex(MAKES, MODELS);

const ANSWER: PuzzleAnswer = {
  makeId: 'suzuki',
  make: 'Suzuki',
  modelId: 'suzuki-gsxr750',
  model: 'GSX-R750',
  year: 2004,
  acceptModelIds: ['suzuki-gsxr750'],
};

function guess(makeId: string, modelId: string, year: number): { makeId: string; modelId: string; year: number } {
  return { makeId, modelId, year };
}

// ---------------------------------------------------------------------------------------------
// RULE A — MAKE (§4.2 worked table). Answer = Suzuki (JP).
// ---------------------------------------------------------------------------------------------

describe('evaluateGuess — RULE A (MAKE)', () => {
  it.each([
    ['suzuki', 'suzuki-gsxr750', 'green'],
    ['honda', 'honda-cbr600f', 'yellow'],
    ['kawasaki', 'kawasaki-zx10r', 'yellow'],
    ['ducati', 'ducati-916', 'red'],
    ['triumph', 'triumph-bonneville-t120', 'red'],
    ['harley-davidson', 'harley-sportster', 'red'],
  ] as const)('guessed make %s -> %s', (makeId, modelId, expected) => {
    const result = evaluateGuess(guess(makeId, modelId, 2004), ANSWER, catalog);
    expect(result.make).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// RULE B — MODEL (§4.2 worked table). Answer = Suzuki GSX-R750, year 2004, acceptModelIds =
// ['suzuki-gsxr750'].
// ---------------------------------------------------------------------------------------------

describe('evaluateGuess — RULE B (MODEL)', () => {
  it.each([
    ['suzuki', 'suzuki-gsxr750', 'green'], // acceptModelIds hit — range not even consulted
    ['honda', 'honda-cbr600f', 'yellow'], // 1987 <= 2004 <= 2007
    ['yamaha', 'yamaha-r1', 'yellow'], // to: null -> still on sale -> <= currentYear+1
    ['ducati', 'ducati-916', 'yellow'], // answer year EQUALS `to` (2004) — inclusive, still yellow
    ['kawasaki', 'kawasaki-zx10r', 'yellow'], // answer year EQUALS `from` (2004) — inclusive, still yellow
    ['honda', 'honda-cb750', 'red'], // 2003 < 2004 — one year outside the late end
    ['kawasaki', 'kawasaki-h2r', 'red'], // 2005 > 2004 — one year outside the early end
    ['harley-davidson', 'harley-sportster', 'red'], // years: null -> never yellow
    ['triumph', 'triumph-bonneville-t120', 'red'], // far outside
  ] as const)('guessed model %s/%s -> %s', (makeId, modelId, expected) => {
    const result = evaluateGuess(guess(makeId, modelId, 2004), ANSWER, catalog);
    expect(result.model).toBe(expected);
  });

  it('the range is tested against the ANSWER year, never the guessed year (CB750/1972 vs a 2004 answer)', () => {
    const result = evaluateGuess(guess('honda', 'honda-cb750', 1972), ANSWER, catalog);
    // 1972 is well inside the CB750's own [1969,2003] range, but that is irrelevant — the model
    // tile checks whether the CB750 was on sale in the ANSWER's year (2004), which it was not.
    expect(result.model).toBe('red');
    expect(result.year).toBe('red'); // |1972 - 2004| = 32
  });

  it('a green MODEL implies a green MAKE (a model belongs to exactly one make)', () => {
    const result = evaluateGuess(guess('suzuki', 'suzuki-gsxr750', 1990), ANSWER, catalog);
    expect(result.model).toBe('green');
    expect(result.make).toBe('green');
  });

  it.each([
    ['green make, yellow model', 'suzuki', 'suzuki-hayabusa', 'green'],
    ['yellow make, yellow model', 'honda', 'honda-cbr600f', 'yellow'],
    ['red make, yellow model', 'triumph', 'triumph-speed-triple', 'red'],
  ] as const)('a yellow MODEL is reachable with each MAKE colour: %s', (_label, makeId, modelId, expectedMake) => {
    const result = evaluateGuess(guess(makeId, modelId, 2004), ANSWER, catalog);
    expect(result.model).toBe('yellow');
    expect(result.make).toBe(expectedMake);
  });

  it('acceptModelIds equivalence (D4): a variant model in acceptModelIds scores green even though it is not `modelId`', () => {
    const monsterCatalog = buildIndex(
      [{ id: 'ducati', name: 'Ducati', country: 'IT', aliases: [] }],
      [
        { id: 'ducati-monster', makeId: 'ducati', name: 'Monster', aliases: [], years: [1993, 2008] },
        { id: 'ducati-monster-900', makeId: 'ducati', name: 'Monster 900', aliases: [], years: [1993, 2002] },
      ],
    );
    const monsterAnswer: PuzzleAnswer = {
      makeId: 'ducati',
      make: 'Ducati',
      modelId: 'ducati-monster',
      model: 'Monster',
      year: 1998,
      acceptModelIds: ['ducati-monster', 'ducati-monster-900'],
    };
    const result = evaluateGuess(guess('ducati', 'ducati-monster-900', 1998), monsterAnswer, monsterCatalog);
    expect(result.model).toBe('green');
  });
});

describe('evaluateGuess — unknown ids throw (a programming error, not a red tile)', () => {
  it('unknown guess.makeId throws', () => {
    expect(() => evaluateGuess(guess('nonexistent-make', 'suzuki-gsxr750', 2004), ANSWER, catalog)).toThrow();
  });
  it('unknown guess.modelId throws', () => {
    expect(() => evaluateGuess(guess('suzuki', 'nonexistent-model', 2004), ANSWER, catalog)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// YEAR bands (§4.2 worked table, answer year 2004).
// ---------------------------------------------------------------------------------------------

describe('evaluateGuess — YEAR bands at the 0/2/3/10/11 boundaries, both directions', () => {
  it.each([
    [2004, 'green'],
    [2006, 'green'],
    [2002, 'green'],
    [2007, 'yellow'],
    [2001, 'yellow'],
    [2014, 'yellow'],
    [1994, 'yellow'],
    [2015, 'red'],
    [1993, 'red'],
    [1885, 'red'],
  ] as const)('guessed year %s -> %s', (year, expected) => {
    const result = evaluateGuess(guess('suzuki', 'suzuki-gsxr750', year), ANSWER, catalog);
    expect(result.year).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// submitGuess / giveUp — locking, scoring, endings (§4.3).
// ---------------------------------------------------------------------------------------------

function initialState(): TodayState {
  return {
    schemaVersion: 1,
    date: '2026-09-02',
    number: 1,
    puzzleId: 'mtd-0001',
    status: 'in_progress',
    guesses: [],
    locks: { makeId: null, modelId: null, year: null },
    viewLevel: 1,
    endedAtGuess: null,
    score: null,
  };
}

function toSubmitInput(g: { makeId: string; modelId: string; year: number }, make: string, model: string): SubmitGuessInput {
  return { ...g, make, model };
}

/** Filler guess that scores red/red/red against ANSWER, safe to repeat with no locking side
 *  effects. */
const RED_FILLER: SubmitGuessInput = { makeId: 'harley-davidson', modelId: 'harley-sportster', year: 1885, make: 'Harley-Davidson', model: 'Sportster' };

describe('submitGuess — locking after each green', () => {
  it('locks appear incrementally, guess by guess, and the game wins once all three are locked', () => {
    let state = initialState();

    // Guess 1: only the year is right.
    state = submitGuess(state, toSubmitInput(guess('harley-davidson', 'harley-sportster', 2004), 'Harley-Davidson', 'Sportster'), ANSWER, catalog);
    expect(state.locks).toEqual({ makeId: null, modelId: null, year: 2004 });
    expect(state.status).toBe('in_progress');

    // Guess 2: make now right too (model still a decoy, not accepted).
    state = submitGuess(state, toSubmitInput(guess('suzuki', 'suzuki-hayabusa', 2004), 'Suzuki', 'Hayabusa'), ANSWER, catalog);
    expect(state.locks).toEqual({ makeId: 'suzuki', modelId: null, year: 2004 });
    expect(state.status).toBe('in_progress');

    // Guess 3: model now right — the win.
    state = submitGuess(state, toSubmitInput(guess('suzuki', 'suzuki-gsxr750', 2004), 'Suzuki', 'GSX-R750'), ANSWER, catalog);
    expect(state.locks).toEqual({ makeId: 'suzuki', modelId: 'suzuki-gsxr750', year: 2004 });
    expect(state.status).toBe('won');
    expect(state.endedAtGuess).toBe(3);
    expect(state.score).toBe(9); // 3 points * multiplier 3 (win on guess 3)
  });
});

describe('submitGuess — yellow locks nothing on any tile', () => {
  it('an all-yellow guess leaves every lock null', () => {
    const state = submitGuess(
      initialState(),
      toSubmitInput(guess('honda', 'honda-cbr600f', 2010), 'Honda', 'CBR600F'), // make yellow, model yellow, year yellow (Δ6)
      ANSWER,
      catalog,
    );
    expect(state.locks).toEqual({ makeId: null, modelId: null, year: null });
    expect(state.status).toBe('in_progress');
  });
});

describe('submitGuess — a locked category re-scores green on every subsequent guess (never re-entered, never regresses)', () => {
  it('forces green on the recorded tile even if a later guess would, on its own, evaluate differently', () => {
    let state = initialState();
    state.locks = { makeId: null, modelId: null, year: 2004 }; // year already locked from an earlier guess

    // This guess's own year (1990) would raw-evaluate as yellow (|1990-2004|=14 -> actually red;
    // pick a value that would clearly NOT be green on its own).
    const submitted = submitGuess(state, toSubmitInput(guess('honda', 'honda-cbr600f', 1990), 'Honda', 'CBR600F'), ANSWER, catalog);
    expect(submitted.guesses[0].result.year).toBe('green'); // forced, not re-derived
    expect(submitted.locks.year).toBe(2004); // lock itself is untouched, still the ORIGINAL green guess
  });
});

describe('submitGuess — duplicate guesses are accepted and cost a guess', () => {
  it('the same guess submitted twice appends two rows', () => {
    let state = initialState();
    state = submitGuess(state, RED_FILLER, ANSWER, catalog);
    state = submitGuess(state, RED_FILLER, ANSWER, catalog);
    expect(state.guesses).toHaveLength(2);
    expect(state.guesses[0].result).toEqual(state.guesses[1].result);
  });
});

describe('giveUp — appends no guess row, at each guess 1..5', () => {
  function stateWithNGuesses(n: number): TodayState {
    const s = initialState();
    const dummyRecord: GuessRecord = {
      modelId: 'harley-sportster',
      make: 'Harley-Davidson',
      model: 'Sportster',
      year: 1885,
      result: { make: 'red', model: 'red', year: 'red' },
    };
    s.guesses = Array.from({ length: n }, () => dummyRecord);
    return s;
  }

  it.each([1, 2, 3, 4, 5])('give-up during guess %s -> endedAtGuess = %s, guesses.length unchanged', (n) => {
    const before = stateWithNGuesses(n - 1);
    const after = giveUp(before);
    expect(after.guesses).toHaveLength(n - 1); // no row appended
    expect(after.status).toBe('lost');
    expect(after.endedAtGuess).toBe(n);
    expect(after.score).toBeLessThanOrEqual(2); // multiplier 1, points 0 here
  });

  it('throws if the game has already ended', () => {
    const ended = { ...initialState(), status: 'won' as const, endedAtGuess: 1, score: 15 };
    expect(() => giveUp(ended)).toThrow();
  });
});

describe('submitGuess — loss at guess 5', () => {
  it('5 non-winning guesses end the game as a loss with endedAtGuess 5', () => {
    let state = initialState();
    for (let i = 0; i < 5; i++) {
      state = submitGuess(state, RED_FILLER, ANSWER, catalog);
    }
    expect(state.status).toBe('lost');
    expect(state.endedAtGuess).toBe(5);
    expect(state.score).toBe(0); // nothing was ever green
    expect(state.guesses).toHaveLength(5);
  });
});

describe('submitGuess — win at each guess 1..5', () => {
  const WIN: SubmitGuessInput = toSubmitInput(guess('suzuki', 'suzuki-gsxr750', 2004), 'Suzuki', 'GSX-R750');

  it.each([1, 2, 3, 4, 5])('winning on guess %s scores 3 * (6 - guess)', (n) => {
    let state = initialState();
    for (let i = 0; i < n - 1; i++) {
      state = submitGuess(state, RED_FILLER, ANSWER, catalog);
    }
    state = submitGuess(state, WIN, ANSWER, catalog);
    expect(state.status).toBe('won');
    expect(state.endedAtGuess).toBe(n);
    expect(state.score).toBe(3 * (6 - n));
  });
});

describe('submitGuess — a 6th guess is rejected', () => {
  it('throws once the game has already ended at guess 5', () => {
    let state = initialState();
    for (let i = 0; i < 5; i++) {
      state = submitGuess(state, RED_FILLER, ANSWER, catalog);
    }
    expect(state.status).toBe('lost');
    expect(() => submitGuess(state, RED_FILLER, ANSWER, catalog)).toThrow();
  });

  it('throws once the game has already ended by a win', () => {
    let state = initialState();
    const win = toSubmitInput(guess('suzuki', 'suzuki-gsxr750', 2004), 'Suzuki', 'GSX-R750');
    state = submitGuess(state, win, ANSWER, catalog);
    expect(state.status).toBe('won');
    expect(() => submitGuess(state, RED_FILLER, ANSWER, catalog)).toThrow();
  });
});
