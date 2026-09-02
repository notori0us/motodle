import { describe, expect, it } from 'vitest';
import type { Puzzle } from '../../schema/types';
import { PUZZLE_BASE_URL } from '../config';
import { loadManifest, loadPuzzle, manifestUrl, puzzleUrl, resolveAssetUrl } from './puzzle';

const PUZZLE: Puzzle = {
  schema: 1,
  id: 'mtd-0001',
  number: 1,
  date: '2026-09-02',
  answer: {
    makeId: 'suzuki',
    make: 'Suzuki',
    modelId: 'suzuki-gsxr750',
    model: 'GSX-R750',
    year: 2004,
    acceptModelIds: ['suzuki-gsxr750'],
  },
  image: {
    aspect: '4:3',
    focus: { x: 0.5, y: 0.5 },
    sourceCrop: null,
    cropFractions: [0.15, 0.25, 0.4, 0.62, 0.95],
    levels: [
      { level: 1, src: 'img/0001/l1.webp', w: 320, h: 240, rect: { w: 320, h: 240 }, bytes: 100 },
      { level: 2, src: 'img/0001/l2.webp', w: 400, h: 300, rect: { w: 400, h: 300 }, bytes: 100 },
      { level: 3, src: 'img/0001/l3.webp', w: 500, h: 375, rect: { w: 500, h: 375 }, bytes: 100 },
      { level: 4, src: 'img/0001/l4.webp', w: 600, h: 450, rect: { w: 600, h: 450 }, bytes: 100 },
      { level: 5, src: 'img/0001/l5.webp', w: 700, h: 525, rect: { w: 700, h: 525 }, bytes: 100 },
    ],
    full: { src: 'img/0001/full.webp', w: 800, h: 600, bytes: 100 },
  },
  credit: {
    fileTitle: 'File:test.jpg',
    descriptionUrl: 'https://commons.wikimedia.org/wiki/File:test.jpg',
    author: 'Someone',
    license: { id: 'PD', name: 'Public domain', url: 'https://commons.wikimedia.org/wiki/Template:PD-user', jurisdiction: null },
    attributionRequired: false,
    modified: 'cropped, resized, re-encoded to WebP',
    creditNote: null,
  },
  yearEvidence: { confidence: 'high', source: 'title', note: 'test', approvedBy: 'operator', approvedOn: '2026-09-02' },
};

describe('puzzleUrl / manifestUrl / resolveAssetUrl — resolved against PUZZLE_BASE_URL', () => {
  it('puzzleUrl builds `${PUZZLE_BASE_URL}${date}.json`', () => {
    expect(puzzleUrl('2026-09-02')).toBe(`${PUZZLE_BASE_URL}2026-09-02.json`);
  });

  it('manifestUrl builds `${PUZZLE_BASE_URL}manifest.json`', () => {
    expect(manifestUrl()).toBe(`${PUZZLE_BASE_URL}manifest.json`);
  });

  it('resolveAssetUrl resolves a relative level src against PUZZLE_BASE_URL — never absolute, never a full URL', () => {
    expect(resolveAssetUrl(PUZZLE.image.levels[0].src)).toBe(`${PUZZLE_BASE_URL}img/0001/l1.webp`);
  });
});

describe('loadPuzzle', () => {
  it('a 404 resolves to `no-puzzle` — NOT an error', async () => {
    const fetchImpl = async () => ({ status: 404, ok: false, json: async () => ({}) });
    const result = await loadPuzzle('2026-09-01', fetchImpl);
    expect(result).toEqual({ status: 'no-puzzle' });
  });

  it('a 500 resolves to `load-failed`', async () => {
    const fetchImpl = async () => ({ status: 500, ok: false, json: async () => ({}) });
    const result = await loadPuzzle('2026-09-02', fetchImpl);
    expect(result.status).toBe('load-failed');
  });

  it('a schema mismatch resolves to `load-failed`', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, json: async () => ({ schema: 2 }) });
    const result = await loadPuzzle('2026-09-02', fetchImpl);
    expect(result.status).toBe('load-failed');
  });

  it('a well-formed payload resolves to `ok`', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, json: async () => PUZZLE });
    const result = await loadPuzzle('2026-09-02', fetchImpl);
    expect(result).toEqual({ status: 'ok', puzzle: PUZZLE });
  });

  it('a network error (thrown fetch) resolves to `load-failed`, not a throw', async () => {
    const fetchImpl = async () => {
      throw new Error('offline');
    };
    const result = await loadPuzzle('2026-09-02', fetchImpl);
    expect(result.status).toBe('load-failed');
  });

  it('invalid JSON resolves to `load-failed`', async () => {
    const fetchImpl = async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    const result = await loadPuzzle('2026-09-02', fetchImpl);
    expect(result.status).toBe('load-failed');
  });
});

describe('loadManifest', () => {
  const MANIFEST = {
    schema: 1,
    launchDate: '2026-09-02',
    latest: { date: '2026-09-02', number: 1 },
    puzzles: [{ date: '2026-09-02', number: 1, id: 'mtd-0001' }],
  };

  it('resolves ok for a well-formed manifest', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, json: async () => MANIFEST });
    const result = await loadManifest(fetchImpl);
    expect(result).toEqual({ status: 'ok', manifest: MANIFEST });
  });

  it('load-failed on non-2xx', async () => {
    const fetchImpl = async () => ({ status: 500, ok: false, json: async () => ({}) });
    const result = await loadManifest(fetchImpl);
    expect(result.status).toBe('load-failed');
  });
});
