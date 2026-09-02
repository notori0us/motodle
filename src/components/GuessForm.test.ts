import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogIndex, TodayState } from '../../schema/types';
import { buildCatalogIndex } from '../lib/catalog';
import GuessForm from './GuessForm.svelte';

function testCatalog(): CatalogIndex {
  return buildCatalogIndex({
    schema: 1,
    generatedAt: '2026-09-02',
    source: 'seed',
    makes: [
      { id: 'yamaha', name: 'Yamaha', country: 'JP', aliases: [] },
      { id: 'ducati', name: 'Ducati', country: 'IT', aliases: [] },
      { id: 'bmw', name: 'BMW', country: 'DE', aliases: [] },
      { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
    ],
    models: [
      { id: 'ducati-panigale', makeId: 'ducati', name: 'Panigale', aliases: [], years: [2012, null] },
      { id: 'ducati-monster', makeId: 'ducati', name: 'Monster', aliases: [], years: [1993, null] },
      { id: 'ducati-monster-900', makeId: 'ducati', name: 'Monster 900', aliases: [], years: [1993, 2002] },
      { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: [], years: [1985, null] },
      { id: 'yamaha-yzfr1', makeId: 'yamaha', name: 'YZF-R1', aliases: [], years: [1998, null] },
      { id: 'bmw-r1250gs', makeId: 'bmw', name: 'R 1250 GS', aliases: [], years: [2018, null] },
    ],
  });
}
const catalog = testCatalog();

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

function makeSelect(): HTMLSelectElement {
  return screen.getByLabelText('Make') as HTMLSelectElement;
}

function modelSelect(): HTMLSelectElement {
  return screen.getByLabelText('Model') as HTMLSelectElement;
}

function optionTexts(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.textContent ?? '');
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.value);
}

describe('GuessForm — make dropdown (§5.3.2)', () => {
  it('#mtd-make placeholder first, then every catalog make, alphabetical by display name, value = make id', () => {
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    const select = makeSelect();
    expect(select.id).toBe('mtd-make');
    expect(optionTexts(select)).toEqual(['Choose a make…', 'BMW', 'Ducati', 'Suzuki', 'Yamaha']);
    expect(optionValues(select)).toEqual(['', 'bmw', 'ducati', 'suzuki', 'yamaha']);
  });
});

describe('GuessForm — model dropdown cascade (§5.3.2)', () => {
  it('#mtd-model is disabled with "Choose a make first" until a make is chosen', () => {
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    const select = modelSelect();
    expect(select.id).toBe('mtd-model');
    expect(select).toBeDisabled();
    expect(optionTexts(select)).toEqual(['Choose a make first']);
  });

  it('choosing a make fills #mtd-model with exactly that make\'s models — all of them, families and variants, alphabetical, no other make present', async () => {
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    await fireEvent.change(makeSelect(), { target: { value: 'ducati' } });
    const select = modelSelect();
    expect(select).not.toBeDisabled();
    // Both the family (Monster) and its depth-2 variant (Monster 900) are present, alphabetical,
    // with no year filtering and no other make's model leaking in.
    expect(optionTexts(select)).toEqual(['Choose a model…', 'Monster', 'Monster 900', 'Panigale']);
    expect(optionValues(select)).toEqual(['', 'ducati-monster', 'ducati-monster-900', 'ducati-panigale']);
    expect(optionValues(select)).not.toContain('suzuki-gsxr750');
  });

  it('changing the make resets #mtd-model to the placeholder and repopulates from the new make', async () => {
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    await fireEvent.change(makeSelect(), { target: { value: 'ducati' } });
    await fireEvent.change(modelSelect(), { target: { value: 'ducati-monster' } });
    expect(modelSelect().value).toBe('ducati-monster');

    await fireEvent.change(makeSelect(), { target: { value: 'suzuki' } });
    const select = modelSelect();
    expect(select.value).toBe('');
    expect(optionValues(select)).toEqual(['', 'suzuki-gsxr750']);
  });
});

describe('GuessForm — locking (§5.3.3, unchanged §4.3 rules)', () => {
  it('locked MAKE: #mtd-make disabled showing the locked make + chip + aria-label, #mtd-model stays enabled and lists that make\'s models', () => {
    const today: TodayState = { ...freshToday(), locks: { makeId: 'ducati', modelId: null, year: null } };
    render(GuessForm, { props: { today, catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    const make = makeSelect();
    expect(make).toBeDisabled();
    expect(make.value).toBe('ducati');
    expect(make).toHaveAttribute('aria-label', 'Make — locked to Ducati');
    expect(screen.getAllByText('Locked')).toHaveLength(1);

    const model = modelSelect();
    expect(model).not.toBeDisabled();
    expect(optionValues(model)).toEqual(['', 'ducati-monster', 'ducati-monster-900', 'ducati-panigale']);
  });

  it('locked MODEL: #mtd-model disabled too, showing the player\'s own chosen model (never the answer), only year stays editable', () => {
    const today: TodayState = {
      ...freshToday(),
      guesses: [
        {
          modelId: 'ducati-monster-900',
          make: 'Ducati',
          model: 'Monster 900',
          year: 1995,
          result: { make: 'green', model: 'green', year: 'yellow' },
        },
      ],
      locks: { makeId: 'ducati', modelId: 'ducati-monster-900', year: null },
    };
    render(GuessForm, { props: { today, catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    expect(makeSelect()).toBeDisabled();
    const model = modelSelect();
    expect(model).toBeDisabled();
    expect(model.value).toBe('ducati-monster-900');
    expect(model).toHaveAttribute('aria-label', 'Model — locked to Monster 900');
    expect(screen.getAllByText('Locked')).toHaveLength(2);

    const year = screen.getByRole('spinbutton');
    expect(year).not.toBeDisabled();
  });
});

describe('GuessForm — validation (§5.3.4)', () => {
  it('submit is aria-disabled, not disabled, and stays clickable', () => {
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit, ongiveup: vi.fn() } });
    const submit = screen.getByRole('button', { name: /Guess 1 of 5/ });
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveAttribute('aria-disabled', 'true');
  });

  it('submit with no make chosen shows "Choose a make" and marks #mtd-make invalid; never silently dead', async () => {
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit, ongiveup: vi.fn() } });
    await fireEvent.click(screen.getByRole('button', { name: /Guess 1 of 5/ }));
    expect(onsubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a make')).toBeInTheDocument();
    const make = makeSelect();
    expect(make).toHaveAttribute('aria-invalid', 'true');
    expect(make).toHaveAttribute('aria-describedby', 'mtd-make-error');
  });

  it('Enter on #mtd-make with nothing chosen submits (§5.3.5 narrow exception) and shows "Choose a make"', async () => {
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit, ongiveup: vi.fn() } });
    await fireEvent.keyDown(makeSelect(), { key: 'Enter' });
    expect(onsubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a make')).toBeInTheDocument();
  });

  it('make chosen, no model: shows "Choose a model" and marks #mtd-model invalid', async () => {
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    await fireEvent.change(makeSelect(), { target: { value: 'ducati' } });
    await fireEvent.click(screen.getByRole('button', { name: /Guess 1 of 5/ }));
    expect(screen.getByText('Choose a model')).toBeInTheDocument();
    const model = modelSelect();
    expect(model).toHaveAttribute('aria-invalid', 'true');
    expect(model).toHaveAttribute('aria-describedby', 'mtd-model-error');
    expect(screen.queryByText('Choose a make')).not.toBeInTheDocument();
  });

  it('every offending field is marked on the same attempt: no make chosen AND an out-of-range year both surface', async () => {
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup: vi.fn() } });
    const year = screen.getByRole('spinbutton');
    await fireEvent.input(year, { target: { value: '1500' } });
    await fireEvent.click(screen.getByRole('button', { name: /Guess 1 of 5/ }));
    expect(screen.getByText('Choose a make')).toBeInTheDocument();
    expect(screen.getByText(/Enter a year between 1885 and/)).toBeInTheDocument();
    // Model isn't separately flagged while make itself is still unchosen (§5.3.4 table).
    expect(screen.queryByText('Choose a model')).not.toBeInTheDocument();
  });
});

describe('GuessForm — submit payload (§5.3.6)', () => {
  it('a complete make + model + year submit calls onsubmit once with {makeId, modelId, make, model, year}', async () => {
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit, ongiveup: vi.fn() } });
    await fireEvent.change(makeSelect(), { target: { value: 'ducati' } });
    await fireEvent.change(modelSelect(), { target: { value: 'ducati-monster-900' } });
    const year = screen.getByRole('spinbutton');
    await fireEvent.input(year, { target: { value: '1995' } });
    await fireEvent.click(screen.getByRole('button', { name: /Guess 1 of 5/ }));
    expect(onsubmit).toHaveBeenCalledTimes(1);
    expect(onsubmit).toHaveBeenCalledWith({
      makeId: 'ducati',
      modelId: 'ducati-monster-900',
      make: 'Ducati',
      model: 'Monster 900',
      year: 1995,
    });
  });

  it('when MODEL is locked, resubmitting reuses the locked make/model and only the year changes', async () => {
    const today: TodayState = {
      ...freshToday(),
      guesses: [
        {
          modelId: 'ducati-monster-900',
          make: 'Ducati',
          model: 'Monster 900',
          year: 1995,
          result: { make: 'green', model: 'green', year: 'yellow' },
        },
      ],
      locks: { makeId: 'ducati', modelId: 'ducati-monster-900', year: null },
    };
    const onsubmit = vi.fn();
    render(GuessForm, { props: { today, catalog, onsubmit, ongiveup: vi.fn() } });
    const year = screen.getByRole('spinbutton');
    await fireEvent.input(year, { target: { value: '1997' } });
    await fireEvent.click(screen.getByRole('button', { name: /Guess 2 of 5/ }));
    expect(onsubmit).toHaveBeenCalledWith({
      makeId: 'ducati',
      modelId: 'ducati-monster-900',
      make: 'Ducati',
      model: 'Monster 900',
      year: 1997,
    });
  });
});

describe('GuessForm — give-up confirmation (unchanged)', () => {
  it('give-up requires a confirmation step before calling ongiveup', async () => {
    const ongiveup = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup } });
    await fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    expect(ongiveup).not.toHaveBeenCalled();
    expect(screen.getByText(/Give up\? This counts as a loss\./)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(ongiveup).toHaveBeenCalled();
  });

  it('give-up can be cancelled', async () => {
    const ongiveup = vi.fn();
    render(GuessForm, { props: { today: freshToday(), catalog, onsubmit: vi.fn(), ongiveup } });
    await fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ongiveup).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Give up' })).toBeInTheDocument();
  });
});
