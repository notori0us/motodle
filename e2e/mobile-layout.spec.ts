// The 360x640 "reachable without scrolling" rule (§5.8) -- asserted with NO focus call and
// window.scrollY === 0, which is the case §5.8 explicitly flags plan item 12's literal "focus
// then check" as insufficient for: focusing an input can itself scroll the page, which would
// make the assertion pass for the wrong reason. Also asserts the pinch-zoom-enabled viewport
// meta (WCAG 1.4.4).
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime } from './helpers';

test.use({ viewport: { width: 360, height: 640 } });

// K3: the first-run help modal's own dismiss control must not be below the fold at 360x640.
test('360x640: the first-run help modal Got it button is above the fold, unscrolled', async ({ page }) => {
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();

  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBe(0); // the app's own rAF focus lands on the fixed overlay, so the window never scrolls

  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  // Plain literal, not the DOMRect itself (§5.8/known-fact-3 pattern above) -- DOMRect's fields
  // are prototype accessors with no own enumerable keys, so Playwright's evaluate serializer
  // would hand back `{}` and silently turn this into a no-op assertion.
  const m = await page.evaluate(() => {
    const r = document.querySelector('.help-cta')!.getBoundingClientRect();
    return { bottom: r.bottom, innerHeight: window.innerHeight };
  });
  expect(m.bottom).toBeLessThanOrEqual(m.innerHeight);
});

test('360x640: submit button is above the fold unfocused, and pinch-zoom stays enabled', async ({ page }) => {
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await closeHelpModal(page);

  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportContent).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
  expect(viewportContent).not.toContain('user-scalable=no');
  expect(viewportContent).not.toContain('maximum-scale');

  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBe(0); // the app's own rAF focus lands on the fixed overlay, so the window never scrolls

  const submit = page.locator('button[type="submit"]');
  await expect(submit).toBeVisible();
  // getBoundingClientRect().bottom vs window.innerHeight, per §5.8/known-fact-3 -- NOT
  // boundingBox() vs viewportSize(), which diverge the moment a horizontal scrollbar appears
  // (viewportSize() ignores it; the CSS viewport that innerHeight/getBoundingClientRect see does
  // not) -- exactly the layout regression this spec exists to catch. Also asserts no horizontal
  // overflow at all, since that scrollbar is what would cause the divergence in the first place.
  const m = await page.evaluate(() => {
    const r = document.querySelector('button[type="submit"]')!.getBoundingClientRect();
    return {
      bottom: r.bottom,
      innerHeight: window.innerHeight,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  expect(m.bottom).toBeLessThanOrEqual(m.innerHeight);
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW);

  // §5.10.2/§5.10.1: the in-play licence chip shares the scrub row instead of costing its own —
  // it must be visible without moving the submit button, and the scrub segments must still clear
  // the 44px touch-target minimum (the licence line takes its width out of that same row, so a
  // regression that squeezes the segments below 44px is the realistic way this design fails).
  await expect(page.locator('#mtd-photo-licence')).toBeVisible();
  const segBoxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.scrub__seg')).map((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }),
  );
  expect(segBoxes.length).toBe(5);
  for (const box of segBoxes) {
    expect(box.w).toBeGreaterThanOrEqual(44);
    expect(box.h).toBeGreaterThanOrEqual(44);
  }

  // §5.11.7: the error/Locked chip lives on the field's own label line, which exists in every
  // state (§5.11.4 U6) -- so a failed submit must cost the layout nothing. A "give-up is also
  // above the fold" assertion was rejected in the plan as too brittle (7.5px of margin); the
  // submit button's own position not moving is the real guarantee.
  const bottomBefore = m.bottom;
  // { force: true }: aria-disabled, not natively disabled (§5.3.4) -- Playwright's own
  // actionability check treats aria-disabled as disabled by design (see blocked-submit.spec.ts).
  await submit.click({ force: true }); // nothing chosen -- fails validation, surfaces "Choose a make" etc.
  const bottomAfter = await page.evaluate(
    () => document.querySelector('button[type="submit"]')!.getBoundingClientRect().bottom,
  );
  expect(bottomAfter).toBe(bottomBefore);
});
