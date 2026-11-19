import {
  type DayResult,
  evaluateDay,
  type HolidayEntry,
  type LeaveSession,
  type Punch,
  resolveDays,
  type ResolvedDay,
  type ShiftRule,
  type WorkWeekRule,
  zonedInstant,
} from '@hrm/business-rules';
import type { AttendanceDayItem, EmployeeRef, Permission } from '@hrm/shared-types';
import { AppException } from '../../common/http/app.exception.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { employeeRefSelect, toEmployeeRef } from '../employees/employee-mapper.js';
import {
  addDays,
  currentRecord,
  employeeAttributes,
  isoDate,
  toDate,
  todayIso,
} from '../employees/employee-scope.js';

export interface Subject {
  id: string;
  ref: EmployeeRef;
  status: 'ACTIVE' | 'ON_NOTICE' | 'SEPARATED';
  dateOfJoining: string;
  lastWorkingDate: string | null;
  membershipId: string | null;
  ownerUserId: string | null;
  probationStatus: 'NOT_APPLICABLE' | 'ON_PROBATION' | 'CONFIRMED';
  attributes: ReturnType<typeof employeeAttributes>;
  /** Current reporting manager (routing of approvals). */
  managerId: string | null;
  employmentType: string | null;
  timeZone: string;
}

/**
 * Loads an employee as the subject of a time & attendance action. 404 unless the caller is the
 * employee or `permission` covers them (ABAC), so employees outside scope stay invisible.
 */
export async function loadSubject(
  tx: TenantTransaction,
  principal: AuthPrincipal,
  employeeId: string,
  permission: Permission | null,
): Promise<Subject> {
  const subject = await subjectOf(tx, employeeId);
  if (!subject) throw AppException.notFound('Employee');
  const self = subject.ownerUserId !== null && subject.ownerUserId === principal.userId;
  if (!self && !(permission && can(principal, permission, subject.attributes)))
    throw AppException.notFound('Employee');
  return subject;
}

export function isSelfSubject(principal: AuthPrincipal, s: Subject): boolean {
  return s.ownerUserId !== null && s.ownerUserId === principal.userId;
}

export async function subjectOf(
  tx: TenantTransaction,
  employeeId: string,
): Promise<Subject | null> {
  const e = await tx.employee.findFirst({
    where: { id: employeeId },
    select: {
      ...employeeRefSelect,
      status: true,
      dateOfJoining: true,
      lastWorkingDate: true,
      probationStatus: true,
      membershipId: true,
      membership: { select: { userId: true } },
      employmentRecords: {
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          changeType: true,
          companyId: true,
          branchId: true,
          departmentId: true,
          teamId: true,
          managerId: true,
          employmentType: true,
          branch: { select: { timezone: true } },
          company: { select: { timezone: true } },
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 3,
      },
    },
  });
  if (!e) return null;
  const rec = currentRecord(e.employmentRecords, todayIso());
  const org = await tx.organization.findFirst({ select: { defaultTimezone: true } });
  return {
    id: e.id,
    ref: toEmployeeRef(e) as EmployeeRef,
    status: e.status,
    dateOfJoining: isoDate(e.dateOfJoining),
    lastWorkingDate: e.lastWorkingDate ? isoDate(e.lastWorkingDate) : null,
    membershipId: e.membershipId,
    ownerUserId: e.membership?.userId ?? null,
    probationStatus: e.probationStatus,
    attributes: employeeAttributes(rec, e.membership?.userId),
    managerId: rec?.managerId ?? null,
    employmentType: rec?.employmentType ?? null,
    timeZone:
      rec?.branch?.timezone ?? rec?.company.timezone ?? org?.defaultTimezone ?? 'Asia/Kolkata',
  };
}

/** The caller's own employee id, or 404. */
export async function selfEmployeeId(
  tx: TenantTransaction,
  principal: AuthPrincipal,
): Promise<string> {
  const e = principal.membershipId
    ? await tx.employee.findFirst({
        where: { membershipId: principal.membershipId },
        select: { id: true },
      })
    : null;
  if (!e) throw AppException.notFound('Employee record linked to your account');
  return e.id;
}

// ------------------------------------------------------------------------------ calendars

type CalendarSource = { workWeekId: string | null; holidayCalendarId: string | null };

/**
 * Resolved calendar per date for an employee over a range, following branch changes in their
 * job history. Without any work week configured every day is a working day (attendance by
 * punches only); leave counting rejects that case instead (see `requireWorkWeek`).
 */
export async function employeeCalendar(
  tx: TenantTransaction,
  employeeId: string,
  from: string,
  to: string,
): Promise<{ days: Map<string, ResolvedDay>; configured: boolean }> {
  const records = await tx.employmentRecord.findMany({
    where: {
      employeeId,
      effectiveFrom: { lte: toDate(to) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(from) } }],
    },
    select: { effectiveFrom: true, effectiveTo: true, branchId: true },
    orderBy: { effectiveFrom: 'asc' },
  });
  const branchIds = [...new Set(records.map((r) => r.branchId).filter((x): x is string => !!x))];
  const branches = branchIds.length
    ? await tx.branch.findMany({
        where: { id: { in: branchIds } },
        select: { id: true, workWeekId: true, holidayCalendarId: true },
      })
    : [];
  const byBranch = new Map(branches.map((b) => [b.id, b]));
  const sources = new Map<string, CalendarSource>();
  const sourceFor = (date: string): CalendarSource => {
    const r = [...records]
      .reverse()
      .find(
        (x) =>
          isoDate(x.effectiveFrom) <= date && (!x.effectiveTo || isoDate(x.effectiveTo) >= date),
      );
    const b = r?.branchId ? byBranch.get(r.branchId) : undefined;
    return { workWeekId: b?.workWeekId ?? null, holidayCalendarId: b?.holidayCalendarId ?? null };
  };
  const cache = new Map<string, Map<string, ResolvedDay> | null>();
  let configured = true;
  const out = new Map<string, ResolvedDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const src = sourceFor(d);
    const key = `${src.workWeekId ?? 'default'}|${src.holidayCalendarId ?? 'default'}`;
    sources.set(d, src);
    if (!cache.has(key)) cache.set(key, await resolveFor(tx, src, from, to));
    const resolved = cache.get(key);
    if (resolved) {
      const day = resolved.get(d);
      if (day) out.set(d, day);
    } else {
      configured = false;
      out.set(d, {
        date: d,
        weekday: (((toDate(d).getUTCDay() + 6) % 7) + 1) as ResolvedDay['weekday'],
        kind: 'WORKING',
      });
    }
  }
  return { days: out, configured };
}

async function resolveFor(
  tx: TenantTransaction,
  src: CalendarSource,
  from: string,
  to: string,
): Promise<Map<string, ResolvedDay> | null> {
  const week = await tx.workWeek.findFirst({
    where: src.workWeekId ? { id: src.workWeekId } : { isDefault: true },
    include: { rules: true },
  });
  if (!week) return null;
  const cal = await tx.holidayCalendar.findFirst({
    where: src.holidayCalendarId ? { id: src.holidayCalendarId } : { isDefault: true },
    select: { id: true },
  });
  const holidays: HolidayEntry[] = cal
    ? (
        await tx.holiday.findMany({
          where: { calendarId: cal.id, date: { gte: toDate(from), lte: toDate(to) } },
        })
      ).map((h) => ({ date: isoDate(h.date), name: h.name, kind: h.kind }))
    : [];
  return new Map(
    resolveDays(from, to, week.rules as unknown as WorkWeekRule[], holidays).map((d) => [
      d.date,
      d,
    ]),
  );
}

// ------------------------------------------------------------------------------ shifts

export interface ShiftRow {
  id: string;
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMinutes: number | null;
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
}

export function toShiftRule(s: ShiftRow): ShiftRule {
  return {
    startMinutes: s.startMinutes,
    endMinutes: s.endMinutes,
    breakMinutes: s.breakMinutes,
    graceInMinutes: s.graceInMinutes,
    graceOutMinutes: s.graceOutMinutes,
    fullDayMinutes: s.fullDayMinutes,
    halfDayMinutes: s.halfDayMinutes,
    overtimeAfterMinutes: s.overtimeAfterMinutes,
    windowBeforeMinutes: s.windowBeforeMinutes,
    windowAfterMinutes: s.windowAfterMinutes,
  };
}

/** Shift per date: roster entry (a shift or a day off) → assignment → organization default. */
export async function employeeShifts(
  tx: TenantTransaction,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<(employeeId: string, date: string) => { shift: ShiftRow | null; rosterOff: boolean }> {
  const [roster, assignments, fallback] = await Promise.all([
    tx.rosterEntry.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: toDate(from), lte: toDate(to) } },
      select: { employeeId: true, date: true, shift: true },
    }),
    tx.shiftAssignment.findMany({
      where: {
        employeeId: { in: employeeIds },
        effectiveFrom: { lte: toDate(to) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(from) } }],
      },
      select: { employeeId: true, effectiveFrom: true, effectiveTo: true, shift: true },
    }),
    tx.shift.findFirst({ where: { isDefault: true, status: 'ACTIVE' } }),
  ]);
  const rosterMap = new Map(roster.map((r) => [`${r.employeeId}|${isoDate(r.date)}`, r]));
  return (employeeId, date) => {
    const r = rosterMap.get(`${employeeId}|${date}`);
    if (r) return { shift: r.shift, rosterOff: r.shift === null };
    const a = assignments.find(
      (x) =>
        x.employeeId === employeeId &&
        isoDate(x.effectiveFrom) <= date &&
        (!x.effectiveTo || isoDate(x.effectiveTo) >= date),
    );
    return { shift: a?.shift ?? fallback, rosterOff: false };
  };
}

// ------------------------------------------------------------------------------ leave per day

export interface DayLeave {
  type: string;
  session: LeaveSession;
}

/** Approved leave per employee and date (half sessions on the first/last day). */
export async function approvedLeave(
  tx: TenantTransaction,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<Map<string, DayLeave>> {
  const requests = await tx.leaveRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'APPROVED',
      startDate: { lte: toDate(to) },
      endDate: { gte: toDate(from) },
    },
    select: {
      employeeId: true,
      startDate: true,
      endDate: true,
      startSession: true,
      endSession: true,
      leaveType: { select: { name: true } },
    },
  });
  const out = new Map<string, DayLeave>();
  for (const r of requests) {
    const start = isoDate(r.startDate);
    const end = isoDate(r.endDate);
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (d < from || d > to) continue;
      let session: LeaveSession = 'FULL';
      if (d === start && r.startSession !== 'FULL') session = r.startSession;
      if (d === end && r.endSession === 'FIRST_HALF')
        session = start === end ? r.startSession : 'FIRST_HALF';
      const key = `${r.employeeId}|${d}`;
      const existing = out.get(key);
      // Two half-day leaves on one day make a full day.
      out.set(
        key,
        existing && existing.session !== session
          ? { type: existing.type, session: 'FULL' }
          : { type: r.leaveType.name, session },
      );
    }
  }
  return out;
}

// ------------------------------------------------------------------------------ evaluation

/**
 * Evaluates attendance for employees over a range (batch: one query per kind of data).
 * Dates outside employment (before joining / after the last working day) are omitted.
 */
export async function evaluateRange(
  tx: TenantTransaction,
  subjects: Subject[],
  from: string,
  to: string,
  now: Date = new Date(),
): Promise<Map<string, AttendanceDayItem[]>> {
  const ids = subjects.map((s) => s.id);
  // Punches for night shifts may fall on the next calendar day: widen by one day each side.
  const punchFrom = toDate(addDays(from, -1));
  const punchTo = toDate(addDays(to, 2));
  const [punches, regs, pendingRegs, leave, shiftOf] = await Promise.all([
    tx.attendancePunch.findMany({
      where: { employeeId: { in: ids }, punchedAt: { gte: punchFrom, lt: punchTo } },
      select: { employeeId: true, punchedAt: true, direction: true },
      orderBy: { punchedAt: 'asc' },
    }),
    tx.attendanceRegularization.findMany({
      where: {
        employeeId: { in: ids },
        status: 'APPROVED',
        date: { gte: toDate(from), lte: toDate(to) },
      },
      select: {
        employeeId: true,
        date: true,
        requestedIn: true,
        requestedOut: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'asc' },
    }),
    tx.attendanceRegularization.findMany({
      where: {
        employeeId: { in: ids },
        status: 'PENDING',
        date: { gte: toDate(from), lte: toDate(to) },
      },
      select: { employeeId: true, date: true },
    }),
    approvedLeave(tx, ids, from, to),
    employeeShifts(tx, ids, from, to),
  ]);
  const regMap = new Map(regs.map((r) => [`${r.employeeId}|${isoDate(r.date)}`, r]));
  const pendingSet = new Set(pendingRegs.map((r) => `${r.employeeId}|${isoDate(r.date)}`));
  const result = new Map<string, AttendanceDayItem[]>();

  for (const s of subjects) {
    const { days: calendar } = await employeeCalendar(tx, s.id, from, to);
    const mine: Punch[] = punches
      .filter((p) => p.employeeId === s.id)
      .map((p) => ({ at: p.punchedAt, direction: p.direction }));
    const items: AttendanceDayItem[] = [];
    // A punch belongs to the first day whose window contains it (no double counting).
    const claimed = new Set<Date>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (d < s.dateOfJoining) continue;
      if (s.lastWorkingDate && s.status === 'SEPARATED' && d > s.lastWorkingDate) continue;
      const cal = calendar.get(d);
      const { shift, rosterOff } = shiftOf(s.id, d);
      const kind = rosterOff ? 'WEEKLY_OFF' : (cal?.kind ?? 'WORKING');
      const key = `${s.id}|${d}`;
      const reg = regMap.get(key);
      const leaveForDay = leave.get(key);
      const countsLeave = kind === 'WORKING' || kind === 'HALF_DAY' || kind === 'OPTIONAL_HOLIDAY';
      const rule = shift ? toShiftRule(shift) : null;
      const dayPunches = selectPunches(mine, claimed, d, rule, s.timeZone);
      const r: DayResult = evaluateDay({
        date: d,
        timeZone: s.timeZone,
        kind,
        shift: rule,
        punches: dayPunches,
        regularization: reg ? { in: reg.requestedIn, out: reg.requestedOut } : null,
        leave: countsLeave ? (leaveForDay?.session ?? null) : null,
        now,
      });
      items.push({
        date: d,
        status: r.status,
        leave:
          countsLeave && leaveForDay
            ? { type: leaveForDay.type, session: leaveForDay.session }
            : null,
        holidayName: cal?.holidayName ?? null,
        shift: shift ? { code: shift.code, name: shift.name } : null,
        scheduledStart: r.scheduledStart?.toISOString() ?? null,
        scheduledEnd: r.scheduledEnd?.toISOString() ?? null,
        firstIn: r.firstIn?.toISOString() ?? null,
        lastOut: r.lastOut?.toISOString() ?? null,
        workedMinutes: r.workedMinutes,
        lateMinutes: r.lateMinutes,
        earlyExitMinutes: r.earlyExitMinutes,
        overtimeMinutes: r.overtimeMinutes,
        missingPunch: r.missingPunch,
        workedOnOffDay: r.workedOnOffDay,
        regularized: r.regularized,
        pendingRegularization: pendingSet.has(key),
      });
    }
    result.set(s.id, items);
  }
  return result;
}

function selectPunches(
  punches: Punch[],
  claimed: Set<Date>,
  date: string,
  shift: ShiftRule | null,
  timeZone: string,
): Punch[] {
  let start: number;
  let end: number;
  if (shift) {
    const crosses = shift.endMinutes <= shift.startMinutes;
    const s = zonedStart(date, shift.startMinutes - shift.windowBeforeMinutes, timeZone);
    const e = zonedStart(
      date,
      (crosses ? shift.endMinutes + 1440 : shift.endMinutes) + shift.windowAfterMinutes,
      timeZone,
    );
    start = s;
    end = e;
  } else {
    start = zonedStart(date, 0, timeZone);
    end = zonedStart(date, 1440, timeZone) - 1;
  }
  const chosen = punches.filter(
    (p) => !claimed.has(p.at) && p.at.getTime() >= start && p.at.getTime() <= end,
  );
  for (const p of chosen) claimed.add(p.at);
  return chosen;
}

function zonedStart(date: string, minutes: number, timeZone: string): number {
  return zonedInstant(date, minutes, timeZone).getTime();
}
