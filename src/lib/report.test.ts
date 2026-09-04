import { describe, expect, it } from 'vitest';
import { GITHUB_REPOSITORY, reportIssueUrl } from './report';

const puzzle = {
  number: 42,
  date: '2026-10-13',
  answer: { makeId: 'honda', make: 'Honda', modelId: 'honda-cb750', model: 'CB750', year: 1969, acceptModelIds: ['honda-cb750'] },
};

describe('reportIssueUrl', () => {
  it('targets the inaccuracy issue form of the configured repository', () => {
    const url = new URL(reportIssueUrl(puzzle));
    expect(url.origin + url.pathname).toBe(`https://github.com/${GITHUB_REPOSITORY}/issues/new`);
    expect(url.searchParams.get('template')).toBe('inaccuracy.yml');
  });

  it('prefills the title without the answer, and the puzzle field with it', () => {
    const url = new URL(reportIssueUrl(puzzle));
    expect(url.searchParams.get('title')).toBe('Motodle #42 (2026-10-13): possible inaccuracy');
    expect(url.searchParams.get('title')).not.toContain('Honda');
    expect(url.searchParams.get('puzzle')).toBe('#42 · 2026-10-13 · 1969 Honda CB750');
  });
});
