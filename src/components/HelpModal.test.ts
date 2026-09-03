import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import HelpModal from './HelpModal.svelte';

describe('HelpModal', () => {
  it('renders the §5.12 tagline verbatim as its intro', () => {
    render(HelpModal, { props: { open: true, onclose: vi.fn() } });
    expect(screen.getByText('Guess the motorbike in 5 tries. A new motorbike is available each day.')).toBeInTheDocument();
  });

  it('renders the §5.6 wording for all three yellow bands when open', () => {
    render(HelpModal, { props: { open: true, onclose: vi.fn() } });
    expect(screen.getByText(/same country/)).toBeInTheDocument();
    expect(screen.getByText(/on sale the year the answer was built/)).toBeInTheDocument();
    expect(screen.getByText(/within 2 years/)).toBeInTheDocument();
    expect(screen.getByText(/within 10 years/)).toBeInTheDocument();
    // Uses COUNTRY_NAMES (a display name), never a raw ISO code.
    expect(screen.getByText(/Japan/)).toBeInTheDocument();
    expect(screen.queryByText(/\bJP\b/)).not.toBeInTheDocument();
  });

  it('explains that only green counts and locks', () => {
    render(HelpModal, { props: { open: true, onclose: vi.fn() } });
    expect(screen.getByText(/Only a green tile scores a point and locks that field in\. Yellow is just a hint\./)).toBeInTheDocument();
  });

  it('shows the multiplier table', () => {
    render(HelpModal, { props: { open: true, onclose: vi.fn() } });
    expect(screen.getByText('×5')).toBeInTheDocument();
    expect(screen.getAllByText('×1')).toHaveLength(2); // guess 5, and loss/give-up
    expect(screen.getByText('Loss or give-up')).toBeInTheDocument();
  });

  it('mentions the daily reset at local midnight', () => {
    render(HelpModal, { props: { open: true, onclose: vi.fn() } });
    expect(screen.getByText(/A new Motodle every day at midnight, your time/)).toBeInTheDocument();
  });

  it('calls onclose when dismissed', async () => {
    const onclose = vi.fn();
    render(HelpModal, { props: { open: true, onclose } });
    screen.getByRole('button', { name: 'Got it' }).click();
    expect(onclose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(HelpModal, { props: { open: false, onclose: vi.fn() } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
