import { describe, expect, it } from 'vitest';
import {
  evaluateDay,
  pairPunches,
  type Punch,
  type ShiftRule,
  shiftNetMinutes,
  shiftWindow,
  summarizeDays,
  validateShift,
} from './attendance.js';
import { zonedDate, zonedInstant, zonedMinutes, zoneOffsetMinutes } from './timezone.js';

const IST = 'Asia/Kolkata';
const at = (date: string, hhmm: string, tz = IST) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return zonedInstant(date, h * 60 + m, tz);
};
const p = (date: string, hhmm: string, direction: Punch['direction']): Punch => ({
  at: at(date, hhmm),
  direction,
});

const general: ShiftRule = {
  startMinutes: 9 * 60 + 30,
  endMinutes: 18 * 60 + 30,
  breakMinutes: 60,
  graceInMinutes: 10,
  graceOutMinutes: 0,
  fullDayMinutes: 8 * 60,
  halfDayMinutes: 4 * 60,
  overtimeAfterMinutes: 30,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
};
const night: ShiftRule = {
  ...general,
  startMinutes: 22 * 60,
  endMinutes: 6 * 60,
  fullDayMinutes: 7 * 60,
  overtimeAfterMinutes: null,
};
const later = new Date('2030-01-01T00:00:00Z');

describe('time zones', () => {
  it('converts local wall time to instants and back', () => {
    const i = zonedInstant('2026-11-19', 9 * 60 + 30, IST);
    expect(i.toISOString()).toBe('2026-11-19T04:00:00.000Z');
    expect(zonedDate(i, IST)).toBe('2026-11-19');
    expect(zonedMinutes(i, IST)).toBe(570);
    expect(zoneOffsetMinutes(i, IST)).toBe(330);
    // Minutes beyond midnight land on the next day.
    expect(zonedInstant('2026-11-19', 1440 + 60, IST).toISOString()).toBe(
      '2026-11-19T19:30:00.000Z',
    );
  });

  it('handles daylight saving time', () => {
    // New York: EDT (−4) before 2026-11-01, EST (−5) after.
    expect(zonedInstant('2026-10-30', 540, 'America/New_York').toISOString()).toBe(
      '2026-10-30T13:00:00.000Z',
    );
    expect(zonedInstant('2026-11-02', 540, 'America/New_York').toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });
});

describe('shifts', () => {
  it('computes windows (including night shifts) and validates configuration', () => {
    expect(shiftNetMinutes(general)).toBe(480);
    expect(shiftNetMinutes(night)).toBe(420);
    const w = shiftWindow('2026-11-19', night, IST);
    expect(w.start.toISOString()).toBe('2026-11-19T16:30:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-20T00:30:00.000Z');
    expect(validateShift(general)).toEqual([]);
    expect(validateShift({ ...general, halfDayMinutes: 600 })).toEqual(
      expect.arrayContaining(['Half-day minutes cannot exceed full-day minutes']),
    );
    expect(validateShift({ ...general, endMinutes: general.startMinutes })).toContain(
      'Start and end time must differ',
    );
  });

  it('pairs punches, ignoring duplicate taps', () => {
    const pairs = pairPunches([
      p('2026-11-19', '09:30', 'IN'),
      p('2026-11-19', '09:31', 'IN'),
      p('2026-11-19', '13:00', 'OUT'),
      p('2026-11-19', '14:00', 'IN'),
      p('2026-11-19', '18:00', 'OUT'),
      p('2026-11-19', '18:05', 'OUT'),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[1]?.out?.toISOString()).toBe(at('2026-11-19', '18:05').toISOString());
  });
});

describe('evaluateDay', () => {
  const base = {
    date: '2026-11-19',
    timeZone: IST,
    kind: 'WORKING' as const,
    shift: general,
    now: later,
  };

  it('marks a full day present with late minutes beyond grace and overtime beyond the threshold', () => {
    const r = evaluateDay({
      ...base,
      punches: [p('2026-11-19', '09:55', 'IN'), p('2026-11-19', '20:00', 'OUT')],
    });
    expect(r).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 605,
      lateMinutes: 15,
      earlyExitMinutes: 0,
    });
    // 605 worked − 480 scheduled − 30 threshold.
    expect(r.overtimeMinutes).toBe(95);
  });

  it('distinguishes half days, absences, early exits and missing punches', () => {
    const half = evaluateDay({
      ...base,
      punches: [p('2026-11-19', '09:30', 'IN'), p('2026-11-19', '14:00', 'OUT')],
    });
    expect(half).toMatchObject({ status: 'HALF_DAY', earlyExitMinutes: 270 });
    expect(evaluateDay({ ...base, punches: [] }).status).toBe('ABSENT');
    const missing = evaluateDay({ ...base, punches: [p('2026-11-19', '09:30', 'IN')] });
    expect(missing).toMatchObject({ missingPunch: true, status: 'ABSENT', workedMinutes: 0 });
  });

  it('keeps today pending until the punch window closes', () => {
    const now = at('2026-11-19', '11:00');
    const r = evaluateDay({ ...base, now, punches: [p('2026-11-19', '09:35', 'IN')] });
    expect(r).toMatchObject({ status: 'PENDING', missingPunch: false, lateMinutes: 0 });
  });

  it('reports leave, offs and holidays, and work on off days', () => {
    expect(evaluateDay({ ...base, leave: 'FULL', punches: [] }).status).toBe('ON_LEAVE');
    expect(evaluateDay({ ...base, kind: 'WEEKLY_OFF', punches: [] }).status).toBe('WEEKLY_OFF');
    expect(evaluateDay({ ...base, kind: 'HOLIDAY', punches: [] }).status).toBe('HOLIDAY');
    const onOff = evaluateDay({
      ...base,
      kind: 'HOLIDAY',
      punches: [p('2026-11-19', '10:00', 'IN'), p('2026-11-19', '14:00', 'OUT')],
    });
    // On a holiday all worked minutes are overtime (no scheduled hours, no threshold).
    expect(onOff).toMatchObject({ status: 'PRESENT', workedOnOffDay: true, overtimeMinutes: 240 });
  });

  it('needs only half the hours with a half-day leave and measures lateness from the second half', () => {
    const r = evaluateDay({
      ...base,
      leave: 'FIRST_HALF',
      punches: [p('2026-11-19', '14:00', 'IN'), p('2026-11-19', '18:30', 'OUT')],
    });
    expect(r).toMatchObject({ status: 'PRESENT', lateMinutes: 0, workedMinutes: 270 });
    const short = evaluateDay({
      ...base,
      leave: 'SECOND_HALF',
      punches: [p('2026-11-19', '09:30', 'IN'), p('2026-11-19', '11:00', 'OUT')],
    });
    expect(short.status).toBe('ABSENT');
  });

  it('uses an approved regularization instead of punches', () => {
    const r = evaluateDay({
      ...base,
      punches: [p('2026-11-19', '09:30', 'IN')],
      regularization: { in: at('2026-11-19', '09:30'), out: at('2026-11-19', '18:30') },
    });
    expect(r).toMatchObject({
      status: 'PRESENT',
      regularized: true,
      missingPunch: false,
      workedMinutes: 540,
    });
  });

  it('attributes night-shift punches to the shift start date', () => {
    const r = evaluateDay({
      ...base,
      shift: night,
      punches: [
        p('2026-11-19', '22:05', 'IN'),
        { at: at('2026-11-20', '06:00'), direction: 'OUT' },
      ],
    });
    expect(r).toMatchObject({ status: 'PRESENT', workedMinutes: 475, overtimeMinutes: 0 });
  });

  it('without a shift, any punch means present', () => {
    expect(
      evaluateDay({ ...base, shift: null, punches: [p('2026-11-19', '10:00', 'IN')] }).status,
    ).toBe('PRESENT');
    expect(evaluateDay({ ...base, shift: null, punches: [] }).status).toBe('ABSENT');
  });

  it('summarizes a period', () => {
    const days = [
      evaluateDay({
        ...base,
        punches: [p('2026-11-19', '09:55', 'IN'), p('2026-11-19', '18:30', 'OUT')],
      }),
      evaluateDay({ ...base, date: '2026-11-20', punches: [] }),
      evaluateDay({ ...base, date: '2026-11-21', kind: 'WEEKLY_OFF', punches: [] }),
    ];
    expect(summarizeDays(days)).toMatchObject({ present: 1, absent: 1, weeklyOff: 1, lateDays: 1 });
  });
});
