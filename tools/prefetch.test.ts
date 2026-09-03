import { describe, expect, it } from 'vitest';
import type { ReviewCandidate } from '../schema/types';
import { selectCandidates, thumbFilename } from './prefetch';

function cand(id: string, decision: ReviewCandidate['decision'], thumbUrl = 'https://x/y/960px-a.jpg?utm=1'): ReviewCandidate {
  return { candidateId: id, decision, thumbUrl } as unknown as ReviewCandidate;
}

describe('selectCandidates', () => {
  const all = [cand('M1', 'approve'), cand('M2', 'pending'), cand('M3', 'reject')];
  it('defaults to approve only', () => {
    expect(selectCandidates(all, {}).map((c) => c.candidateId)).toEqual(['M1']);
  });
  it('accepts a comma list of decisions and the literal all', () => {
    expect(selectCandidates(all, { decisions: 'pending,approve' }).map((c) => c.candidateId)).toEqual(['M1', 'M2']);
    expect(selectCandidates(all, { decisions: 'all' })).toHaveLength(3);
  });
  it('ids win over decisions', () => {
    expect(selectCandidates(all, { decisions: 'approve', ids: 'M3' }).map((c) => c.candidateId)).toEqual(['M3']);
  });
});

describe('thumbFilename', () => {
  it('follows the thumb URL extension, normalizing jpeg', () => {
    expect(thumbFilename(cand('M9', 'pending', 'https://x/960px-a.JPEG?utm=1'))).toBe('M9.jpg');
    expect(thumbFilename(cand('M9', 'pending', 'https://x/960px-a.png'))).toBe('M9.png');
    expect(thumbFilename(cand('M9', 'pending', 'https://x/no-ext'))).toBe('M9.jpg');
  });
});
