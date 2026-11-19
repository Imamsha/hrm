import { describe, expect, it } from 'vitest';
import { resolveDays, type WorkWeekRule } from './calendar.js';
import {
  accrualCredits,
  carryForward,
  countLeaveDays,
  leaveYearOf,
  leaveYearRange,
  validateLeaveSessions,
} from './leave.js';

// Mon–Fri full, Saturday half, Sunday off; 2026-11-20 (Friday) is a public holiday.
const rules: WorkWeekRule[] = [
  ...([1, 2, 3, 4, 5] as const).map((weekday) => ({
    weekday,
    occurrence: 0 as const,
    dayType: 'FULL' as const,
  })),
  { weekday: 6, occurrence: 0, dayType: 'HALF' },
];
const holidays = [{ date: '2026-11-20', name: 'Festival', kind: 'PUBLIC' as const }];
const cal = (from: string, to: string) => resolveDays(from, to, rules, holidays);
const strict = { countWeeklyOffs: false, countHolidays: false, allowHalfDay: true };

describe('countLeaveDays', () => {
  it('skips offs and holidays unless the policy counts them (sandwich)', () => {
    // Thu 19 → Mon 23: Thu 1, Fri holiday, Sat half, Sun off, Mon 1.
    expect(countLeaveDays(cal('2026-11-19', '2026-11-23'), 'FULL', 'FULL', strict).total).toBe(2.5);
    expect(
      countLeaveDays(cal('2026-11-19', '2026-11-23'), 'FULL', 'FULL', {
        ...strict,
        countWeeklyOffs: true,
        countHolidays: true,
      }).total,
    ).toBe(4.5);
  });

  it('charges half days for sessions', () => {
    expect(
      countLeaveDays(cal('2026-11-18', '2026-11-18'), 'FIRST_HALF', 'FIRST_HALF', strict).total,
    ).toBe(0.5);
    // Afternoon of Wed + Thu + morning of... Thu end FIRST_HALF.
    expect(
      countLeaveDays(cal('2026-11-18', '2026-11-19'), 'SECOND_HALF', 'FIRST_HALF', strict).total,
    ).toBe(1);
  });

  it('validates sessions', () => {
    expect(
      validateLeaveSessions('2026-11-18', '2026-11-18', 'FIRST_HALF', 'FIRST_HALF', false),
    ).toEqual(['This leave type cannot be taken in half days']);
    expect(
      validateLeaveSessions('2026-11-18', '2026-11-19', 'FIRST_HALF', 'FULL', true),
    ).toHaveLength(1);
    expect(validateLeaveSessions('2026-11-19', '2026-11-18', 'FULL', 'FULL', true)).toContain(
      'The end date cannot be before the start date',
    );
    expect(
      validateLeaveSessions('2026-11-18', '2026-11-19', 'SECOND_HALF', 'FIRST_HALF', true),
    ).toEqual([]);
  });
});

describe('leave year', () => {
  it('supports any start month', () => {
    expect(leaveYearOf('2026-03-31', 4)).toBe(2025);
    expect(leaveYearOf('2026-04-01', 4)).toBe(2026);
    expect(leaveYearOf('2026-11-19', 1)).toBe(2026);
    expect(leaveYearRange(2026, 4)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(leaveYearRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(leaveYearRange(2027, 3).to).toBe('2028-02-29');
  });
});

describe('accrualCredits', () => {
  it('credits monthly and makes the year sum exactly to the quota', () => {
    const credits = accrualCredits(
      { method: 'MONTHLY', annualQuota: '18', prorateOnJoining: false },
      2026,
      1,
      '2020-01-01',
      '2026-12-31',
    );
    expect(credits).toHaveLength(12);
    expect(credits[0]).toEqual({ period: 1, effectiveDate: '2026-01-01', days: '1.50' });
    const odd = accrualCredits(
      { method: 'MONTHLY', annualQuota: '10', prorateOnJoining: false },
      2026,
      1,
      '2020-01-01',
      '2026-12-31',
    );
    expect(odd.reduce((s, c) => s + Number(c.days), 0)).toBeCloseTo(10, 5);
    expect(odd[11]?.days).toBe('0.87');
  });

  it('starts from the joining month and stops at the as-of date', () => {
    const credits = accrualCredits(
      { method: 'MONTHLY', annualQuota: '12', prorateOnJoining: false },
      2026,
      4,
      '2026-06-15',
      '2026-08-10',
    );
    expect(credits.map((c) => c.effectiveDate)).toEqual(['2026-06-15', '2026-07-01', '2026-08-01']);
  });

  it('grants yearly quotas, prorated when configured', () => {
    expect(
      accrualCredits(
        { method: 'YEARLY', annualQuota: '12', prorateOnJoining: false },
        2026,
        1,
        '2026-07-10',
        '2026-11-19',
      ),
    ).toEqual([{ period: 0, effectiveDate: '2026-07-10', days: '12.00' }]);
    expect(
      accrualCredits(
        { method: 'YEARLY', annualQuota: '12', prorateOnJoining: true },
        2026,
        1,
        '2026-07-10',
        '2026-11-19',
      )[0]?.days,
    ).toBe('6.00');
    expect(
      accrualCredits(
        { method: 'NONE', annualQuota: '12', prorateOnJoining: false },
        2026,
        1,
        '2020-01-01',
        '2026-11-19',
      ),
    ).toEqual([]);
    expect(
      accrualCredits(
        { method: 'YEARLY', annualQuota: '12', prorateOnJoining: false },
        2026,
        1,
        '2027-02-01',
        '2027-03-01',
      ),
    ).toEqual([]);
  });
});

describe('carryForward', () => {
  it('carries up to the cap and lapses the rest', () => {
    expect(carryForward('7.5', '5')).toEqual({ carry: '5.00', lapse: '2.50' });
    expect(carryForward('3', '5')).toEqual({ carry: '3.00', lapse: '0.00' });
    expect(carryForward('4', null)).toEqual({ carry: '0.00', lapse: '4.00' });
    expect(carryForward('-2', '5')).toEqual({ carry: '0.00', lapse: '0.00' });
  });
});
