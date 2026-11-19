/**
 * Attendance day evaluation (pure). Every threshold comes from the organization's shift
 * configuration; nothing here encodes a statutory rule.
 */
import type { ResolvedDayKind } from './calendar.js';
import { zonedInstant } from './timezone.js';

export interface ShiftRule {
  /** Local start/end in minutes after midnight; `endMinutes <= startMinutes` crosses midnight. */
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  /** Minutes after the start before an arrival counts as late. */
  graceInMinutes: number;
  /** Minutes before the end before a departure counts as early. */
  graceOutMinutes: number;
  /** Worked minutes needed for a full day / a half day. */
  fullDayMinutes: number;
  halfDayMinutes: number;
  /** Overtime starts this many minutes after the scheduled net hours; null = no overtime. */
  overtimeAfterMinutes: number | null;
  /** Punches count for the day from start − before to end + after. */
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
}

export type PunchDirection = 'IN' | 'OUT';

export interface Punch {
  at: Date;
  direction: PunchDirection;
}

export type LeaveSession = 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';

export type AttendanceStatus =
  'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'WEEKLY_OFF' | 'HOLIDAY' | 'PENDING';

export interface DayInput {
  date: string;
  timeZone: string;
  kind: ResolvedDayKind;
  /** Null when the organization has no shift for the employee (presence by punches only). */
  shift: ShiftRule | null;
  punches: readonly Punch[];
  /** Approved regularization replaces the punches for the day. */
  regularization?: { in: Date; out: Date } | null;
  /** Approved leave covering the day. */
  leave?: LeaveSession | null;
  now: Date;
}

export interface DayResult {
  date: string;
  status: AttendanceStatus;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  /** An IN without a matching OUT after the punch window closed. */
  missingPunch: boolean;
  /** Worked on a weekly off / holiday. */
  workedOnOffDay: boolean;
  regularized: boolean;
}

const MIN = 60_000;

/** The scheduled start and end instants of a shift on a local date. */
export function shiftWindow(date: string, shift: ShiftRule, timeZone: string) {
  const end = shift.endMinutes <= shift.startMinutes ? shift.endMinutes + 1440 : shift.endMinutes;
  const start = zonedInstant(date, shift.startMinutes, timeZone);
  const finish = zonedInstant(date, end, timeZone);
  return {
    start,
    end: finish,
    windowStart: new Date(start.getTime() - shift.windowBeforeMinutes * MIN),
    windowEnd: new Date(finish.getTime() + shift.windowAfterMinutes * MIN),
  };
}

/** Net scheduled minutes of a shift (duration minus break). */
export function shiftNetMinutes(shift: ShiftRule): number {
  const span =
    shift.endMinutes <= shift.startMinutes
      ? shift.endMinutes + 1440 - shift.startMinutes
      : shift.endMinutes - shift.startMinutes;
  return Math.max(0, span - shift.breakMinutes);
}

/** Validates a shift's configuration; returns human-readable problems. */
export function validateShift(shift: ShiftRule): string[] {
  const errors: string[] = [];
  const net = shiftNetMinutes(shift);
  if (shift.startMinutes === shift.endMinutes) errors.push('Start and end time must differ');
  if (net <= 0) errors.push('The break is longer than the shift');
  if (shift.halfDayMinutes > shift.fullDayMinutes)
    errors.push('Half-day minutes cannot exceed full-day minutes');
  if (shift.fullDayMinutes > net + shift.breakMinutes)
    errors.push('Full-day minutes cannot exceed the shift length');
  return errors;
}

/**
 * Pairs punches IN→OUT in time order. Consecutive INs keep the first; consecutive OUTs keep
 * the last, so duplicate taps do not distort the total.
 */
export function pairPunches(punches: readonly Punch[]): { in: Date; out: Date | null }[] {
  const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const pairs: { in: Date; out: Date | null }[] = [];
  for (const p of sorted) {
    const last = pairs.at(-1);
    if (p.direction === 'IN') {
      if (!last || last.out) pairs.push({ in: p.at, out: null });
    } else if (last) {
      if (!last.out || p.at > last.out) last.out = p.at;
    }
  }
  return pairs;
}

const minutesBetween = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / MIN));

export function evaluateDay(input: DayInput): DayResult {
  const { shift, timeZone, date, now } = input;
  const window = shift ? shiftWindow(date, shift, timeZone) : null;
  const pairs = input.regularization
    ? [{ in: input.regularization.in, out: input.regularization.out }]
    : pairPunches(input.punches);
  const firstIn = pairs[0]?.in ?? null;
  const closedOuts = pairs.filter((p) => p.out).map((p) => p.out as Date);
  const lastOut = closedOuts.at(-1) ?? null;
  const worked = pairs.reduce((sum, p) => sum + (p.out ? minutesBetween(p.in, p.out) : 0), 0);
  const open = pairs.some((p) => !p.out);
  const windowClosed = window ? now > window.windowEnd : now.getTime() > dayEnd(date, timeZone);
  const missingPunch = open && windowClosed;

  const isOff = input.kind === 'WEEKLY_OFF' || input.kind === 'HOLIDAY';
  const halfDayCalendar = input.kind === 'HALF_DAY';

  let lateMinutes = 0;
  let earlyExitMinutes = 0;
  let overtimeMinutes = 0;
  if (shift && window && !isOff) {
    const expectedStart =
      input.leave === 'FIRST_HALF'
        ? new Date((window.start.getTime() + window.end.getTime()) / 2)
        : window.start;
    const expectedEnd =
      input.leave === 'SECOND_HALF' || halfDayCalendar
        ? new Date((window.start.getTime() + window.end.getTime()) / 2)
        : window.end;
    if (firstIn)
      lateMinutes = Math.max(0, minutesBetween(expectedStart, firstIn) - shift.graceInMinutes);
    if (lastOut && !open)
      earlyExitMinutes = Math.max(0, minutesBetween(lastOut, expectedEnd) - shift.graceOutMinutes);
  }
  if (shift && shift.overtimeAfterMinutes !== null) {
    const expected = isOff
      ? 0
      : halfDayCalendar
        ? shiftNetMinutes(shift) / 2
        : shiftNetMinutes(shift);
    overtimeMinutes = Math.max(
      0,
      Math.round(worked - expected - (isOff ? 0 : shift.overtimeAfterMinutes)),
    );
  }

  const status = dayStatus({
    input,
    worked,
    hasPunch: pairs.length > 0,
    pending: !windowClosed,
    halfDayCalendar,
    isOff,
  });

  return {
    date,
    status,
    scheduledStart: window?.start ?? null,
    scheduledEnd: window?.end ?? null,
    firstIn,
    lastOut,
    workedMinutes: worked,
    lateMinutes:
      status === 'PRESENT' || status === 'HALF_DAY' || status === 'PENDING' ? lateMinutes : 0,
    earlyExitMinutes: status === 'PRESENT' || status === 'HALF_DAY' ? earlyExitMinutes : 0,
    overtimeMinutes,
    missingPunch,
    workedOnOffDay: isOff && worked > 0,
    regularized: Boolean(input.regularization),
  };
}

function dayEnd(date: string, timeZone: string): number {
  return zonedInstant(date, 1440, timeZone).getTime();
}

function dayStatus(a: {
  input: DayInput;
  worked: number;
  hasPunch: boolean;
  pending: boolean;
  halfDayCalendar: boolean;
  isOff: boolean;
}): AttendanceStatus {
  const { input, worked } = a;
  if (input.leave === 'FULL') return 'ON_LEAVE';
  if (a.isOff) return worked > 0 ? 'PRESENT' : input.kind === 'HOLIDAY' ? 'HOLIDAY' : 'WEEKLY_OFF';
  // Optional holidays are working days unless the employee took leave.
  const shift = input.shift;
  if (!shift) {
    if (a.hasPunch) return 'PRESENT';
    return a.pending ? 'PENDING' : 'ABSENT';
  }
  // With half-day leave (or a half working day) the status describes the working half only;
  // the leave half is reported separately (`leave`).
  const halfLeave = input.leave === 'FIRST_HALF' || input.leave === 'SECOND_HALF';
  const required = halfLeave || a.halfDayCalendar ? shift.halfDayMinutes : shift.fullDayMinutes;
  if (worked >= required) return 'PRESENT';
  if (a.pending) return 'PENDING';
  if (!halfLeave && !a.halfDayCalendar && worked >= shift.halfDayMinutes) return 'HALF_DAY';
  return 'ABSENT';
}

/** Totals over a period (register footer, payroll inputs later). */
export function summarizeDays(days: readonly DayResult[]) {
  const count = (s: AttendanceStatus) => days.filter((d) => d.status === s).length;
  return {
    present: count('PRESENT'),
    halfDay: count('HALF_DAY'),
    absent: count('ABSENT'),
    onLeave: count('ON_LEAVE'),
    weeklyOff: count('WEEKLY_OFF'),
    holiday: count('HOLIDAY'),
    pending: count('PENDING'),
    workedMinutes: days.reduce((s, d) => s + d.workedMinutes, 0),
    lateDays: days.filter((d) => d.lateMinutes > 0).length,
    overtimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
    missingPunches: days.filter((d) => d.missingPunch).length,
  };
}
