/**
 * StorageBackend + versioned read/write + migration hook (§3.5). Everything in `src/` reads
 * storage ONLY through the injected `StorageBackend` — that single seam is the entire
 * login/sync hook (§9.1).
 *
 * Namespace `motodle:` — nothing unprefixed.
 */
import type { StorageBackend, TodayState } from '../../schema/types';

export const STORAGE_VERSION = 1;

export const KEY_SCHEMA = 'motodle:schema';
export const KEY_TODAY = 'motodle:today';
export const KEY_STATS = 'motodle:stats';
export const KEY_PREFS = 'motodle:prefs';

export function practiceKey(date: string): string {
  return `motodle:practice:${date}`;
}

// -------------------------------------------------------------------------------------------
// Versioned read/write + migration hook.
//
// The version lives in exactly one place conceptually (§3.5) — but with no `keys()`/`list()` on
// `StorageBackend`, a global "migrate every key, THEN bump the flag" orchestrator can't discover
// every `motodle:practice:<date>` key that might exist. So the AUTHORITATIVE per-record signal
// is each record's own mirrored `schemaVersion` field (present exactly because §3.5 mirrors it
// there); `motodle:schema` is written best-effort alongside every successful save/migration as a
// cheap top-level indicator, never relied on as the sole source of truth for whether any single
// record needs migrating. This keeps every key's migration independently correct regardless of
// read order or which keys happen to exist yet.
// -------------------------------------------------------------------------------------------

export type Migration = (raw: unknown) => unknown;

/** MIGRATIONS[v] migrates a v payload to v+1. Keys never carry a version, so a v1 payload is
 *  still sitting at `motodle:stats` when v2 code reads it. Empty at schema version 1 — add an
 *  entry here the day `STORAGE_VERSION` bumps to 2. */
const MIGRATIONS: Record<number, Migration> = {
  /* 1: (raw) => …  add on bump */
};

export interface LoadVersionedOptions {
  /** Overrides for testing the migration RUNNER against a hypothetical future version, without
   *  needing to fake the module-level `STORAGE_VERSION` (there are no real migrations yet). */
  targetVersion?: number;
  migrations?: Record<number, Migration>;
}

/** Applies `migrations[v]` for v = storedVersion .. targetVersion-1, in ascending order. Throws
 *  if a step in the chain is missing (the caller catches and falls back). */
export function applyMigrations(
  raw: unknown,
  storedVersion: number,
  targetVersion: number,
  migrations: Record<number, Migration>,
): unknown {
  let data = raw;
  for (let v = storedVersion; v < targetVersion; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`storage: no migration registered for v${v} -> v${v + 1}`);
    data = step(data);
  }
  return data;
}

/**
 * Reads and, if needed, migrates the record at `key`. Every failure mode — a throwing backend
 * (private mode / blocked site data), corrupt JSON, a stored version NEWER than this code, or a
 * broken migration chain — degrades to `fallback` and leaves the raw stored value untouched
 * (a newer deployed client's data must never be destroyed by an older bundle).
 */
export function loadVersioned<T>(
  backend: StorageBackend,
  key: string,
  fallback: T,
  opts: LoadVersionedOptions = {},
): T {
  const targetVersion = opts.targetVersion ?? STORAGE_VERSION;
  const migrations = opts.migrations ?? MIGRATIONS;

  let raw: string | null;
  try {
    raw = backend.get(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (parsed === null || typeof parsed !== 'object') return fallback; // `null`/`42` are corrupt, not records

  const mirrored = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;
  const storedVersion = typeof mirrored === 'number' ? mirrored : targetVersion;
  if (storedVersion > targetVersion) return fallback; // newer client wrote this; do not touch it
  if (storedVersion === targetVersion) return parsed as T;

  let migrated: unknown;
  try {
    migrated = applyMigrations(parsed, storedVersion, targetVersion, migrations);
  } catch {
    return fallback;
  }

  try {
    backend.set(key, JSON.stringify(migrated));
    backend.set(KEY_SCHEMA, String(targetVersion));
  } catch {
    // best-effort — still hand back the migrated value for this session
  }

  return migrated as T;
}

/** Writes `value` (which must already carry the current `schemaVersion`) and best-effort bumps
 *  the top-level `motodle:schema` indicator. Failures (quota, private mode) are swallowed —
 *  storage degrades to an in-memory session, never a crash. */
export function saveVersioned<T extends { schemaVersion: number }>(
  backend: StorageBackend,
  key: string,
  value: T,
): void {
  try {
    backend.set(key, JSON.stringify(value));
    backend.set(KEY_SCHEMA, String(STORAGE_VERSION));
  } catch {
    // ignore
  }
}

/** `motodle:today` (§4.5 rollover): if the stored record's `date` isn't today's, it is
 *  DISCARDED outright — it was either finished (stats already recorded at completion) or
 *  abandoned (counts as nothing) — never migrated or resumed into today. */
export function loadTodayState(backend: StorageBackend, todayDateKey: string, fallback: TodayState): TodayState {
  const stored = loadVersioned<TodayState>(backend, KEY_TODAY, fallback);
  if (stored.date !== todayDateKey) return fallback;
  return stored;
}

// -------------------------------------------------------------------------------------------
// Practice record pruning (§3.5): "pruned to the 30 most recently touched records, oldest date
// evicted first". Self-tracked via a small index key (touch order) rather than relying on
// enumerating `motodle:practice:*` keys, which `StorageBackend` has no way to do.
// -------------------------------------------------------------------------------------------

const PRACTICE_INDEX_KEY = 'motodle:practice:_index';
const PRACTICE_LIMIT = 30;

/** Marks `date` as just-touched (moves it to most-recent), evicting the oldest touched date(s)
 *  past `PRACTICE_LIMIT`. Call before writing `motodle:practice:<date>`. */
export function touchPractice(backend: StorageBackend, date: string): void {
  let order: string[];
  try {
    const raw = backend.get(PRACTICE_INDEX_KEY);
    order = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    order = [];
  }
  order = order.filter((d) => d !== date);
  order.push(date); // most-recently-touched at the end

  while (order.length > PRACTICE_LIMIT) {
    const evicted = order.shift();
    if (evicted !== undefined) {
      try {
        backend.remove(practiceKey(evicted));
      } catch {
        // best-effort
      }
    }
  }

  try {
    backend.set(PRACTICE_INDEX_KEY, JSON.stringify(order));
  } catch {
    // best-effort
  }
}

// -------------------------------------------------------------------------------------------
// Backends (§3.5, §9.1).
// -------------------------------------------------------------------------------------------

export class LocalStorageBackend implements StorageBackend {
  get(key: string): string | null {
    return window.localStorage.getItem(key);
  }
  set(key: string, value: string): void {
    window.localStorage.setItem(key, value);
  }
  remove(key: string): void {
    window.localStorage.removeItem(key);
  }
  /** Cross-tab today, cross-device later (§9.1). Native `storage` events only fire in OTHER
   *  tabs/windows, never the one that made the write — that is correct, not a bug to fix here. */
  subscribe(fn: (key: string) => void): () => void {
    const handler = (e: StorageEvent) => {
      if (e.key !== null && e.key.startsWith('motodle:')) fn(e.key);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}

/** Used by tests and by private mode (when `LocalStorageBackend` throws on every call). */
export class MemoryBackend implements StorageBackend {
  private store = new Map<string, string>();
  private listeners = new Set<(key: string) => void>();

  get(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
    for (const fn of this.listeners) fn(key);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
  subscribe(fn: (key: string) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
