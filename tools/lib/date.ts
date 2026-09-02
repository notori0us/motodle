/**
 * `tools/lib/date.ts` — puzzle-number arithmetic (§4.1), reproduced VERBATIM from the frozen
 * algorithm in PLAN.md. Not imported from `src/lib/date.ts` — that file belongs to W3 and may
 * not exist while W2 runs (streams run in parallel, §8). This mirrors the precedent set by
 * `schema/puzzle-contracts.test.ts` (W1), which inlines the same formula for the same reason.
 * `LAUNCH_DATE`/`PUZZLE_NUMBER_OFFSET` themselves are plain data, safe to import from
 * `schema/constants.ts` (a shared, no-runtime-deps file) — only the ALGORITHM is duplicated,
 * which is exactly what carries drift risk and exactly what §7.2 #10's sibling test (for
 * normalize/match, not date) exists to catch for the other frozen function.
 */
import { LAUNCH_DATE, PUZZLE_NUMBER_OFFSET } from '../../schema/constants';

/** Days between two local calendar dates via Date.UTC on the LOCAL y/m/d components — DST-proof. */
export function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function puzzleNumber(key: string): number {
  return dayIndex(key) - dayIndex(LAUNCH_DATE) + PUZZLE_NUMBER_OFFSET;
}

/** `mtd-${String(number).padStart(4,'0')}` — the one place tools/ mints a puzzle id (§6.3). */
export function puzzleId(number: number): string {
  return `mtd-${String(number).padStart(4, '0')}`;
}

/** `key` plus `n` local calendar days, via the same DST-proof `Date.UTC`-on-local-components
 *  trick as `dayIndex`. Used by `tools/schedule.ts` to lay approved candidates onto consecutive
 *  dates starting at `--start`. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Today's LOCAL calendar date, `YYYY-MM-DD` — reproduced from §4.1's `todayKey()` for the same
 *  reason the rest of this file reproduces the frozen date algorithms (W3's `src/lib/date.ts`
 *  does not exist while W2 runs). Only used for `yearEvidence.approvedOn` when `tools/schedule.ts`
 *  is actually run by an operator — never read by the offline `tools/generate.ts` path, which
 *  copies `approvedOn` verbatim from `fixtures/fixtures.json` instead. */
export function localToday(d = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
