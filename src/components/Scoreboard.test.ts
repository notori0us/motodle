import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { GuessRecord } from '../../schema/types';
import Scoreboard from './Scoreboard.svelte';

const guesses: GuessRecord[] = [
  {
    modelId: 'triumph-bonneville-t120',
    make: 'Triumph',
    model: 'Bonneville T120',
    year: 1998,
    result: { make: 'red', model: 'red', year: 'yellow' },
  },
  {
    modelId: 'suzuki-gt750',
    make: 'Suzuki',
    model: 'GT750',
    year: 2003,
    result: { make: 'green', model: 'red', year: 'yellow' },
  },
];

describe('Scoreboard', () => {
  it('renders 5 rows of 3 tiles, colours matching results including yellow in make/model', () => {
    const { container } = render(Scoreboard, { props: { guesses } });
    const rows = container.querySelectorAll('.scoreboard__row');
    expect(rows).toHaveLength(5);

    const [row1, row2] = rows;
    const [make1, model1, year1] = row1.querySelectorAll('.tile');
    expect(make1).toHaveAttribute('data-color', 'red');
    expect(model1).toHaveAttribute('data-color', 'red');
    expect(year1).toHaveAttribute('data-color', 'yellow');

    const [make2, model2] = row2.querySelectorAll('.tile');
    expect(make2).toHaveAttribute('data-color', 'green'); // RULE A green is reachable
    expect(model2).toHaveAttribute('data-color', 'red');

    // Unplayed rows render empty placeholder tiles.
    const [emptyMake] = rows[2].querySelectorAll('.tile');
    expect(emptyMake).toHaveAttribute('data-color', 'empty');
  });

  it('shows a yellow make tile for a same-country, different-make guess (RULE A)', () => {
    const yellowGuess: GuessRecord = {
      modelId: 'honda-cb750',
      make: 'Honda',
      model: 'CB750',
      year: 1998,
      result: { make: 'yellow', model: 'red', year: 'green' },
    };
    const { container } = render(Scoreboard, { props: { guesses: [yellowGuess] } });
    const firstTile = container.querySelector('.scoreboard__row .tile');
    expect(firstTile).toHaveAttribute('data-color', 'yellow');
  });

  it('renders colourblind glyphs when colorblind is set', () => {
    render(Scoreboard, { props: { guesses, colorblind: true } });
    // Green -> checkmark glyph, visible (not aria-hidden text content, but present in DOM).
    expect(screen.getAllByText('✓').length).toBeGreaterThan(0);
    expect(screen.getAllByText('~').length).toBeGreaterThan(0);
    expect(screen.getAllByText('✗').length).toBeGreaterThan(0);
  });

  it('renders no glyphs when colorblind is off', () => {
    render(Scoreboard, { props: { guesses, colorblind: false } });
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });
});
