/**
 * Store-level tests for `GameStore` — the wiring between `src/lib/**` and storage that no pure
 * unit test can see. Boots real stores against the committed fixture data (fetch stubbed, like
 * `App.test.ts`), pinned to `?today=2026-09-02` via the DEV-only clock override (§7.4a).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsState } from '../../schema/types';
import type { SubmitGuessInput } from '../lib/game';
import { KEY_STATS, MemoryBackend, loadVersioned } from '../lib/storage';
import { createInitialStats } from '../lib/stats';
import { GameStore } from './game.svelte';

const ROOT = resolve(__dirname, '../..');
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'public/catalog.json'), 'utf-8'));
const puzzle = JSON.parse(readFileSync(resolve(ROOT, 'public/puzzles/2026-09-02.json'), 'utf-8'));

function jsonResponse(data: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => data };
}

/** Puzzle #1's answer (2004 Suzuki GSX-R750) — an instant win on guess 1. */
const WIN: SubmitGuessInput = { makeId: 'suzuki', modelId: 'suzuki-gsxr750', make: 'Suzuki', model: 'GSX-R750', year: 2004 };
/** Red/red/red against puzzle #1 (Triumph Bonneville T120 [1959,1974], year 1990). */
const MISS: SubmitGuessInput = {
  makeId: 'triumph',
  modelId: 'triumph-bonneville-t120',
  make: 'Triumph',
  model: 'Bonneville T120',
  year: 1990,
};

describe('GameStore', () => {
  const stores: GameStore[] = [];

  beforeEach(() => {
    window.history.pushState({}, '', '/?today=2026-09-02');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('catalog.json')) return jsonResponse(catalog);
        if (url.includes('2026-09-02.json')) return jsonResponse(puzzle);
        return jsonResponse(null, 404);
      }),
    );
  });

  afterEach(() => {
    for (const s of stores.splice(0)) s.dispose();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  async function boot(backend: MemoryBackend): Promise<GameStore> {
    const store = new GameStore(backend);
    stores.push(store);
    await store.init();
    expect(store.screen).toBe('game');
    return store;
  }

  it('two tabs finishing the same day count ONE completion (§4.3 idempotency, via a re-read before recording)', async () => {
    const backend = new MemoryBackend();
    const tabA = await boot(backend);
    const tabB = await boot(backend); // both booted before either finished — each holds a fresh stats snapshot

    tabA.submitGuess(WIN);
    tabB.submitGuess(WIN);

    const stored = loadVersioned<StatsState>(backend, KEY_STATS, createInitialStats());
    expect(stored.played).toBe(1);
    expect(stored.wins).toBe(1);
    expect(stored.currentStreak).toBe(1);
    expect(tabB.stats.played).toBe(1); // tab B's in-memory copy agrees with what it wrote
  });

  it('snaps viewLevel to the unlocked level after every guess, and to 5 once the game has ended (§5.5)', async () => {
    const store = await boot(new MemoryBackend());
    expect(store.today.viewLevel).toBe(1);
    store.submitGuess(MISS);
    expect(store.unlockedLevel).toBe(2);
    expect(store.today.viewLevel).toBe(2);
    store.setViewLevel(1); // scrub back
    expect(store.today.viewLevel).toBe(1);
    store.submitGuess(WIN); // win on guess 2 -> everything unlocks
    expect(store.today.status).toBe('won');
    expect(store.unlockedLevel).toBe(5);
    expect(store.today.viewLevel).toBe(5);
  });

  it('give-up also unlocks and shows the widest level', async () => {
    const store = await boot(new MemoryBackend());
    store.giveUp();
    expect(store.today.status).toBe('lost');
    expect(store.today.viewLevel).toBe(5);
  });
});

describe('GameStore credits (§5.10.4)', () => {
  const stores: GameStore[] = [];
  const puzzle3 = JSON.parse(readFileSync(resolve(ROOT, 'public/puzzles/2026-09-03.json'), 'utf-8'));
  const puzzle4 = JSON.parse(readFileSync(resolve(ROOT, 'public/puzzles/2026-09-04.json'), 'utf-8'));
  // 2026-09-01 is listed in the manifest but was never shipped (404) — proves the "skipped
  // silently, still counts toward loadedCount" rule (§5.10.4).
  const manifest = {
    schema: 1,
    launchDate: '2026-09-02',
    latest: { date: '2026-09-04', number: 3 },
    puzzles: [
      { date: '2026-09-01', number: 0, id: 'mtd-0000' },
      { date: '2026-09-02', number: 1, id: 'mtd-0001' },
      { date: '2026-09-03', number: 2, id: 'mtd-0002' },
      { date: '2026-09-04', number: 3, id: 'mtd-0003' },
    ],
  };

  let fetchCalls: string[] = [];

  beforeEach(() => {
    fetchCalls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('catalog.json')) return jsonResponse(catalog);
        if (url.includes('manifest.json')) return jsonResponse(manifest);
        if (url.includes('2026-09-01.json')) {
          fetchCalls.push(url);
          return jsonResponse(null, 404);
        }
        if (url.includes('2026-09-02.json')) {
          fetchCalls.push(url);
          return jsonResponse(puzzle);
        }
        if (url.includes('2026-09-03.json')) {
          fetchCalls.push(url);
          return jsonResponse(puzzle3);
        }
        if (url.includes('2026-09-04.json')) {
          fetchCalls.push(url);
          return jsonResponse(puzzle4);
        }
        return jsonResponse(null, 404);
      }),
    );
  });

  afterEach(() => {
    for (const s of stores.splice(0)) s.dispose();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('openCredits() issues exactly min(20, eligible.length) requests; a 404 day contributes no row and no error; re-opening issues zero further requests', async () => {
    window.history.pushState({}, '', '/?today=2026-09-05'); // past every fixture -> all 4 manifest days are eligible
    const store = new GameStore(new MemoryBackend());
    stores.push(store);
    await store.init(); // no puzzle scheduled for 09-05, but that's irrelevant to the credits view

    await store.openCredits();
    expect(store.creditsStatus).toBe('ready');
    // Newest first; 2026-09-01 (404) is skipped silently — no row, no error.
    expect(store.credits.map((r) => r.date)).toEqual(['2026-09-04', '2026-09-03', '2026-09-02']);
    expect(store.creditsHasMore).toBe(false);
    expect(fetchCalls).toHaveLength(4); // min(20, eligible.length = 4)

    fetchCalls.length = 0;
    await store.openCredits(); // re-open: same 4 dates, every one now in the puzzleCache
    expect(fetchCalls).toHaveLength(0);
    expect(store.credits).toHaveLength(3);
  });

  it("today's own row unlocks only once the REAL game finishes — a practice win for an old date does not do it (§5.10.4)", async () => {
    const backend = new MemoryBackend();
    const ducatiWin: SubmitGuessInput = {
      makeId: 'ducati',
      modelId: 'ducati-916',
      make: 'Ducati',
      model: '916',
      year: 1995,
    };

    // A practice tab plays an OLD date (2026-09-02) to a win while "today" is 2026-09-04.
    window.history.pushState({}, '', '/?today=2026-09-04&d=2026-09-02');
    const practiceTab = new GameStore(backend);
    stores.push(practiceTab);
    await practiceTab.init();
    expect(practiceTab.isPractice).toBe(true);
    practiceTab.submitGuess(WIN);
    expect(practiceTab.today.status).toBe('won');

    // The REAL tab for "today" (2026-09-04), still in progress.
    window.history.pushState({}, '', '/?today=2026-09-04');
    const realTab = new GameStore(backend);
    stores.push(realTab);
    await realTab.init();
    expect(realTab.isPractice).toBe(false);
    expect(realTab.today.status).toBe('in_progress');

    await realTab.openCredits();
    // The practice win (a different storage key entirely) must not unlock today's row.
    expect(realTab.credits.map((r) => r.date)).not.toContain('2026-09-04');

    realTab.submitGuess(ducatiWin); // finishes the REAL game for real
    expect(realTab.today.status).toBe('won');

    await realTab.openCredits();
    expect(realTab.credits[0].date).toBe('2026-09-04'); // newest first, now unlocked
  });
});
