import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleUserAgent, cacheKeyFor, DEFAULT_UA_CONTACT, WikimediaClient, withMandatoryParams } from './wikimedia';

const SCRATCH_ROOT = os.tmpdir();

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(SCRATCH_ROOT, 'wm-cache-'));
});

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
});

describe('assembleUserAgent — fail-fast before any request (§6.8, D5)', () => {
  it('assembles the default UA verbatim', () => {
    expect(assembleUserAgent(undefined)).toBe(`motodle/0.1 (${DEFAULT_UA_CONTACT}) node-fetch`);
  });

  it('never embeds an email address in the default contact', () => {
    expect(DEFAULT_UA_CONTACT).not.toMatch(/@/);
  });

  it('throws on an empty contact string', () => {
    expect(() => assembleUserAgent('')).toThrow(/empty/);
  });

  it('throws on a whitespace-only contact string', () => {
    expect(() => assembleUserAgent('   ')).toThrow(/empty/);
  });

  it('throws on a literal "<owner>"-style placeholder', () => {
    expect(() => assembleUserAgent('<owner>@example.com')).toThrow(/placeholder/);
  });

  it('throws on a contact containing a bare ">"', () => {
    expect(() => assembleUserAgent('https://example.com/>weird')).toThrow(/placeholder/);
  });

  it('accepts a real override', () => {
    expect(assembleUserAgent('https://example.com/my-fork; contact via issues')).toBe(
      'motodle/0.1 (https://example.com/my-fork; contact via issues) node-fetch',
    );
  });
});

describe('WikimediaClient constructor — fails fast, before any request is possible', () => {
  it('throws synchronously when the UA is invalid, even though no request has been made', () => {
    expect(() => new WikimediaClient({ cacheDir, uaContact: '<placeholder>' })).toThrow(/placeholder/);
  });
});

describe('withMandatoryParams (§6.7 — always append format=json&formatversion=2&maxlag=5)', () => {
  it('appends all three to a bare URL', () => {
    const out = new URL(withMandatoryParams('https://commons.wikimedia.org/w/api.php?action=query'));
    expect(out.searchParams.get('format')).toBe('json');
    expect(out.searchParams.get('formatversion')).toBe('2');
    expect(out.searchParams.get('maxlag')).toBe('5');
    expect(out.searchParams.get('action')).toBe('query');
  });

  it('does not duplicate or override an already-present param', () => {
    const out = new URL(withMandatoryParams('https://commons.wikimedia.org/w/api.php?maxlag=2'));
    expect(out.searchParams.get('maxlag')).toBe('2');
  });
});

describe('cacheKeyFor', () => {
  it('is deterministic and looks like a sha256 hex digest', () => {
    const key = cacheKeyFor('https://example.com/a');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKeyFor('https://example.com/a')).toBe(key);
  });

  it('differs for different URLs', () => {
    expect(cacheKeyFor('https://example.com/a')).not.toBe(cacheKeyFor('https://example.com/b'));
  });
});

describe('WikimediaClient — dry-run makes no network call on a cache miss', () => {
  it('reports wouldFetch and leaves data undefined, without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new WikimediaClient({ cacheDir, dryRun: true });
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&titles=Category:Test';
    const result = await client.requestJson(url);

    expect(result.wouldFetch).toBe(true);
    expect(result.fromCache).toBe(false);
    expect(result.data).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.getStats()).toEqual({ cacheHits: 0, networkRequests: 0, wouldFetch: 1 });
    expect(client.getWouldFetchUrls()).toHaveLength(1);
    fetchSpy.mockRestore();
  });

  it('an empty cache directory (clean-clone state) reports zero cache hits, no crash', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new WikimediaClient({ cacheDir, dryRun: true });
    await client.requestJson('https://commons.wikimedia.org/w/api.php?action=query&titles=Category:A');
    await client.requestJson('https://commons.wikimedia.org/w/api.php?action=query&titles=Category:B');
    expect(client.getStats().cacheHits).toBe(0);
    expect(client.getStats().wouldFetch).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('WikimediaClient — on-disk cache hit never touches the network, dry-run or not', () => {
  async function seedCache(url: string, body: unknown, ageMs = 0): Promise<void> {
    const key = cacheKeyFor(withMandatoryParams(url));
    const fetchedAt = new Date(Date.now() - ageMs).toISOString();
    await fs.writeFile(
      path.join(cacheDir, `${key}.json`),
      JSON.stringify({ url: withMandatoryParams(url), fetchedAt, encoding: 'json', body }),
    );
  }

  it('a fresh cache entry is returned verbatim, with no fetch call, even when dryRun is false', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&titles=Category:Suzuki';
    await seedCache(url, { query: { pages: [{ pageid: 1 }] } });

    const client = new WikimediaClient({ cacheDir, dryRun: false });
    const result = await client.requestJson(url);

    expect(result.fromCache).toBe(true);
    expect(result.wouldFetch).toBe(false);
    expect(result.data).toEqual({ query: { pages: [{ pageid: 1 }] } });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.getStats()).toEqual({ cacheHits: 1, networkRequests: 0, wouldFetch: 0 });
    fetchSpy.mockRestore();
  });

  it('a stale (>7 day TTL) cache entry is treated as a miss', async () => {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&titles=Category:Stale';
    await seedCache(url, { stale: true }, 8 * 24 * 60 * 60 * 1000);

    const client = new WikimediaClient({ cacheDir, dryRun: true }); // dry-run so a miss is safe to observe
    const result = await client.requestJson(url);
    expect(result.fromCache).toBe(false);
    expect(result.wouldFetch).toBe(true);
  });

  it('a corrupt cache file is treated as a miss, never crashes the walk', async () => {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&titles=Category:Corrupt';
    const key = cacheKeyFor(withMandatoryParams(url));
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, `${key}.json`), '{ not valid json');

    const client = new WikimediaClient({ cacheDir, dryRun: true });
    const result = await client.requestJson(url);
    expect(result.wouldFetch).toBe(true);
  });
});

describe('WikimediaClient — serial requests only, no parallelism (§6.8)', () => {
  // A fully-mocked global.fetch — this never reaches the real network, dry-run or not; it just
  // proves the CLIENT never issues two requests concurrently and spaces them apart.
  it('never has more than one fetch() in flight at a time, across concurrent callers', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WikimediaClient({ cacheDir, dryRun: false });
    await Promise.all([
      client.requestJson('https://commons.wikimedia.org/w/api.php?action=query&titles=A'),
      client.requestJson('https://commons.wikimedia.org/w/api.php?action=query&titles=B'),
      client.requestJson('https://commons.wikimedia.org/w/api.php?action=query&titles=C'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
    vi.unstubAllGlobals();
  }, 10_000);

  it('spaces consecutive real requests by at least ~180ms (the 200ms inter-request delay)', async () => {
    const timestamps: number[] = [];
    const fetchMock = vi.fn(async () => {
      timestamps.push(Date.now());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WikimediaClient({ cacheDir, dryRun: false });
    await client.requestJson('https://commons.wikimedia.org/w/api.php?action=query&titles=X');
    await client.requestJson('https://commons.wikimedia.org/w/api.php?action=query&titles=Y');

    expect(timestamps).toHaveLength(2);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(180);
    vi.unstubAllGlobals();
  }, 10_000);
});
