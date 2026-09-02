/**
 * Every URL the app fetches, in one place (§10.6). §9.5's CDN move is an edit to this file.
 */
export const PUZZLE_BASE_URL = '/puzzles/'; // manifest = `${PUZZLE_BASE_URL}manifest.json`
// puzzle   = `${PUZZLE_BASE_URL}${date}.json`
// images   = `${PUZZLE_BASE_URL}${level.src}`
export const CATALOG_URL = '/catalog.json';
export const SITE_URL = 'https://playmotodle.com'; // operator decision D5; share text ends with it

/** DEV-ONLY clock override (§7.4a). MUST be null in a production build — guard every read with
 *  `import.meta.env.DEV`, and honour `?today=YYYY-MM-DD` under the same guard. */
export const todayOverride: string | null = null;
