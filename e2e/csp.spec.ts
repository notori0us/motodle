// §13.9 W6-4/B2 — the app must work under the exact production CSP, not an unheadered preview.
// vite.config.ts's `preview.headers` (§13.5.2) serves the real CloudFront response-headers-policy
// headers on this suite's webServer, so a `securitypolicyviolation` event here means the CSP is
// wrong, not that the test is wrong (§13.9 DoD #5). Exercises the same verified winning sequence
// as playthrough.spec.ts (make/model/year triples), plus the 404 page's own inline <style> element
// (§13.5.1), since 'unsafe-inline' has to cover both the attribute and element cases.
import { expect, test } from '@playwright/test';
import { closeHelpModal, DAY1, localTime, stubNavigatorShare } from './helpers';

test('no CSP violations across a full winning round + 404 page', async ({ page, context }) => {
  const problems: string[] = [];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener('securitypolicyviolation', (e: any) => {
      (window as any).__csp.push(
        `${e.effectiveDirective || e.violatedDirective} blocked ${e.blockedURI} (${e.sourceFile || 'inline'})`,
      );
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push('http ' + r.status() + ' ' + r.url());
  });

  await stubNavigatorShare(page);
  await page.clock.install({ time: localTime(DAY1) });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();
  await closeHelpModal(page);

  const makeSelect = page.locator('#mtd-make');
  const modelSelect = page.locator('#mtd-model');
  const year = page.getByRole('spinbutton');
  const submit = page.locator('button[type="submit"]');

  await makeSelect.selectOption('triumph');
  await modelSelect.selectOption('triumph-bonneville-t120');
  await year.fill('1990');
  await submit.click();
  await makeSelect.selectOption('suzuki');
  await modelSelect.selectOption('suzuki-gt750');
  await year.fill('1999');
  await submit.click();
  await modelSelect.selectOption('suzuki-gsxr750');
  await year.fill('2002');
  await submit.click();
  await expect(page.getByRole('heading', { name: 'You got it!' })).toBeVisible();
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('status')).toHaveText('Copied to clipboard');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Statistics' }).click();
  await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You got it!' })).toBeVisible();
  problems.push(...(await page.evaluate(() => (window as any).__csp ?? [])));

  // The static 404 page's own inline <style> ELEMENT, not attribute (§13.5.1's closing note).
  // CloudFront's custom_error_response (§13.2.6) is what rewrites an arbitrary missing path to
  // this file's body while preserving status 404 (V9/V12, §13.7) -- `vite preview`'s
  // appType: 'mpa' only prevents the index.html SPA fallback (§13.5.2's note) and, verified here,
  // returns an empty-body bare 404 for an unmatched path with no page to probe for CSP violations.
  // So this hits /404.html directly, a real object in dist/ that serves 200 under both `vite
  // preview` (V8, §13.7) and CloudFront -- the CSP-under-inline-<style> question is the same
  // either way.
  const p2 = await context.newPage();
  const v2: string[] = [];
  await p2.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener('securitypolicyviolation', (e: any) =>
      (window as any).__csp.push(`404page: ${e.effectiveDirective || e.violatedDirective} blocked ${e.blockedURI}`),
    );
  });
  p2.on('console', (m) => {
    if (m.type() === 'error') v2.push('404page console: ' + m.text());
  });
  const r = await p2.goto('/404.html');
  expect(r?.status()).toBe(200);
  await expect(p2.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  v2.push(...(await p2.evaluate(() => (window as any).__csp ?? [])));
  problems.push(...v2);

  expect(problems, 'CSP / console problems:\n' + problems.join('\n')).toEqual([]);
});
