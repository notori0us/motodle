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
