import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import YearInput from './YearInput.svelte';

const MAX_YEAR = new Date().getFullYear() + 1;

describe('YearInput', () => {
  it('steppers clamp at 1885 and currentYear+1', async () => {
    const onchange = vi.fn();
    render(YearInput, { props: { id: 'y', value: 1886, onchange } });
    const earlier = screen.getByRole('button', { name: 'Earlier year' });
    await fireEvent.pointerDown(earlier);
    expect(onchange).toHaveBeenLastCalledWith(1885);
    await fireEvent.pointerDown(earlier);
    expect(onchange).toHaveBeenLastCalledWith(1885); // clamped, does not go below
  });

  it('clamps upward at currentYear+1', async () => {
    const onchange = vi.fn();
    render(YearInput, { props: { id: 'y', value: MAX_YEAR - 1, onchange } });
    const later = screen.getByRole('button', { name: 'Later year' });
    await fireEvent.pointerDown(later);
    expect(onchange).toHaveBeenLastCalledWith(MAX_YEAR);
    await fireEvent.pointerDown(later);
    expect(onchange).toHaveBeenLastCalledWith(MAX_YEAR); // clamped, does not exceed
  });

  it('steppers work from the keyboard (Enter/Space), one step per press, no auto-repeat on held keys', async () => {
    const onchange = vi.fn();
    render(YearInput, { props: { id: 'y', value: 2000, onchange } });
    const later = screen.getByRole('button', { name: 'Later year' });
    await fireEvent.keyDown(later, { key: 'Enter' });
    expect(onchange).toHaveBeenLastCalledWith(2001);
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Earlier year' }), { key: ' ' });
    expect(onchange).toHaveBeenLastCalledWith(1999); // computed from the `value` prop (still 2000), not the last step
    await fireEvent.keyDown(later, { key: 'Enter', repeat: true });
    expect(onchange).toHaveBeenCalledTimes(2); // a held key does not auto-repeat
    await fireEvent.keyDown(later, { key: 'a' });
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  it('blocks non-numeric input (never validated by string length)', async () => {
    const onchange = vi.fn();
    render(YearInput, { props: { id: 'y', value: null, onchange } });
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'abcd' } });
    // jsdom's <input type=number> rejects a non-numeric value at the DOM level, leaving it ''.
    expect(input.value).toBe('');
    expect(onchange).toHaveBeenLastCalledWith(null);
  });

  it('is disabled and pre-filled with the player’s own value when locked', () => {
    render(YearInput, { props: { id: 'y', value: 2004, onchange: vi.fn(), locked: true } });
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.value).toBe('2004');
  });

  it('selects all text on focus so the previous value can be replaced by typing', async () => {
    render(YearInput, { props: { id: 'y', value: 1998, onchange: vi.fn() } });
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    const selectSpy = vi.spyOn(input, 'select');
    await fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
  });

  it('sets aria-invalid/aria-describedby when invalid — the message itself belongs to the parent (§5.11.3)', () => {
    render(YearInput, {
      props: { id: 'y', value: null, onchange: vi.fn(), invalid: true },
    });
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'y-error');
  });
});
