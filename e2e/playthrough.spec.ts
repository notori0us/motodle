// Scripted win playthrough (§7.4 steps 1-9) against puzzle #1 (2026-09-02, Suzuki GSX-R750,
// answer year 2004). Clock pinned per §7.4a — this spec never reads the real date.
//
//   Guess 1: Triumph Bonneville T120 (GB, [1959,1974]), year 1990 (14 off)
//            -> make RED (different country), model RED (range excludes 2004), year RED (>10 off)
//   Guess 2: Suzuki GT750 (JP, [1971,1977]), year 1999 (5 off)
//            -> make GREEN (exact), model RED (range excludes 2004, not yellow -- picking a
//               still-current Suzuki would flip this to yellow), year YELLOW (<=10 off)
//   Guess 3: Suzuki GSX-R750, year 2002 (2 off)
//            -> make GREEN (locked), model GREEN, year GREEN (<=2 off) -> WIN on guess 3
//
// points = 3 (all three locked green), multiplier = 6-3 = 3, score = 9.
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime, SITE_URL, stubNavigatorShare } from './helpers';

const EXPECTED_SHARE_TEXT = [
  'Motodle #1 9/15',
  '',
  '🟥🟥🟥\n🟩🟥🟨\n🟩🟩🟩',
  '',
  SITE_URL,
].join('\n');

test.describe('win playthrough', () => {
  test('full round: tile colours, locking, combobox filtering, score, share text, stats, reload', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubNavigatorShare(page);
    await page.clock.install({ time: localTime(DAY1) });

    // ---- 1. First visit: HelpModal auto-opens -> close. ----------------------------------------
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();
    await closeHelpModal(page);

    // ---- 2. Puzzle #1 loads; level 1 shown; scrub-forward disabled. ---------------------------
    const submit = page.locator('button[type="submit"]');
    await expect(submit).toHaveText('Guess 1 of 5');
    await expect(page.getByRole('button', { name: 'Crop level 1 of 5' })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: 'Crop level 2 of 5' })).toBeDisabled();

    // By id, not by role+accessible name: once the make locks, the input's aria-label changes
    // to "<Make> model" (§5.3), which would silently stop matching a name-based locator.
    const combo = page.locator('#mtd-guess');
    const year = page.getByRole('spinbutton');

    // ---- 3. Guess 1: red/red/red; image advances to level 2; scrub back/forward. --------------
    await combo.fill('Triumph Bonneville T120');
    await combo.press('Enter');
    await year.fill('1990');
    await submit.click();

    const row1 = page.locator('.scoreboard__row').nth(0);
    await expect(row1.locator('[data-color]').nth(0)).toHaveAttribute('data-color', 'red');
    await expect(row1.locator('[data-color]').nth(1)).toHaveAttribute('data-color', 'red');
    await expect(row1.locator('[data-color]').nth(2)).toHaveAttribute('data-color', 'red');

    await expect(page.getByRole('button', { name: 'Crop level 2 of 5' })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('button', { name: 'Crop level 3 of 5' })).toBeDisabled();

    await page.getByRole('button', { name: 'Crop level 1 of 5' }).click();
    await expect(page.getByRole('button', { name: 'Crop level 1 of 5' })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Crop level 2 of 5' }).click();
    await expect(page.getByRole('button', { name: 'Crop level 2 of 5' })).toHaveAttribute('aria-current', 'true');

    // ---- 4. Guess 2: correct make, wrong (off-sale) model, year 5 off -> green/red/yellow. -----
    await expect(submit).toHaveText('Guess 2 of 5');
    await combo.fill('Suzuki GT750');
    await combo.press('Enter');
    await year.fill('1999');
    await submit.click();

    const row2 = page.locator('.scoreboard__row').nth(1);
    await expect(row2.locator('[data-color]').nth(0)).toHaveAttribute('data-color', 'green');
    await expect(row2.locator('[data-color]').nth(1)).toHaveAttribute('data-color', 'red');
    await expect(row2.locator('[data-color]').nth(2)).toHaveAttribute('data-color', 'yellow');

    // Make locked: chip appears, combobox is filtered to Suzuki only.
    await expect(page.locator('.make-chip')).toHaveText('Suzuki');
    await expect(combo).toHaveAttribute('aria-label', 'Suzuki model');

    const listbox = page.locator('#mtd-guess-listbox');
    await combo.fill('triumph');
    await expect(listbox.getByRole('option')).toHaveCount(0); // foreign make: no options

    // The catalog's real seed has several Suzuki GSX* models, so "suz gsx" -- the plan's own
    // example query -- surfaces several candidates, not one; the point it proves (§5.3) is that
    // the "suz" MAKE token still matches even though the field is filtered to Suzuki only, and
    // GSX-R750 is among the results, shown model-only ("GSX-R750", not "Suzuki GSX-R750").
    await combo.fill('suz gsx');
    await expect(listbox.getByRole('option')).not.toHaveCount(0);
    await expect(listbox.getByRole('option', { name: 'GSX-R750', exact: true })).toBeVisible();

    // ---- 5. Guess 3: refine to a unique match, chosen with ArrowDown+Enter, year 2 off -> win. -
    await combo.fill('suz gsxr750');
    await expect(listbox.getByRole('option')).toHaveCount(1);
    await combo.press('ArrowDown');
    await combo.press('Enter');
    await expect(combo).toHaveValue('GSX-R750');
    await year.fill('2002');
    await expect(submit).toHaveText('Guess 3 of 5');
    await submit.click();

    const row3 = page.locator('.scoreboard__row').nth(2);
    await expect(row3.locator('[data-color]').nth(0)).toHaveAttribute('data-color', 'green');
    await expect(row3.locator('[data-color]').nth(1)).toHaveAttribute('data-color', 'green');
    await expect(row3.locator('[data-color]').nth(2)).toHaveAttribute('data-color', 'green');

    // ---- 6. ResultModal opens; score reads 9 (3 points x multiplier 3). -----------------------
    await expect(page.getByRole('heading', { name: 'You got it!' })).toBeVisible();
    await expect(page.getByText('3 × 3')).toBeVisible();
    await expect(page.locator('.result-score strong')).toHaveText('9');

    // ---- 7. Share (from the still-open ResultModal) -> clipboard equals the exact §4.4 string. -
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('status')).toHaveText('Copied to clipboard');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(EXPECTED_SHARE_TEXT);
    await page.getByRole('button', { name: 'Close' }).click(); // close ResultModal

    // ---- 8. Stats modal: played 1, win 100%, streak 1, the 9 bucket highlighted. ---------------
    await page.getByRole('button', { name: 'Statistics' }).click();
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
    const summary = page.locator('.stats-summary strong');
    await expect(summary.nth(0)).toHaveText('1'); // played
    await expect(summary.nth(1)).toHaveText('100'); // win %
    await expect(summary.nth(2)).toHaveText('1'); // current streak
    await expect(summary.nth(3)).toHaveText('1'); // max streak

    const bucket9 = page
      .locator('.distribution__row')
      .filter({ has: page.locator('.distribution__label', { hasText: '9' }) });
    await expect(bucket9.locator('.distribution__bar')).toHaveClass(/distribution__bar--highlight/);
    await expect(bucket9.locator('.distribution__bar')).toHaveText('1');
    await page.getByRole('button', { name: 'Close' }).click(); // close StatsModal

    // ---- 9. Reload -> the finished state is restored, not replayed. ---------------------------
    await page.reload();
    await expect(page.getByRole('heading', { name: 'You got it!' })).toBeVisible(); // resultOpen restored
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.scoreboard__row').nth(2).locator('[data-color]').first()).toHaveAttribute(
      'data-color',
      'green',
    );
    await expect(submit).toBeDisabled(); // game over: the form is disabled, not replayable
  });
});
