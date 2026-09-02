import { describe, expect, it } from 'vitest';
import { normalizeId } from './match';

// ---------------------------------------------------------------------------------------------
// §3.2 frozen normalizeId() vector table.
// ---------------------------------------------------------------------------------------------

describe('normalizeId — the §3.2 frozen vector table', () => {
  it.each([
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
  ])('normalizeId(%s) === %s', (input, expected) => {
    expect(normalizeId(input)).toBe(expected);
  });
});
