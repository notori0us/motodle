// Deterministic OG/social-card image generator (LAUNCH.md B2). SVG inlined here, not a separate
// tools/og/og.svg, to stay in this lane's file list. No <text> (font rendering isn't
// deterministic across machines) -- pure geometry: index.html's favicon chevron, scaled up, above
// a row of tile-colour rects, matching the pinned og:image:alt ("chevron mark above ... tiles").
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(HERE, '..', 'public', 'og.png');

const PLATE = '#15181d';
const CHEVRON = '#0d6b8a';
const TILE_GREEN = '#3b7d22';
const TILE_YELLOW = '#946c0a';
const TILE_RED = '#b32222';

// 1200x630 viewBox. Chevron path is index.html's favicon path (`M15 42 L27 24 L36 34 L50 12`
// in a 0..64 box), translated/scaled and centered in the upper half; stroke-width scaled with it.
// Tile row centered below, matching og:image:alt ("chevron mark above ... tiles"). Paths and
// rects only — no <text>, no external refs.
const OG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PLATE}"/>
  <g transform="translate(472,80) scale(4)">
    <path d="M15 42 L27 24 L36 34 L50 12" stroke="${CHEVRON}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
  <rect x="445" y="420" width="90" height="90" rx="14" fill="${TILE_GREEN}"/>
  <rect x="555" y="420" width="90" height="90" rx="14" fill="${TILE_YELLOW}"/>
  <rect x="665" y="420" width="90" height="90" rx="14" fill="${TILE_RED}"/>
</svg>`;

/**
 * Renders the card and returns the PNG bytes. Pure — no filesystem write — so the unit test can
 * call it twice in-process and diff the buffers without touching `public/og.png`.
 */
export async function renderOg(): Promise<Buffer> {
  return sharp(Buffer.from(OG_SVG), { density: 144 })
    .resize(1200, 630, { fit: 'contain' })
    // MANDATORY. `fit: contain` pads with TRANSPARENCY, and Reddit, X and some Slack clients
    // composite alpha to black or white unpredictably -- the card then looks broken in the one
    // place it is ever seen. #15181d is the favicon's ink plate, so the card matches the mark.
    .flatten({ background: PLATE })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main(): Promise<void> {
  const png = await renderOg();
  await writeFile(OUT_PATH, png);
  console.log(`wrote ${OUT_PATH} (${png.length} bytes)`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
