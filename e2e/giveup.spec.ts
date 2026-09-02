// Give-up before any guess is submitted (§7.4 step 10, §4.4's zero-row collapse case). Puzzle #1
// (2026-09-02). A give-up is deliberately indistinguishable from a loss in the share text -- no
// scarlet letter -- and appends no guess row, so the share grid COLLAPSES to header, one blank
// line, URL.
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime, SITE_URL, stubNavigatorShare } from './helpers';

const EXPECTED_SHARE_TEXT = ['Motodle #1 0/15', '', SITE_URL].join('\n');

test('give-up with zero guesses: counts as a loss, score 0, empty share grid', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await stubNavigatorShare(page);
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await closeHelpModal(page);

  await expect(page.getByRole('button', { name: 'Give up' })).toBeVisible();
  await page.getByRole('button', { name: 'Give up' }).click();
  await expect(page.getByText('Give up? This counts as a loss.')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();

  // No row was ever submitted: every scoreboard tile stays empty.
  await expect(page.locator('.scoreboard__row [data-color="empty"]')).toHaveCount(15);

  await expect(page.getByRole('heading', { name: 'Better luck tomorrow' })).toBeVisible();
  await expect(page.locator('.result-score strong')).toHaveText('0');

  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied to clipboard');
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(EXPECTED_SHARE_TEXT);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Statistics' }).click();
  const summary = page.locator('.stats-summary strong');
  await expect(summary.nth(0)).toHaveText('1'); // played
  await expect(summary.nth(1)).toHaveText('0'); // win %
  await expect(summary.nth(2)).toHaveText('0'); // current streak

  const bucket0 = page
    .locator('.distribution__row')
    .filter({ has: page.locator('.distribution__label', { hasText: '0' }) });
  await expect(bucket0.locator('.distribution__bar')).toHaveClass(/distribution__bar--highlight/);
  await expect(bucket0.locator('.distribution__bar')).toHaveText('1');
  await page.getByRole('button', { name: 'Close' }).click();

  // Reload: the give-up state is restored, and the button that caused it is gone (game over).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Better luck tomorrow' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Give up' })).toHaveCount(0);
});
