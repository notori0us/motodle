// Rollover while the page is open (§4.5, §7.4 item 10's clock mechanism): the 60s watcher must
// notice a local-midnight crossing and show a persistent, non-dismissable banner WITHOUT
// disturbing the mid-guess board, and the two days' state must never mix once Reload is clicked.
//
// Uses `page.clock.install` + `pauseAt` + `runFor` (§7.4a) rather than waiting on real time.
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime } from './helpers';

test('rollover banner appears at local midnight; mid-guess state survives; the new day starts fresh', async ({
  page,
}) => {
  await page.clock.install({ time: localTime(DAY1, '23:58:00') });
  await page.goto('/');
  await closeHelpModal(page);

  const submit = page.locator('button[type="submit"]');
  const combo = page.getByRole('combobox', { name: 'Make and model' });
  const year = page.getByRole('spinbutton');
  await combo.fill('Triumph Bonneville T120');
  await combo.press('Enter');
  await year.fill('1990');
  await submit.click();
  await expect(submit).toHaveText('Guess 2 of 5');
  await expect(page.locator('.stale-banner')).toHaveCount(0);

  // Freeze precisely, then jump forward -- the rollover watcher's 60s setInterval (§4.5) fires
  // at least twice inside this window, crossing local midnight.
  await page.clock.pauseAt(localTime(DAY1, '23:58:05'));
  await page.clock.runFor('00:03:00');

  const banner = page.getByRole('status').filter({ hasText: 'A new Motodle is ready' });
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();

  // Non-dismissable, non-destructive: the in-progress board is untouched until Reload is clicked
  // (§4.5 -- a player mid-guess must not lose their board).
  await expect(submit).toHaveText('Guess 2 of 5');
  const row1 = page.locator('.scoreboard__row').nth(0);
  await expect(row1.locator('[data-color]').first()).toHaveAttribute('data-color', 'red');

  await page.getByRole('button', { name: 'Reload' }).click();

  // The two days' state never mix (§4.5): the stored record's date ('2026-09-02') no longer
  // equals todayKey() ('2026-09-03'), so it is discarded outright -- the new puzzle loads fresh,
  // 0 guesses, not puzzle #1's in-progress board restored under the wrong day.
  await expect(page.getByRole('button', { name: 'Guess 1 of 5' })).toBeVisible();
  await expect(page.locator('.scoreboard__row [data-color="empty"]')).toHaveCount(15);
  await expect(page.locator('.stale-banner')).toHaveCount(0);
});
