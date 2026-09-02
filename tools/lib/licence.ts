/**
 * `tools/lib/licence.ts` — licence allowlist / denylist (§6.5), matched against the strings
 * Commons recon actually observed. Two independent gates that must both be consulted:
 *
 *  1. `classifyLicenseShortName()` — pattern-matches `extmetadata.LicenseShortName`.
 *  2. `checkP275()` — Structured Data `P275` Q-ids, read via `wbgetentities`. Authoritative for
 *     DENIAL ONLY (a dual-licensed file may report a single collapsed LicenseShortName while its
 *     P275 claims include a licence extmetadata never mentions — recon's `M142102925`).
 *
 * `decideLicense()` combines both into the one decision `tools/fetch.ts` needs.
 */
import type { LicenseId } from '../../schema/types';

// -----------------------------------------------------------------------------------------
// Gate 1 — extmetadata.LicenseShortName
// -----------------------------------------------------------------------------------------

export interface ShortNameClassification {
  allowed: boolean;
  id?: LicenseId;
  /** The jurisdiction suffix the id drops (e.g. "de"), else null. Only meaningful when allowed. */
  jurisdiction?: string | null;
  /** Present only when `allowed` is false. */
  reason?: string;
}

const CC_BY_RE = /^CC BY (\d\.\d)(?:\s(\w+))?$/;
const CC_BY_SA_RE = /^CC BY-SA (\d\.\d)(?:\s(\w+))?$/;

/** Explicit deny strings/substrings — checked before falling through to "unrecognised". */
function isExplicitlyDenied(shortName: string): string | null {
  if (/GFDL/i.test(shortName)) return 'gfdl';
  if (/GNU Free Documentation/i.test(shortName)) return 'gfdl';
  if (shortName === 'Copyrighted free use') return 'copyrighted-free-use';
  return null;
}

/**
 * Classifies `extmetadata.LicenseShortName` against the §6.5 allow patterns. Jurisdiction
 * suffixes (e.g. "CC BY-SA 2.0 de") pass and are captured separately — never folded into `id`.
 */
export function classifyLicenseShortName(shortName: string | undefined | null): ShortNameClassification {
  if (!shortName || shortName.trim() === '') {
    return { allowed: false, reason: 'empty' };
  }
  const s = shortName.trim();

  if (s === 'Public domain') return { allowed: true, id: 'PD', jurisdiction: null };
  if (s.startsWith('CC0')) return { allowed: true, id: 'CC0', jurisdiction: null };

  const bySa = CC_BY_SA_RE.exec(s); // must be checked BEFORE CC BY (both start with "CC BY")
  if (bySa) {
    return { allowed: true, id: `CC-BY-SA-${bySa[1]}` as LicenseId, jurisdiction: bySa[2] ?? null };
  }
  const by = CC_BY_RE.exec(s);
  if (by) {
    return { allowed: true, id: `CC-BY-${by[1]}` as LicenseId, jurisdiction: by[2] ?? null };
  }

  const denyReason = isExplicitlyDenied(s);
  if (denyReason) return { allowed: false, reason: denyReason };

  return { allowed: false, reason: 'unrecognised' };
}

// -----------------------------------------------------------------------------------------
// Gate 2 — Structured Data P275 Q-ids
// -----------------------------------------------------------------------------------------

/** GFDL Q-ids — denial only when a candidate's SOLE P275 value is one of these. */
export const GFDL_QIDS = new Set(['Q26921686', 'Q50829104']);

/** Every licence Q-id the §6.5 allowlist admits (§6.5's "Licence Q-ids for the SDC check"
 *  table). A P275 value outside this set (and outside GFDL_QIDS) is "unrecognised" — a warning,
 *  never a rejection on its own (§6.5 precedence rule). */
export const KNOWN_LICENSE_QIDS = new Set([
  'Q6938433', // CC0
  'Q98592850', // PD, by copyright holder
  'Q19125117', // CC BY 2.0
  'Q18810333', // CC BY 2.5
  'Q14947546', // CC BY 3.0
  'Q20007257', // CC BY 4.0
  'Q19068220', // CC BY-SA 2.0
  'Q19113751', // CC BY-SA 2.5
  'Q14946043', // CC BY-SA 3.0
  'Q18199165', // CC BY-SA 4.0
]);

export interface P275Check {
  /** True iff the candidate's sole P275 value(s) are all GFDL — hard reject regardless of
   *  extmetadata. */
  denied: boolean;
  /** P275 values that are neither a known allowed licence nor a GFDL Q-id. Non-empty ⇒
   *  `unknown-p275` warning, decision stays pending (not a reject). */
  unknownQids: string[];
}

export function checkP275(p275: string[]): P275Check {
  if (p275.length > 0 && p275.every((q) => GFDL_QIDS.has(q))) {
    return { denied: true, unknownQids: [] };
  }
  const unknownQids = p275.filter((q) => !KNOWN_LICENSE_QIDS.has(q) && !GFDL_QIDS.has(q));
  return { denied: false, unknownQids };
}

// -----------------------------------------------------------------------------------------
// Combined decision — what tools/fetch.ts actually calls
// -----------------------------------------------------------------------------------------

export interface LicenseDecisionInput {
  shortName: string | undefined | null;
  /** Verbatim `extmetadata.LicenseUrl` — copied through, never derived from `id` (§3.1). */
  licenseUrl: string | undefined | null;
  p275: string[];
}

export interface LicenseDecision {
  outcome: 'allow' | 'reject';
  license?: { id: LicenseId; name: string; url: string; jurisdiction: string | null };
  /** e.g. "unknown-p275". Present on an allowed outcome too. */
  warnings: string[];
  /** Present only when outcome === 'reject'. */
  reason?: string;
}

export function decideLicense(input: LicenseDecisionInput): LicenseDecision {
  const warnings: string[] = [];

  const p275Result = checkP275(input.p275);
  if (p275Result.denied) {
    return { outcome: 'reject', warnings, reason: 'gfdl-p275' };
  }
  if (p275Result.unknownQids.length > 0) {
    warnings.push('unknown-p275');
  }

  const shortNameResult = classifyLicenseShortName(input.shortName);
  if (!shortNameResult.allowed) {
    return { outcome: 'reject', warnings, reason: `license-short-name-${shortNameResult.reason}` };
  }

  // §3.1: `credit.license.url` must be a real deed URL copied verbatim from `LicenseUrl` — an
  // absent value would otherwise ship as a dead `''` link with nothing to flag it. Warn rather
  // than reject: the operator can still supply the correct deed URL by hand before approving.
  if (!input.licenseUrl) {
    warnings.push('missing-license-url');
  }

  return {
    outcome: 'allow',
    warnings,
    license: {
      id: shortNameResult.id!,
      name: (input.shortName as string).trim(),
      url: input.licenseUrl ?? '',
      jurisdiction: shortNameResult.jurisdiction ?? null,
    },
  };
}
