import { describe, expect, it } from 'vitest';
import {
  billingRate,
  budgetUse,
  canHaveParent,
  canMoveInvoice,
  canMoveSprint,
  canMoveTimesheet,
  createsCycle,
  dueDate,
  invoiceBalance,
  invoiceLine,
  invoiceNumber,
  invoiceTotals,
  progressByCategory,
  sprintVelocity,
  totalHours,
  validateBoardColumns,
  validateTimesheet,
  weekDays,
  weekStart,
  workItemKey,
} from './projects.js';

describe('work items', () => {
  it('enforces the hierarchy', () => {
    expect(canHaveParent('STORY', 'EPIC')).toBe(true);
    expect(canHaveParent('TASK', 'STORY')).toBe(true);
    expect(canHaveParent('BUG', null)).toBe(true);
    expect(canHaveParent('EPIC', 'STORY')).toBe(false);
    expect(canHaveParent('SUBTASK', null)).toBe(false);
    expect(canHaveParent('TASK', 'EPIC')).toBe(false);
  });

  it('detects cycles and builds keys', () => {
    const parents = new Map<string, string | null>([
      ['a', null],
      ['b', 'a'],
      ['c', 'b'],
    ]);
    expect(createsCycle('a', 'c', parents)).toBe(true);
    expect(createsCycle('c', 'a', parents)).toBe(false);
    expect(createsCycle('a', 'a', parents)).toBe(true);
    expect(workItemKey('WEB', 42)).toBe('WEB-42');
  });

  it('validates board columns and measures progress', () => {
    expect(
      validateBoardColumns([
        { name: 'To do', category: 'TODO' },
        { name: 'Done', category: 'DONE' },
      ]),
    ).toEqual(["Add a column for 'in progress'"]);
    expect(
      validateBoardColumns([
        { name: 'To do', category: 'TODO' },
        { name: 'Doing', category: 'IN_PROGRESS' },
        { name: 'to do', category: 'DONE' },
      ]),
    ).toEqual(['Column names must be unique']);
    const items = [
      { category: 'DONE' as const, points: 5 },
      { category: 'TODO' as const, points: 3 },
      { category: 'IN_PROGRESS' as const, points: null },
      { category: 'DONE' as const, points: '2' },
    ];
    expect(progressByCategory(items).percentDone.toString()).toBe('50');
    expect(progressByCategory(items, true).percentDone.toString()).toBe('70');
    expect(progressByCategory([]).percentDone.toString()).toBe('0');
  });
});

describe('sprints', () => {
  it('moves only forward and measures velocity', () => {
    expect(canMoveSprint('PLANNED', 'ACTIVE')).toBe(true);
    expect(canMoveSprint('ACTIVE', 'COMPLETED')).toBe(true);
    expect(canMoveSprint('COMPLETED', 'ACTIVE')).toBe(false);
    expect(canMoveSprint('PLANNED', 'COMPLETED')).toBe(false);
    const v = sprintVelocity([
      { category: 'DONE', points: 8 },
      { category: 'IN_PROGRESS', points: 5 },
      { category: 'TODO', points: null },
    ]);
    expect([v.committed.toString(), v.completed.toString()]).toEqual(['13', '8']);
  });
});

describe('timesheets', () => {
  it('finds the ISO week', () => {
    expect(weekStart('2026-11-25')).toBe('2026-11-23');
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekDays('2026-11-23')).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ]);
  });

  it('checks dates, quarter hours and the daily limit', () => {
    expect(validateTimesheet('2026-11-23', [{ date: '2026-11-24', hours: '7.5' }])).toEqual([]);
    expect(
      validateTimesheet('2026-11-23', [
        { date: '2026-11-30', hours: 1 },
        { date: '2026-11-24', hours: '0.1' },
        { date: '2026-11-25', hours: 16 },
        { date: '2026-11-25', hours: 9 },
      ]),
    ).toEqual([
      'Entry 1: 2026-11-30 is not in the week of 2026-11-23',
      'Entry 2: hours must be 0.25–24 in quarter hours',
      '2026-11-25: 25 hours is more than 24 in a day',
    ]);
    expect(totalHours([{ hours: '7.5' }, { hours: '0.25' }]).toString()).toBe('7.75');
    expect(canMoveTimesheet('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canMoveTimesheet('APPROVED', 'DRAFT')).toBe(false);
    expect(canMoveTimesheet('REJECTED', 'SUBMITTED')).toBe(true);
  });
});

describe('billing', () => {
  it('picks the member rate before the project rate', () => {
    expect(billingRate('1500', '1000')?.toString()).toBe('1500');
    expect(billingRate(null, '1000')?.toString()).toBe('1000');
    expect(billingRate(null, null)).toBeNull();
  });

  it('computes lines, tax and totals with half-up rounding', () => {
    const l = invoiceLine({ quantity: '7.25', unitPrice: '1333.33', taxPercent: '10' });
    expect([l.amount.toFixed(2), l.tax.toFixed(2), l.total.toFixed(2)]).toEqual([
      '9666.64',
      '966.66',
      '10633.30',
    ]);
    const t = invoiceTotals([
      { quantity: 1, unitPrice: '0.125', taxPercent: null },
      { quantity: 2, unitPrice: '100', taxPercent: '5' },
    ]);
    expect([t.subtotal.toFixed(2), t.tax.toFixed(2), t.total.toFixed(2)]).toEqual([
      '200.13',
      '10.00',
      '210.13',
    ]);
  });

  it('tracks payments, numbers and due dates', () => {
    expect(invoiceBalance('100.00', ['40', '60']).settled).toBe(true);
    expect(invoiceBalance('100.00', ['40']).balance.toString()).toBe('60');
    expect(invoiceBalance('100.00', ['120']).overpaid).toBe(true);
    expect(invoiceNumber('INV', 2026, 7)).toBe('INV-2026-0007');
    expect(dueDate('2026-11-24', 30)).toBe('2026-12-24');
    expect(canMoveInvoice('DRAFT', 'ISSUED')).toBe(true);
    expect(canMoveInvoice('PAID', 'VOID')).toBe(false);
    expect(budgetUse('2500', '10000')?.toString()).toBe('25');
    expect(budgetUse('2500', null)).toBeNull();
  });
});
