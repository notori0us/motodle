import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogIndex, TodayState } from '../../schema/types';
import { buildCatalogIndex } from '../lib/catalog';
import { buildMatchIndex } from '../lib/match';
import GuessForm from './GuessForm.svelte';

function testCatalog(): CatalogIndex {
  return buildCatalogIndex({
    schema: 1,
    generatedAt: '2026-09-02',
    source: 'seed',
    makes: [
      { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
      { id: 'honda', name: 'Honda', country: 'JP', aliases: [] },
    ],
    models: [
      { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: ['gsxr'], years: [1985, null] },
      { id: 'suzuki-gt750', makeId: 'suzuki', name: 'GT750', aliases: [], years: [1971, 1977] },
      { id: 'honda-cb750', makeId: 'honda', name: 'CB750', aliases: [], years: [1969, 2003] },
    ],
  });
}
const catalog = testCatalog();
const entries = buildMatchIndex(catalog);

function freshToday(): TodayState {
  return {
    schemaVersion: 1,
    date: '2026-09-02',
    number: 1,
    puzzleId: 'mtd-0001',
    status: 'in_progress',
    guesses: [],
    locks: { makeId: null, modelId: null, year: null },
    viewLevel: 1,
    endedAtGuess: null,
    score: null,
  };
}

describe('GuessForm', () => {
  it('marks submit aria-disabled (not disabled) until a catalog entry is chosen and a year is entered', async () => {
    // Real `disabled` would swallow the click and Enter-to-submit (Cardle's silent-disabled-button
    // trap, §5.3) — the button must stay clickable so handleSubmit's attemptedInvalid branch can run.
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, entries, onsubmit, ongiveup: vi.fn() } });
    const submit = screen.getByRole('button', { name: /Guess 1 of 5/ });
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    await fireEvent.click(submit);
    expect(onsubmit).not.toHaveBeenCalled();
  });

  it('submits the chosen make/model and typed year', async () => {
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, entries, onsubmit, ongiveup: vi.fn() } });
    const combo = screen.getByRole('combobox');
    await fireEvent.input(combo, { target: { value: 'gsxr' } });
    await fireEvent.keyDown(combo, { key: 'Enter' });
    const year = screen.getByRole('spinbutton');
    await fireEvent.input(year, { target: { value: '2004' } });
    const submit = screen.getByRole('button', { name: /Guess 1 of 5/ });
    expect(submit).not.toBeDisabled();
    await fireEvent.click(submit);
    expect(onsubmit).toHaveBeenCalledWith({
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      make: 'Suzuki',
      model: 'GSX-R750',
      year: 2004,
    });
  });

  it('shows the "Pick a bike from the list" message on a blocked submit attempt', async () => {
    // Click the button itself (the only path a real user has) rather than firing `submit` on the
    // form directly — that would bypass a disabled button and give a false pass (review B2).
    render(GuessForm, { props: { today: freshToday(), catalog, entries, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    const year = screen.getByRole('spinbutton');
    await fireEvent.input(year, { target: { value: '2004' } });
    const submit = screen.getByRole('button', { name: /Guess 1 of 5/ });
    await fireEvent.click(submit);
    expect(screen.getByText('Pick a bike from the list')).toBeInTheDocument();
  });

  it('when MODEL is locked, resubmitting reuses the locked make/model and only the year changes', async () => {
    const today: TodayState = {
      ...freshToday(),
      status: 'in_progress',
      guesses: [
        {
          modelId: 'suzuki-gsxr750',
          make: 'Suzuki',
          model: 'GSX-R750',
          year: 2002,
          result: { make: 'green', model: 'green', year: 'yellow' },
        },
      ],
      locks: { makeId: 'suzuki', modelId: 'suzuki-gsxr750', year: null },
    };
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today, catalog, entries, onsubmit, ongiveup: vi.fn() } });
    const combo = screen.getByRole('combobox') as HTMLInputElement;
    expect(combo).toBeDisabled();
    expect(combo.value).toBe('Suzuki GSX-R750');

    const year = screen.getByRole('spinbutton');
    await fireEvent.input(year, { target: { value: '2006' } });
    await fireEvent.click(screen.getByRole('button', { name: /Guess 2 of 5/ }));
    expect(onsubmit).toHaveBeenCalledWith({
      makeId: 'suzuki',
      modelId: 'suzuki-gsxr750',
      make: 'Suzuki',
      model: 'GSX-R750',
      year: 2006,
    });
  });

  it('give-up requires a confirmation step before calling ongiveup', async () => {
    const ongiveup = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, entries, onsubmit: vi.fn(), ongiveup } });
    await fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    expect(ongiveup).not.toHaveBeenCalled();
    expect(screen.getByText(/Give up\? This counts as a loss\./)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(ongiveup).toHaveBeenCalled();
  });

  it('give-up can be cancelled', async () => {
    const ongiveup = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, entries, onsubmit: vi.fn(), ongiveup } });
    await fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ongiveup).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Give up' })).toBeInTheDocument();
  });
});
