/**
 * §13.9 W6-5 — the CSP the app is tested under and the CSP CloudFront serves must be the same
 * string. Same no-drift pattern as the normalizeId test (§7.2 #10).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from './constants';

const ROOT = path.join(__dirname, '..');

describe('CSP no-drift', () => {
  it('infra/variables.tf ships exactly CONTENT_SECURITY_POLICY', () => {
    const tf = readFileSync(path.join(ROOT, 'infra/variables.tf'), 'utf8');
    const block = tf
      .split(/^variable /m)
      .find((b) => b.startsWith('"content_security_policy"'));
    expect(block, 'variable "content_security_policy" missing from infra/variables.tf').toBeDefined();
    const match = /^\s*default\s*=\s*"([^"]*)"\s*$/m.exec(block as string);
    expect(match, 'no default = "…" inside the content_security_policy variable').not.toBeNull();
    expect((match as RegExpExecArray)[1]).toBe(CONTENT_SECURITY_POLICY);
  });
});
