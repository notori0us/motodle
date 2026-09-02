/**
 * App smoke test (§7.3 note: W4 replaces the W0 placeholder here). Mocks `fetch` with the real
 * committed fixture data (`public/catalog.json`, `public/puzzles/2026-09-02.json`, manifest) so
 * the whole boot path — catalog load, puzzle load, screen selection — runs for real, without any
 * network access. Pins the DEV-only `?today=` clock override (§7.4a) so the test is not coupled
 * to the host's real date.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';
import { game } from './state/game.svelte';

const ROOT = resolve(__dirname, '..');
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'public/catalog.json'), 'utf-8'));
const puzzle = JSON.parse(readFileSync(resolve(ROOT, 'public/puzzles/2026-09-02.json'), 'utf-8'));
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/puzzles/manifest.json'), 'utf-8'));

function jsonResponse(data: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => data };
}

describe('App', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/?today=2026-09-02');
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('catalog.json')) return jsonResponse(catalog);
        if (url.includes('manifest.json')) return jsonResponse(manifest);
        if (url.includes('2026-09-02.json')) return jsonResponse(puzzle);
        return jsonResponse(null, 404);
      }),
    );
  });

  afterEach(() => {
    game.dispose();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-colorblind');
    window.history.pushState({}, '', '/');
  });

  it('boots against the real fixture puzzle and renders the game screen', async () => {
    render(App);
    expect(screen.getByRole('heading', { level: 1, name: 'Motodle' })).toBeInTheDocument();

    const submit = await screen.findByRole('button', { name: /Guess 1 of 5/ });
    expect(submit).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Make' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument();
    // First visit: prefs.seenHelp is unset, so the HelpModal auto-opens (§5.1).
    expect(screen.getByRole('heading', { name: 'How to play' })).toBeInTheDocument();
  });

  it('sets seenHelp on close and does not auto-open HelpModal on a later boot', async () => {
    render(App);
    const gotIt = await screen.findByRole('button', { name: 'Got it' });
    await fireEvent.click(gotIt);
    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('motodle:prefs')!).seenHelp).toBe(true);

    // A fresh boot (simulating a reload) must not re-open it.
    game.dispose();
    cleanup();
    render(App);
    await screen.findByRole('button', { name: /Guess 1 of 5/ });
    expect(screen.queryByRole('heading', { name: 'How to play' })).not.toBeInTheDocument();
  });

  it('theme and colourblind toggles set data-theme/data-colorblind on <html> (§5.7)', async () => {
    render(App);
    await screen.findByRole('button', { name: /Guess 1 of 5/ });
    const root = document.documentElement;
    expect(root).not.toHaveAttribute('data-theme'); // starts at 'system'
    expect(root).toHaveAttribute('data-colorblind', 'false');

    const themeButton = screen.getByRole('button', { name: 'Change theme' });
    await fireEvent.click(themeButton); // system -> dark
    expect(root).toHaveAttribute('data-theme', 'dark');
    await fireEvent.click(themeButton); // dark -> light
    expect(root).toHaveAttribute('data-theme', 'light');
    await fireEvent.click(themeButton); // light -> system
    expect(root).not.toHaveAttribute('data-theme');

    await fireEvent.click(screen.getByRole('button', { name: 'Toggle colourblind mode' }));
    expect(root).toHaveAttribute('data-colorblind', 'true');
  });

  it('practice mode never writes to motodle:stats (§4.6)', async () => {
    // "today" pinned past the fixture range so 2026-09-02 is a valid practice (past) date.
    window.history.pushState({}, '', '/?today=2026-09-04&d=2026-09-02');
    render(App);
    await screen.findByRole('button', { name: /Guess 1 of 5/ });
    expect(screen.getByText(/Practice/)).toBeInTheDocument();

    await fireEvent.change(screen.getByRole('combobox', { name: 'Make' }), { target: { value: 'suzuki' } });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: 'suzuki-gsxr750' } });
    const year = screen.getByRole('spinbutton');
    await fireEvent.input(year, { target: { value: '2004' } });
    await fireEvent.click(screen.getByRole('button', { name: /Guess 1 of 5/ }));

    // recordCompletion() writes motodle:stats synchronously at game end (§4.3) — practice must
    // never reach it, so the key stays entirely absent, not merely unchanged.
    expect(window.localStorage.getItem('motodle:stats')).toBeNull();
  });
});
