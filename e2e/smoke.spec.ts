// Bootstrap smoke spec (W0): proves the Playwright + `vite preview` pipeline works end to end
// (§10.4) before any other stream lands, against the placeholder App.svelte shell only.
//
// This is NOT the scripted playthrough of §7.4 — that spec needs puzzle data (W1/W2), game
// logic (W3) and real UI (W4), none of which exist yet. It is deliberately named `smoke.spec.ts`
// rather than `playthrough.spec.ts` so it cannot collide with W5's file of that name (§8, e2e/**
// is W5's file set); W5 may delete this file once the real playthrough spec lands.
import { test, expect } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Motodle');
  await expect(page.getByRole('heading', { name: 'Motodle' })).toBeVisible();
});
