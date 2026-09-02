import { defineConfig } from 'vitest/config';          // NOT from 'vite' — TS2769 otherwise
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],                // svelteTesting() is MANDATORY (probe §3a)
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setup-test.ts'],
    include: ['src/**/*.{test,spec}.{ts,js}', 'schema/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],  // else vitest steals Playwright's specs
    maxWorkers: 2,                                      // 4.8 GiB free, swap full
  },
});
