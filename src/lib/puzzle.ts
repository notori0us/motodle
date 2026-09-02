/**
 * Puzzle fetch (404 -> NoPuzzle), manifest fetch (§3.1, §3.3). Every `src` in a puzzle file is
 * relative and is resolved against `PUZZLE_BASE_URL` (§3, §10.6) — never absolute, never a full
 * URL, so the §9.5 CDN move is a one-line config edit.
 */
import type { Manifest, Puzzle } from '../../schema/types';
import { PUZZLE_BASE_URL } from '../config';
import type { FetchLike } from './catalog';

export function puzzleUrl(date: string): string {
  return `${PUZZLE_BASE_URL}${date}.json`;
}

export function manifestUrl(): string {
  return `${PUZZLE_BASE_URL}manifest.json`;
}

/** Resolves a puzzle-relative asset path (e.g. `image.levels[].src`) against `PUZZLE_BASE_URL`. */
export function resolveAssetUrl(relSrc: string): string {
  return `${PUZZLE_BASE_URL}${relSrc}`;
}

function isPuzzleShaped(data: unknown): data is Puzzle {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    d.schema === 1 &&
    typeof d.id === 'string' &&
    typeof d.date === 'string' &&
    typeof d.number === 'number' &&
    !!d.answer &&
    !!d.image &&
    !!d.credit &&
    !!d.yearEvidence
  );
}

export type PuzzleLoadResult =
  | { status: 'ok'; puzzle: Puzzle }
  | { status: 'no-puzzle' } // 404 — not an error, just no puzzle scheduled for that date
  | { status: 'load-failed'; reason: string };

/** Never throws. A 404 is `no-puzzle` (not an error — e.g. a date before `LAUNCH_DATE`, or past
 *  the last scheduled puzzle); any other non-2xx, a network error, invalid JSON, or a payload
 *  that doesn't look like a `Puzzle` (including an unrecognised `schema`) is `load-failed`. */
export async function loadPuzzle(date: string, fetchImpl: FetchLike = fetch): Promise<PuzzleLoadResult> {
  let res: { status: number; ok: boolean; json(): Promise<unknown> };
  try {
    res = await fetchImpl(puzzleUrl(date));
  } catch {
    return { status: 'load-failed', reason: 'network error' };
  }
  if (res.status === 404) {
    return { status: 'no-puzzle' };
  }
  if (!res.ok) {
    return { status: 'load-failed', reason: `http ${res.status}` };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: 'load-failed', reason: 'invalid json' };
  }
  if (!isPuzzleShaped(data)) {
    return { status: 'load-failed', reason: 'schema mismatch' };
  }
  return { status: 'ok', puzzle: data };
}

function isManifestShaped(data: unknown): data is Manifest {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.schema === 1 && typeof d.launchDate === 'string' && Array.isArray(d.puzzles) && !!d.latest;
}

export type ManifestLoadResult = { status: 'ok'; manifest: Manifest } | { status: 'load-failed'; reason: string };

export async function loadManifest(fetchImpl: FetchLike = fetch): Promise<ManifestLoadResult> {
  let res: { status: number; ok: boolean; json(): Promise<unknown> };
  try {
    res = await fetchImpl(manifestUrl());
  } catch {
    return { status: 'load-failed', reason: 'network error' };
  }
  if (!res.ok) {
    return { status: 'load-failed', reason: `http ${res.status}` };
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: 'load-failed', reason: 'invalid json' };
  }
  if (!isManifestShaped(data)) {
    return { status: 'load-failed', reason: 'schema mismatch' };
  }
  return { status: 'ok', manifest: data };
}
