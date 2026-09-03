/**
 * §5.10.4: the photo-credits spoiler filter and batching. Pure, no DOM, no fetch — the ONE place
 * the "which days may show their answer" rule lives (same discipline as tile-colour evaluation,
 * §4.2/§5.2: no component re-derives it).
 */
import type { CreditBlock, Manifest } from '../../schema/types';

export interface CreditRow {
  number: number;
  date: string;
  id: string;
  year: number;
  make: string;
  model: string;
  credit: CreditBlock;
}

/** Batch size for `nextCreditBatch` — a year of puzzles costs 20 requests on open, not 365. */
export const CREDITS_PAGE_SIZE = 20;

/**
 * Dates whose credits may be shown, newest first: strictly before `todayDateKey`, plus
 * `todayDateKey` itself only when `todayFinished` is true. Never a future date, under any
 * circumstance. `todayFinished` must be computed against the REAL today state (never practice) —
 * see `GameStore`'s use of this function.
 */
export function eligibleCreditDates(manifest: Manifest, todayDateKey: string, todayFinished: boolean): string[] {
  return manifest.puzzles
    .filter((p) => p.date < todayDateKey || (p.date === todayDateKey && todayFinished))
    .map((p) => p.date)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first
}

/** The next slice of `eligible` to fetch, starting at `loadedCount`, at most CREDITS_PAGE_SIZE
 *  long. Empty once everything has been loaded. */
export function nextCreditBatch(eligible: string[], loadedCount: number): string[] {
  return eligible.slice(loadedCount, loadedCount + CREDITS_PAGE_SIZE);
}
