// A loss after 5 guesses (§7.4 step 10; the exact scenario the plan spells out at §4.4: "make
// locked green from guess 2 on, model never found -- every wrong model is a Suzuki that was off
// sale in 2004"). Puzzle #1 (2026-09-02, Suzuki GSX-R750, answer year 2004).
//
// All 5 guesses are IDENTICAL -- Suzuki GT750 ([1971,1977], excludes 2004), year 1990 (14 off):
//   make GREEN (exact match, guess 1 on), model RED (off-sale, never yellow), year RED (>10 off)
// Nothing ever locks except make, so points = 1, multiplier = 1 (loss), score = 1.
//
// Once locked, GuessForm keeps the player's committed choice across guesses (§4.3 -- a locked
// category is never re-entered), so guesses 2-5 need no retyping: clicking Submit again reuses
// the same committed make/model and year.
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime, SITE_URL, stubNavigatorShare } from './helpers';

const EXPECTED_SHARE_TEXT = [
  'Motodle #1 1/15',
  '',
  Array(5).fill('🟩🟥🟥').join('\n'),
  '',
  SITE_URL,
].join('\n');

test('loss after 5 guesses: make stays locked green, model/year never do, score 1', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await stubNavigatorShare(page);
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await closeHelpModal(page);

  const submit = page.locator('button[type="submit"]');
  const combo = page.getByRole('combobox', { name: 'Make and model' });
  const year = page.getByRole('spinbutton');

  await combo.fill('Suzuki GT750');
  await combo.press('Enter');
  await year.fill('1990');

  for (let guessNumber = 1; guessNumber <= 5; guessNumber++) {
    await expect(submit).toHaveText(`Guess ${guessNumber} of 5`);
    await submit.click();
    const row = page.locator('.scoreboard__row').nth(guessNumber - 1);
    await expect(row.locator('[data-color]').nth(0)).toHaveAttribute('data-color', 'green');
    await expect(row.locator('[data-color]').nth(1)).toHaveAttribute('data-color', 'red');
    await expect(row.locator('[data-color]').nth(2)).toHaveAttribute('data-color', 'red');
  }

  // Scrub unlocks fully once the game ends, even though only 5 guesses were made.
  await expect(page.getByRole('button', { name: 'Crop level 5 of 5' })).toBeEnabled();

  await expect(page.getByRole('heading', { name: 'Better luck tomorrow' })).toBeVisible();
  await expect(page.locator('.result-score strong')).toHaveText('1');

  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied to clipboard');
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(EXPECTED_SHARE_TEXT);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Statistics' }).click();
  const summary = page.locator('.stats-summary strong');
  await expect(summary.nth(0)).toHaveText('1'); // played
  await expect(summary.nth(1)).toHaveText('0'); // win %
  await expect(summary.nth(2)).toHaveText('0'); // current streak (a loss resets it)
  await expect(summary.nth(3)).toHaveText('0'); // max streak

  // The give-up button is gone once the game has ended (a loss needs no give-up escape hatch).
  await expect(page.getByRole('button', { name: 'Give up' })).toHaveCount(0);
});
