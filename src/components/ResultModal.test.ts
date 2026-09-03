import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Puzzle, TodayState } from '../../schema/types';
import ResultModal from './ResultModal.svelte';

function testPuzzle(overrides: Partial<Puzzle['image']['full']> = {}, creditOverrides: Partial<Puzzle['credit']> = {}): Puzzle {
  return {
    schema: 1,
    id: 'mtd-0001',
    number: 1,
    date: '2026-09-02',
    answer: {
      makeId: 'suzuki',
      make: 'Suzuki',
      modelId: 'suzuki-gsxr750',
      model: 'GSX-R750',
      year: 2004,
      acceptModelIds: ['suzuki-gsxr750'],
    },
    image: {
      aspect: '4:3',
      focus: { x: 0.5, y: 0.5 },
      sourceCrop: null,
      cropFractions: [0.15, 0.25, 0.4, 0.62, 0.95],
      levels: [1, 2, 3, 4, 5].map((level) => ({
        level,
        src: `img/0001/l${level}.webp`,
        w: 100 * level,
        h: 75 * level,
        rect: { w: 100 * level, h: 75 * level },
        bytes: 1000,
      })),
      full: { src: 'img/0001/full.webp', w: 1200, h: 500, bytes: 5000, ...overrides },
    },
    credit: {
      fileTitle: 'File:Test.jpg',
      descriptionUrl: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
      author: 'Test Author',
      license: {
        id: 'PD',
        name: 'Public domain',
        url: 'https://commons.wikimedia.org/wiki/Template:PD-user',
        jurisdiction: null,
      },
      attributionRequired: false,
      modified: 'cropped, resized, re-encoded to WebP',
      creditNote: null,
      ...creditOverrides,
    },
    yearEvidence: {
      confidence: 'high',
      source: 'title',
      note: 'test',
      approvedBy: 'operator',
      approvedOn: '2026-09-02',
    },
  };
}

function wonToday(): TodayState {
  return {
    schemaVersion: 1,
    date: '2026-09-02',
    number: 1,
    puzzleId: 'mtd-0001',
    status: 'won',
    guesses: [],
    locks: { makeId: 'suzuki', modelId: 'suzuki-gsxr750', year: 2004 },
    viewLevel: 3,
    endedAtGuess: 3,
    score: 9,
  };
}

describe('ResultModal', () => {
  it('renders attribution (author, licence link, Commons link) even when attributionRequired is false', () => {
    const puzzle = testPuzzle({}, { attributionRequired: false });
    render(ResultModal, { props: { open: true, puzzle, today: wonToday(), onclose: vi.fn(), onshare: vi.fn(), oncredits: vi.fn() } });
    expect(screen.getByText(/Test Author/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Public domain' })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/Template:PD-user',
    );
    expect(screen.getByRole('link', { name: 'Source on Commons' })).toHaveAttribute(
      'href',
      'https://commons.wikimedia.org/wiki/File:Test.jpg',
    );
  });

  it('renders credit.modified beside the licence link', () => {
    const puzzle = testPuzzle();
    render(ResultModal, { props: { open: true, puzzle, today: wonToday(), onclose: vi.fn(), onshare: vi.fn(), oncredits: vi.fn() } });
    expect(screen.getByText(/cropped, resized, re-encoded to WebP/)).toBeInTheDocument();
  });

  it('renders creditNote verbatim when present', () => {
    const puzzle = testPuzzle({}, { creditNote: 'Please credit "Test Author" if reused.' });
    render(ResultModal, { props: { open: true, puzzle, today: wonToday(), onclose: vi.fn(), onshare: vi.fn(), oncredits: vi.fn() } });
    expect(screen.getByText('Please credit "Test Author" if reused.')).toBeInTheDocument();
  });

  it('does not render a creditNote paragraph when null', () => {
    const puzzle = testPuzzle();
    render(ResultModal, { props: { open: true, puzzle, today: wonToday(), onclose: vi.fn(), onshare: vi.fn(), oncredits: vi.fn() } });
    expect(screen.queryByText(/Please credit/)).not.toBeInTheDocument();
  });

  it('letterboxes a non-4:3 full image (object-fit: contain, not distorted)', () => {
    const puzzle = testPuzzle({ w: 1200, h: 500 }); // not 4:3
    const { container } = render(ResultModal, {
      props: { open: true, puzzle, today: wonToday(), onclose: vi.fn(), onshare: vi.fn(), oncredits: vi.fn() },
    });
    const img = container.querySelector('.result-image img') as HTMLImageElement;
    expect(img).toHaveAttribute('width', '1200');
    expect(img).toHaveAttribute('height', '500');
    const style = getComputedStyle(img);
    expect(style.objectFit).toBe('contain');
  });

  it('shows the score breakdown as points x multiplier', () => {
    const puzzle = testPuzzle();
    render(ResultModal, { props: { open: true, puzzle, today: wonToday(), onclose: vi.fn(), onshare: vi.fn(), oncredits: vi.fn() } });
    // 3 points (all locked green) x multiplier 3 (won on guess 3) = 9
    expect(screen.getByText(/3 × 3/)).toBeInTheDocument();
  });

  it('shows the plain answer text', () => {
    const puzzle = testPuzzle();
    render(ResultModal, { props: { open: true, puzzle, today: wonToday(), onclose: vi.fn(), onshare: vi.fn(), oncredits: vi.fn() } });
    expect(screen.getByText(/2004/)).toBeInTheDocument();
    expect(screen.getByText(/Suzuki/)).toBeInTheDocument();
    expect(screen.getByText(/GSX-R750/)).toBeInTheDocument();
  });

  it('the "Photo credits" affordance (#mtd-credits-link-result) closes the result modal and opens the credits view (§5.10.3)', async () => {
    const onclose = vi.fn();
    const oncredits = vi.fn();
    const puzzle = testPuzzle();
    const { container } = render(ResultModal, {
      props: { open: true, puzzle, today: wonToday(), onclose, onshare: vi.fn(), oncredits },
    });
    const button = container.querySelector('#mtd-credits-link-result') as HTMLButtonElement;
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Photo credits');

    await fireEvent.click(button);
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(oncredits).toHaveBeenCalledTimes(1);
    // Never two dialogs open at once: onclose must fire before oncredits opens the next one.
    expect(onclose.mock.invocationCallOrder[0]).toBeLessThan(oncredits.mock.invocationCallOrder[0]);
  });
});
