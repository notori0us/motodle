/**
 * Catalog load, index build, locked-make filtering (§3.2, §5.3). Pure data shaping — the fetch
 * wrapper is the only part that touches the network, and it accepts an injected fetch-like
 * function so nothing here depends on a live server to be tested.
 */
import type { Catalog, CatalogIndex, CatalogMake, CatalogModel } from '../../schema/types';
import { CATALOG_URL } from '../config';

/** Builds the runtime `CatalogIndex` `evaluateGuess()` reads (§3.7) from the on-disk `Catalog`
 *  shape. `makes`/`models` are keyed by id. */
export function buildCatalogIndex(catalog: Catalog): CatalogIndex {
  return {
    makes: new Map(catalog.makes.map((m) => [m.id, m])),
    models: new Map(catalog.models.map((m) => [m.id, m])),
  };
}

export function getMake(index: CatalogIndex, id: string): CatalogMake {
  const make = index.makes.get(id);
  if (!make) throw new Error(`catalog: unknown make id "${id}"`);
  return make;
}

export function getModel(index: CatalogIndex, id: string): CatalogModel {
  const model = index.models.get(id);
  if (!model) throw new Error(`catalog: unknown model id "${id}"`);
  return model;
}

/** Locked-make filtering (§4.3, §5.3): every model belonging to `makeId`, nothing else. */
export function modelsForMake(index: CatalogIndex, makeId: string): CatalogModel[] {
  return [...index.models.values()].filter((m) => m.makeId === makeId);
}

/** Minimal shape `loadCatalog` needs from `fetch` — avoids pinning callers to the full global
 *  `fetch` signature so a test double doesn't need to construct a real `Response`. */
export interface FetchLike {
  (url: string): Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;
}

export type CatalogLoadResult = { status: 'ok'; catalog: Catalog } | { status: 'load-failed'; reason: string };

function isCatalogShaped(data: unknown): data is Catalog {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).schema === 1 &&
    Array.isArray((data as Record<string, unknown>).makes) &&
    Array.isArray((data as Record<string, unknown>).models)
  );
}

/** Fetches `CATALOG_URL`. Never throws — every failure mode (network error, non-2xx, invalid
 *  JSON, wrong/missing `schema`) comes back as `{ status: 'load-failed' }`. */
export async function loadCatalog(fetchImpl: FetchLike = fetch): Promise<CatalogLoadResult> {
  let res: { status: number; ok: boolean; json(): Promise<unknown> };
  try {
    res = await fetchImpl(CATALOG_URL);
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
  if (!isCatalogShaped(data)) {
    return { status: 'load-failed', reason: 'schema mismatch' };
  }
  return { status: 'ok', catalog: data };
}
