/**
 * `tools/lib/attribution.ts` — renders `docs/ATTRIBUTION.md` WHOLESALE from the current puzzle
 * set (§6.1, §6.3, §8: generated, never hand-edited). Pure string-building function; the caller
 * (`generate.ts` / `schedule.ts`) does the one `fs.writeFile`.
 */
import type { Puzzle } from '../../schema/types';

/** The §6.5a paragraph, verbatim — required in BOTH docs/ATTRIBUTION.md and README.md (README's
 *  copy is W5's job, §8). Do not paraphrase; the wording ("that photograph's own licence",
 *  "same CC BY-SA version") is the actual position statement. */
export const IMAGE_LICENSE_STATEMENT = `The images under \`fixtures/images/\` and \`public/puzzles/img/\` are **not** covered by this
repository's code licence. Each is a cropped, resized, WebP-re-encoded derivative of a Wikimedia
Commons photograph and is distributed under **that photograph's own licence**, named per puzzle
in \`docs/ATTRIBUTION.md\` and shown in the game's result screen. Where the source is CC BY-SA, the
derivative is offered under the **same CC BY-SA version**; reusers inherit that share-alike
obligation.`;

export function renderAttribution(puzzles: Puzzle[]): string {
  const sorted = [...puzzles].sort((a, b) => a.number - b.number);

  const lines: string[] = [
    '# Image attribution',
    '',
    '> Generated wholesale by `tools/generate.ts` / `tools/schedule.ts` from the current puzzle',
    '> set, sorted by puzzle number, on every run (§6.3). Never hand-edited, never appended to.',
    '',
    IMAGE_LICENSE_STATEMENT,
    '',
  ];

  for (const p of sorted) {
    const c = p.credit;
    lines.push(`## Puzzle #${p.number} — ${p.date} — ${p.answer.make} ${p.answer.model} (${p.answer.year})`);
    lines.push('');
    lines.push(`- **Source:** [${c.fileTitle}](${c.descriptionUrl})`);
    lines.push(`- **Author:** ${c.author}`);
    lines.push(`- **Licence:** [${c.license.name}](${c.license.url})`);
    if (c.license.jurisdiction) lines.push(`- **Jurisdiction:** ${c.license.jurisdiction}`);
    lines.push(`- **Modified:** ${c.modified}`);
    if (c.creditNote) lines.push(`- **Credit note:** ${c.creditNote}`);
    lines.push('');
  }

  return lines.join('\n');
}
