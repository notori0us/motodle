/**
 * Id normalization shared with `tools/lib/normalize.ts` (§3.2). Pure. No DOM.
 */

// ---------------------------------------------------------------------------------------------
// normalizeId() — VERBATIM from §3.2. `tools/lib/normalize.ts` (W2) must contain the identical
// body; §7.2 #10 proves the two have not drifted.
// ---------------------------------------------------------------------------------------------

const RUN = /[a-z]+|[0-9]+/g;

/** A run is "short" if it is a digit-run, or a letter-run of at most 3 characters. */
const isShortRun = (r: string): boolean => /^[0-9]/.test(r) || r.length <= 3;

export function normalizeId(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip diacritics: ČZ → cz
    .replace(/[^a-z0-9]+/g, '-') // every other character run → one hyphen
    .replace(/^-+|-+$/g, '');
  if (base === '') return '';

  const segments = base.split('-');
  const firstRun = (seg: string) => (seg.match(RUN) ?? [seg])[0];
  const lastRun = (seg: string) => (seg.match(RUN) ?? [seg]).at(-1)!;

  let out = segments[0];
  for (let i = 1; i < segments.length; i++) {
    const join = isShortRun(lastRun(segments[i - 1])) && isShortRun(firstRun(segments[i]));
    out += (join ? '' : '-') + segments[i];
  }
  return out;
}
