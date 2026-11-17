import { describe, expect, it } from 'vitest';
import {
  countWorkingDays,
  dayTypeFor,
  FIVE_DAY_WEEK,
  isoWeekday,
  resolveDays,
  validateWorkWeek,
  type WorkWeekRule,
  weekdayOccurrence,
} from './calendar.js';

// Six-day week where the 2nd and 4th Saturdays are off (common in Indian offices).
const SIX_DAY_ALT_SAT: WorkWeekRule[] = [
  ...FIVE_DAY_WEEK,
  { weekday: 6, occurrence: 0, dayType: 'FULL' },
  { weekday: 6, occurrence: 2, dayType: 'OFF' },
  { weekday: 6, occurrence: 4, dayType: 'OFF' },
];

describe('date helpers', () => {
  it('computes ISO weekdays and monthly occurrence', () => {
    expect(isoWeekday('2026-11-16')).toBe(1); // Monday
    expect(isoWeekday('2026-11-15')).toBe(7); // Sunday
    expect(weekdayOccurrence('2026-11-14')).toBe(2); // 2nd Saturday of Nov 2026
    expect(weekdayOccurrence('2026-11-28')).toBe(4);
  });

  it('rejects impossible dates', () => {
    expect(() => isoWeekday('2026-02-30')).toThrow(RangeError);
    expect(() => isoWeekday('16/11/2026')).toThrow(RangeError);
  });
});

describe('dayTypeFor', () => {
  it('applies occurrence-specific overrides before the weekday rule', () => {
    expect(dayTypeFor('2026-11-07', SIX_DAY_ALT_SAT)).toBe('FULL'); // 1st Saturday
    expect(dayTypeFor('2026-11-14', SIX_DAY_ALT_SAT)).toBe('OFF'); // 2nd
    expect(dayTypeFor('2026-11-21', SIX_DAY_ALT_SAT)).toBe('FULL'); // 3rd
    expect(dayTypeFor('2026-11-28', SIX_DAY_ALT_SAT)).toBe('OFF'); // 4th
  });

  it('treats weekdays without a rule as off', () => {
    expect(dayTypeFor('2026-11-15', SIX_DAY_ALT_SAT)).toBe('OFF'); // Sunday
  });
});

describe('validateWorkWeek', () => {
  it('accepts a valid pattern', () => {
    expect(validateWorkWeek(SIX_DAY_ALT_SAT)).toEqual([]);
  });

  it('rejects duplicates and weeks without working days', () => {
    expect(
      validateWorkWeek([...FIVE_DAY_WEEK, { weekday: 1, occurrence: 0, dayType: 'HALF' }]),
    ).toHaveLength(1);
    expect(validateWorkWeek([{ weekday: 6, occurrence: 2, dayType: 'FULL' }])).toEqual([
      'A work week needs at least one working weekday',
    ]);
  });
});

describe('resolveDays', () => {
  it('combines the pattern with holidays', () => {
    const days = resolveDays('2026-11-09', '2026-11-15', SIX_DAY_ALT_SAT, [
      { date: '2026-11-10', name: 'Founders Day', kind: 'PUBLIC' },
      { date: '2026-11-12', name: 'Regional festival', kind: 'OPTIONAL' },
    ]);
    expect(days.map((d) => d.kind)).toEqual([
      'WORKING',
      'HOLIDAY',
      'WORKING',
      'OPTIONAL_HOLIDAY',
      'WORKING',
      'WEEKLY_OFF', // 2nd Saturday
      'WEEKLY_OFF', // Sunday
    ]);
    expect(days[1]?.holidayName).toBe('Founders Day');
  });

  it('prefers a public holiday over an optional one on the same date', () => {
    const [day] = resolveDays('2026-11-10', '2026-11-10', FIVE_DAY_WEEK, [
      { date: '2026-11-10', name: 'Optional', kind: 'OPTIONAL' },
      { date: '2026-11-10', name: 'Public', kind: 'PUBLIC' },
    ]);
    expect(day).toMatchObject({ kind: 'HOLIDAY', holidayName: 'Public' });
  });

  it('crosses month and leap-year boundaries', () => {
    const days = resolveDays('2028-02-28', '2028-03-01', FIVE_DAY_WEEK);
    expect(days.map((d) => d.date)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('guards the range', () => {
    expect(() => resolveDays('2026-11-10', '2026-11-09', FIVE_DAY_WEEK)).toThrow(RangeError);
    expect(() => resolveDays('2026-01-01', '2027-12-31', FIVE_DAY_WEEK)).toThrow(/366/);
  });
});

describe('countWorkingDays', () => {
  it('counts half days as 0.5 and excludes holidays and weekly offs', () => {
    const rules: WorkWeekRule[] = [
      ...FIVE_DAY_WEEK,
      { weekday: 6, occurrence: 0, dayType: 'HALF' },
    ];
    const days = resolveDays('2026-11-09', '2026-11-15', rules, [
      { date: '2026-11-10', name: 'Holiday', kind: 'PUBLIC' },
    ]);
    expect(countWorkingDays(days)).toBe(4.5);
  });
});
