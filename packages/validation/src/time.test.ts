import { describe, expect, it } from 'vitest';
import {
  balanceAdjustmentSchema,
  createLeaveTypeSchema,
  createShiftSchema,
  leaveRequestSchema,
  minutesOf,
  punchSchema,
  rangeQuerySchema,
  regularizationSchema,
  timeOf,
} from './time.js';

const TYPE = '0195f1d2-0000-7000-8000-000000000001';

describe('shift schemas', () => {
  it('converts times and validates thresholds with the shared shift rules', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(timeOf(1530)).toBe('01:30');
    const ok = createShiftSchema.parse({
      code: 'gen',
      name: 'General',
      startTime: '09:30',
      endTime: '18:30',
      fullDayMinutes: 480,
      halfDayMinutes: 240,
      breakMinutes: 60,
    });
    expect(ok).toMatchObject({ code: 'GEN', graceInMinutes: 0, windowBeforeMinutes: 240 });
    expect(
      createShiftSchema.safeParse({
        code: 'X',
        name: 'X',
        startTime: '09:00',
        endTime: '13:00',
        fullDayMinutes: 200,
        halfDayMinutes: 300,
      }).success,
    ).toBe(false);
    expect(
      createShiftSchema.safeParse({
        code: 'X',
        name: 'X',
        startTime: '25:00',
        endTime: '13:00',
        fullDayMinutes: 1,
        halfDayMinutes: 1,
      }).success,
    ).toBe(false);
  });
});

describe('attendance schemas', () => {
  it('validates punches, regularizations and ranges', () => {
    expect(punchSchema.parse({})).toEqual({ source: 'WEB' });
    expect(punchSchema.safeParse({ latitude: '95' }).success).toBe(false);
    expect(
      regularizationSchema.safeParse({
        date: '2026-11-06',
        requestedIn: '2026-11-06T18:30:00+05:30',
        requestedOut: '2026-11-06T09:30:00+05:30',
        reason: 'x',
      }).error?.issues[0]?.path,
    ).toEqual(['requestedOut']);
    expect(rangeQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(
      false,
    );
    expect(rangeQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30' }).success).toBe(true);
  });
});

describe('leave schemas', () => {
  it('keeps quotas as decimal strings and rejects negatives', () => {
    expect(
      createLeaveTypeSchema.parse({ code: 'cl', name: 'Casual', annualQuota: 12 }),
    ).toMatchObject({
      code: 'CL',
      annualQuota: '12',
      carryForwardMax: null,
      accrualMethod: 'YEARLY',
    });
    expect(
      createLeaveTypeSchema.safeParse({ code: 'CL', name: 'Casual', annualQuota: '-1' }).success,
    ).toBe(false);
    expect(
      createLeaveTypeSchema.safeParse({ code: 'CL', name: 'Casual', annualQuota: '1.234' }).success,
    ).toBe(false);
  });

  it('validates sessions and ranges of a request', () => {
    expect(
      leaveRequestSchema.parse({
        leaveTypeId: TYPE,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
      }),
    ).toMatchObject({
      startSession: 'FULL',
      endSession: 'FULL',
    });
    expect(
      leaveRequestSchema.safeParse({
        leaveTypeId: TYPE,
        startDate: '2026-12-02',
        endDate: '2026-12-01',
      }).error?.issues[0]?.path,
    ).toEqual(['endDate']);
    expect(
      leaveRequestSchema.safeParse({
        leaveTypeId: TYPE,
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        startSession: 'FIRST_HALF',
      }).success,
    ).toBe(false);
  });

  it('requires a non-zero adjustment with a note', () => {
    expect(
      balanceAdjustmentSchema.safeParse({ leaveTypeId: TYPE, year: 2026, days: '0', note: 'x' })
        .success,
    ).toBe(false);
    expect(
      balanceAdjustmentSchema.parse({
        leaveTypeId: TYPE,
        year: 2026,
        days: '-1.5',
        note: 'Correction',
      }),
    ).toMatchObject({
      days: '-1.5',
      kind: 'ADJUSTMENT',
    });
  });
});
