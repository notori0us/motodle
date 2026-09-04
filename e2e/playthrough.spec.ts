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
  test('full round: tile colours, locking, make/model cascade, score, share text, stats, reload', async ({
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

    // Two cascading native selects, addressed by the frozen DOM contract ids (§5.3.1) -- never by
    // role+accessible name, since a locked select's aria-label changes to "<Make/Model> — locked
    // to {name}" (§5.3.3), which would silently stop matching a name-based locator. Guesses are
    // entered with selectOption by catalog id, never by typing (§5.3, §7.4 preamble).
    const makeSelect = page.locator('#mtd-make');
    const modelSelect = page.locator('#mtd-model');
    const year = page.getByRole('spinbutton');

    // ---- 13. The in-play licence chip, before any guess (§5.10.1). -----------------------------
    // Fixture #1's credit: author "Pawlex", license.name "Public domain", fileTitle
    // "File:2004 Suzuki GSXR-750 Left SIde.jpg" (note the unhyphenated "GSXR" — the catalog's
    // model label is "GSX-R750", so a populated #mtd-model dropdown can't false-fail this).
    const licenceChip = page.locator('#mtd-photo-licence');
    await expect(licenceChip).toBeVisible();
    await expect(licenceChip).toHaveText('Photo: Public domain');
    await expect(licenceChip).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/Template:PD-user');

    async function assertNoSpoilers(): Promise<void> {
      const html = await page.content();
      expect(html).not.toContain('Pawlex');
      expect(html).not.toContain('File:');
      expect(html).not.toContain('GSXR');
      expect(html).not.toContain('commons.wikimedia.org/wiki/File:');
    }
    await assertNoSpoilers();

    // ---- 3. Guess 1: red/red/red; image advances to level 2; scrub back/forward. --------------
    // Before any make is chosen, #mtd-model is disabled with the "Choose a make first" placeholder
    // (§5.3.2).
    await expect(modelSelect).toBeDisabled();
    await makeSelect.selectOption('triumph');
    await expect(modelSelect).toBeEnabled();
    // Changing the make resets the model selection to the placeholder (§5.3.2 cascade reset) --
    // exercised with an unrelated make before returning to the real guess.
    await makeSelect.selectOption('honda');
    await expect(modelSelect).toHaveValue('');
    await makeSelect.selectOption('triumph');
    await modelSelect.selectOption('triumph-bonneville-t120');
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

    // ---- 13 (cont'd). Still there, and the page is still clean, after guess 1. -----------------
    await expect(licenceChip).toBeVisible();
    await assertNoSpoilers();

    // ---- 4. Guess 2: correct make, wrong (off-sale) model, year 5 off -> green/red/yellow. -----
    await expect(submit).toHaveText('Guess 2 of 5');
    await makeSelect.selectOption('suzuki');
    await modelSelect.selectOption('suzuki-gt750');
    await year.fill('1999');
    await submit.click();

    const row2 = page.locator('.scoreboard__row').nth(1);
    await expect(row2.locator('[data-color]').nth(0)).toHaveAttribute('data-color', 'green');
    await expect(row2.locator('[data-color]').nth(1)).toHaveAttribute('data-color', 'red');
    await expect(row2.locator('[data-color]').nth(2)).toHaveAttribute('data-color', 'yellow');

    // Make locked: chip appears, #mtd-make is disabled holding the locked value, #mtd-model stays
    // enabled and still lists the WHOLE Suzuki range -- every model of that make, unfiltered by
    // year (§5.3.2/§5.3.3): suzuki-gsxr750 present, triumph-bonneville-t120 (a different make)
    // absent, and more than one Suzuki model total, proving it is the make's full list and not
    // narrowed down to "would-score" candidates.
    await expect(page.locator('.lock-chip')).toHaveText('Locked');
    await expect(makeSelect).toBeDisabled();
    await expect(makeSelect).toHaveValue('suzuki');
    await expect(makeSelect).toHaveAttribute('aria-label', 'Make — locked to Suzuki');
    await expect(modelSelect).toBeEnabled();

    const modelValues = await modelSelect
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(modelValues).toContain('suzuki-gsxr750');
    expect(modelValues).not.toContain('triumph-bonneville-t120'); // no foreign make leaks in
    expect(modelValues.filter((v) => v !== '').length).toBeGreaterThan(1); // the whole make, not one

    // ---- 5. Guess 3: correct model, year 2 off -> win. ------------------------------------------
    await modelSelect.selectOption('suzuki-gsxr750');
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

    // Game over: both selects are disabled, and #mtd-model shows the player's own chosen model —
    // same evidence (chip count + aria-label) as the make-lock assertion above, §5.3.3.
    await expect(makeSelect).toBeDisabled();
    await expect(modelSelect).toBeDisabled();
    await expect(modelSelect).toHaveValue('suzuki-gsxr750');
    await expect(page.locator('.lock-chip')).toHaveCount(2);
    await expect(modelSelect).toHaveAttribute('aria-label', 'Model — locked to GSX-R750');

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

    // ---- 14. The credits view (§5.10.4). --------------------------------------------------------
    // ROADMAP §1: the report link lives on the result screen only, prefilled for this puzzle.
    await expect(page.locator('#mtd-report-link')).toHaveAttribute('href', /\/issues\/new\?template=inaccuracy\.yml&title=Motodle\+%231\+/);
    await page.locator('#mtd-credits-link-result').click(); // closes ResultModal, opens CreditsModal
    await expect(page.getByRole('heading', { name: 'Photo credits' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'You got it!' })).not.toBeVisible(); // never two dialogs at once

    const creditRows = page.locator('[data-mtd-credit-row]');
    await expect(creditRows).toHaveCount(1); // exactly one -- today's own, just finished
    await expect(creditRows.first()).toHaveAttribute('data-date', '2026-09-02');
    await expect(creditRows.first()).toContainText('Motodle #1');
    await expect(creditRows.first()).toContainText('2004 Suzuki GSX-R750');
    await expect(creditRows.first()).toContainText('Pawlex');
    await expect(creditRows.first().getByRole('link', { name: 'Public domain' })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/Template:PD-user',
    );
    await expect(creditRows.first().getByRole('link', { name: 'Source on Commons' })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/File:2004_Suzuki_GSXR-750_Left_SIde.jpg',
    );
    // The spoiler assertion that matters: no row for 2026-09-03 or 2026-09-04, even though both
    // are future days AND both puzzle files are published (§13.8) -- and nothing left to load.
    await expect(page.locator('[data-mtd-credit-row][data-date="2026-09-03"]')).toHaveCount(0);
    await expect(page.locator('[data-mtd-credit-row][data-date="2026-09-04"]')).toHaveCount(0);
    await expect(page.locator('#mtd-credits-more')).toHaveCount(0);

    await page.getByRole('button', { name: 'Close' }).click(); // close CreditsModal
    await page.locator('#mtd-credits-link').click(); // re-open from the OTHER entry point (footer)
    await expect(page.getByRole('heading', { name: 'Photo credits' })).toBeVisible();
    await expect(creditRows).toHaveCount(1); // the two entry points render the same one view
    await expect(creditRows.first()).toHaveAttribute('data-date', '2026-09-02');
    await page.getByRole('button', { name: 'Close' }).click(); // close CreditsModal

    await expect(page.locator('.scoreboard__row').nth(2).locator('[data-color]').first()).toHaveAttribute(
      'data-color',
      'green',
    );
    await expect(submit).toBeDisabled(); // game over: the form is disabled, not replayable
  });
});
