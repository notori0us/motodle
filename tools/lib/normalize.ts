/**
 * `tools/lib/normalize.ts` — id normalization (§3.2). This file and `src/lib/match.ts` (W3)
 * must contain the SAME literal function body, character for character — that is what
 * `schema/catalog-contracts.test.ts`'s §7.2 #10 no-drift test asserts once both files exist.
 * Do not "clean up" or refactor this against prose intuition; it is copied verbatim from
 * PLAN.md §3.2.
 */

const RUN = /[a-z]+|[0-9]+/g;

/** A run is "short" if it is a digit-run, or a letter-run of at most 3 characters. */
const isShortRun = (r: string): boolean => /^[0-9]/.test(r) || r.length <= 3;

export function normalizeId(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')      // strip diacritics: ČZ → cz
    .replace(/[^a-z0-9]+/g, '-')                  // every other character run → one hyphen
    .replace(/^-+|-+$/g, '');
  if (base === '') return '';

  // Segments are the hyphen-separated pieces of `base`; runs are the maximal [a-z]+ / [0-9]+
  // stretches inside a segment. A hyphen is DELETED iff both runs it sits between are short.
  // Every decision is computed against the ORIGINAL segment list in one left-to-right pass;
  // a join never re-evaluates the longer run it just created.
  const segments = base.split('-');
  const firstRun = (seg: string) => (seg.match(RUN) ?? [seg])[0];
  const lastRun  = (seg: string) => (seg.match(RUN) ?? [seg]).at(-1)!;

  let out = segments[0];
  for (let i = 1; i < segments.length; i++) {
    const join = isShortRun(lastRun(segments[i - 1])) && isShortRun(firstRun(segments[i]));
    out += (join ? '' : '-') + segments[i];
  }
  return out;
}
