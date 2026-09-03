/**
 * §7.2 #13 — schema/validate.ts self-test, plus "all five JSON Schemas validate their example
 * payloads" (part of W1's DoD). puzzle/catalog/manifest use the REAL committed files as their
 * example payload; review/storage have no committed instance in this repo (data/ is git-ignored
 * and no operator has run `npm run fetch` yet, and localStorage payloads only ever exist at
 * runtime) so their example payloads are the literal JSON blocks from PLAN.md §3.4 / §3.5.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSupportedKeywords, validate, type JSONSchema } from './validate';

const SCHEMA_DIR = path.join(__dirname);
const ROOT = path.join(__dirname, '..');

function readJson(...parts: string[]): any {
  return JSON.parse(readFileSync(path.join(ROOT, ...parts), 'utf8'));
}

function readSchema(name: string): JSONSchema {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));
}

const SCHEMA_FILES = [
  'puzzle.schema.json',
  'catalog.schema.json',
  'manifest.schema.json',
  'review.schema.json',
  'storage.schema.json',
];

describe('§7.2 #13 — schema keyword subset self-test', () => {
  for (const file of SCHEMA_FILES) {
    it(`${file} uses only the §7.2a supported keyword subset`, () => {
      const schema = readSchema(file);
      expect(() => assertSupportedKeywords(schema)).not.toThrow();
    });
  }
});

describe('the five JSON Schemas validate their example payloads', () => {
  it('puzzle.schema.json validates the real puzzle #1 file', () => {
    const schema = readSchema('puzzle.schema.json');
    const data = readJson('public/puzzles/2026-09-02.json');
    expect(validate(schema, data)).toEqual([]);
  });

  it('catalog.schema.json validates the real seed catalog', () => {
    const schema = readSchema('catalog.schema.json');
    const data = readJson('public/catalog.json');
    expect(validate(schema, data)).toEqual([]);
  });

  it('manifest.schema.json validates the real manifest', () => {
    const schema = readSchema('manifest.schema.json');
    const data = readJson('public/puzzles/manifest.json');
    expect(validate(schema, data)).toEqual([]);
  });

  it('review.schema.json validates the literal §3.4 example candidate', () => {
    const schema = readSchema('review.schema.json');
    const data = {
      schema: 1,
      batch: '2026-09-02-batch01',
      generatedAt: '2026-09-02',
      userAgent: 'motodle/0.1 (https://playmotodle.com; homelab hobby project)',
      candidates: [
        {
          candidateId: 'M12193306',
          decision: 'pending',
          makeId: 'suzuki',
          modelId: 'suzuki-gsxr750',
          sourceCategory: 'Category:Suzuki GSX-R 750',
          fileTitle: 'File:2004 Suzuki GSXR-750 Left SIde.jpg',
          descriptionUrl: 'https://commons.wikimedia.org/wiki/File:2004_Suzuki_GSXR-750_Left_SIde.jpg',
          thumbUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg',
          originalUrl: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/2004_Suzuki_GSXR-750_Left_SIde.jpg',
          width: 800,
          height: 600,
          mime: 'image/jpeg',
          license: {
            id: 'PD',
            name: 'Public domain',
            url: 'https://commons.wikimedia.org/wiki/Template:PD-user',
            jurisdiction: null,
            sdcP275: ['Q98592850'],
            attributionRequired: false,
          },
          author: 'Pawlex',
          creditNote: null,
          restrictions: [],
          yearCandidates: [
            { year: 2004, source: 'title', pattern: 'leading', confidence: 'high' },
            { year: 2004, source: 'description', pattern: 'leading', confidence: 'high' },
          ],
          yearProposed: 2004,
          yearConfidence: 'high',
          warnings: ['source-width-below-min'],
          operator: {
            year: null,
            focus: null,
            sourceCrop: null,
            cropFractions: null,
            modelIdOverride: null,
            note: null,
          },
        },
      ],
    };
    expect(validate(schema, data)).toEqual([]);
  });

  it('storage.schema.json validates the literal §3.5 example "today" record', () => {
    const schema = readSchema('storage.schema.json');
    const data = {
      schemaVersion: 1,
      date: '2026-09-02',
      number: 1,
      puzzleId: 'mtd-0001',
      status: 'in_progress',
      guesses: [
        {
          modelId: 'honda-cb750',
          make: 'Honda',
          model: 'CB750',
          year: 1998,
          result: { make: 'yellow', model: 'red', year: 'yellow' },
        },
      ],
      locks: { makeId: null, modelId: null, year: null },
      viewLevel: 2,
      endedAtGuess: null,
      score: null,
    };
    expect(validate(schema.$defs!.today, data, schema)).toEqual([]);
  });

  it('storage.schema.json validates the literal §3.5 example "stats" record', () => {
    const schema = readSchema('storage.schema.json');
    const data = {
      schemaVersion: 1,
      played: 12,
      wins: 9,
      currentStreak: 3,
      maxStreak: 5,
      lastWinDate: '2026-09-14',
      lastCompletedDate: '2026-09-14',
      scoreDistribution: { '0': 1, '1': 1, '2': 1, '3': 0, '6': 2, '9': 3, '12': 3, '15': 1 },
    };
    expect(validate(schema.$defs!.stats, data, schema)).toEqual([]);
  });

  it('storage.schema.json validates the literal §3.5 example "prefs" record', () => {
    const schema = readSchema('storage.schema.json');
    const data = { schemaVersion: 1, theme: 'system', colorblind: false, seenHelp: true };
    expect(validate(schema.$defs!.prefs, data, schema)).toEqual([]);
  });

  it('storage.schema.json validates a "practice" record (today shape + practice: true)', () => {
    const schema = readSchema('storage.schema.json');
    const data = {
      schemaVersion: 1,
      date: '2026-08-15',
      number: 32,
      puzzleId: 'mtd-0032',
      status: 'won',
      guesses: [],
      locks: { makeId: null, modelId: null, year: null },
      viewLevel: 1,
      endedAtGuess: null,
      score: null,
      practice: true,
    };
    expect(validate(schema.$defs!.practice, data, schema)).toEqual([]);
  });
});

describe('validate() rejects malformed data (sanity check on the validator itself)', () => {
  it('reports a missing required property', () => {
    const schema: JSONSchema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
    expect(validate(schema, {})).toEqual([{ path: '$.a', message: 'missing required property' }]);
  });

  it('reports a const mismatch', () => {
    const schema: JSONSchema = { const: 1 };
    expect(validate(schema, 2)).toHaveLength(1);
  });

  it('reports an additional property when additionalProperties is false', () => {
    const schema: JSONSchema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
    expect(validate(schema, { a: 'x', b: 'y' })).toEqual([{ path: '$.b', message: 'additional property not allowed' }]);
  });

  it('accepts null against a ["object","null"] type when properties are absent for null', () => {
    const schema: JSONSchema = {
      type: ['object', 'null'],
      properties: { x: { type: 'number' } },
      required: ['x'],
      additionalProperties: false,
    };
    expect(validate(schema, null)).toEqual([]);
    expect(validate(schema, { x: 1 })).toEqual([]);
    expect(validate(schema, {})).toHaveLength(1); // missing required x when non-null
  });
});
