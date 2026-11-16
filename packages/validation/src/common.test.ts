import { describe, expect, it } from 'vitest';
import { decimalStringSchema, listQuerySchema, optionalText, requiredText } from './common.js';
import { toErrorDetails } from './issues.js';

describe('listQuerySchema', () => {
  it('applies defaults and coerces query-string numbers', () => {
    expect(listQuerySchema.parse({ page: '3' })).toEqual({ page: 3, pageSize: 25, sortDir: 'asc' });
  });

  it('rejects page sizes above the maximum', () => {
    expect(listQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });

  it('rejects sort fields that could be used for injection', () => {
    expect(listQuerySchema.safeParse({ sortBy: 'name; DROP TABLE x' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ sortBy: 'createdAt' }).success).toBe(true);
  });
});

describe('text helpers', () => {
  it('treats blank optional text as undefined', () => {
    expect(optionalText().parse('   ')).toBeUndefined();
  });

  it('requires non-blank required text', () => {
    expect(requiredText().safeParse('  ').success).toBe(false);
  });
});

describe('decimalStringSchema', () => {
  it.each(['0', '1500.50', '-20.1234'])('accepts %s', (v) => {
    expect(decimalStringSchema.safeParse(v).success).toBe(true);
  });

  it.each(['1e5', '1.23456', 'abc', ''])('rejects %s', (v) => {
    expect(decimalStringSchema.safeParse(v).success).toBe(false);
  });
});

describe('toErrorDetails', () => {
  it('maps nested paths to dot notation', () => {
    const result = listQuerySchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(toErrorDetails(result.error)[0]?.path).toBe('page');
    }
  });
});
