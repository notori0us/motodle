/**
 * The typeahead matcher (§5.3) — a tiered scan over a pre-normalized catalog. A higher tier
 * always beats a lower one regardless of score:
 *
 *   5  norm === q                                      exact
 *   4  norm.startsWith(q)                               prefix
 *   3  some word starts with q                          word-prefix
 *   2  norm.includes(q)                                 substring
 *   1  every query token prefix-matches some word,       token intersection (order-independent)
 *      any order
 *   0  in-order character subsequence, gap-penalized     fuzzy (fzy/Sublime heuristic)
 *   -  none of the above => reject
 *
 * Pure. No DOM.
 */
import type { CatalogIndex, MatchResult, MatchTier } from '../../schema/types';

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

// ---------------------------------------------------------------------------------------------
// The matcher proper. `norm` here is a display-preserving fold (lowercase, diacritics stripped,
// whitespace collapsed) — NOT `normalizeId`'s hyphenated id form — so a space-typed query like
// "honda cb750" can still hit an exact/prefix tier against a label's own spaces.
// ---------------------------------------------------------------------------------------------

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a folded string into words on any run of non-alphanumeric characters (spaces AND
 *  hyphens/slashes/parens), so "GSX-R750" tokenizes as ["gsx","r750"] for tier 1/3 purposes. */
function tokenize(norm: string): string[] {
  return norm.split(/[^a-z0-9]+/).filter(Boolean);
}

export interface MatchEntry {
  makeId: string;
  modelId: string;
  /** "{make.name} {model.name}", precomposed for display (§3.7). */
  label: string;
  norm: string;
  words: string[];
}

/** Precomputes `{ label, norm, words }` once per catalog load (§5.3) — a keystroke is then one
 *  linear pass over a few thousand short strings. */
export function buildMatchIndex(catalog: CatalogIndex): MatchEntry[] {
  const entries: MatchEntry[] = [];
  for (const model of catalog.models.values()) {
    const make = catalog.makes.get(model.makeId);
    if (!make) throw new Error(`match: model "${model.id}" has unknown makeId "${model.makeId}"`);
    const label = `${make.name} ${model.name}`;
    const norm = fold(label);
    entries.push({ makeId: make.id, modelId: model.id, label, norm, words: tokenize(norm) });
  }
  return entries;
}

/** fzy/Sublime-style subsequence heuristic (§5.3): +10 for an adjacent character, +max(1,8-gap)
 *  otherwise, +8 for a word-boundary hit, -0.05 x label length. Returns null when `q` is not a
 *  subsequence of `norm` at all. */
function fuzzyScore(norm: string, q: string): number | null {
  if (q.length === 0) return null;
  let score = 0;
  let searchFrom = 0;
  let lastMatch = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = norm.indexOf(q[qi], searchFrom);
    if (idx === -1) return null;
    if (lastMatch !== -1) {
      const gap = idx - lastMatch - 1;
      score += gap === 0 ? 10 : Math.max(1, 8 - gap);
    }
    const isWordBoundary = idx === 0 || !/[a-z0-9]/.test(norm[idx - 1]);
    if (isWordBoundary) score += 8;
    lastMatch = idx;
    searchFrom = idx + 1;
  }
  score -= 0.05 * norm.length;
  return score;
}

interface Classified {
  tier: MatchTier;
  score: number;
}

function classify(entry: MatchEntry, q: string, tokens: string[]): Classified | null {
  const { norm, words } = entry;
  if (norm === q) return { tier: 5, score: 1000 };
  if (norm.startsWith(q)) return { tier: 4, score: 1000 - norm.length };
  if (words.some((w) => w.startsWith(q))) return { tier: 3, score: 1000 };
  const substringAt = norm.indexOf(q);
  if (substringAt !== -1) return { tier: 2, score: 1000 - substringAt };
  if (tokens.length > 0 && tokens.every((t) => words.some((w) => w.startsWith(t)))) {
    return { tier: 1, score: 1000 };
  }
  const fuzzy = fuzzyScore(norm, q);
  if (fuzzy !== null) return { tier: 0, score: fuzzy };
  return null;
}

export interface MatchOptions {
  /** Locked-make filtering (§4.3, §5.3): narrows the candidate pool to that make's models. Each
   *  entry keeps its full `norm`/`words` (built from the FULL "{make} {model}" label), so make
   *  tokens stay searchable — "suz gsx" still matches Suzuki GSX-R750 with Suzuki locked. */
  lockedMakeId?: string | null;
}

function toMatchResult(entry: MatchEntry, c: Classified): MatchResult {
  return { makeId: entry.makeId, modelId: entry.modelId, label: entry.label, tier: c.tier, score: c.score };
}

/**
 * Full ranked match list — NOT truncated to 10. Exposed so a caller can do correct incremental
 * narrowing: because every tier here is monotonic in query-extension (anything that matches a
 * longer query also matches every prefix of it), filtering a PREVIOUS full `rankMatches` result
 * down against a longer query and re-ranking is provably equivalent to a fresh scan — but only
 * if the previous set wasn't already truncated to the top 10 shown on screen.
 */
export function rankMatches(query: string, entries: MatchEntry[], opts: MatchOptions = {}): MatchResult[] {
  const q = fold(query);
  if (q === '') return [];
  const tokens = tokenize(q);
  const pool = opts.lockedMakeId ? entries.filter((e) => e.makeId === opts.lockedMakeId) : entries;

  const classified: Array<{ entry: MatchEntry; c: Classified }> = [];
  for (const entry of pool) {
    const c = classify(entry, q, tokens);
    if (c) classified.push({ entry, c });
  }

  classified.sort((a, b) => {
    if (a.c.tier !== b.c.tier) return b.c.tier - a.c.tier;
    if (a.c.score !== b.c.score) return b.c.score - a.c.score;
    if (a.entry.label.length !== b.entry.label.length) return a.entry.label.length - b.entry.label.length;
    return a.entry.label.localeCompare(b.entry.label);
  });

  return classified.map(({ entry, c }) => toMatchResult(entry, c));
}

/** Sliced to the 10 options the combobox shows (§5.3). */
export function matchCatalog(query: string, entries: MatchEntry[], opts: MatchOptions = {}): MatchResult[] {
  return rankMatches(query, entries, opts).slice(0, 10);
}
