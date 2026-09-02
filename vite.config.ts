import { defineConfig } from 'vitest/config';          // NOT from 'vite' — TS2769 otherwise
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { CONTENT_SECURITY_POLICY } from './schema/constants';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],                // svelteTesting() is MANDATORY (probe §3a)
  appType: 'mpa',                                      // no client router: missing puzzle JSON must 404, not fall back to index.html
  preview: {
    // The exact headers CloudFront serves in production (PLAN §13.2.6), so the e2e
    // suite runs under the real policy instead of an unheadered preview.
    headers: {
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setup-test.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}', 'schema/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],  // else vitest steals Playwright's specs
    maxWorkers: 2,                                      // 4.8 GiB free, swap full
  },
});
