/**
 * Leave rules (pure). Quotas, accrual, carry-forward and day-counting options are the
 * organization's policy configuration — no statutory entitlement is assumed here.
 */
import type { ResolvedDay } from './calendar.js';
import { Decimal, type DecimalInput } from './money.js';

export type LeaveSessionPart = 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveCountingPolicy {
  /** Count weekly offs inside the requested range (sandwich rule). */
  countWeeklyOffs: boolean;
  /** Count public holidays inside the requested range. */
  countHolidays: boolean;
  allowHalfDay: boolean;
}

export interface LeaveDay {
  date: string;
  /** Leave taken on the day: 1, 0.5 or 0 (an off day not counted by policy). */
  days: number;
  session: LeaveSessionPart;
}

/**
 * Days charged for a leave from the resolved calendar of its range. `startSession` applies to
 * the first day, `endSession` to the last (SECOND_HALF start = afternoon only; FIRST_HALF end
 * = morning only). A half working day (e.g. Saturday half) counts 0.5.
 */
export function countLeaveDays(
  calendar: readonly ResolvedDay[],
  startSession: LeaveSessionPart,
  endSession: LeaveSessionPart,
  policy: LeaveCountingPolicy,
): { total: number; days: LeaveDay[] } {
  if (calendar.length === 0) return { total: 0, days: [] };
  const single = calendar.length === 1;
  const days = calendar.map((d, i): LeaveDay => {
    let session: LeaveSessionPart = 'FULL';
    if (i === 0 && startSession === 'SECOND_HALF') session = 'SECOND_HALF';
    if (i === calendar.length - 1 && endSession === 'FIRST_HALF') session = 'FIRST_HALF';
    if (single && startSession !== 'FULL') session = startSession;
    const counted =
      d.kind === 'WORKING' ||
      d.kind === 'OPTIONAL_HOLIDAY' ||
      d.kind === 'HALF_DAY' ||
      (d.kind === 'WEEKLY_OFF' && policy.countWeeklyOffs) ||
      (d.kind === 'HOLIDAY' && policy.countHolidays);
    if (!counted) return { date: d.date, days: 0, session };
    const base = d.kind === 'HALF_DAY' ? 0.5 : 1;
    return { date: d.date, days: session === 'FULL' ? base : Math.min(base, 0.5), session };
  });
  return { total: days.reduce((s, d) => s + d.days, 0), days };
}

/** Validates session choices against the policy and range; returns problems. */
export function validateLeaveSessions(
  from: string,
  to: string,
  startSession: LeaveSessionPart,
  endSession: LeaveSessionPart,
  allowHalfDay: boolean,
): string[] {
  const errors: string[] = [];
  if (to < from) errors.push('The end date cannot be before the start date');
  if (!allowHalfDay && (startSession !== 'FULL' || endSession !== 'FULL'))
    errors.push('This leave type cannot be taken in half days');
  if (
    from === to &&
    startSession !== 'FULL' &&
    endSession !== 'FULL' &&
    startSession !== endSession
  )
    errors.push('Choose one half for a single-day half leave');
  if (from !== to && startSession === 'FIRST_HALF')
    errors.push('A multi-day leave can only start in the afternoon (second half)');
  if (from !== to && endSession === 'SECOND_HALF')
    errors.push('A multi-day leave can only end in the morning (first half)');
  return errors;
}

// ------------------------------------------------------------------------- leave year

/** Leave year containing `date` for a year starting in `startMonth` (1–12). Named by its first year. */
export function leaveYearOf(date: string, startMonth: number): number {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m >= startMonth ? y : y - 1;
}

/** First and last date of a leave year. */
export function leaveYearRange(year: number, startMonth: number): { from: string; to: string } {
  const from = `${String(year)}-${String(startMonth).padStart(2, '0')}-01`;
  const endYear = startMonth === 1 ? year : year + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const last = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return {
    from,
    to: `${String(endYear)}-${String(endMonth).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
  };
}

// ------------------------------------------------------------------------- accrual

export type AccrualMethod = 'NONE' | 'YEARLY' | 'MONTHLY';

export interface AccrualPolicy {
  method: AccrualMethod;
  /** Days per leave year. */
  annualQuota: DecimalInput;
  /** YEARLY only: grant a share proportional to the months left when joining mid-year. */
  prorateOnJoining: boolean;
}

export interface AccrualCredit {
  /** 1-based month index within the leave year (1 = first month); 0 = yearly grant. */
  period: number;
  effectiveDate: string;
  days: string;
}

function monthStart(year: number, month: number): string {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((month - 1) % 12) + 1;
  return `${String(y)}-${String(m).padStart(2, '0')}-01`;
}

/**
 * Credits due in a leave year up to `asOf`, for an employee who joined on `joinedOn`.
 * MONTHLY credits quota/12 at the start of each month (from the joining month), rounded to
 * 2 decimals, with the rounding remainder added to the last month so the year sums exactly.
 */
export function accrualCredits(
  policy: AccrualPolicy,
  year: number,
  startMonth: number,
  joinedOn: string,
  asOf: string,
): AccrualCredit[] {
  const quota = new Decimal(policy.annualQuota);
  if (policy.method === 'NONE' || quota.lte(0)) return [];
  const range = leaveYearRange(year, startMonth);
  if (joinedOn > range.to || asOf < range.from) return [];
  const months = Array.from({ length: 12 }, (_, i) => ({
    period: i + 1,
    start: monthStart(year, startMonth + i),
  }));
  const firstMonth = months.findIndex((m, i) => {
    const next = months[i + 1]?.start ?? '9999-12-31';
    return joinedOn < next;
  });
  const eligible = months.slice(Math.max(0, firstMonth));

  if (policy.method === 'YEARLY') {
    const effectiveDate = joinedOn > range.from ? joinedOn : range.from;
    if (asOf < effectiveDate) return [];
    const days = policy.prorateOnJoining
      ? quota.mul(eligible.length).div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      : quota;
    return [{ period: 0, effectiveDate, days: days.toFixed(2) }];
  }

  const perMonth = quota.div(12).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const remainder = quota.sub(perMonth.mul(12));
  return eligible
    .filter((m) => m.start <= asOf)
    .map((m) => ({
      period: m.period,
      effectiveDate: m.start < joinedOn ? joinedOn : m.start,
      days: (m.period === 12 ? perMonth.add(remainder) : perMonth).toFixed(2),
    }));
}

/** Year-end carry-forward: the closing balance up to the cap carries; the rest lapses. */
export function carryForward(
  closingBalance: DecimalInput,
  cap: DecimalInput | null,
): { carry: string; lapse: string } {
  const balance = Decimal.max(new Decimal(closingBalance), 0);
  const carry = cap === null ? new Decimal(0) : Decimal.min(balance, new Decimal(cap));
  return { carry: carry.toFixed(2), lapse: balance.sub(carry).toFixed(2) };
}
