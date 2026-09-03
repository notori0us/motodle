// The 360x640 "reachable without scrolling" rule (§5.8) -- asserted with NO focus call and
// window.scrollY === 0, which is the case §5.8 explicitly flags plan item 12's literal "focus
// then check" as insufficient for: focusing an input can itself scroll the page, which would
// make the assertion pass for the wrong reason. Also asserts the pinch-zoom-enabled viewport
// meta (WCAG 1.4.4).
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime } from './helpers';

test.use({ viewport: { width: 360, height: 640 } });

test('360x640: submit button is above the fold unfocused, and pinch-zoom stays enabled', async ({ page }) => {
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await closeHelpModal(page);

  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportContent).toBe('width=device-width, initial-scale=1, viewport-fit=cover');
  expect(viewportContent).not.toContain('user-scalable=no');
  expect(viewportContent).not.toContain('maximum-scale');

  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBe(0); // no focus call anywhere above this line

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
});
