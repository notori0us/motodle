/**
 * §7.2 #14 — `tools/generate.ts` is offline BY CONSTRUCTION. A clean clone has an empty
 * `.cache/wikimedia/`, so "no network call happened" cannot be proven by observing side effects
 * — there may be nothing to observe. This test proves it structurally instead: walk
 * `tools/generate.ts`'s transitive local import graph and assert it never reaches
 * `tools/lib/wikimedia.ts`, never imports `node:http`/`node:https`/`undici`, and no visited file
 * contains a call to the global `fetch` function.
 *
 * Only IMPORT SPECIFIERS are inspected (not arbitrary substrings of file text) — this file's own
 * prose, and generate.ts's own doc comment, both mention "wikimedia.ts" and "fetch" freely, and
 * a naive substring scan would flag itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(__dirname, 'generate.ts');

const FORBIDDEN_BARE_SPECIFIERS = ['node:http', 'node:https', 'undici', 'http', 'https'];

// Matches `import x from '...'`, `import '...'`, `import { a } from "..."`,
// `export * from '...'`, and dynamic `import('...')`.
const IMPORT_RE = /(?:import|export)(?:[^'";]*?from)?\s*\(?\s*['"]([^'"]+)['"]/g;

interface WalkResult {
  visitedFiles: Set<string>;
  bareSpecifiers: Set<string>;
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // bare specifier (npm pkg or node: built-in)
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')];
  for (const c of candidates) {
    try {
      readFileSync(c, 'utf8');
      return c;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function walk(entry: string): WalkResult {
  const visitedFiles = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const stack = [entry];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visitedFiles.has(file)) continue;
    visitedFiles.add(file);

    const text = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      const specifier = m[1];
      const local = resolveLocal(file, specifier);
      if (local) {
        stack.push(local);
      } else {
        bareSpecifiers.add(specifier);
      }
    }
  }

  return { visitedFiles, bareSpecifiers };
}

describe('§7.2 #14 — tools/generate.ts is offline by construction', () => {
  const { visitedFiles, bareSpecifiers } = walk(ENTRY);

  it('sanity: the walk actually visited more than just the entry file', () => {
    // Proves the import-following regex works at all, rather than vacuously passing on a
    // graph of size 1.
    expect(visitedFiles.size).toBeGreaterThan(1);
  });

  it('never imports tools/lib/wikimedia.ts, directly or transitively', () => {
    const wikimediaPath = path.join(ROOT, 'tools/lib/wikimedia.ts');
    expect(visitedFiles.has(wikimediaPath)).toBe(false);
  });

  it('never imports node:http, node:https, or undici (bare specifiers)', () => {
    for (const forbidden of FORBIDDEN_BARE_SPECIFIERS) {
      expect(bareSpecifiers.has(forbidden)).toBe(false);
    }
  });

  it('never imports tools/catalog.ts or tools/fetch.ts (the two network-capable CLIs)', () => {
    expect(visitedFiles.has(path.join(ROOT, 'tools/catalog.ts'))).toBe(false);
    expect(visitedFiles.has(path.join(ROOT, 'tools/fetch.ts'))).toBe(false);
  });

  it('no visited file calls the global fetch() function', () => {
    const offenders: string[] = [];
    for (const file of visitedFiles) {
      const text = readFileSync(file, 'utf8');
      // Strip line comments and block comments before scanning, so a doc comment that merely
      // MENTIONS the word "fetch" cannot produce a false positive.
      const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/\bfetch\s*\(/.test(stripped)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('lists exactly the expected local dependency set (documents the graph, catches silent growth)', () => {
    const relative = [...visitedFiles].map((f) => path.relative(ROOT, f)).sort();
    expect(relative).toEqual(
      [
        'tools/generate.ts',
        'schema/constants.ts',
        'tools/lib/attribution.ts',
        'tools/lib/date.ts',
        'tools/lib/puzzle-build.ts',
        'tools/crop.ts',
        'schema/types.ts',
      ].sort(),
    );
  });
});
