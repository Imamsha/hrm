/**
 * Working-day calendar rules (pure functions, no I/O). Shared by the API (calendar resolution,
 * later leave and attendance) and clients (calendar previews).
 *
 * Dates are ISO calendar dates `YYYY-MM-DD` interpreted without a time zone: a "day" is a
 * calendar day in the branch's local time, so no instant/offset arithmetic is involved.
 */

export type DayType = 'FULL' | 'HALF' | 'OFF';
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WorkWeekRule {
  weekday: IsoWeekday;
  /** 0 = every occurrence in the month; 1–5 = only the nth occurrence (e.g. 2nd Saturday). */
  occurrence: 0 | 1 | 2 | 3 | 4 | 5;
  dayType: DayType;
}

export type HolidayKind = 'PUBLIC' | 'OPTIONAL';

export interface HolidayEntry {
  date: string;
  name: string;
  kind: HolidayKind;
}

export type ResolvedDayKind =
  'WORKING' | 'HALF_DAY' | 'WEEKLY_OFF' | 'HOLIDAY' | 'OPTIONAL_HOLIDAY';

export interface ResolvedDay {
  date: string;
  weekday: IsoWeekday;
  kind: ResolvedDayKind;
  /** Holiday name for HOLIDAY / OPTIONAL_HOLIDAY. */
  holidayName?: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: string): Date {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Invalid ISO date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== date) throw new RangeError(`Invalid calendar date: ${date}`);
  return d;
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoWeekday(date: string): IsoWeekday {
  const day = parse(date).getUTCDay(); // 0 = Sunday
  return (day === 0 ? 7 : day) as IsoWeekday;
}

/** 1-based occurrence of this weekday within its month (the 2nd Saturday → 2). */
export function weekdayOccurrence(date: string): number {
  return Math.ceil(parse(date).getUTCDate() / 7);
}

/**
 * Day type from a work-week pattern. Occurrence-specific rules (e.g. "2nd Saturday OFF") take
 * precedence over the weekday's general rule; weekdays with no rule are OFF.
 */
export function dayTypeFor(date: string, rules: readonly WorkWeekRule[]): DayType {
  const weekday = isoWeekday(date);
  const occurrence = weekdayOccurrence(date);
  const specific = rules.find((r) => r.weekday === weekday && r.occurrence === occurrence);
  if (specific) return specific.dayType;
  const general = rules.find((r) => r.weekday === weekday && r.occurrence === 0);
  return general?.dayType ?? 'OFF';
}

/**
 * Validates a pattern: at most one general rule per weekday, at most one rule per
 * (weekday, occurrence), and at least one working day in a normal week.
 */
export function validateWorkWeek(rules: readonly WorkWeekRule[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const key = `${String(r.weekday)}:${String(r.occurrence)}`;
    if (seen.has(key))
      errors.push(
        `Duplicate rule for weekday ${String(r.weekday)} occurrence ${String(r.occurrence)}`,
      );
    seen.add(key);
  }
  const hasWorkingDay = rules.some((r) => r.occurrence === 0 && r.dayType !== 'OFF');
  if (!hasWorkingDay) errors.push('A work week needs at least one working weekday');
  return errors;
}

/**
 * Resolves every day in [from, to] (inclusive). Holidays override the work-week pattern;
 * a public holiday on a weekly-off day is still reported as HOLIDAY so callers can apply
 * their own policy (e.g. compensatory off).
 */
export function resolveDays(
  from: string,
  to: string,
  rules: readonly WorkWeekRule[],
  holidays: readonly HolidayEntry[] = [],
): ResolvedDay[] {
  const start = parse(from);
  const end = parse(to);
  if (end < start) throw new RangeError('`to` must not be before `from`');
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (spanDays > 366) throw new RangeError('Range must not exceed 366 days');

  const byDate = new Map<string, HolidayEntry>();
  for (const h of holidays) {
    const existing = byDate.get(h.date);
    // A public holiday wins over an optional one on the same date.
    if (!existing || (existing.kind === 'OPTIONAL' && h.kind === 'PUBLIC')) byDate.set(h.date, h);
  }

  const out: ResolvedDay[] = [];
  for (let i = 0; i < spanDays; i++) {
    const date = format(new Date(start.getTime() + i * 86_400_000));
    const weekday = isoWeekday(date);
    const holiday = byDate.get(date);
    if (holiday) {
      out.push({
        date,
        weekday,
        kind: holiday.kind === 'PUBLIC' ? 'HOLIDAY' : 'OPTIONAL_HOLIDAY',
        holidayName: holiday.name,
      });
      continue;
    }
    const type = dayTypeFor(date, rules);
    out.push({
      date,
      weekday,
      kind: type === 'FULL' ? 'WORKING' : type === 'HALF' ? 'HALF_DAY' : 'WEEKLY_OFF',
    });
  }
  return out;
}

/** Working-day count, counting half days as 0.5 (optional holidays count as working days). */
export function countWorkingDays(days: readonly ResolvedDay[]): number {
  return days.reduce((sum, d) => {
    if (d.kind === 'WORKING' || d.kind === 'OPTIONAL_HOLIDAY') return sum + 1;
    if (d.kind === 'HALF_DAY') return sum + 0.5;
    return sum;
  }, 0);
}

/** Monday–Friday full days (a common default; organizations configure their own). */
export const FIVE_DAY_WEEK: readonly WorkWeekRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday: weekday as IsoWeekday,
  occurrence: 0,
  dayType: 'FULL',
}));
