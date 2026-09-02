// The colourblind cascade fix (review B1): `:root[data-colorblind='true']` is the LAST block in
// tokens.css, tying the (0,2,0) specificity of both theme blocks so source order decides -- a
// bare `[data-colorblind]` selector (the original bug) silently loses to both. jsdom cannot
// resolve this cascade at all, so it must be asserted in real chromium (§5.7).
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime } from './helpers';

const COLORBLIND_GREEN = '#c2410c';
const BASE_GREEN = '#3b7d22'; // tokens.css -- the un-shifted RULE A/B green, proves a difference

test('colourblind palette wins over both explicit dark and prefers-color-scheme: dark', async ({ page }) => {
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await closeHelpModal(page); // otherwise the modal overlay intercepts the header button clicks

  const greenBg = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tile-green-bg').trim());

  // Explicit [data-theme="dark"], colourblind still OFF: must be the base green, not the
  // colourblind one -- proves the two states actually differ, not just that the "on" value
  // happens to match (a regression that put COLORBLIND_GREEN in the base :root block would
  // otherwise pass this spec unchanged).
  await page.getByRole('button', { name: 'Change theme' }).click(); // system -> dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await greenBg()).toBe(BASE_GREEN);

  // Explicit [data-theme="dark"] + [data-colorblind="true"]: equal (0,2,0) specificity, so the
  // colourblind block (declared last) must win.
  await page.getByRole('button', { name: 'Toggle colourblind mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-colorblind', 'true');
  expect(await greenBg()).toBe(COLORBLIND_GREEN);

  // Back to theme 'system' (no [data-theme] attribute at all) + OS-level dark via media
  // emulation, colourblind still on: the [data-colorblind='true'] block must still win over the
  // @media (prefers-color-scheme: dark) block sitting right above it in the file.
  await page.getByRole('button', { name: 'Change theme' }).click(); // dark -> light
  await page.getByRole('button', { name: 'Change theme' }).click(); // light -> system
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();

  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await greenBg()).toBe(COLORBLIND_GREEN);

  // Toggle colourblind back OFF, still under prefers-color-scheme: dark emulation: must revert
  // to the base green -- the other half of "proves a difference".
  await page.getByRole('button', { name: 'Toggle colourblind mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-colorblind', 'false');
  expect(await greenBg()).toBe(BASE_GREEN);
});
