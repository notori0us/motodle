/**
 * `tools/prefetch.ts` — download what `tools/schedule.ts` needs but never fetches itself (§6.1:
 * schedule is offline by construction): the ORIGINAL bytes of every approved candidate go into
 * the Wikimedia response cache under exactly the URL schedule will read back, and, optionally,
 * each candidate's API-provided thumbnail is written as a plain image file for human/vision
 * review. Network — every request goes through the serial, rate-limited, cached client.
 *
 * CLI:
 *   tsx tools/prefetch.ts --review data/review/<batch>.json [--decisions approve|pending,approve|all]
 *                          [--ids M1,M2,…] [--originals] [--thumbs <dir>] [--cache .cache/wikimedia]
 *                          [--dry-run]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewCandidate, ReviewDecision, ReviewFile } from '../schema/types';
import { WikimediaClient } from './lib/wikimedia';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DEFAULT_CACHE_DIR = path.join(ROOT, '.cache/wikimedia');

/** Pure: which candidates a run touches. `ids` wins over `decisions`; `all` means every one. */
export function selectCandidates(
  candidates: ReviewCandidate[],
  opts: { decisions?: string; ids?: string },
): ReviewCandidate[] {
  if (opts.ids) {
    const wanted = new Set(opts.ids.split(',').map((s) => s.trim()).filter(Boolean));
    return candidates.filter((c) => wanted.has(c.candidateId));
  }
  const spec = (opts.decisions ?? 'approve').trim();
  if (spec === 'all') return candidates;
  const wanted = new Set(spec.split(',').map((s) => s.trim() as ReviewDecision));
  return candidates.filter((c) => wanted.has(c.decision));
}

/** Pure: a filesystem-safe thumbnail filename — the extension follows the thumb URL, not the
 *  original's mime (Commons renders TIFF/PNG thumbs as JPEG/PNG). */
export function thumbFilename(candidate: ReviewCandidate): string {
  const ext = /\.(jpe?g|png|webp|gif)(\?|$)/i.exec(candidate.thumbUrl)?.[1]?.toLowerCase() ?? 'jpg';
  return `${candidate.candidateId}.${ext === 'jpeg' ? 'jpg' : ext}`;
}

export interface PrefetchOptions {
  reviewPath: string;
  decisions?: string;
  ids?: string;
  originals?: boolean;
  thumbsDir?: string;
  cacheDir?: string;
  dryRun?: boolean;
}

export async function prefetch(opts: PrefetchOptions): Promise<{ selected: number; originals: number; thumbs: number }> {
  const review = JSON.parse(await fs.readFile(opts.reviewPath, 'utf8')) as ReviewFile;
  const selected = selectCandidates(review.candidates, opts);
  const client = new WikimediaClient({ cacheDir: opts.cacheDir ?? DEFAULT_CACHE_DIR, dryRun: opts.dryRun ?? false });
  let originals = 0;
  let thumbs = 0;

  if (opts.thumbsDir) await fs.mkdir(opts.thumbsDir, { recursive: true });

  for (const candidate of selected) {
    if (opts.thumbsDir) {
      const target = path.join(opts.thumbsDir, thumbFilename(candidate));
      let exists = false;
      try {
        await fs.access(target);
        exists = true;
      } catch {
        /* not yet written */
      }
      if (!exists) {
        const result = await client.requestBinary(candidate.thumbUrl);
        if (result.data) {
          await fs.writeFile(target, result.data);
          thumbs++;
        }
      }
    }
    if (opts.originals) {
      // Same URL string schedule.ts hands to requestBinary(), so the cache key matches (§6.3).
      const result = await client.requestBinary(candidate.originalUrl);
      if (result.data) originals++;
    }
  }

  const stats = client.getStats();
  console.log(
    `prefetch: ${selected.length} candidate(s); originals cached=${originals} thumbs written=${thumbs}; ` +
      `cache hits=${stats.cacheHits} network=${stats.networkRequests} would-fetch=${stats.wouldFetch}`,
  );
  return { selected: selected.length, originals, thumbs };
}

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

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.review !== 'string' || (!args.originals && typeof args.thumbs !== 'string')) {
    console.error(
      'usage: tsx tools/prefetch.ts --review data/review/<batch>.json [--decisions approve|pending,approve|all] ' +
        '[--ids M1,M2] [--originals] [--thumbs <dir>] [--cache .cache/wikimedia] [--dry-run]',
    );
    process.exitCode = 1;
  } else {
    prefetch({
      reviewPath: path.resolve(args.review),
      decisions: typeof args.decisions === 'string' ? args.decisions : undefined,
      ids: typeof args.ids === 'string' ? args.ids : undefined,
      originals: args.originals === true,
      thumbsDir: typeof args.thumbs === 'string' ? path.resolve(args.thumbs) : undefined,
      cacheDir: typeof args.cache === 'string' ? path.resolve(args.cache) : undefined,
      dryRun: args['dry-run'] === true,
    }).catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
  }
}
