import { describe, expect, it } from 'vitest';
import type { TileResult } from '../../schema/types';
import { buildShareText } from './share';
import { SITE_URL } from '../config';

function row(make: TileResult, model: TileResult, year: TileResult) {
  return { result: { make, model, year } };
}

describe('buildShareText — §4.4, byte-exact', () => {
  it('win on guess 2 (the §4.4 worked example)', () => {
    const text = buildShareText({
      number: 1,
      score: 12,
      guesses: [row('red', 'red', 'yellow'), row('green', 'green', 'green')],
    });
    expect(text).toBe('Motodle #1 12/15\n\n🟥🟥🟨\n🟩🟩🟩\n\nhttps://playmotodle.com');
  });

  it('loss after 5 guesses (the §4.4 worked example)', () => {
    const text = buildShareText({
      number: 4,
      score: 1,
      guesses: [
        row('red', 'red', 'yellow'),
        row('green', 'red', 'yellow'),
        row('green', 'red', 'yellow'),
        row('green', 'red', 'yellow'),
        row('green', 'red', 'yellow'),
      ],
    });
    expect(text).toBe(
      'Motodle #4 1/15\n\n🟥🟥🟨\n🟩🟥🟨\n🟩🟥🟨\n🟩🟥🟨\n🟩🟥🟨\n\nhttps://playmotodle.com',
    );
  });

  it('give-up during guess 3 — exactly 2 rows, not 3 (the §4.4 worked example)', () => {
    const text = buildShareText({
      number: 7,
      score: 1,
      guesses: [row('red', 'red', 'red'), row('green', 'red', 'red')],
    });
    expect(text).toBe('Motodle #7 1/15\n\n🟥🟥🟥\n🟩🟥🟥\n\nhttps://playmotodle.com');
    expect(text.split('\n')).toHaveLength(6);
  });

  it('give-up during guess 1 — empty grid collapses to header, one blank line, URL', () => {
    const text = buildShareText({ number: 9, score: 0, guesses: [] });
    expect(text).toBe('Motodle #9 0/15\n\nhttps://playmotodle.com');
    // Never two consecutive blank lines.
    expect(text).not.toContain('\n\n\n');
  });

  it('no trailing newline on any of the above — the string ends with the URL', () => {
    const texts = [
      buildShareText({ number: 1, score: 12, guesses: [row('green', 'green', 'green')] }),
      buildShareText({ number: 9, score: 0, guesses: [] }),
    ];
    for (const t of texts) {
      expect(t.endsWith(SITE_URL)).toBe(true);
      expect(t.endsWith('\n')).toBe(false);
    }
  });

  it('SITE_URL is imported from src/config.ts, never hard-coded — changing the domain is a one-line edit', () => {
    const text = buildShareText({ number: 1, score: 0, guesses: [] });
    expect(text.endsWith(SITE_URL)).toBe(true);
    expect(SITE_URL).toBe('https://playmotodle.com'); // sanity: config.ts matches §10.6
  });

  it('practice prefix — header carries "(practice)", no streak appended', () => {
    const text = buildShareText({
      number: 2,
      score: 9,
      practice: true,
      guesses: [row('green', 'green', 'green'), row('green', 'green', 'green'), row('green', 'green', 'green')],
    });
    expect(text.startsWith('Motodle #2 (practice) 9/15\n\n')).toBe(true);
  });

  it('colourblind mode swaps glyphs, including ⬜ for red (Wordle high-contrast set, not ⬛)', () => {
    const text = buildShareText({
      number: 1,
      score: 0,
      colorblind: true,
      guesses: [row('green', 'yellow', 'red')],
    });
    expect(text).toBe('Motodle #1 0/15\n\n🟧🟦⬜\n\nhttps://playmotodle.com');
  });

  it('a row with yellow on all three tiles (RULES A and B can make every tile yellow at once)', () => {
    const text = buildShareText({ number: 5, score: 0, guesses: [row('yellow', 'yellow', 'yellow')] });
    expect(text).toBe('Motodle #5 0/15\n\n🟨🟨🟨\n\nhttps://playmotodle.com');
  });

  it('header number formatting: no leading zero, no "#0001" padding — number is printed as-is', () => {
    expect(buildShareText({ number: 62, score: 0, guesses: [] })).toContain('Motodle #62 0/15');
    expect(buildShareText({ number: 1, score: 0, guesses: [] })).toContain('Motodle #1 0/15');
  });
});
