/**
 * Shared TypeScript contracts (§3.7). No runtime dependencies. Imported by both `src/` and
 * `tools/`. This file defines TYPE SHAPE only — the numeric/string invariants that go beyond
 * what TypeScript's structural types can express (strictly-increasing crop fractions, id
 * uniqueness, "low" never shipping, etc.) are enforced by the JSON Schemas + `schema/*.test.ts`
 * contract suite (§7.2), not by these types.
 */

// ---------------------------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------------------------

/** Every shipped JSON file starts with `"schema": 1`. An unknown value must fail loudly. */
export type Schema1 = 1;

// ---------------------------------------------------------------------------------------------
// Geometry (§3.1, §4.7)
// ---------------------------------------------------------------------------------------------

/** Fractions in [0,1]. For `image.focus`: of the source-cropped image. For `sourceCrop`'s
 *  own x/y: of the original file. */
export interface FocusPoint {
  x: number;
  y: number;
}

/** Fractions of the ORIGINAL file, applied before level generation. `null` = whole image. */
export interface SourceCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The extracted source rect in source-cropped pixels, before the resize (§4.7). */
export interface CropRect {
  w: number;
  h: number;
}

export interface CropLevel {
  /** 1 (tightest) .. 5 (widest). */
  level: number;
  /** Relative to PUZZLE_BASE_URL. */
  src: string;
  /** Encoded output pixels: min(CROP_TARGET_WIDTH, rect.w), never upscaled. Non-decreasing
   *  across levels 1->5. */
  w: number;
  h: number;
  /** The extracted source rect. Strictly increasing in `rect.w` across levels 1->5. */
  rect: CropRect;
  /** On-disk WebP size in bytes. */
  bytes: number;
}

export interface PuzzleImage {
  /** Only value in schema 1. Describes the five `levels` only — never `full`. */
  aspect: '4:3';
  focus: FocusPoint;
  sourceCrop: SourceCrop | null;
  /** Strictly increasing, each in (0,1]. Length 5, one per level. */
  cropFractions: readonly [number, number, number, number, number];
  /** Ordered, level = 1..5. */
  levels: CropLevel[];
  /** The lazy reveal image. No `level`, no `rect`, no 4:3 constraint (letterboxed, not
   *  distorted). Not counted in the day budget. */
  full: { src: string; w: number; h: number; bytes: number };
}

// ---------------------------------------------------------------------------------------------
// Credit / licence (§3.1, §6.5)
// ---------------------------------------------------------------------------------------------

export type LicenseId =
  | 'PD'
  | 'CC0'
  | 'CC-BY-2.0'
  | 'CC-BY-2.5'
  | 'CC-BY-3.0'
  | 'CC-BY-4.0'
  | 'CC-BY-SA-2.0'
  | 'CC-BY-SA-2.5'
  | 'CC-BY-SA-3.0'
  | 'CC-BY-SA-4.0';

export interface LicenseRef {
  id: LicenseId;
  /** Human label, verbatim from `extmetadata.LicenseShortName`. Never constructed. */
  name: string;
  /** Deed URL, verbatim from `extmetadata.LicenseUrl`. Never derived from `id`. */
  url: string;
  /** The jurisdiction suffix `id` drops (e.g. "de"), else null. */
  jurisdiction: string | null;
}

export interface CreditBlock {
  fileTitle: string;
  descriptionUrl: string;
  /** Plain text, HTML stripped from `extmetadata.Artist`. Never empty. */
  author: string;
  license: LicenseRef;
  /** Advisory only — the UI always shows the credit regardless. */
  attributionRequired: boolean;
  /** The §6.5a indication-of-modification. Constant for this pipeline:
   *  "cropped, resized, re-encoded to WebP". Rendered for every puzzle, PD included. */
  modified: string;
  /** Free text for an author's prose credit request. Rendered verbatim when non-null. */
  creditNote: string | null;
}

// ---------------------------------------------------------------------------------------------
// Year evidence (§3.1, §6.4)
// ---------------------------------------------------------------------------------------------

/** Shared by `YearEvidence.confidence` (shipped puzzles: never `low`) and
 *  `ReviewCandidate.yearConfidence` (pre-ship: `low`/`none` force an auto-reject, §3.4). */
export type YearConfidence = 'high' | 'medium' | 'low' | 'operator' | 'none';

export interface YearEvidence {
  /** `low` may not appear in a shipped puzzle. `operator` = no machine evidence, a human
   *  asserted it. */
  confidence: YearConfidence;
  /** e.g. "title", "title+description", "description", "category", "operator". */
  source: string;
  /** Human-readable justification, quoting the evidence. */
  note: string;
  /** Only legal value. Nothing ships un-approved. */
  approvedBy: 'operator';
  approvedOn: string;
}

// ---------------------------------------------------------------------------------------------
// Puzzle (§3.1)
// ---------------------------------------------------------------------------------------------

export interface PuzzleAnswer {
  makeId: string;
  make: string;
  modelId: string;
  /** Display name, WITHOUT the make. */
  model: string;
  year: number;
  /** Model ids that count as MODEL-green. Always contains `modelId`. Length >= 1. */
  acceptModelIds: string[];
}

export interface Puzzle {
  schema: Schema1;
  /** Stable forever: `mtd-${String(number).padStart(4,'0')}`. Carries no answer material. */
  id: string;
  number: number;
  date: string;
  answer: PuzzleAnswer;
  image: PuzzleImage;
  credit: CreditBlock;
  yearEvidence: YearEvidence;
}

// ---------------------------------------------------------------------------------------------
// Catalog (§3.2)
// ---------------------------------------------------------------------------------------------

/** ISO 3166-1 alpha-2, uppercase, e.g. 'JP'. */
export type CountryCode = string;

export interface CatalogMake {
  id: string;
  name: string;
  /** LOAD-BEARING (RULE A). Required on every make. */
  country: CountryCode;
  /** Extra search-only strings. Never rendered. */
  aliases: string[];
}

export interface CatalogModel {
  id: string;
  makeId: string;
  /** Model only, make not repeated. */
  name: string;
  aliases: string[];
  /** LOAD-BEARING (RULE B). [from, to|null] inclusive; `to: null` = still on sale. The whole
   *  field `null` = unknown -> can never be yellow, only green or red. */
  years: [number, number | null] | null;
}

export interface Catalog {
  schema: Schema1;
  generatedAt: string;
  source: 'seed' | 'wikimedia-commons' | 'wikidata' | 'commons+wikidata';
  makes: CatalogMake[];
  models: CatalogModel[];
}

/** The built runtime index `evaluateGuess()` reads (§4.2 pseudocode: `catalog.makes.get(...)`).
 *  Built from `Catalog` by `src/lib/catalog.ts` (W3) — not the on-disk shape. */
export interface CatalogIndex {
  makes: Map<string, CatalogMake>;
  models: Map<string, CatalogModel>;
}

// ---------------------------------------------------------------------------------------------
// Combobox matcher (§5.3) — shapes only, no frozen literal given; W3 (`src/lib/match.ts`)
// implements against these.
// ---------------------------------------------------------------------------------------------

/** 5 = exact match, down to 0 = fuzzy subsequence. Higher always beats lower regardless of
 *  score. */
export type MatchTier = 0 | 1 | 2 | 3 | 4 | 5;

export interface MatchResult {
  makeId: string;
  modelId: string;
  /** `"{make.name} {model.name}"`, precomposed for display. */
  label: string;
  tier: MatchTier;
  score: number;
}

// ---------------------------------------------------------------------------------------------
// Manifest (§3.3)
// ---------------------------------------------------------------------------------------------

export interface ManifestEntry {
  date: string;
  number: number;
  id: string;
}

export interface Manifest {
  schema: Schema1;
  launchDate: string;
  /** Highest scheduled puzzle. */
  latest: { date: string; number: number };
  /** Ascending by number. No answers, no image paths. */
  puzzles: ManifestEntry[];
}

// ---------------------------------------------------------------------------------------------
// Fetcher review file (§3.4)
// ---------------------------------------------------------------------------------------------

export type ReviewDecision = 'pending' | 'approve' | 'reject';

export interface OperatorOverride {
  year: number | null;
  focus: FocusPoint | null;
  sourceCrop: SourceCrop | null;
  cropFractions: readonly [number, number, number, number, number] | null;
  modelIdOverride: string | null;
  note: string | null;
}

export interface ReviewCandidate {
  /** Commons M-id ("M" + pageid). */
  candidateId: string;
  decision: ReviewDecision;
  makeId: string;
  modelId: string;
  sourceCategory: string;
  fileTitle: string;
  descriptionUrl: string;
  /** The `imageinfo.thumburl` the API returned, verbatim, utm_* stripped. */
  thumbUrl: string;
  originalUrl: string;
  width: number;
  height: number;
  mime: string;
  license: LicenseRef & {
    /** Structured Data P275 Q-ids, multi-valued. Authoritative for denial. */
    sdcP275: string[];
    attributionRequired: boolean;
  };
  author: string;
  creditNote: string | null;
  /** From `extmetadata.Restrictions`. "personality" present => auto-reject. */
  restrictions: string[];
  /** Every 4-digit token found, with where/how. Never collapsed. */
  yearCandidates: Array<{ year: number; source: string; pattern: string; confidence: YearConfidence }>;
  yearProposed: number | null;
  yearConfidence: YearConfidence;
  warnings: string[];
  /** The only fields a human edits (plus `decision`). Non-null values win over everything the
   *  fetcher proposed. */
  operator: OperatorOverride;
}

export interface ReviewFile {
  schema: Schema1;
  batch: string;
  generatedAt: string;
  userAgent: string;
  candidates: ReviewCandidate[];
}

// ---------------------------------------------------------------------------------------------
// Fixture source (§3.6)
// ---------------------------------------------------------------------------------------------

export interface FixtureSource {
  /** Single source of truth for this puzzle's id — copied, never re-minted. */
  id: string;
  /** Relative path into fixtures/images/. */
  file: string;
  date: string;
  answer: PuzzleAnswer;
  focus: FocusPoint;
  sourceCrop: SourceCrop | null;
  cropFractions: readonly [number, number, number, number, number];
  credit: CreditBlock;
  yearEvidence: YearEvidence;
}

// ---------------------------------------------------------------------------------------------
// Game logic (§3.7, §4.2) — the frozen evaluator signature
// ---------------------------------------------------------------------------------------------

export type TileResult = 'green' | 'yellow' | 'red';

export interface GuessInput {
  makeId: string;
  modelId: string;
  year: number;
}

export interface TileStates {
  make: TileResult;
  model: TileResult;
  year: TileResult;
}

// ---------------------------------------------------------------------------------------------
// localStorage schema (§3.5)
// ---------------------------------------------------------------------------------------------

/** The schema version stored at `motodle:schema` and mirrored as `schemaVersion` in every
 *  record. Not part of the key path. */
export type StorageVersion = number;

export type GameStatus = 'in_progress' | 'won' | 'lost';

export interface GuessRecord {
  modelId: string;
  /** Denormalized display strings so the board renders without the catalog. */
  make: string;
  model: string;
  year: number;
  result: TileStates;
}

export interface TodayState {
  schemaVersion: StorageVersion;
  date: string;
  number: number;
  puzzleId: string;
  status: GameStatus;
  /** Append-only, <= 5. A give-up appends nothing. */
  guesses: GuessRecord[];
  locks: { makeId: string | null; modelId: string | null; year: number | null };
  /** 1..5, <= unlockedLevel. */
  viewLevel: number;
  /** The guess number the game ended on, 1..5, or null. */
  endedAtGuess: number | null;
  /** 0..15, written once at game end. */
  score: number | null;
}

export interface StatsState {
  schemaVersion: StorageVersion;
  played: number;
  wins: number;
  currentStreak: number;
  maxStreak: number;
  lastWinDate: string | null;
  lastCompletedDate: string | null;
  /** Keys are exactly the 8 achievable scores {0,1,2,3,6,9,12,15}, always all present. */
  scoreDistribution: Record<'0' | '1' | '2' | '3' | '6' | '9' | '12' | '15', number>;
}

export interface PrefsState {
  schemaVersion: StorageVersion;
  theme: 'system' | 'light' | 'dark';
  colorblind: boolean;
  seenHelp: boolean;
}

/** Identical shape to TodayState, plus `practice: true`. Never touches motodle:stats. */
export interface PracticeState extends TodayState {
  practice: true;
}

export interface StorageBackend {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Cross-tab today, cross-device later (§9.1). */
  subscribe(fn: (key: string) => void): () => void;
}

// ---------------------------------------------------------------------------------------------
// Share delivery (§4.4) — the injected adapter. `buildShareText()` itself stays pure and lives
// in `src/lib/share.ts`; this is only the delivery seam `src/state/share.ts` (W4) implements.
// ---------------------------------------------------------------------------------------------

export interface ShareSink {
  /** Delivers `text` via the navigator.share -> clipboard -> execCommand -> manual-select
   *  ladder (§4.4). Resolves with which rung succeeded. */
  share(text: string): Promise<'shared' | 'copied' | 'manual'>;
}

// ---------------------------------------------------------------------------------------------
// Payload budgets (§5.9, §4.7) — the report shape `tools/check-budget.ts` (W0 stub / W5 body)
// prints.
// ---------------------------------------------------------------------------------------------

export interface BudgetReport {
  name: string;
  bytes: number;
  budget: number;
  pass: boolean;
}
