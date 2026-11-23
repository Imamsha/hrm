/** Limits below are fictional test values — every real limit is the organization's policy. */
import { describe, expect, it } from 'vitest';
import {
  canMoveClaim,
  checkExpenseItems,
  convertAmount,
  type ExpensePolicy,
  monthsBetween,
  straightLineBookValue,
  travelSettlement,
} from './expenses.js';

const meals: ExpensePolicy = {
  categoryId: 'meals',
  name: 'Meals',
  active: true,
  maxPerItem: '1000',
  maxPerMonth: '3000',
  receiptRequiredAbove: '500',
  dailyLimit: null,
};
const perDiem: ExpensePolicy = {
  categoryId: 'pd',
  name: 'Per diem',
  active: true,
  maxPerItem: null,
  maxPerMonth: null,
  receiptRequiredAbove: null,
  dailyLimit: '800',
};
const old: ExpensePolicy = { ...meals, categoryId: 'old', name: 'Old', active: false };
const base = {
  today: '2026-11-20',
  claimWindowDays: 60,
  monthToDate: {} as Record<string, string>,
  policies: [meals, perDiem, old],
};
const item = (over: Partial<Parameters<typeof checkExpenseItems>[0]['items'][number]>) => ({
  categoryId: 'meals',
  date: '2026-11-10',
  days: 1,
  amount: '400',
  hasReceipt: false,
  justification: null,
  ...over,
});
const codes = (issues: ReturnType<typeof checkExpenseItems>) =>
  issues.map((i) => `${String(i.item)}:${i.code}:${i.severity}`);

describe('currency', () => {
  it('converts with decimal precision and rejects non-positive rates', () => {
    expect(convertAmount('125.50', '83.2145').toString()).toBe('10443.42');
    expect(() => convertAmount('1', '0')).toThrow();
  });
});

describe('expense policy checks', () => {
  it('blocks missing receipts, future and stale items and inactive categories', () => {
    const issues = checkExpenseItems({
      ...base,
      items: [
        item({ amount: '600' }),
        item({ date: '2026-11-21' }),
        item({ date: '2026-09-01' }),
        item({ categoryId: 'old' }),
        item({ amount: '0' }),
      ],
    });
    expect(codes(issues)).toEqual([
      '0:RECEIPT_REQUIRED:BLOCK',
      '1:FUTURE_DATE:BLOCK',
      '2:TOO_OLD:BLOCK',
      '3:CATEGORY_INACTIVE:BLOCK',
      '4:AMOUNT:BLOCK',
    ]);
  });
  it('warns over limits until a justification is given', () => {
    const over = item({ amount: '1200', hasReceipt: true });
    expect(codes(checkExpenseItems({ ...base, items: [over] }))).toEqual([
      '0:OVER_ITEM_LIMIT:WARN',
    ]);
    expect(
      checkExpenseItems({ ...base, items: [{ ...over, justification: 'Client dinner' }] }),
    ).toEqual([]);
  });
  it('applies daily limits over the days covered', () => {
    expect(
      checkExpenseItems({ ...base, items: [item({ categoryId: 'pd', days: 3, amount: '2400' })] }),
    ).toEqual([]);
    expect(
      codes(
        checkExpenseItems({
          ...base,
          items: [item({ categoryId: 'pd', days: 3, amount: '2401' })],
        }),
      ),
    ).toEqual(['0:OVER_DAILY_LIMIT:WARN']);
  });
  it('counts earlier spend and this claim towards the monthly limit', () => {
    const issues = checkExpenseItems({
      ...base,
      monthToDate: { 'meals|2026-11': '2500' },
      items: [
        item({ amount: '400' }),
        item({ amount: '200' }),
        item({ date: '2026-10-30', amount: '450' }),
      ],
    });
    // 2500 + 400 = 2900 is fine; + 200 = 3100 is over; October is a different month.
    expect(codes(issues)).toEqual(['1:OVER_MONTHLY_LIMIT:WARN']);
  });
  it('treats no window and null limits as unlimited', () => {
    expect(
      checkExpenseItems({
        ...base,
        claimWindowDays: null,
        items: [item({ categoryId: 'pd', date: '2020-01-01', amount: '1' })],
      }),
    ).toEqual([]);
  });
});

describe('claim states', () => {
  it('allows only the defined moves', () => {
    expect(canMoveClaim('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canMoveClaim('SUBMITTED', 'FINANCE_APPROVED')).toBe(false);
    expect(canMoveClaim('MANAGER_APPROVED', 'FINANCE_APPROVED')).toBe(true);
    expect(canMoveClaim('FINANCE_APPROVED', 'REIMBURSED')).toBe(true);
    expect(canMoveClaim('REIMBURSED', 'DRAFT')).toBe(false);
    expect(canMoveClaim('REJECTED', 'DRAFT')).toBe(true);
  });
});

describe('travel settlement', () => {
  it('nets advances against approved claims', () => {
    expect(
      travelSettlement({ advancesPaid: ['10000'], approvedClaims: ['7500.50', '1000'] }),
    ).toMatchObject({ direction: 'RECOVERABLE' });
    expect(
      travelSettlement({
        advancesPaid: ['10000'],
        approvedClaims: ['7500.50', '1000'],
      }).balance.toString(),
    ).toBe('-1499.5');
    expect(travelSettlement({ advancesPaid: [], approvedClaims: ['500'] }).direction).toBe(
      'PAYABLE',
    );
    expect(travelSettlement({ advancesPaid: ['500'], approvedClaims: ['500.00'] }).direction).toBe(
      'SETTLED',
    );
  });
});

describe('asset book value', () => {
  it('depreciates straight-line by whole months down to salvage', () => {
    expect(monthsBetween('2025-01-15', '2026-01-14')).toBe(11);
    expect(monthsBetween('2025-01-15', '2026-01-15')).toBe(12);
    const r = straightLineBookValue({
      cost: '120000',
      salvage: '12000',
      usefulLifeMonths: 36,
      purchaseDate: '2025-01-15',
      asOf: '2026-01-15',
    });
    expect([r.accumulated.toString(), r.bookValue.toString(), r.elapsedMonths]).toEqual([
      '36000',
      '84000',
      12,
    ]);
    const end = straightLineBookValue({
      cost: '120000',
      salvage: '12000',
      usefulLifeMonths: 36,
      purchaseDate: '2020-01-01',
      asOf: '2026-01-01',
    });
    expect(end.bookValue.toString()).toBe('12000');
    expect(() =>
      straightLineBookValue({
        cost: '1',
        salvage: '2',
        usefulLifeMonths: 1,
        purchaseDate: '2020-01-01',
        asOf: '2020-01-01',
      }),
    ).toThrow();
  });
});
