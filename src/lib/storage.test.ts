import { describe, expect, it } from 'vitest';
import type { StorageBackend } from '../../schema/types';
import {
  KEY_SCHEMA,
  KEY_STATS,
  LocalStorageBackend,
  MemoryBackend,
  STORAGE_VERSION,
  applyMigrations,
  loadTodayState,
  loadVersioned,
  practiceKey,
  saveVersioned,
  touchPractice,
} from './storage';

// A backend whose every method throws — simulates Safari private mode / blocked site data.
class ThrowingBackend implements StorageBackend {
  get(): string | null {
    throw new Error('blocked');
  }
  set(): void {
    throw new Error('blocked');
  }
  remove(): void {
    throw new Error('blocked');
  }
  subscribe(): () => void {
    throw new Error('blocked');
  }
}

describe('MemoryBackend', () => {
  it('round-trips get/set/remove', () => {
    const backend = new MemoryBackend();
    expect(backend.get('k')).toBeNull();
    backend.set('k', 'v');
    expect(backend.get('k')).toBe('v');
    backend.remove('k');
    expect(backend.get('k')).toBeNull();
  });

  it('subscribe fires on set, with the written key', () => {
    const backend = new MemoryBackend();
    const seen: string[] = [];
    const unsubscribe = backend.subscribe((key) => seen.push(key));
    backend.set('motodle:stats', '{}');
    expect(seen).toEqual(['motodle:stats']);
    unsubscribe();
    backend.set('motodle:stats', '{}');
    expect(seen).toEqual(['motodle:stats']); // no further calls after unsubscribe
  });
});

describe('LocalStorageBackend (jsdom)', () => {
  it('round-trips through window.localStorage', () => {
    const backend = new LocalStorageBackend();
    backend.set('motodle:test', 'hello');
    expect(backend.get('motodle:test')).toBe('hello');
    backend.remove('motodle:test');
    expect(backend.get('motodle:test')).toBeNull();
  });

  it('subscribe fires for a "motodle:" key on a real StorageEvent (simulating another tab), and ignores foreign keys', () => {
    const backend = new LocalStorageBackend();
    const seen: string[] = [];
    const unsubscribe = backend.subscribe((key) => seen.push(key));
    window.dispatchEvent(new StorageEvent('storage', { key: 'motodle:stats', newValue: '{}' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'someOtherApp:thing', newValue: '{}' }));
    expect(seen).toEqual(['motodle:stats']);
    unsubscribe();
  });
});

describe('loadVersioned / saveVersioned — round-trip and key shape', () => {
  it('round-trips a saved value', () => {
    const backend = new MemoryBackend();
    saveVersioned(backend, KEY_STATS, { schemaVersion: STORAGE_VERSION, played: 3 });
    const loaded = loadVersioned(backend, KEY_STATS, { schemaVersion: STORAGE_VERSION, played: 0 });
    expect(loaded).toEqual({ schemaVersion: STORAGE_VERSION, played: 3 });
  });

  it('keys carry NO version segment — the literal key is "motodle:stats", not "motodle:v1:stats"', () => {
    const backend = new MemoryBackend();
    saveVersioned(backend, KEY_STATS, { schemaVersion: 1, played: 1 });
    expect(KEY_STATS).toBe('motodle:stats');
    expect(backend.get('motodle:stats')).not.toBeNull();
    expect(backend.get('motodle:v1:stats')).toBeNull();
  });

  it('corrupt JSON returns the fallback', () => {
    const backend = new MemoryBackend();
    backend.set(KEY_STATS, '{not valid json');
    const fallback = { schemaVersion: 1, played: 0 };
    expect(loadVersioned(backend, KEY_STATS, fallback)).toEqual(fallback);
  });

  it('valid JSON that is not an object (`null`, a number) returns the fallback rather than a non-record', () => {
    const backend = new MemoryBackend();
    const fallback = { schemaVersion: 1, played: 0 };
    backend.set(KEY_STATS, 'null');
    expect(loadVersioned(backend, KEY_STATS, fallback)).toEqual(fallback);
    backend.set(KEY_STATS, '42');
    expect(loadVersioned(backend, KEY_STATS, fallback)).toEqual(fallback);
  });

  it('a throwing backend (private mode) degrades to the fallback, never throws', () => {
    const backend = new ThrowingBackend();
    const fallback = { schemaVersion: 1, played: 0 };
    expect(() => loadVersioned(backend, KEY_STATS, fallback)).not.toThrow();
    expect(loadVersioned(backend, KEY_STATS, fallback)).toEqual(fallback);
    expect(() => saveVersioned(backend, KEY_STATS, { schemaVersion: 1, played: 5 })).not.toThrow();
  });

  it('a stored version NEWER than this code returns the fallback and does NOT delete the raw value', () => {
    const backend = new MemoryBackend();
    const future = { schemaVersion: 99, played: 7 };
    backend.set(KEY_STATS, JSON.stringify(future));
    const fallback = { schemaVersion: 1, played: 0 };
    expect(loadVersioned(backend, KEY_STATS, fallback)).toEqual(fallback);
    expect(JSON.parse(backend.get(KEY_STATS)!)).toEqual(future); // untouched
  });
});

describe('applyMigrations — MIGRATIONS[v] runs v -> v+1 in ascending order', () => {
  it('chains multiple steps in order', () => {
    const migrations = {
      1: (raw: unknown) => ({ ...(raw as object), schemaVersion: 2, stepsApplied: ['1->2'] }),
      2: (raw: unknown) => ({ ...(raw as any), schemaVersion: 3, stepsApplied: [...(raw as any).stepsApplied, '2->3'] }),
    };
    const result = applyMigrations({ schemaVersion: 1, played: 5 }, 1, 3, migrations) as any;
    expect(result.schemaVersion).toBe(3);
    expect(result.stepsApplied).toEqual(['1->2', '2->3']);
  });

  it('throws when a step in the chain is missing (caller falls back)', () => {
    expect(() => applyMigrations({ schemaVersion: 1 }, 1, 3, { 1: (r) => r })).toThrow();
  });

  it('no-op when storedVersion already equals targetVersion', () => {
    const raw = { schemaVersion: 1, played: 5 };
    expect(applyMigrations(raw, 1, 1, {})).toBe(raw);
  });
});

describe('loadVersioned — a v1 payload is found and migrated by hypothetical "v2 code"', () => {
  it('migrates via targetVersion/migrations overrides, and rewrites motodle:schema ONLY after a full successful pass', () => {
    const backend = new MemoryBackend();
    backend.set(KEY_STATS, JSON.stringify({ schemaVersion: 1, played: 3 }));
    expect(backend.get(KEY_SCHEMA)).toBeNull(); // not yet touched

    const migrations = { 1: (raw: unknown) => ({ ...(raw as object), schemaVersion: 2, newField: 'x' }) };
    const loaded = loadVersioned(backend, KEY_STATS, { schemaVersion: 2, played: 0, newField: '' }, { targetVersion: 2, migrations });

    expect(loaded).toEqual({ schemaVersion: 2, played: 3, newField: 'x' });
    expect(JSON.parse(backend.get(KEY_STATS)!)).toEqual({ schemaVersion: 2, played: 3, newField: 'x' }); // record rewritten
    expect(backend.get(KEY_SCHEMA)).toBe('2'); // schema flag bumped only now, after success
  });

  it('does NOT rewrite motodle:schema when the migration chain fails partway', () => {
    const backend = new MemoryBackend();
    backend.set(KEY_STATS, JSON.stringify({ schemaVersion: 1, played: 3 }));
    const throwingMigration = {
      1: () => {
        throw new Error('migration bug');
      },
    };
    const fallback = { schemaVersion: 2, played: 0 };
    const loaded = loadVersioned(backend, KEY_STATS, fallback, { targetVersion: 2, migrations: throwingMigration });
    expect(loaded).toEqual(fallback);
    expect(backend.get(KEY_SCHEMA)).toBeNull(); // never bumped
    // the raw stored value is also untouched
    expect(JSON.parse(backend.get(KEY_STATS)!)).toEqual({ schemaVersion: 1, played: 3 });
  });
});

describe('loadTodayState — §4.5 rollover: a stored record for a different date is discarded, never resumed', () => {
  it('returns the stored record when its date matches today', () => {
    const backend = new MemoryBackend();
    const today = { schemaVersion: 1, date: '2026-09-02', number: 1, puzzleId: 'mtd-0001', status: 'in_progress' as const, guesses: [], locks: { makeId: null, modelId: null, year: null }, viewLevel: 1, endedAtGuess: null, score: null };
    saveVersioned(backend, 'motodle:today', today);
    const fallback = { ...today, date: 'FALLBACK' };
    expect(loadTodayState(backend, '2026-09-02', fallback)).toEqual(today);
  });

  it('discards a stored record for a DIFFERENT date and returns the fallback', () => {
    const backend = new MemoryBackend();
    const stale = { schemaVersion: 1, date: '2026-09-02', number: 1, puzzleId: 'mtd-0001', status: 'won' as const, guesses: [], locks: { makeId: 'suzuki', modelId: 'suzuki-gsxr750', year: 2004 }, viewLevel: 5, endedAtGuess: 3, score: 9 };
    saveVersioned(backend, 'motodle:today', stale);
    const fallback = { schemaVersion: 1, date: '2026-09-03', number: 2, puzzleId: 'mtd-0002', status: 'in_progress' as const, guesses: [], locks: { makeId: null, modelId: null, year: null }, viewLevel: 1, endedAtGuess: null, score: null };
    expect(loadTodayState(backend, '2026-09-03', fallback)).toEqual(fallback);
  });
});

describe('touchPractice — practice records prune to 30, oldest evicted first', () => {
  it('the 31st distinct touched date evicts the 1st (oldest)', () => {
    const backend = new MemoryBackend();
    const dates = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    for (const date of dates) {
      backend.set(practiceKey(date), JSON.stringify({ schemaVersion: 1, date }));
      touchPractice(backend, date);
    }
    expect(backend.get(practiceKey(dates[0]))).toBeNull(); // oldest evicted
    expect(backend.get(practiceKey(dates[1]))).not.toBeNull(); // 2nd-oldest survives (30 kept)
    expect(backend.get(practiceKey(dates[30]))).not.toBeNull(); // newest survives
  });

  it('re-touching an existing date refreshes it as most-recent and does not cause an extra eviction', () => {
    const backend = new MemoryBackend();
    const dates = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    for (const date of dates) {
      backend.set(practiceKey(date), JSON.stringify({ schemaVersion: 1, date }));
      touchPractice(backend, date);
    }
    // Re-touch the OLDEST date — it should move to "most recent" and survive the next insert.
    touchPractice(backend, dates[0]);
    const newDate = '2026-02-01';
    backend.set(practiceKey(newDate), JSON.stringify({ schemaVersion: 1, date: newDate }));
    touchPractice(backend, newDate);

    expect(backend.get(practiceKey(dates[0]))).not.toBeNull(); // refreshed, survives
    expect(backend.get(practiceKey(dates[1]))).toBeNull(); // now the oldest-untouched, evicted
  });
});
