/**
 * A tiny dependency-free JSON Schema (draft 2020-12) validator (§2, §3, §7.2a).
 *
 * Supported keyword subset — deliberately small, stated once, enforced by
 * `assertSupportedKeywords()`: `type` (string or array-of-string, for nullable fields),
 * `required`, `properties`, `additionalProperties` (boolean only), `items`, `enum`, `const`,
 * `pattern`, `minimum`/`maximum`, `minItems`/`maxItems`, and `$ref` to a same-document `$defs`
 * entry. `$defs` itself is a container the walker recurses into rather than a keyword it
 * flags — it exists solely to hold `$ref` targets (§7.2a).
 *
 * "Validates against the schema" therefore means "validates against this subset" — the five
 * schemas must not lean on anything outside it (draft keywords like `oneOf`/`format`/
 * `patternProperties` are NOT implemented and will silently no-op if present, which is exactly
 * why the self-test in §7.2 #13 walks every schema document and rejects unknown keys).
 */

export type JSONSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JSONSchema>;
  additionalProperties?: boolean;
  items?: JSONSchema;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
};

export interface ValidationError {
  path: string;
  message: string;
}

function typeMatches(t: string, value: unknown): boolean {
  switch (t) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      throw new Error(`validate.ts: unsupported "type" value "${t}"`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as never)[k], (b as never)[k]));
  }
  return false;
}

function resolveRef(schema: JSONSchema, root: JSONSchema): JSONSchema {
  if (!schema.$ref) return schema;
  const m = /^#\/\$defs\/([^/]+)$/.exec(schema.$ref);
  if (!m) throw new Error(`validate.ts: unsupported $ref "${schema.$ref}" (only "#/$defs/<name>" is supported)`);
  const def = root.$defs?.[m[1]];
  if (!def) throw new Error(`validate.ts: unresolved $ref "${schema.$ref}"`);
  return def;
}

/**
 * Validates `data` against `schema`. `root` is the document `$ref`s resolve against — pass it
 * explicitly to validate `data` against a `$defs` sub-schema (e.g. one of several localStorage
 * record shapes living in one file) rather than a document's top level. Defaults to `schema`
 * itself, which is correct for every top-level document (puzzle/catalog/manifest/review).
 */
export function validate(schema: JSONSchema, data: unknown, root: JSONSchema = schema): ValidationError[] {
  const errors: ValidationError[] = [];

  function check(schemaIn: JSONSchema, value: unknown, path: string): void {
    const s = resolveRef(schemaIn, root);

    if (s.const !== undefined) {
      if (!deepEqual(value, s.const)) {
        errors.push({ path, message: `expected const ${JSON.stringify(s.const)}, got ${JSON.stringify(value)}` });
      }
    }

    if (s.enum) {
      if (!s.enum.some((e) => deepEqual(e, value))) {
        errors.push({ path, message: `expected one of ${JSON.stringify(s.enum)}, got ${JSON.stringify(value)}` });
      }
    }

    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeMatches(t, value))) {
        errors.push({ path, message: `expected type ${JSON.stringify(s.type)}, got ${JSON.stringify(value)}` });
      }
    }

    if (s.pattern !== undefined && typeof value === 'string') {
      if (!new RegExp(s.pattern).test(value)) {
        errors.push({ path, message: `value ${JSON.stringify(value)} does not match pattern ${s.pattern}` });
      }
    }

    if (typeof value === 'number') {
      if (s.minimum !== undefined && value < s.minimum) {
        errors.push({ path, message: `${value} < minimum ${s.minimum}` });
      }
      if (s.maximum !== undefined && value > s.maximum) {
        errors.push({ path, message: `${value} > maximum ${s.maximum}` });
      }
    }

    if (Array.isArray(value)) {
      if (s.minItems !== undefined && value.length < s.minItems) {
        errors.push({ path, message: `array length ${value.length} < minItems ${s.minItems}` });
      }
      if (s.maxItems !== undefined && value.length > s.maxItems) {
        errors.push({ path, message: `array length ${value.length} > maxItems ${s.maxItems}` });
      }
      if (s.items) {
        value.forEach((v, i) => check(s.items!, v, `${path}[${i}]`));
      }
    }

    if (s.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      for (const [key, subSchema] of Object.entries(s.properties)) {
        if (key in obj) check(subSchema, obj[key], `${path}.${key}`);
      }
      if (s.required) {
        for (const key of s.required) {
          if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: 'missing required property' });
        }
      }
      if (s.additionalProperties === false) {
        const allowed = new Set(Object.keys(s.properties));
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) errors.push({ path: `${path}.${key}`, message: 'additional property not allowed' });
        }
      }
    }
  }

  check(schema, data, '$');
  return errors;
}

// ---------------------------------------------------------------------------------------------
// §7.2a self-test support: walk a raw schema document and reject any keyword outside the
// supported subset. `properties` and `$defs` are containers whose VALUES are themselves
// schemas (recursed into); their own keys (field names / def names) are data, not keywords,
// and are never checked against the allowlist.
// ---------------------------------------------------------------------------------------------

const SUPPORTED_KEYWORDS = new Set([
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'pattern',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  '$ref',
  '$defs',
]);

export function assertSupportedKeywords(node: unknown, path = '#'): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'properties' || key === '$defs') {
      if (value && typeof value === 'object') {
        for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
          assertSupportedKeywords(sub, `${path}.${key}.${name}`);
        }
      }
      continue;
    }
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(`schema/validate.ts self-test: unsupported keyword "${key}" at ${path}`);
    }
    if (key === 'items') {
      assertSupportedKeywords(value, `${path}.items`);
    }
  }
}
