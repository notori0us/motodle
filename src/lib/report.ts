import type { Puzzle } from '../../schema/types';

/** owner/repo the "report an inaccuracy" link files against (ROADMAP §1). */
export const GITHUB_REPOSITORY = 'notori0us/motodle';
export const ISSUE_TEMPLATE = 'inaccuracy.yml';

/**
 * Prefilled GitHub issue-form URL for one puzzle. The query keys are the form's field ids
 * (.github/ISSUE_TEMPLATE/inaccuracy.yml). The answer stays out of the title so the issues list
 * never reads as a spoiler feed; it goes in the `puzzle` field, which only shows once opened.
 */
export function reportIssueUrl(puzzle: Pick<Puzzle, 'number' | 'date' | 'answer'>): string {
  const params = new URLSearchParams({
    template: ISSUE_TEMPLATE,
    title: `Motodle #${puzzle.number} (${puzzle.date}): possible inaccuracy`,
    puzzle: `#${puzzle.number} · ${puzzle.date} · ${puzzle.answer.year} ${puzzle.answer.make} ${puzzle.answer.model}`,
  });
  return `https://github.com/${GITHUB_REPOSITORY}/issues/new?${params.toString()}`;
}
