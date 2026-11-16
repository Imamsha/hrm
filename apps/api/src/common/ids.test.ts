import { describe, expect, it } from 'vitest';
import { slugify, uuidv7 } from './ids.js';

describe('uuidv7', () => {
  it('produces valid, time-ordered v7 UUIDs', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(a.slice(0, 13).replace('-', '')).toBe(
      (1_700_000_000_000).toString(16).padStart(12, '0'),
    );
  });
});

describe('slugify', () => {
  it.each([
    ['Acme Corp', 'acme-corp'],
    ['  Tata Consultancy — Pune!  ', 'tata-consultancy-pune'],
    ['Café Ñandú', 'cafe-nandu'],
    ['A', 'org-a'],
    ['日本', 'org-new'],
  ])('%j -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('caps the length', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(48);
  });
});
