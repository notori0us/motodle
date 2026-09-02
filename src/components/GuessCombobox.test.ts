import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogIndex } from '../../schema/types';
import { buildCatalogIndex } from '../lib/catalog';
import { buildMatchIndex } from '../lib/match';
import GuessCombobox from './GuessCombobox.svelte';

function testCatalog(): CatalogIndex {
  return buildCatalogIndex({
    schema: 1,
    generatedAt: '2026-09-02',
    source: 'seed',
    makes: [
      { id: 'suzuki', name: 'Suzuki', country: 'JP', aliases: [] },
      { id: 'honda', name: 'Honda', country: 'JP', aliases: [] },
      { id: 'triumph', name: 'Triumph', country: 'GB', aliases: [] },
    ],
    models: [
      { id: 'suzuki-gsxr750', makeId: 'suzuki', name: 'GSX-R750', aliases: ['gsxr'], years: [1985, null] },
      { id: 'suzuki-gt750', makeId: 'suzuki', name: 'GT750', aliases: [], years: [1971, 1977] },
      { id: 'honda-cb750', makeId: 'honda', name: 'CB750', aliases: [], years: [1969, 2003] },
      {
        id: 'triumph-bonneville-t120',
        makeId: 'triumph',
        name: 'Bonneville T120',
        aliases: ['t120'],
        years: [1959, 1974],
      },
    ],
  });
}

const entries = buildMatchIndex(testCatalog());

describe('GuessCombobox', () => {
  it('aria-controls resolves to a real element both open and closed (always-mounted hidden listbox)', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox');
    const list = document.getElementById(input.getAttribute('aria-controls')!);
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute('hidden');

    await fireEvent.input(input, { target: { value: 'suz' } });
    const listOpen = document.getElementById(input.getAttribute('aria-controls')!);
    expect(listOpen).not.toBeNull();
    expect(listOpen).not.toHaveAttribute('hidden');
  });

  it('aria-expanded is present (as "false") even when closed', () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('aria-activedescendant is absent when nothing is active, and points at the active option once one is', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await fireEvent.input(input, { target: { value: 'suz' } });
    expect(input).toHaveAttribute('aria-activedescendant', input.getAttribute('aria-controls') + '-0');
  });

  it('exactly one option has aria-selected=true, matching the active index', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'suz' } });
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    const selected = options.filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toBe(options[1]);
  });

  it('ArrowDown/ArrowUp clamp at the ends without wrapping', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'suz' } }); // 2 Suzuki options
    for (let i = 0; i < 5; i++) await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', input.getAttribute('aria-controls') + '-1');
    for (let i = 0; i < 5; i++) await fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', input.getAttribute('aria-controls') + '-0');
  });

  it('Enter accepts the active option, closes the list, and does not submit the round (preventDefault)', async () => {
    const onchoose = vi.fn();
    render(GuessCombobox, { props: { id: 'g', entries, onchoose } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'gsxr' } });
    const notPrevented = await fireEvent.keyDown(input, { key: 'Enter' });
    expect(notPrevented).toBe(false); // fireEvent's dispatch return is false iff preventDefault() ran
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onchoose).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'suzuki-gsxr750' }));
    expect(input.value).toBe('Suzuki GSX-R750');
  });

  it('Enter falls through (is not prevented) when the list is closed', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox');
    const notPrevented = await fireEvent.keyDown(input, { key: 'Enter' });
    expect(notPrevented).toBe(true);
  });

  it('Escape: first press closes and keeps text, second press clears it', async () => {
    const onchoose = vi.fn();
    render(GuessCombobox, { props: { id: 'g', entries, onchoose } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'triu' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.value).toBe('triu');

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(onchoose).toHaveBeenLastCalledWith(null);
  });

  it('Home/End do not move the active option (editable-combobox rule: they move the caret)', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'suz' } });
    await fireEvent.keyDown(input, { key: 'ArrowDown' }); // active -> 1
    const before = input.getAttribute('aria-activedescendant');
    await fireEvent.keyDown(input, { key: 'Home' });
    await fireEvent.keyDown(input, { key: 'End' });
    expect(input.getAttribute('aria-activedescendant')).toBe(before);
  });

  it('Tab accepts the active option and closes (and does not preventDefault, so focus moves on)', async () => {
    const onchoose = vi.fn();
    render(GuessCombobox, { props: { id: 'g', entries, onchoose } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'gsxr' } });
    const notPrevented = await fireEvent.keyDown(input, { key: 'Tab' });
    expect(notPrevented).toBe(true);
    expect(onchoose).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'suzuki-gsxr750' }));
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('Alt+ArrowDown opens the list without moving the active option', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'suz' } });
    await fireEvent.keyDown(input, { key: 'Escape' }); // close, keep text
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('Alt+ArrowUp closes the list and keeps the text', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'triu' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.value).toBe('triu');
  });

  it('dismisses on an outside pointerdown, keeping the typed text', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'triu' } });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await fireEvent.pointerDown(document.body);
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input.value).toBe('triu');
  });

  it('pointerdown on an option commits it (the mousedown-blur trap fix)', async () => {
    const onchoose = vi.fn();
    render(GuessCombobox, { props: { id: 'g', entries, onchoose } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'cb750' } });
    const option = screen.getByRole('option', { name: 'Honda CB750' });
    await fireEvent.pointerDown(option);
    expect(onchoose).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'honda-cb750' }));
    expect(input.value).toBe('Honda CB750');
  });

  it('the input keeps its chosen label after commit and is never silently cleared', async () => {
    render(GuessCombobox, { props: { id: 'g', entries, onchoose: vi.fn() } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'gsxr' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('Suzuki GSX-R750');
    // Re-render with the same props (simulating a parent update) should not wipe it.
    await fireEvent.focus(input);
    expect(input.value).toBe('Suzuki GSX-R750');
  });

  it('locked-make filtering: narrows the pool but keeps make tokens searchable, and shows model-only labels', async () => {
    render(GuessCombobox, {
      props: { id: 'g', entries, lockedMakeId: 'suzuki', lockedMakeName: 'Suzuki', onchoose: vi.fn() },
    });
    const input = screen.getByRole('combobox') as HTMLInputElement;

    await fireEvent.input(input, { target: { value: 'honda' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    await fireEvent.input(input, { target: { value: 'suz gsx' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('GSX-R750'); // model-only, not "Suzuki GSX-R750"

    expect(screen.getByText('Suzuki')).toBeInTheDocument(); // the non-removable chip
    expect(input).toHaveAttribute('aria-label', 'Suzuki model');
  });

  it('when the model is locked, the field shows the players own matched entry and is disabled', () => {
    render(GuessCombobox, {
      props: { id: 'g', entries, lockedLabel: 'Suzuki GSX-R750', onchoose: vi.fn() },
    });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.value).toBe('Suzuki GSX-R750');
  });

  it('typing without choosing renders the inline "pick a bike" message and wires aria-invalid', () => {
    render(GuessCombobox, {
      props: { id: 'g', entries, onchoose: vi.fn(), invalid: true, invalidMessage: 'Pick a bike from the list' },
    });
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Pick a bike from the list')).toBeInTheDocument();
  });

  it('editing after a commit uncommits the selection (onchoose(null))', async () => {
    const onchoose = vi.fn();
    render(GuessCombobox, { props: { id: 'g', entries, onchoose } });
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'gsxr' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    onchoose.mockClear();
    await fireEvent.input(input, { target: { value: 'Suzuki GSX-R75' } });
    expect(onchoose).toHaveBeenCalledWith(null);
  });
});
