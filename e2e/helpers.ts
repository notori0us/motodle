/**
 * Shared plumbing for the §7.4 scripted-playthrough specs. No test logic lives here — only setup
 * every spec repeats (clock pinning dates, the share stub, the help-modal dismissal).
 *
 * `SITE_URL` is imported from `src/config.ts`, never re-typed (§4.4's rule for `share.test.ts`
 * applies just as much here — a domain change must stay a one-line config edit, not a grep
 * across e2e/**).
 */
import type { Page } from '@playwright/test';
export { SITE_URL } from '../src/config';

/** The three committed fixtures (§7.4a) — Suzuki GSX-R750 / Kawasaki Ninja ZX-6R / Ducati 916. */
export const DAY1 = '2026-09-02';
export const DAY2 = '2026-09-03';
export const DAY3 = '2026-09-04';
/** A date guaranteed to postdate every committed fixture and any near-term puzzle the operator
 *  schedules, so the client 404s into the "no puzzle today" screen (§7.4a) for the life of this
 *  repo. Deliberately NOT LAUNCH_DATE + 3 (2026-09-05) -- that is `tools/schedule.ts`'s own CLI
 *  example `--start` date, so the operator's first real scheduling run would silently flip this
 *  spec from "no puzzle exists" to "puzzle exists but is mocked away", a false pass. */
export const NO_PUZZLE_DAY = '2099-01-01';

/** A local wall-clock Date for `page.clock.install`/`pauseAt` — no `Z` suffix, matching
 *  `todayKey()`'s local-date semantics (§4.1, §7.4a: a `Z` suffix would put half the planet on
 *  the previous day). */
export function localTime(date: string, time = '12:00:00'): Date {
  return new Date(`${date}T${time}`);
}

/** Stubs `navigator.share` away so the `ShareSink` ladder's clipboard branch is the one
 *  exercised (§7.4 step 7, §4.4). Must be installed before the page's first script runs. */
export async function stubNavigatorShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
  });
}

/** Dismisses the first-visit HelpModal, which auto-opens whenever `prefs.seenHelp` is unset
 *  (§5.1) — true at the start of every test, since each Playwright test gets a fresh, isolated
 *  browser context (fresh localStorage) by default. */
export async function closeHelpModal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Got it' }).click();
}
