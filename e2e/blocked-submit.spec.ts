// The blocked-submit inline messages (§5.3.4: the submit button uses aria-disabled, not the
// native `disabled` attribute, so the "Choose a make" / "Choose a model" messages stay reachable).
// Playwright's `.click()` refuses an aria-disabled element by design, so reaching handleSubmit
// needs `{ force: true }`; pressing Enter in the year field is one alternate path (aria-disabled
// has no effect on implicit form submission either). Pressing Enter in a *select*, by contrast, is
// NOT native implicit submission — Chromium does not submit forms from Enter-in-select — so
// GuessForm wires it explicitly (§5.3.5 narrow exception); that wiring is exercised below too.
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime } from './helpers';

test('blocked submit surfaces "Choose a make" / "Choose a model" without disabling the button natively', async ({
  page,
}) => {
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await closeHelpModal(page);

  const submit = page.locator('button[type="submit"]');
  const makeSelect = page.locator('#mtd-make');
  const modelSelect = page.locator('#mtd-model');
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  // Playwright's own `toBeEnabled()`/actionability checks treat aria-disabled as disabled too
  // (by design) -- read the DOM property directly to prove the NATIVE attribute is absent, which
  // is the whole point (§5.3.4): a truly `disabled` button would swallow a real click silently.
  expect(await submit.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(false);

  // Enter inside #mtd-make with nothing chosen: the explicit onkeydown wiring (§5.3.5), not native
  // implicit submission, must still run the same validation path as the button -- never nothing.
  await makeSelect.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mtd-make-error')).toHaveText('Choose a make');
  await expect(makeSelect).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.scoreboard__row [data-color="empty"]')).toHaveCount(15); // nothing submitted

  // Nothing chosen at all: force through the aria-disabled button.
  await submit.click({ force: true });

  await expect(page.locator('#mtd-make-error')).toHaveText('Choose a make');
  await expect(makeSelect).toHaveAttribute('aria-invalid', 'true');
  await expect(makeSelect).toHaveAttribute('aria-describedby', 'mtd-make-error');
  await expect(page.getByText(/Enter a year between 1885 and \d+/)).toBeVisible();
  await expect(page.locator('.scoreboard__row [data-color="empty"]')).toHaveCount(15); // nothing submitted

  // Fix the make half: its own error clears once a make is chosen, and -- every offending field
  // is marked on the same attempt (§5.3.4) -- #mtd-model now becomes the offending control instead,
  // reactively, with no second submit needed.
  await makeSelect.selectOption('suzuki');
  await expect(page.locator('#mtd-make-error')).toHaveCount(0);
  await expect(makeSelect).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#mtd-model-error')).toHaveText('Choose a model');
  await expect(modelSelect).toHaveAttribute('aria-invalid', 'true');
  await expect(modelSelect).toHaveAttribute('aria-describedby', 'mtd-model-error');

  // Fix the model half too: its error clears the same way.
  await modelSelect.selectOption('suzuki-gsxr750');
  await expect(page.locator('#mtd-model-error')).toHaveCount(0);
  await expect(modelSelect).not.toHaveAttribute('aria-invalid', 'true');

  // Make and model are both valid now; only the year (still empty) blocks the submit. Alternate
  // path to the same blocked-submit code: press Enter in the year field rather than clicking the
  // button (aria-disabled has no effect on implicit form submission either, §5.3.4).
  const year = page.getByRole('spinbutton');
  await year.press('Enter');
  await expect(page.getByText(/Enter a year between 1885 and \d+/)).toBeVisible();
  await expect(page.locator('#mtd-make-error')).toHaveCount(0); // make/model stay clean
  await expect(page.locator('#mtd-model-error')).toHaveCount(0);
  await expect(page.locator('.scoreboard__row [data-color="empty"]')).toHaveCount(15); // still nothing submitted
  await expect(submit).toHaveText('Guess 1 of 5'); // no guess was consumed
});
