/**
 * `tools/lib/year.ts` — year-candidate extraction + confidence scoring (§6.4).
 *
 * The scanned fields are EXACTLY TWO: the file title (`ObjectName`) and `ImageDescription`.
 * Nothing else is scanned for year tokens (`DateTimeOriginal` and Commons SDC `P571` are both
 * NEGATIVE evidence — the camera/photo date, never the model year — and are used only to
 * discard a token that would otherwise look like corroboration, never to supply one).
 */
import type { YearConfidence } from '../../schema/types';

export interface YearCandidate {
  year: number;
  source: 'title' | 'description';
  /** "leading" | "other" | "date-shaped" | "event-adjacent". */
  pattern: string;
  confidence: YearConfidence;
}

export interface YearScan {
  candidates: YearCandidate[];
  yearProposed: number | null;
  yearConfidence: YearConfidence;
  /** e.g. "title", "title+description", "description", "" (no candidate). Feeds
   *  `yearEvidence.source` when a candidate is approved (§3.1). */
  source: string;
}

interface RawToken {
  year: number;
  source: 'title' | 'description';
  leading: boolean;
  dateShaped: boolean;
  eventAdjacent: boolean;
}

const YEAR_TOKEN_RE = /\b(\d{4})\b/g;
const EVENT_KEYWORDS = /(bonhams|salon|show|days|wiki loves|pride|parade|autoshow)/i;

function yearInRange(year: number, minYear: number, maxYear: number): boolean {
  return year >= minYear && year <= maxYear;
}

/** A token is "date-shaped" if it sits inside a YYYY-MM-DD-style stamp, or is hyphen-flanked
 *  like "- 2016 -" (both real recon anti-patterns, §6.4). */
function isDateShaped(text: string, index: number, token: string): boolean {
  const before = text.slice(Math.max(0, index - 3), index);
  const after = text.slice(index + token.length, index + token.length + 3);
  if (/^\d{4}-\d{2}-\d{2}/.test(text.slice(index, index + 10))) return true; // leading YYYY-MM-DD
  if (/-\s*$/.test(before) && /^\s*-/.test(after)) return true; // "- YYYY -"
  if (/-$/.test(before.trim()) && /^-/.test(after.trim())) return true;
  return false;
}

function isEventAdjacent(text: string, index: number, token: string): boolean {
  const windowBefore = text.slice(Math.max(0, index - 24), index);
  const windowAfter = text.slice(index + token.length, index + token.length + 24);
  return EVENT_KEYWORDS.test(windowBefore) || EVENT_KEYWORDS.test(windowAfter);
}

function scanTokens(text: string, source: 'title' | 'description', minYear: number, maxYear: number): RawToken[] {
  const out: RawToken[] = [];
  const trimmedStart = text.length - text.trimStart().length;
  YEAR_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YEAR_TOKEN_RE.exec(text)) !== null) {
    const year = Number(m[1]);
    if (!yearInRange(year, minYear, maxYear)) continue;
    out.push({
      year,
      source,
      leading: m.index === trimmedStart,
      dateShaped: isDateShaped(text, m.index, m[1]),
      eventAdjacent: isEventAdjacent(text, m.index, m[1]),
    });
  }
  return out;
}

function tokenPattern(t: RawToken): string {
  if (t.dateShaped) return 'date-shaped';
  if (t.eventAdjacent) return 'event-adjacent';
  if (t.leading) return 'leading';
  return 'other';
}

export interface ScanYearOptions {
  /** `extmetadata.ObjectName` — the caller strips the "File:" prefix and extension before
   *  calling this function; "leading" is evaluated against THIS string's start, not the raw
   *  Commons page title. */
  title: string;
  description: string;
  /** The photo's capture year (EXIF DateTimeOriginal), if known — negative evidence: a token
   *  equal to this year is discarded, not counted for or against anything (§6.4). */
  dateTimeOriginalYear?: number | null;
  /** Defaults to `[1885, currentYear + 1]`, matching `answer.year`'s own bounds (§3.1). Pass
   *  explicitly in tests that must not depend on the day they run. */
  minYear?: number;
  maxYear?: number;
}

export function scanYearCandidates(opts: ScanYearOptions): YearScan {
  const minYear = opts.minYear ?? 1885;
  const maxYear = opts.maxYear ?? new Date().getFullYear() + 1;

  const rawTitle = scanTokens(opts.title ?? '', 'title', minYear, maxYear);
  const rawDesc = scanTokens(opts.description ?? '', 'description', minYear, maxYear);

  const discardYear = opts.dateTimeOriginalYear ?? null;
  const titleTokens = discardYear === null ? rawTitle : rawTitle.filter((t) => t.year !== discardYear);
  const descTokens = discardYear === null ? rawDesc : rawDesc.filter((t) => t.year !== discardYear);

  // "Clean" = not date-shaped, not event-adjacent — the anti-patterns that force `low` (§6.4).
  const titleClean = titleTokens.filter((t) => !t.dateShaped && !t.eventAdjacent);
  const descClean = descTokens.filter((t) => !t.dateShaped && !t.eventAdjacent);

  const titleLeadingClean = titleClean.find((t) => t.leading) ?? null;

  let year: number | null = null;
  let confidence: YearConfidence;
  let winningSource: 'title' | 'title+description' | 'description' | '' = '';

  if (titleLeadingClean) {
    year = titleLeadingClean.year;
    const descHasYear = descTokens.some((t) => t.year === year);
    const otherDistinctElsewhere = [...titleTokens, ...descTokens].some((t) => t.year !== year);
    if (descHasYear && !otherDistinctElsewhere) {
      confidence = 'high';
      winningSource = 'title+description';
    } else {
      confidence = 'medium';
      winningSource = descHasYear ? 'title+description' : 'title';
    }
  } else if (descClean.length > 0) {
    // No qualifying leading token in the title, but the year appears (anywhere) in the
    // description — §6.4 medium row, second clause.
    year = descClean[0].year;
    confidence = 'medium';
    winningSource = 'description';
  } else if (titleTokens.length > 0 || descTokens.length > 0) {
    // Only date-shaped/event-adjacent/non-leading tokens exist — low, auto-reject.
    const anyToken = titleTokens[0] ?? descTokens[0];
    year = anyToken.year;
    confidence = 'low';
    winningSource = anyToken.source;
  } else {
    confidence = 'none';
    winningSource = '';
  }

  const candidates: YearCandidate[] = [...titleTokens, ...descTokens].map((t) => ({
    year: t.year,
    source: t.source,
    pattern: tokenPattern(t),
    confidence: t.dateShaped || t.eventAdjacent ? 'low' : t.leading ? 'high' : 'medium',
  }));

  return {
    candidates,
    yearProposed: year,
    yearConfidence: confidence,
    source: winningSource,
  };
}

/** §3.4 / §6.4: `low`/`none` are auto-`reject`; everything else stays `pending` for the operator. */
export function autoDecisionFor(confidence: YearConfidence): 'pending' | 'reject' {
  return confidence === 'low' || confidence === 'none' ? 'reject' : 'pending';
}
