// The blocked-submit inline message (known review issue: the submit button uses aria-disabled,
// not the native `disabled` attribute, so the "Pick a bike from the list" message stays
// reachable -- §5.3). Playwright's `.click()` refuses an aria-disabled element by design, so
// reaching handleSubmit needs `{ force: true }`; pressing Enter in a field is the alternate path
// (aria-disabled has no effect on implicit form submission either), exercised here too.
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime } from './helpers';

test('blocked submit surfaces "Pick a bike from the list" without disabling the button natively', async ({
  page,
}) => {
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await closeHelpModal(page);

  const submit = page.locator('button[type="submit"]');
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  // Playwright's own `toBeEnabled()`/actionability checks treat aria-disabled as disabled too
  // (by design) -- read the DOM property directly to prove the NATIVE attribute is absent, which
  // is the whole point (§5.3): a truly `disabled` button would swallow a real click silently.
  expect(await submit.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);

  await submit.click({ force: true });

  await expect(page.getByText('Pick a bike from the list')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Make and model' })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Enter a year between 1885 and \d+/)).toBeVisible();
  await expect(page.locator('.scoreboard__row [data-color="empty"]')).toHaveCount(15); // nothing submitted

  // Fix the combobox half: its own error clears once a real choice is committed.
  const combo = page.getByRole('combobox', { name: 'Make and model' });
  await combo.fill('Suzuki GSX-R750');
  await combo.press('Enter');
  await expect(page.getByText('Pick a bike from the list')).toHaveCount(0);

  // Alternate path to the same blocked-submit code: Enter in the year field, still empty.
  const year = page.getByRole('spinbutton');
  await year.fill('');
  await year.press('Enter');
  await expect(page.getByText(/Enter a year between 1885 and \d+/)).toBeVisible();
  await expect(page.locator('.scoreboard__row [data-color="empty"]')).toHaveCount(15); // still nothing submitted
});
