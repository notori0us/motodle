// "No puzzle today" (§7.4a: any date past the last fixture 404s) and practice/archive isolation
// (§4.6): playing an archived puzzle to a WIN must never write `motodle:stats` (§3.5, §4.6 --
// `recordCompletion` has exactly one caller, `GameStore.onGameEnded()`, and that is where the
// practice guard lives).
//
// Clock pinned to NO_PUZZLE_DAY -- well past the last fixture (2026-09-04) -- so "today" has no
// puzzle file, and every fixture date is a valid `date < today` practice entry in the archive.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { closeHelpModal, localTime, NO_PUZZLE_DAY } from './helpers';

test('no puzzle today: the empty-state screen renders, and the archive lists only past dates', async ({ page }) => {
  await page.clock.install({ time: localTime(NO_PUZZLE_DAY) });
  await page.goto('/');

  // "No puzzle" is not the 'ok' path (§5.1), so the HelpModal never auto-opens here.
  await expect(page.getByRole('heading', { name: 'How to play' })).toHaveCount(0);
  await expect(page.getByText('No Motodle today. Check back tomorrow, or play a past puzzle.')).toBeVisible();

  await page.getByRole('button', { name: 'Play the archive' }).click();
  await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible();
  await expect(page.locator('a[href="?d=2026-09-02"]')).toContainText('Motodle #1');
  await expect(page.locator('a[href="?d=2026-09-03"]')).toContainText('Motodle #2');
  await expect(page.locator('a[href="?d=2026-09-04"]')).toContainText('Motodle #3');
  // Neither today (NO_PUZZLE_DAY, no puzzle anyway) nor any future date is ever offered.
  await expect(page.locator(`a[href="?d=${NO_PUZZLE_DAY}"]`)).toHaveCount(0);
});

test('practice mode: a full win against an archived puzzle never touches motodle:stats', async ({ page }) => {
  // Pre-existing stats (§3.5's StatsState shape) written before the app's first script runs, so
  // this proves practice mode never OVERWRITES real stats -- not merely that null stays null,
  // which the byte-identical check below would pass vacuously against an empty record.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'motodle:stats',
      JSON.stringify({
        schemaVersion: 1,
        played: 4,
        wins: 3,
        currentStreak: 2,
        maxStreak: 3,
        lastWinDate: '2026-09-01',
        lastCompletedDate: '2026-09-01',
        scoreDistribution: { '0': 0, '1': 0, '2': 1, '3': 0, '6': 0, '9': 2, '12': 1, '15': 0 },
      }),
    );
  });
  await page.clock.install({ time: localTime(NO_PUZZLE_DAY) });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play the archive' }).click();

  const statsBefore = await page.evaluate(() => window.localStorage.getItem('motodle:stats'));

  await page.locator('a[href="?d=2026-09-02"]').click(); // real navigation: ?d= is not SPA-routed
  await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible(); // fresh session
  await closeHelpModal(page);

  await expect(page.getByText(`Practice · Motodle #1`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to today' })).toBeVisible();

  // Same win sequence as the main playthrough spec (puzzle #1's answer is unaffected by practice
  // mode): guess 1 red/red/red, guess 2 green/red/yellow, guess 3 all-green win. Guesses are
  // entered with selectOption by catalog id (§5.3), never by typing.
  const submit = page.locator('button[type="submit"]');
  // By id, not by role+accessible name: once the make locks, the select's aria-label changes to
  // "Make — locked to {name}" (§5.3.3), which would silently stop matching a name-based locator.
  const makeSelect = page.locator('#mtd-make');
  const modelSelect = page.locator('#mtd-model');
  const year = page.getByRole('spinbutton');

  await makeSelect.selectOption('triumph');
  await modelSelect.selectOption('triumph-bonneville-t120');
  await year.fill('1990');
  await submit.click();

  await makeSelect.selectOption('suzuki');
  await modelSelect.selectOption('suzuki-gt750');
  await year.fill('1999');
  await submit.click();

  await modelSelect.selectOption('suzuki-gsxr750');
  await year.fill('2002');
  await submit.click();

  await expect(page.getByRole('heading', { name: 'You got it!' })).toBeVisible();
  await expect(page.getByText('(practice)')).toBeVisible();
  await expect(page.locator('.result-score strong')).toHaveText('9');

  const statsAfter = await page.evaluate(() => window.localStorage.getItem('motodle:stats'));
  expect(statsAfter).toBe(statsBefore); // byte-identical to the pre-existing seed -- not merely "still null"

  // The practice record itself DID persist, under its own separate key (§3.5, §4.6).
  const practiceRecord = await page.evaluate(() => window.localStorage.getItem('motodle:practice:2026-09-02'));
  expect(practiceRecord).not.toBeNull();
  expect(JSON.parse(practiceRecord as string).status).toBe('won');

  // ---- The credits view (§5.10.4), second (cheaper) leg -----------------------------------------
  // "Today" is still NO_PUZZLE_DAY, well past every committed puzzle, so EVERY puzzle in the
  // manifest is eligible -- newest first, CREDITS_PAGE_SIZE (20) per batch. Expectations are
  // derived from the committed manifest so scheduling more content never breaks this spec, and
  // paging through with "Show more" until it disappears exercises the batching for real.
  // Also exercises fixture #3's real, non-null creditNote (the only fixture that has one).
  await page.getByRole('button', { name: 'Close' }).click(); // close ResultModal
  await page.locator('#mtd-credits-link').click(); // footer entry point
  await expect(page.getByRole('heading', { name: 'Photo credits' })).toBeVisible();

  const manifest = JSON.parse(readFileSync(new URL('../public/puzzles/manifest.json', import.meta.url), 'utf8')) as {
    puzzles: { date: string }[];
  };
  const eligible = manifest.puzzles
    .map((p) => p.date)
    .filter((d) => d < NO_PUZZLE_DAY)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest first, as eligibleCreditDates() orders them
  const PAGE = 20; // CREDITS_PAGE_SIZE

  const creditRows = page.locator('[data-mtd-credit-row]');
  await expect(creditRows).toHaveCount(Math.min(PAGE, eligible.length));
  await expect(creditRows.nth(0)).toHaveAttribute('data-date', eligible[0]); // newest first
  await expect(creditRows.nth(1)).toHaveAttribute('data-date', eligible[1]);

  // Page through: "Show more" is present iff something is still unloaded, and vanishes at the end.
  for (let loaded = PAGE; loaded < eligible.length; loaded += PAGE) {
    await expect(page.locator('#mtd-credits-more')).toBeVisible();
    await page.locator('#mtd-credits-more').click();
    await expect(creditRows).toHaveCount(Math.min(loaded + PAGE, eligible.length));
  }
  await expect(page.locator('#mtd-credits-more')).toHaveCount(0);
  await expect(creditRows).toHaveCount(eligible.length);
  await expect(creditRows.last()).toHaveAttribute('data-date', '2026-09-02'); // #1, oldest

  const fixture3 = page.locator('[data-mtd-credit-row][data-date="2026-09-04"]');
  await expect(fixture3).toContainText('Motodle #3');
  await expect(fixture3).toContainText('1995 Ducati 916');
  await expect(page.getByText('Przemysław Jahr / Wikimedia Commons')).toBeVisible(); // fixture #3's creditNote
});
