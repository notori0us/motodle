import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsState } from '../../schema/types';
import { createInitialStats } from '../lib/stats';
import StatsModal from './StatsModal.svelte';

function statsWith(overrides: Partial<StatsState>): StatsState {
  return { ...createInitialStats(), ...overrides };
}

describe('StatsModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('always shows all 8 distribution buckets, zeros included, in descending order', () => {
    const { container } = render(StatsModal, {
      props: { open: true, stats: createInitialStats(), highlightScore: null, canShare: false, onclose: vi.fn(), onshare: vi.fn() },
    });
    const labels = Array.from(container.querySelectorAll('.distribution__label')).map((el) => el.textContent);
    expect(labels).toEqual(['15', '12', '9', '6', '3', '2', '1', '0']);
  });

  it('highlights the bucket matching highlightScore', () => {
    const stats = statsWith({ played: 1, wins: 1, scoreDistribution: { ...createInitialStats().scoreDistribution, '9': 1 } });
    const { container } = render(StatsModal, {
      props: { open: true, stats, highlightScore: 9, canShare: true, onclose: vi.fn(), onshare: vi.fn() },
    });
    const highlighted = container.querySelector('.distribution__bar--highlight');
    expect(highlighted).not.toBeNull();
    expect(highlighted).toHaveTextContent('1');
  });

  it('renders played, win%, current and max streak', () => {
    const stats = statsWith({ played: 4, wins: 3, currentStreak: 2, maxStreak: 3 });
    render(StatsModal, { props: { open: true, stats, highlightScore: null, canShare: false, onclose: vi.fn(), onshare: vi.fn() } });
    expect(screen.getByText('4')).toBeInTheDocument(); // played
    expect(screen.getByText('75')).toBeInTheDocument(); // win %
  });

  it('renders the countdown in HH:MM:SS format', () => {
    render(StatsModal, {
      props: { open: true, stats: createInitialStats(), highlightScore: null, canShare: false, onclose: vi.fn(), onshare: vi.fn() },
    });
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('calls onshare when the Share button is clicked (game ended)', async () => {
    const onshare = vi.fn();
    render(StatsModal, {
      props: { open: true, stats: createInitialStats(), highlightScore: null, canShare: true, onclose: vi.fn(), onshare },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onshare).toHaveBeenCalled();
  });

  it('hides Share while the game is still in progress — a partial grid must never be shared as a 0/15', () => {
    render(StatsModal, {
      props: { open: true, stats: createInitialStats(), highlightScore: null, canShare: false, onclose: vi.fn(), onshare: vi.fn() },
    });
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });
});
