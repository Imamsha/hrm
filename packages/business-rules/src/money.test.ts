import { describe, expect, it } from 'vitest';
import { allocate, prorate, roundMoney, sumMoney, toDecimal, toMoneyString } from './money.js';

describe('decimal safety', () => {
  it('avoids floating point drift', () => {
    expect(sumMoney(['0.1', '0.2']).toString()).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3); // documents why Decimal is required
  });

  it('rejects non-finite input', () => {
    expect(() => toDecimal(Number.NaN)).toThrow(RangeError);
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('roundMoney', () => {
  it('rounds half up by default', () => {
    expect(roundMoney('2.345').toString()).toBe('2.35');
    expect(roundMoney('-2.345').toString()).toBe('-2.35');
  });

  it('supports configurable modes and scales', () => {
    expect(roundMoney('2.345', 2, 'HALF_EVEN').toString()).toBe('2.34');
    expect(roundMoney('1234.5', 0, 'CEIL').toString()).toBe('1235');
    expect(roundMoney('1234.99', 0, 'FLOOR').toString()).toBe('1234');
  });
});

describe('prorate', () => {
  it('computes partial-period amounts without intermediate rounding', () => {
    expect(roundMoney(prorate('50000', 18, 30)).toString()).toBe('30000');
    expect(roundMoney(prorate('45000', 17, 31)).toString()).toBe('24677.42');
  });

  it('rejects a zero denominator', () => {
    expect(() => prorate('100', 1, 0)).toThrow(RangeError);
  });
});

describe('allocate', () => {
  it('always sums exactly to the total', () => {
    const parts = allocate('100.00', [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(sumMoney(parts).toFixed(2)).toBe('100.00');
  });

  it('distributes proportionally to weights', () => {
    const parts = allocate('1000', [3, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['750.00', '250.00']);
  });

  it('rejects all-zero weights', () => {
    expect(() => allocate('10', [0, 0])).toThrow(RangeError);
  });
});

describe('toMoneyString', () => {
  it('serialises with fixed scale', () => {
    expect(toMoneyString('5')).toBe('5.00');
    expect(toMoneyString('12345678901234.565')).toBe('12345678901234.57');
  });
});
