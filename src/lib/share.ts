/**
 * PURE `buildShareText()` — emoji grid + header + URL, no DOM (§4.4). Delivery (navigator.share
 * -> clipboard -> execCommand -> manual select) is a separate injected `ShareSink`
 * (`src/state/share.ts`, W4) — this module exports only the string builder.
 */
import type { GuessRecord } from '../../schema/types';
import { SITE_URL } from '../config';

const GLYPHS = {
  normal: { green: '🟩', yellow: '🟨', red: '🟥' },
  colorblind: { green: '🟧', yellow: '🟦', red: '⬜' }, // Wordle's high-contrast set (⬛ is
  // invisible against the dark background of most chat clients — rejected, §4.4).
} as const;

export interface ShareTextInput {
  number: number;
  score: number;
  guesses: Pick<GuessRecord, 'result'>[];
  /** Practice share prefixes the header and appends no streak (§4.6). */
  practice?: boolean;
  colorblind?: boolean;
}

/**
 * String in, string out. No DOM.
 *
 *   Motodle #<number> <score>/15
 *   <blank line>
 *   <row per guess: 3 tiles, no separators>
 *   <blank line>
 *   <SITE_URL>
 *
 * A give-up appends no row, so a 0-row grid COLLAPSES: header, one blank line, URL — never two
 * consecutive blank lines. No trailing newline: the string ends with the URL's last character.
 */
export function buildShareText(input: ShareTextInput): string {
  const { number, score, guesses, practice = false, colorblind = false } = input;
  const glyphs = colorblind ? GLYPHS.colorblind : GLYPHS.normal;
  const header = `Motodle #${number}${practice ? ' (practice)' : ''} ${score}/15`;

  const sections = [header];
  if (guesses.length > 0) {
    const rows = guesses.map((g) => glyphs[g.result.make] + glyphs[g.result.model] + glyphs[g.result.year]);
    sections.push(rows.join('\n'));
  }
  sections.push(SITE_URL);

  return sections.join('\n\n');
}
