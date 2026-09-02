/**
 * `tools/lib/wikimedia.ts` — Wikimedia API client (§6.7, §6.8): User-Agent assembly, maxlag,
 * gzip, a serial request queue, and an on-disk response cache.
 *
 * NEVER imported by `tools/generate.ts` (directly or transitively) — that is what keeps
 * `npm run generate` mechanically offline (§7.2 #14). `tools/catalog.ts` and `tools/fetch.ts`
 * are the only importers.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (§6.8)
const MIN_REQUEST_INTERVAL_MS = 200; // "200ms inter-request delay" (§6.8)
const MAX_ATTEMPTS = 5; // "1s -> 30s, 5 attempts" (§6.8)
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

// -------------------------------------------------------------------------------------------
// User-Agent (§6.8, D5) — assembled and validated BEFORE any request is ever made.
// -------------------------------------------------------------------------------------------

export const DEFAULT_UA_CONTACT = 'https://github.com/reenchree/motodle; homelab hobby project';

/** Fails fast (before any request) if the assembled UA is empty or still contains a literal
 *  `<`/`>` placeholder — a `<owner>` template yields a 404 contact URL, which under Wikimedia's
 *  UA policy is worse than no URL at all. No email address is ever used (D5). */
export function assembleUserAgent(contact: string | undefined = process.env.MOTODLE_UA_CONTACT): string {
  const c = (contact ?? DEFAULT_UA_CONTACT).trim();
  if (c === '') {
    throw new Error('wikimedia.ts: MOTODLE_UA_CONTACT resolved to an empty string — refusing to make requests');
  }
  if (c.includes('<') || c.includes('>')) {
    throw new Error(
      `wikimedia.ts: MOTODLE_UA_CONTACT "${c}" still contains a "<"/">" placeholder — replace it with a ` +
        'real repo URL or contact URL before making requests',
    );
  }
  return `motodle/0.1 (${c}) node-fetch`;
}

// -------------------------------------------------------------------------------------------
// On-disk cache — `.cache/wikimedia/<sha256(url)>.json`, TTL + URL stored alongside for
// auditing; every request URL is also appended to `.cache/wikimedia/urls.log`.
// -------------------------------------------------------------------------------------------

export function cacheKeyFor(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

interface CacheEnvelope {
  url: string;
  fetchedAt: string; // ISO timestamp
  /** JSON responses store the parsed body; binary responses store base64. */
  encoding: 'json' | 'base64';
  body: unknown;
}

async function readCacheEntry(cacheDir: string, url: string, ttlMs: number): Promise<CacheEnvelope | null> {
  const file = path.join(cacheDir, `${cacheKeyFor(url)}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
  let entry: CacheEnvelope;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null; // corrupt cache entry — treat as a miss, never crash the walk
  }
  const age = Date.now() - Date.parse(entry.fetchedAt);
  if (!Number.isFinite(age) || age > ttlMs) return null;
  return entry;
}

async function writeCacheEntry(cacheDir: string, url: string, entry: CacheEnvelope): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${cacheKeyFor(url)}.json`);
  await fs.writeFile(file, JSON.stringify(entry));
  await fs.appendFile(path.join(cacheDir, 'urls.log'), `${new Date().toISOString()} ${url}\n`);
}

// -------------------------------------------------------------------------------------------
// Request helpers
// -------------------------------------------------------------------------------------------

/** Appends the mandatory `format=json&formatversion=2&maxlag=5` (§6.7) if not already present. */
export function withMandatoryParams(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has('format')) u.searchParams.set('format', 'json');
  if (!u.searchParams.has('formatversion')) u.searchParams.set('formatversion', '2');
  if (!u.searchParams.has('maxlag')) u.searchParams.set('maxlag', '5');
  return u.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WikimediaClientOptions {
  cacheDir: string;
  /** When true, a cache miss is recorded as "would fetch" and NO network call is made. */
  dryRun?: boolean;
  uaContact?: string;
  ttlMs?: number;
}

export interface RequestResult<T> {
  data: T | undefined;
  fromCache: boolean;
  /** True only in dry-run mode on a cache miss — `data` is undefined in that case. */
  wouldFetch: boolean;
}

/**
 * Etiquette (§6.8): serial requests only (no parallelism), a 200ms inter-request delay (which,
 * by construction, caps throughput at 5 req/s — the token bucket the plan also names), gzip
 * Accept-Encoding, exponential backoff on 429/503/5xx, and maxlag-aware retry. Read-only — no
 * write path exists at all (no `action=edit`, no tokens, no login).
 */
export class WikimediaClient {
  private readonly cacheDir: string;
  private readonly dryRun: boolean;
  private readonly ttlMs: number;
  private readonly userAgent: string;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private wouldFetchUrls: string[] = [];
  private cacheHits = 0;
  private networkRequests = 0;

  constructor(opts: WikimediaClientOptions) {
    // Fail fast — before any request, dry-run or not (§6.8).
    this.userAgent = assembleUserAgent(opts.uaContact);
    this.cacheDir = opts.cacheDir;
    this.dryRun = opts.dryRun ?? false;
    this.ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
  }

  getStats(): { cacheHits: number; networkRequests: number; wouldFetch: number } {
    return { cacheHits: this.cacheHits, networkRequests: this.networkRequests, wouldFetch: this.wouldFetchUrls.length };
  }

  getWouldFetchUrls(): string[] {
    return [...this.wouldFetchUrls];
  }

  /** Fetches a MediaWiki API JSON endpoint (`action=query…`, `action=wbgetentities…`, …). */
  async requestJson<T = unknown>(rawUrl: string): Promise<RequestResult<T>> {
    const url = withMandatoryParams(rawUrl);
    return this.run<T>(url, 'json');
  }

  /** Fetches a binary resource (an original image, e.g. `imageinfo.url`). No mandatory params
   *  are appended — those are an api.php convention, not an upload-host one. */
  async requestBinary(url: string): Promise<RequestResult<Buffer>> {
    return this.run<Buffer>(url, 'binary');
  }

  private async run<T>(url: string, kind: 'json' | 'binary'): Promise<RequestResult<T>> {
    const cached = await readCacheEntry(this.cacheDir, url, this.ttlMs);
    if (cached) {
      this.cacheHits++;
      const data = kind === 'binary' ? (Buffer.from(cached.body as string, 'base64') as unknown as T) : (cached.body as T);
      return { data, fromCache: true, wouldFetch: false };
    }

    if (this.dryRun) {
      this.wouldFetchUrls.push(url);
      return { data: undefined, fromCache: false, wouldFetch: true };
    }

    // Serialize: every real network call goes through one chained queue, one at a time.
    const result = this.queue.then(() => this.fetchWithRetry<T>(url, kind));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async fetchWithRetry<T>(url: string, kind: 'json' | 'binary'): Promise<RequestResult<T>> {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.lastRequestAt = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { 'User-Agent': this.userAgent, 'Accept-Encoding': 'gzip' },
        });
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) throw err;
        await sleep(Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
        continue;
      }

      if (response.status === 429 || response.status === 503 || response.status >= 500) {
        if (attempt === MAX_ATTEMPTS) {
          throw new Error(`wikimedia.ts: ${response.status} from ${url} after ${MAX_ATTEMPTS} attempts`);
        }
        await sleep(Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
        continue;
      }
      if (!response.ok) {
        throw new Error(`wikimedia.ts: HTTP ${response.status} from ${url}`);
      }

      if (kind === 'json') {
        const body = await response.json();
        const maxlagCode = (body as { error?: { code?: string; lag?: number } })?.error?.code;
        if (maxlagCode === 'maxlag') {
          if (attempt === MAX_ATTEMPTS) {
            throw new Error(`wikimedia.ts: maxlag exceeded on ${url} after ${MAX_ATTEMPTS} attempts`);
          }
          const lagSeconds = (body as { error?: { lag?: number } }).error?.lag ?? 5;
          await sleep(lagSeconds * 1000);
          continue;
        }
        this.networkRequests++;
        await writeCacheEntry(this.cacheDir, url, {
          url,
          fetchedAt: new Date().toISOString(),
          encoding: 'json',
          body,
        });
        return { data: body as T, fromCache: false, wouldFetch: false };
      } else {
        const buf = Buffer.from(await response.arrayBuffer());
        this.networkRequests++;
        await writeCacheEntry(this.cacheDir, url, {
          url,
          fetchedAt: new Date().toISOString(),
          encoding: 'base64',
          body: buf.toString('base64'),
        });
        return { data: buf as unknown as T, fromCache: false, wouldFetch: false };
      }
    }
    // Unreachable — the loop above always returns or throws.
    throw new Error(`wikimedia.ts: exhausted retries for ${url}`);
  }
}
