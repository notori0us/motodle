// LAUNCH.md B2: alpha/size gate on the committed PNG + in-process idempotency (no golden-byte gate).
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderOg } from './og';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OG_PNG_PATH = path.join(HERE, '..', 'public', 'og.png');
const MAX_BYTES = 100 * 1024;

describe('public/og.png (committed)', () => {
  it('exists', () => {
    expect(existsSync(OG_PNG_PATH)).toBe(true);
  });

  it('is 1200x630 PNG with no alpha channel, under 100 KB', async () => {
    const meta = await sharp(OG_PNG_PATH).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(false);
    expect(statSync(OG_PNG_PATH).size).toBeLessThan(MAX_BYTES);
  });
});

describe('renderOg()', () => {
  it('is byte-for-byte idempotent across two runs', async () => {
    const a = await renderOg();
    const b = await renderOg();
    expect(a.equals(b)).toBe(true);
  });

  it('produces a 1200x630 PNG with no alpha channel', async () => {
    const png = await renderOg();
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(false);
  });
});
