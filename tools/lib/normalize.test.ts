import { describe, expect, it } from 'vitest';
import { normalizeId } from './normalize';

// §3.2 frozen test vectors — the same table `src/lib/match.test.ts` (W3) asserts.
const FROZEN_VECTORS: [string, string][] = [
  ['GSX-R 750', 'gsxr750'],
  ['GSX-R750', 'gsxr750'],
  ['gsxr750', 'gsxr750'],
  ['Suzuki GSX-R750', 'suzuki-gsxr750'],
  ['Honda CB750', 'honda-cb750'],
  ['Honda FT 500', 'honda-ft500'],
  ['Harley-Davidson', 'harley-davidson'],
  ['Harley Davidson', 'harley-davidson'],
  ['Ninja ZX-6R', 'ninja-zx6r'],
  ['Kawasaki Ninja ZX-6R', 'kawasaki-ninja-zx6r'],
  ['Ducati 916', 'ducati-916'],
  ['ČZ', 'cz'],
];

describe('normalizeId — §3.2 frozen vectors', () => {
  for (const [input, expected] of FROZEN_VECTORS) {
    it(`normalizeId(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
      expect(normalizeId(input)).toBe(expected);
    });
  }
});

describe('normalizeId — additional properties', () => {
  it('empty string yields empty string', () => {
    expect(normalizeId('')).toBe('');
  });

  it('a string with only punctuation yields empty string', () => {
    expect(normalizeId('---///***')).toBe('');
  });

  it('is idempotent (normalizing an already-normalized id is a no-op)', () => {
    for (const [, expected] of FROZEN_VECTORS) {
      expect(normalizeId(expected)).toBe(expected);
    }
  });

  it('unprettily-normalizing ids are accepted as-is, not "fixed" (§3.2)', () => {
    // "BMW R75/5" -> "bmwr755" is documented as fine, not a bug.
    expect(normalizeId('BMW R75/5')).toBe('bmwr755');
  });
});
