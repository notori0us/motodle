/**
 * Frozen numeric/string constants (§4.1, §4.7, §10.6). One place; `tools/crop.ts` and
 * `tools/check-budget.ts` import from here, never re-declare a value.
 */

// ---------------------------------------------------------------------------------------------
// Puzzle number arithmetic (§4.1)
// ---------------------------------------------------------------------------------------------

export const LAUNCH_DATE = '2026-09-02';
/** 2026-09-02 ⇒ Motodle #1 (operator decision D1, §1.3). */
export const PUZZLE_NUMBER_OFFSET = 1;

// ---------------------------------------------------------------------------------------------
// Crop geometry (§4.7)
// ---------------------------------------------------------------------------------------------

/** Level 1..5, a geometric sequence: fᵢ = 0.11 · r^(i-1), r = (0.95/0.11)^(1/4) = 1.71428,
 *  rounded to 2 dp. Exact sequence 0.11000, 0.18857, 0.32326, 0.55417, 0.95000. §4.7a. */
export const DEFAULT_CROP_FRACTIONS = [0.11, 0.19, 0.32, 0.55, 0.95] as const; // level 1..5
export const CROP_ASPECT = 4 / 3;
export const CROP_TARGET_WIDTH = 900; // max output width; never upscales
export const MIN_LEVEL1_PX = 240; // hard validation floor — was 280, §4.7a (b)

/** DERIVED, never hand-set: a source narrower than this cannot satisfy MIN_LEVEL1_PX at the
 *  default fractions, so the fetcher must not approve it without an override. */
export const MIN_SOURCE_WIDTH = Math.ceil(MIN_LEVEL1_PX / DEFAULT_CROP_FRACTIONS[0]); // = 2182

export const DEFAULT_FOCUS = { x: 0.5, y: 0.5 } as const;

// ---------------------------------------------------------------------------------------------
// CSP (§13.2.3 / §13.2.6 D4) — served in production by infra/variables.tf's
// content_security_policy default, and here so vite.config.ts's `preview.headers` (§13.5.2) and
// the app can share one string. schema/csp-contract.test.ts asserts the two never drift.
// ---------------------------------------------------------------------------------------------

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

// ---------------------------------------------------------------------------------------------
// Budgets — every budget referenced anywhere in the plan lives HERE, one place.
// ---------------------------------------------------------------------------------------------

export const CROP_BUDGET_BYTES = 360_000; // sum of the 5 level WebPs
export const FULL_BUDGET_BYTES = 250_000; // the lazy full reveal (outside the day budget)
export const DAY_BUDGET_BYTES = 400_000; // puzzle JSON + its 5 levels, raw (brief)
export const JS_GZ_BUDGET_BYTES = 60 * 1024; // app JS, gzipped (brief)
export const CSS_GZ_BUDGET_BYTES = 20 * 1024; // app CSS, gzipped
export const CATALOG_GZ_BUDGET_BYTES = 150 * 1024; // public/catalog.json, gzipped (brief)

export const FULL_TARGET_WIDTH = 1400;
export const WEBP_QUALITY_START = 80;
export const WEBP_QUALITY_MIN = 56;
export const WEBP_QUALITY_STEP = 4;

// ---------------------------------------------------------------------------------------------
// ISO 3166-1 alpha-2 -> display name, for help text only (RULE A, §4.2). Covers every
// `makes[].country` value used by the seed catalog (§6.10); contract test §7.2 #11 enforces
// that every catalog country resolves here.
// ---------------------------------------------------------------------------------------------

export const COUNTRY_NAMES: Record<string, string> = {
  JP: 'Japan',
  IT: 'Italy',
  GB: 'United Kingdom',
  US: 'United States',
  DE: 'Germany',
  AT: 'Austria',
  IN: 'India',
  CN: 'China',
  TW: 'Taiwan',
  ES: 'Spain',
  SE: 'Sweden',
  CZ: 'Czechia',
  FR: 'France',
  KR: 'South Korea',
  RU: 'Russia',
  UA: 'Ukraine',
};
