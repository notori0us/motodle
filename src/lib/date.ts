/**
 * Local date keys and DST-proof puzzle-number arithmetic (§4.1). Pure. No DOM.
 */
import { LAUNCH_DATE, PUZZLE_NUMBER_OFFSET } from '../../schema/constants';

/** Local calendar date -> 'YYYY-MM-DD'. Never uses toISOString (that is UTC). */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Days between two local calendar dates. Uses Date.UTC on the LOCAL y/m/d components parsed out
 * of the key string, which removes DST entirely — no 23h or 25h day can shift the count.
 * Exported (the §4.1 pseudocode omits `export`, but §4.3's `recordCompletion` — a different
 * module, `stats.ts` — calls `dayIndex(puzzle.date)` too; exporting it here is the only way to
 * give stats.ts that function without a second, drift-prone implementation).
 */
export function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function puzzleNumber(key: string): number {
  return dayIndex(key) - dayIndex(LAUNCH_DATE) + PUZZLE_NUMBER_OFFSET;
}

/** Local midnight of the day AFTER `d`. Drives the stats-modal countdown (§4.5). */
export function nextLocalMidnight(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

/** Milliseconds from `d` until `nextLocalMidnight(d)`. Convenience for the 1 Hz countdown. */
export function msUntilNextLocalMidnight(d: Date = new Date()): number {
  return nextLocalMidnight(d).getTime() - d.getTime();
}
