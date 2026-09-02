/**
 * `tools/catalog.ts` — build/refresh `public/catalog.json` from the Commons category tree
 * (§6.2, §6.10). Network — but discovers only make/model NAMES and ids; `country` and `years`
 * are NEVER fetched (recon proved neither Wikidata nor Commons carries them, C1/C7) and are
 * ALWAYS hand-authored, preserved verbatim across every regeneration by id (§3.2).
 *
 * CLI:
 *   tsx tools/catalog.ts --out public/catalog.json [--brands 40] [--depth 2]
 *                         [--cache .cache/wikimedia] [--dry-run] [--resume]
 *                         [--review-only]   # offline: re-render docs/CATALOG-REVIEW.md
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Catalog, CatalogMake, CatalogModel } from '../schema/types';
import { normalizeId } from './lib/normalize';
import { WikimediaClient } from './lib/wikimedia';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DEFAULT_OUT_PATH = path.join(ROOT, 'public/catalog.json');
const DEFAULT_CACHE_DIR = path.join(ROOT, '.cache/wikimedia');
const DEFAULT_REVIEW_PATH = path.join(ROOT, 'docs/CATALOG-REVIEW.md');
const ROOT_CATEGORY = 'Category:Motorcycles by brand'; // NOT "...by manufacturer" — that root
// title does not exist on Commons (§6.7 gotcha).

// -------------------------------------------------------------------------------------------
// Pure helpers — category-title -> make/model name derivation (unit-tested directly)
// -------------------------------------------------------------------------------------------

export function deriveBrandName(categoryTitle: string): string {
  let name = categoryTitle.replace(/^Category:/, '');
  name = name.replace(/\s+motor(cycle|bike)s?$/i, '');
  name = name.replace(/\s+motorcycle marque$/i, '');
  return name.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strips a leading "Category:" and a leading repeat of the make name (Commons model
 *  subcategories are usually named "<Make> <Model>"). Returns `null` when nothing usable is
 *  left (an empty or make-only category name). */
export function deriveModelName(categoryTitle: string, makeName: string): string | null {
  let name = categoryTitle.replace(/^Category:/, '').trim();
  if (name.toLowerCase() === makeName.toLowerCase()) return null; // the make's own category, no model
  const prefix = new RegExp(`^${escapeRegExp(makeName)}\\s+`, 'i');
  if (prefix.test(name)) name = name.replace(prefix, '').trim();
  return name.length > 0 ? name : null;
}

// -------------------------------------------------------------------------------------------
// Pure merge (§3.2: hand-authored country/years ALWAYS win; a new make gets country "??" and
// is reported, never silently dropped) and markdown rendering (§6.10, offline, wholesale).
// -------------------------------------------------------------------------------------------

export interface DiscoveredMake {
  id: string;
  name: string;
  aliases: string[];
}

export interface DiscoveredModel {
  id: string;
  makeId: string;
  name: string;
  aliases: string[];
}

export interface MergeResult {
  catalog: Catalog;
  /** Newly discovered makes with no hand-authored country — "??" is loud, never silent (§3.2). */
  newMakesNeedingCountry: string[];
}

export function mergeCatalog(
  existing: Catalog,
  discoveredMakes: DiscoveredMake[],
  discoveredModels: DiscoveredModel[],
  generatedAt: string,
): MergeResult {
  const existingMakeIds = new Set(existing.makes.map((m) => m.id));
  const existingModelIds = new Set(existing.models.map((m) => m.id));

  const newMakesNeedingCountry: string[] = [];
  const addedMakes: CatalogMake[] = [];
  for (const d of discoveredMakes) {
    if (existingMakeIds.has(d.id)) continue; // existing wins entirely — nothing to merge in
    addedMakes.push({ id: d.id, name: d.name, country: '??', aliases: d.aliases });
    newMakesNeedingCountry.push(d.id);
  }

  const addedModels: CatalogModel[] = [];
  for (const d of discoveredModels) {
    if (existingModelIds.has(d.id)) continue;
    addedModels.push({ id: d.id, makeId: d.makeId, name: d.name, aliases: d.aliases, years: null });
  }

  return {
    catalog: {
      schema: 1,
      generatedAt,
      source: existing.makes.length > 0 || existing.models.length > 0 ? 'commons+wikidata' : 'wikimedia-commons',
      makes: [...existing.makes, ...addedMakes.sort((a, b) => a.id.localeCompare(b.id))],
      models: [...existing.models, ...addedModels.sort((a, b) => a.id.localeCompare(b.id))],
    },
    newMakesNeedingCountry,
  };
}

export function renderCatalogReview(catalog: Catalog): string {
  const modelsByMake = new Map<string, CatalogModel[]>();
  for (const model of catalog.models) {
    const list = modelsByMake.get(model.makeId) ?? [];
    list.push(model);
    modelsByMake.set(model.makeId, list);
  }

  const lines: string[] = [
    '# Catalog review',
    '',
    '> Generated wholesale by `tools/catalog.ts --review-only` from `public/catalog.json` (§6.10).',
    '> Never hand-edited, never appended to. Corrections go into `public/catalog.json` itself —',
    '> that file is the source of truth — then re-render this file.',
    '',
    '| Make | Country | Model | Years | Source |',
    '|---|---|---|---|---|',
  ];

  const sortedMakes = [...catalog.makes].sort((a, b) => a.name.localeCompare(b.name));
  for (const make of sortedMakes) {
    const models = (modelsByMake.get(make.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    if (models.length === 0) {
      lines.push(`| ${make.name} | ${make.country} | _(no models)_ |  | ${catalog.source} |`);
      continue;
    }
    for (const model of models) {
      const years = model.years === null ? '' : `${model.years[0]}–${model.years[1] ?? 'present'}`;
      lines.push(`| ${make.name} | ${make.country} | ${model.name} | ${years} | ${catalog.source} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// -------------------------------------------------------------------------------------------
// Network discovery — walks the Commons category tree. Untestable live (no network access in
// this environment); --dry-run / an empty cache is mechanically zero-request via
// tools/lib/wikimedia.ts, which every request here goes through.
// -------------------------------------------------------------------------------------------

interface CategoryMembersResponse {
  query?: { categorymembers?: Array<{ title: string }> };
}

async function listSubcategories(
  client: WikimediaClient,
  categoryTitle: string,
  limit: number,
): Promise<{ titles: string[]; wouldFetch: boolean }> {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers&` +
    `cmtitle=${encodeURIComponent(categoryTitle)}&cmtype=subcat&cmlimit=${limit}`;
  const result = await client.requestJson<CategoryMembersResponse>(url);
  if (result.wouldFetch) return { titles: [], wouldFetch: true };
  return { titles: (result.data?.query?.categorymembers ?? []).map((m) => m.title), wouldFetch: false };
}

export async function discoverMakesAndModels(
  client: WikimediaClient,
  brandLimit: number,
  depth: number,
): Promise<{ makes: DiscoveredMake[]; models: DiscoveredModel[] }> {
  const makes: DiscoveredMake[] = [];
  const models: DiscoveredModel[] = [];

  const brandCats = await listSubcategories(client, ROOT_CATEGORY, 500);
  if (brandCats.wouldFetch) return { makes, models };

  for (const brandCatTitle of brandCats.titles.slice(0, brandLimit)) {
    const makeName = deriveBrandName(brandCatTitle);
    const makeId = normalizeId(makeName);
    if (!makeId) continue;
    makes.push({ id: makeId, name: makeName, aliases: [] });

    const modelCats = await listSubcategories(client, brandCatTitle, 200);
    if (modelCats.wouldFetch) continue;

    for (const modelCatTitle of modelCats.titles) {
      const modelName = deriveModelName(modelCatTitle, makeName);
      if (!modelName) continue;
      const modelId = normalizeId(`${makeName} ${modelName}`);
      if (!modelId) continue;
      models.push({ id: modelId, makeId, name: modelName, aliases: [] });

      if (depth >= 2) {
        const variantCats = await listSubcategories(client, modelCatTitle, 100);
        if (variantCats.wouldFetch) continue;
        for (const variantCatTitle of variantCats.titles) {
          const variantName = deriveModelName(variantCatTitle, makeName);
          if (!variantName) continue;
          const variantId = normalizeId(`${makeName} ${variantName}`);
          if (!variantId) continue;
          models.push({ id: variantId, makeId, name: variantName, aliases: [] });
        }
      }
    }
  }

  return { makes, models };
}

// -------------------------------------------------------------------------------------------
// Orchestration
// -------------------------------------------------------------------------------------------

export interface CatalogOptions {
  outPath?: string;
  brands?: number;
  depth?: number;
  cacheDir?: string;
  dryRun?: boolean;
  reviewOnly?: boolean;
  reviewOutPath?: string;
  generatedAt?: string;
}

export interface CatalogResult {
  reviewOnly: boolean;
  dryRun: boolean;
  newMakesNeedingCountry: string[];
  makeCount: number;
  modelCount: number;
}

async function loadCatalogFile(outPath: string): Promise<Catalog> {
  try {
    return JSON.parse(await fs.readFile(outPath, 'utf8'));
  } catch {
    return { schema: 1, generatedAt: '', source: 'wikimedia-commons', makes: [], models: [] };
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function buildCatalog(opts: CatalogOptions = {}): Promise<CatalogResult> {
  const outPath = opts.outPath ?? DEFAULT_OUT_PATH;
  const reviewOutPath = opts.reviewOutPath ?? DEFAULT_REVIEW_PATH;

  if (opts.reviewOnly) {
    // Fully offline, unconditionally — no WikimediaClient is even constructed.
    const catalog = await loadCatalogFile(outPath);
    await fs.mkdir(path.dirname(reviewOutPath), { recursive: true });
    await fs.writeFile(reviewOutPath, renderCatalogReview(catalog));
    return { reviewOnly: true, dryRun: false, newMakesNeedingCountry: [], makeCount: catalog.makes.length, modelCount: catalog.models.length };
  }

  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR;
  const client = new WikimediaClient({ cacheDir, dryRun: opts.dryRun ?? false });
  const existing = await loadCatalogFile(outPath);
  const { makes, models } = await discoverMakesAndModels(client, opts.brands ?? 40, opts.depth ?? 2);
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  const merged = mergeCatalog(existing, makes, models, generatedAt);

  if (!opts.dryRun) {
    await writeJson(outPath, merged.catalog);
  }

  return {
    reviewOnly: false,
    dryRun: opts.dryRun ?? false,
    newMakesNeedingCountry: merged.newMakesNeedingCountry,
    makeCount: merged.catalog.makes.length,
    modelCount: merged.catalog.models.length,
  };
}

// -------------------------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await buildCatalog({
    outPath: typeof args.out === 'string' ? path.resolve(args.out) : undefined,
    brands: args.brands ? Number(args.brands) : undefined,
    depth: args.depth ? Number(args.depth) : undefined,
    cacheDir: typeof args.cache === 'string' ? args.cache : undefined,
    dryRun: args['dry-run'] === true,
    reviewOnly: args['review-only'] === true,
  });

  if (result.reviewOnly) {
    console.log(`catalog: regenerated docs/CATALOG-REVIEW.md from ${result.makeCount} makes / ${result.modelCount} models`);
    return;
  }
  console.log(
    `catalog: ${result.dryRun ? 'would produce' : 'wrote'} ${result.makeCount} makes / ${result.modelCount} models`,
  );
  if (result.newMakesNeedingCountry.length > 0) {
    console.log(
      `catalog: ${result.newMakesNeedingCountry.length} new make(s) need a country in ${DEFAULT_OUT_PATH}: ` +
        result.newMakesNeedingCountry.join(', '),
    );
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
