import { describe, expect, it } from 'vitest';
import { assertInvariants, baseRect, computeExtractRects } from './crop';
import { MIN_LEVEL1_PX } from '../schema/constants';

describe('baseRect', () => {
  it('returns the full width when W/H already equals or exceeds 4:3', () => {
    // 800x600 fixture 1: exactly 4:3.
    expect(baseRect(800, 600)).toEqual({ bw0: 800, bh0: 600 });
    // 960x720 fixture 2: exactly 4:3.
    expect(baseRect(960, 720)).toEqual({ bw0: 960, bh0: 720 });
  });

  it('rounds .5 up when deriving bh0 from a narrower-than-4:3 rect (fixture 3, §6.9)', () => {
    // 1454x1106 source-cropped fixture 3: narrower than 4:3, so bh0 = round(1454/(4/3)).
    // 1454 / (4/3) = 1090.5 exactly; JS Math.round rounds .5 up to 1091, not 1090.
    expect(baseRect(1454, 1106)).toEqual({ bw0: 1454, bh0: 1091 });
  });
});

describe('computeExtractRects — fixture 1 (2004 Suzuki GSX-R750, 800x600, no sourceCrop)', () => {
  const rects = computeExtractRects(800, 600, { x: 0.3, y: 0.68 }, [0.3, 0.41, 0.55, 0.74, 1.0]);

  it('matches the literal §3.1 example rects exactly', () => {
    expect(rects.map((r) => ({ w: r.bw, h: r.bh }))).toEqual([
      { w: 240, h: 180 },
      { w: 328, h: 246 },
      { w: 440, h: 330 },
      { w: 592, h: 444 },
      { w: 800, h: 600 },
    ]);
  });

  it('rect.w is strictly increasing across levels', () => {
    for (let i = 1; i < rects.length; i++) expect(rects[i].bw).toBeGreaterThan(rects[i - 1].bw);
  });
});

describe('computeExtractRects — fixture 3 (1995 Ducati 916, 1454x1106 source-cropped)', () => {
  const rects = computeExtractRects(1454, 1106, { x: 0.56, y: 0.55 }, [0.17, 0.26, 0.4, 0.62, 0.96]);

  it('matches the §6.9 computed geometry table exactly, including the level 4/5 rect split', () => {
    expect(rects.map((r) => ({ w: r.bw, h: r.bh }))).toEqual([
      { w: 247, h: 185 },
      { w: 378, h: 284 },
      { w: 582, h: 437 },
      { w: 901, h: 676 },
      { w: 1396, h: 1047 },
    ]);
  });

  it('level 1 rect meets MIN_LEVEL1_PX exactly at the boundary fraction', () => {
    expect(rects[0].bw).toBeGreaterThanOrEqual(MIN_LEVEL1_PX);
  });
});

describe('computeExtractRects — focus clamping', () => {
  it('clamps an edge focus into an edge-aligned rect rather than going out of bounds', () => {
    const [rect] = computeExtractRects(1000, 1000, { x: 0.02, y: 0.02 }, [0.5]);
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
  });

  it('clamps a focus near the far edge the same way', () => {
    const [rect] = computeExtractRects(1000, 1000, { x: 0.98, y: 0.98 }, [0.5]);
    expect(rect.left + rect.bw).toBeLessThanOrEqual(1000);
    expect(rect.top + rect.bh).toBeLessThanOrEqual(1000);
  });

  it('clamps an oversize fraction (>1) into an in-bounds rect', () => {
    const [rect] = computeExtractRects(1000, 1000, { x: 0.5, y: 0.5 }, [1.5]);
    expect(rect.bw).toBeLessThanOrEqual(1000);
    expect(rect.bh).toBeLessThanOrEqual(1000);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
  });
});

describe('assertInvariants', () => {
  it('accepts a valid strictly-increasing rect list at/above MIN_LEVEL1_PX', () => {
    const rects = computeExtractRects(800, 600, { x: 0.5, y: 0.5 }, [0.4, 0.52, 0.66, 0.82, 1.0]);
    expect(() => assertInvariants(rects)).not.toThrow();
  });

  it('throws "source too small" when the level-1 rect is below MIN_LEVEL1_PX', () => {
    const rects = computeExtractRects(800, 600, { x: 0.5, y: 0.5 }, [0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(rects[0].bw).toBeLessThan(MIN_LEVEL1_PX);
    expect(() => assertInvariants(rects)).toThrow(/source too small/);
  });

  it('throws when two levels tie on rect.w (fractions collapsed against a clamp)', () => {
    // A tiny image where two large fractions both saturate at the full width.
    const rects = computeExtractRects(300, 300, { x: 0.5, y: 0.5 }, [0.95, 0.97, 0.99, 1.0, 1.0]);
    expect(() => assertInvariants(rects)).toThrow(/strictly increasing/);
  });
});
