// "No puzzle today" (§7.4a: any date past the last fixture 404s) and practice/archive isolation
// (§4.6): playing an archived puzzle to a WIN must never write `motodle:stats` (§3.5, §4.6 --
// enforced by construction with a NullStatsSink, not an `if` at each call site).
//
// Clock pinned to NO_PUZZLE_DAY -- well past the last fixture (2026-09-04) -- so "today" has no
// puzzle file, and every fixture date is a valid `date < today` practice entry in the archive.
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
  // mode): guess 1 red/red/red, guess 2 green/red/yellow, guess 3 all-green win.
  const submit = page.locator('button[type="submit"]');
  // By id, not by role+accessible name: once the make locks, the input's aria-label changes to
  // "<Make> model" (§5.3), which would silently stop matching a name-based locator.
  const combo = page.locator('#mtd-guess');
  const year = page.getByRole('spinbutton');

  await combo.fill('Triumph Bonneville T120');
  await combo.press('Enter');
  await year.fill('1990');
  await submit.click();

  await combo.fill('Suzuki GT750');
  await combo.press('Enter');
  await year.fill('1999');
  await submit.click();

  // "suz gsxr750" is the unique match for GSX-R750 in the real seed catalog (§5.3's locked-make
  // filtering keeps the make token searchable even though the field shows "Suzuki" as a chip) --
  // see playthrough.spec.ts for why a shorter query like "suz gsx" is not unique here.
  await combo.fill('suz gsxr750');
  await expect(page.locator('#mtd-guess-listbox').getByRole('option')).toHaveCount(1);
  await page.locator('#mtd-guess-listbox').getByRole('option').first().click();
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
});
