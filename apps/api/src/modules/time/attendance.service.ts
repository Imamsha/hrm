import { Inject, Injectable } from '@nestjs/common';
import { summarizeDays, zonedDate } from '@hrm/business-rules';
import {
  type AttendanceDayItem,
  type AttendanceRangeItem,
  type AttendanceStatusValue,
  type AttendanceSummaryItem,
  type KioskToken,
  type PaginatedResult,
  PERMISSIONS,
  type PunchImportResult,
  type PunchItem,
  type RegularizationItem,
  type TodayAttendance,
} from '@hrm/shared-types';
import type {
  attendanceSummaryQuerySchema,
  decisionSchema,
  manualPunchSchema,
  punchImportSchema,
  punchSchema,
  regularizationSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, skipTake } from '../../common/pagination.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { employeeRefSelect, toEmployeeRef } from '../employees/employee-mapper.js';
import {
  addDays,
  employeeScopeWhere,
  inForceWhere,
  isoDate,
  toDate,
  todayIso,
} from '../employees/employee-scope.js';
import { KioskTokens } from './kiosk-token.js';
import {
  evaluateRange,
  isSelfSubject,
  loadSubject,
  selfEmployeeId,
  type Subject,
  subjectOf,
} from './time-context.js';
import { timeSettings } from './time-settings.service.js';

const P = PERMISSIONS;
const DUPLICATE_WINDOW_MS = 60_000;
/** How far back an employee may ask to regularize (product limit, not a legal rule). */
export const REGULARIZATION_MAX_AGE_DAYS = 60;

const punchSelect = {
  id: true,
  punchedAt: true,
  direction: true,
  source: true,
  latitude: true,
  longitude: true,
  note: true,
} as const;

function toPunch(p: Prisma.AttendancePunchGetPayload<{ select: typeof punchSelect }>): PunchItem {
  return {
    id: p.id,
    punchedAt: p.punchedAt.toISOString(),
    direction: p.direction,
    source: p.source,
    latitude: p.latitude ? p.latitude.toFixed(6) : null,
    longitude: p.longitude ? p.longitude.toFixed(6) : null,
    note: p.note,
  };
}

const regSelect = {
  id: true,
  date: true,
  requestedIn: true,
  requestedOut: true,
  reason: true,
  status: true,
  decidedAt: true,
  decidedByUserId: true,
  decisionNote: true,
  createdAt: true,
  employee: { select: employeeRefSelect },
} as const;

@Injectable()
export class AttendanceService {
  private readonly kiosk: KioskTokens;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.kiosk = new KioskTokens(config.AUTH_JWT_SECRET);
  }

  // ------------------------------------------------------------------ self

  today(principal: AuthPrincipal): Promise<TodayAttendance> {
    return this.prisma.withTenant(async (tx) => {
      const s = await subjectOf(tx, await selfEmployeeId(tx, principal));
      if (!s) throw AppException.notFound('Employee');
      return this.todayOf(tx, s, principal.organizationId ?? '');
    });
  }

  private async todayOf(
    tx: TenantTransaction,
    s: Subject,
    organizationId: string,
  ): Promise<TodayAttendance> {
    const settings = await timeSettings(tx, organizationId);
    const today = zonedDate(new Date(), s.timeZone);
    const days = (await evaluateRange(tx, [s], today, today)).get(s.id) ?? [];
    const last = await tx.attendancePunch.findFirst({
      where: { employeeId: s.id, punchedAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
      orderBy: { punchedAt: 'desc' },
      select: { direction: true },
    });
    const punches = await tx.attendancePunch.findMany({
      where: {
        employeeId: s.id,
        punchedAt: { gte: toDate(addDays(today, -1)), lt: toDate(addDays(today, 2)) },
      },
      orderBy: { punchedAt: 'asc' },
      select: punchSelect,
    });
    return {
      day: days[0] ?? blankDay(today),
      punches: punches.map(toPunch),
      nextDirection: last?.direction === 'IN' ? 'OUT' : 'IN',
      timeZone: s.timeZone,
      allowed: {
        web: settings.webPunchEnabled,
        mobile: settings.mobilePunchEnabled,
        qr: settings.qrPunchEnabled,
        geolocationRequired: settings.geolocationRequired,
      },
    };
  }

  punch(
    principal: AuthPrincipal,
    input: z.output<typeof punchSchema>,
    ipAddress: string | undefined,
  ): Promise<TodayAttendance> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const employeeId = await selfEmployeeId(tx, principal);
      // Serialize punches of one employee (toggle direction and duplicate checks).
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
      const s = await subjectOf(tx, employeeId);
      if (!s) throw AppException.notFound('Employee');
      if (s.status === 'SEPARATED') throw AppException.forbidden('Your employment has ended');
      const today = zonedDate(new Date(), s.timeZone);
      if (today < s.dateOfJoining)
        throw AppException.badRequest('You can clock in from your joining date', 'direction');
      const settings = await timeSettings(tx, organizationId);

      let source: 'WEB' | 'MOBILE' | 'QR' = input.source;
      let branchId: string | null = null;
      if (input.qrToken) {
        if (!settings.qrPunchEnabled) throw AppException.forbidden('QR clock-in is disabled');
        const claims = this.kiosk.verify(input.qrToken, settings.qrRotationSeconds);
        if (claims?.organizationId !== organizationId)
          throw AppException.badRequest('The QR code has expired — scan it again', 'qrToken');
        source = 'QR';
        branchId = claims.branchId;
      } else if (source === 'WEB' && !settings.webPunchEnabled) {
        throw AppException.forbidden('Clocking in from the web is disabled; use the kiosk QR code');
      } else if (source === 'MOBILE' && !settings.mobilePunchEnabled) {
        throw AppException.forbidden('Clocking in from the mobile app is disabled');
      }
      if (settings.geolocationRequired && source !== 'QR' && (!input.latitude || !input.longitude))
        throw AppException.badRequest('Your location is required to clock in', 'latitude');

      const last = await tx.attendancePunch.findFirst({
        where: { employeeId, punchedAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
        orderBy: { punchedAt: 'desc' },
        select: { direction: true, punchedAt: true },
      });
      const direction = input.direction ?? (last?.direction === 'IN' ? 'OUT' : 'IN');
      if (
        last &&
        last.direction === direction &&
        Date.now() - last.punchedAt.getTime() < DUPLICATE_WINDOW_MS
      )
        throw AppException.conflict(
          `You already clocked ${direction === 'IN' ? 'in' : 'out'} a moment ago`,
        );

      await tx.attendancePunch.create({
        data: {
          organizationId,
          employeeId,
          punchedAt: new Date(),
          direction,
          source,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          ipAddress: ipAddress ?? null,
          branchId,
          recordedByUserId: principal.userId,
        },
      });
      return this.todayOf(tx, s, organizationId);
    });
  }

  // ------------------------------------------------------------------ ranges and summaries

  range(
    principal: AuthPrincipal,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<AttendanceRangeItem> {
    return this.prisma.withTenant(async (tx) => {
      const id = employeeId === 'self' ? await selfEmployeeId(tx, principal) : employeeId;
      const s = await loadSubject(
        tx,
        principal,
        id,
        employeeId === 'self' ? null : P.ATTENDANCE_RECORD_READ,
      );
      const days = (await evaluateRange(tx, [s], from, to)).get(s.id) ?? [];
      return {
        employee: s.ref,
        timeZone: s.timeZone,
        from,
        to,
        days,
        totals: summarizeDays(days.map(asDayResult)),
      };
    });
  }

  punches(
    principal: AuthPrincipal,
    employeeId: string,
    from: string,
    to: string,
  ): Promise<PunchItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const id = employeeId === 'self' ? await selfEmployeeId(tx, principal) : employeeId;
      await loadSubject(tx, principal, id, employeeId === 'self' ? null : P.ATTENDANCE_RECORD_READ);
      const rows = await tx.attendancePunch.findMany({
        where: { employeeId: id, punchedAt: { gte: toDate(from), lt: toDate(addDays(to, 1)) } },
        orderBy: { punchedAt: 'asc' },
        select: punchSelect,
        take: 2000,
      });
      return rows.map(toPunch);
    });
  }

  /** Day overview of every employee the caller may see (scope), optionally filtered. */
  summary(
    principal: AuthPrincipal,
    q: z.output<typeof attendanceSummaryQuerySchema>,
  ): Promise<AttendanceSummaryItem> {
    const scope = employeeScopeWhere(principal, P.ATTENDANCE_RECORD_READ, q.date);
    return this.prisma.withTenant(async (tx) => {
      const empty: AttendanceSummaryItem = {
        date: q.date,
        counts: emptyCounts(),
        late: 0,
        missingPunches: 0,
        employees: [],
      };
      if (!scope) return empty;
      const placement: Prisma.EmploymentRecordWhereInput = {
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.branchId ? { branchId: q.branchId } : {}),
      };
      const rows = await tx.employee.findMany({
        where: {
          AND: [
            scope,
            { status: { not: 'SEPARATED' } },
            { dateOfJoining: { lte: toDate(q.date) } },
            Object.keys(placement).length
              ? { employmentRecords: { some: { AND: [inForceWhere(q.date), placement] } } }
              : {},
          ],
        },
        select: {
          id: true,
          employmentRecords: {
            where: inForceWhere(q.date),
            take: 1,
            orderBy: { effectiveFrom: 'desc' },
            select: { department: { select: { name: true } } },
          },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 500,
      });
      const subjects = (await Promise.all(rows.map((r) => subjectOf(tx, r.id)))).filter(
        (x): x is Subject => !!x,
      );
      const days = await evaluateRange(tx, subjects, q.date, q.date);
      const out = { ...empty, counts: emptyCounts() };
      for (const s of subjects) {
        const d = days.get(s.id)?.[0];
        if (!d) continue;
        out.counts[d.status] += 1;
        if (d.lateMinutes > 0) out.late += 1;
        if (d.missingPunch) out.missingPunches += 1;
        out.employees.push({
          employee: s.ref,
          department:
            rows.find((r) => r.id === s.id)?.employmentRecords[0]?.department?.name ?? null,
          status: d.status,
          firstIn: d.firstIn,
          lastOut: d.lastOut,
          lateMinutes: d.lateMinutes,
        });
      }
      return out;
    });
  }

  // ------------------------------------------------------------------ HR punches

  manualPunch(
    principal: AuthPrincipal,
    employeeId: string,
    input: z.output<typeof manualPunchSchema>,
  ): Promise<PunchItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await loadSubject(tx, principal, employeeId, P.ATTENDANCE_RECORD_READ);
      if (!can(principal, P.ATTENDANCE_RECORD_MANAGE, s.attributes)) throw AppException.forbidden();
      if (isSelfSubject(principal, s))
        throw AppException.forbidden('You cannot record manual punches for yourself');
      const at = new Date(input.punchedAt);
      if (at.getTime() > Date.now() + 5 * 60_000)
        throw AppException.badRequest('Punches cannot be in the future', 'punchedAt');
      const row = await tx.attendancePunch
        .create({
          data: {
            organizationId: principal.organizationId ?? '',
            employeeId,
            punchedAt: at,
            direction: input.direction,
            source: 'MANUAL',
            note: input.note,
            recordedByUserId: principal.userId,
          },
          select: punchSelect,
        })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflict('This punch already exists');
          throw err;
        });
      await this.audit.record(tx, {
        action: 'attendance.manual_punch',
        entityType: 'attendance_punch',
        entityId: row.id,
        metadata: {
          employeeId,
          direction: input.direction,
          punchedAt: input.punchedAt,
          note: input.note,
        },
      });
      return toPunch(row);
    });
  }

  /**
   * Imports device punches (e.g. exported from biometric terminals). Idempotent: re-importing the
   * same punch is counted as a duplicate. Device push protocols are integrated in Phase 14.
   */
  importPunches(
    principal: AuthPrincipal,
    input: z.output<typeof punchImportSchema>,
  ): Promise<PunchImportResult> {
    return this.prisma.withTenant(async (tx) => {
      const numbers = [...new Set(input.punches.map((p) => p.employeeNumber))];
      const employees = await tx.employee.findMany({
        where: { employeeNumber: { in: numbers } },
        select: { id: true, employeeNumber: true, status: true },
      });
      const byNumber = new Map(employees.map((e) => [e.employeeNumber, e]));
      const errors: PunchImportResult['errors'] = [];
      const data: Prisma.AttendancePunchCreateManyInput[] = [];
      input.punches.forEach((p, row) => {
        const e = byNumber.get(p.employeeNumber);
        if (!e) return errors.push({ row, message: `Unknown employee number ${p.employeeNumber}` });
        if (Date.parse(p.punchedAt) > Date.now() + 5 * 60_000)
          return errors.push({ row, message: 'Punch is in the future' });
        data.push({
          organizationId: principal.organizationId ?? '',
          employeeId: e.id,
          punchedAt: new Date(p.punchedAt),
          direction: p.direction,
          source: 'BIOMETRIC_IMPORT',
          deviceLabel: p.deviceLabel ?? null,
          recordedByUserId: principal.userId,
        });
      });
      const { count } = data.length
        ? await tx.attendancePunch.createMany({ data, skipDuplicates: true })
        : { count: 0 };
      await this.audit.record(tx, {
        action: 'attendance.punches_imported',
        entityType: 'attendance_punch',
        metadata: { received: input.punches.length, imported: count, errors: errors.length },
      });
      return { imported: count, duplicates: data.length - count, errors };
    });
  }

  // ------------------------------------------------------------------ kiosk

  kioskToken(principal: AuthPrincipal, branchId: string): Promise<KioskToken> {
    return this.prisma.withTenant(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id: branchId },
        select: { id: true, code: true, name: true, companyId: true, status: true },
      });
      if (!branch || branch.status !== 'ACTIVE') throw AppException.notFound('Branch');
      if (
        !can(principal, P.ATTENDANCE_KIOSK_OPERATE, {
          companyId: branch.companyId,
          branchId: branch.id,
        })
      )
        throw AppException.forbidden();
      const settings = await timeSettings(tx, principal.organizationId ?? '');
      if (!settings.qrPunchEnabled)
        throw AppException.conflict('QR clock-in is disabled in attendance settings');
      const rotation = settings.qrRotationSeconds;
      const window = KioskTokens.windowOf(Date.now(), rotation);
      const token = this.kiosk.sign({
        organizationId: principal.organizationId ?? '',
        branchId,
        window,
      });
      const expiresAt = new Date((window + 2) * rotation * 1000);
      return {
        token,
        url: `${this.config.APP_WEB_URL.replace(/\/$/, '')}/attendance/qr?t=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
        rotatesInSeconds: Math.max(
          1,
          Math.ceil(((window + 1) * rotation * 1000 - Date.now()) / 1000),
        ),
        branch: { id: branch.id, code: branch.code, name: branch.name },
      };
    });
  }

  // ------------------------------------------------------------------ regularization

  requestRegularization(
    principal: AuthPrincipal,
    input: z.output<typeof regularizationSchema>,
  ): Promise<RegularizationItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await subjectOf(tx, await selfEmployeeId(tx, principal));
      if (!s) throw AppException.notFound('Employee');
      const today = zonedDate(new Date(), s.timeZone);
      if (input.date > today)
        throw AppException.badRequest('You cannot regularize a future day', 'date');
      if (input.date < addDays(today, -REGULARIZATION_MAX_AGE_DAYS))
        throw AppException.badRequest(
          `Requests are limited to the last ${String(REGULARIZATION_MAX_AGE_DAYS)} days`,
          'date',
        );
      if (input.date < s.dateOfJoining)
        throw AppException.badRequest('The day is before your joining date', 'date');
      // The times must belong to that day (night shifts may end the next morning).
      const inDate = zonedDate(new Date(input.requestedIn), s.timeZone);
      if (
        inDate !== input.date &&
        inDate !== addDays(input.date, 1) &&
        inDate !== addDays(input.date, -1)
      )
        throw AppException.badRequest('The in time must be on the selected day', 'requestedIn');
      if (Date.parse(input.requestedOut) > Date.now())
        throw AppException.badRequest('The out time cannot be in the future', 'requestedOut');
      const row = await tx.attendanceRegularization
        .create({
          data: {
            organizationId: principal.organizationId ?? '',
            employeeId: s.id,
            date: toDate(input.date),
            requestedIn: new Date(input.requestedIn),
            requestedOut: new Date(input.requestedOut),
            reason: input.reason,
            requestedByUserId: principal.userId,
          },
          select: regSelect,
        })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflictOn('A request for this day is already pending', 'date');
          throw err;
        });
      await this.audit.record(tx, {
        action: 'attendance.regularization_requested',
        entityType: 'attendance_regularization',
        entityId: row.id,
        metadata: { date: input.date },
      });
      return this.toReg(tx, row);
    });
  }

  myRegularizations(principal: AuthPrincipal): Promise<RegularizationItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const id = await selfEmployeeId(tx, principal);
      const rows = await tx.attendanceRegularization.findMany({
        where: { employeeId: id },
        orderBy: { date: 'desc' },
        take: 100,
        select: regSelect,
      });
      return Promise.all(rows.map((r) => this.toReg(tx, r)));
    });
  }

  cancelRegularization(principal: AuthPrincipal, id: string): Promise<RegularizationItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await selfEmployeeId(tx, principal);
      const r = await tx.attendanceRegularization.findFirst({
        where: { id, employeeId: me },
        select: { status: true },
      });
      if (!r) throw AppException.notFound('Regularization');
      if (r.status !== 'PENDING')
        throw AppException.conflict('Only pending requests can be cancelled');
      const row = await tx.attendanceRegularization.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: regSelect,
      });
      await this.audit.record(tx, {
        action: 'attendance.regularization_cancelled',
        entityType: 'attendance_regularization',
        entityId: id,
      });
      return this.toReg(tx, row);
    });
  }

  listRegularizations(
    principal: AuthPrincipal,
    q: {
      status?: string | undefined;
      employeeId?: string | undefined;
      page: number;
      pageSize: number;
    },
  ): Promise<PaginatedResult<RegularizationItem>> {
    const scope = employeeScopeWhere(principal, P.ATTENDANCE_RECORD_READ, todayIso());
    if (!scope) return Promise.resolve(paginate([], 0, q));
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.AttendanceRegularizationWhereInput = {
        employee: scope,
        ...(q.status ? { status: q.status as 'PENDING' } : {}),
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.attendanceRegularization.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          select: regSelect,
          ...skipTake(q),
        }),
        tx.attendanceRegularization.count({ where }),
      ]);
      return paginate(await Promise.all(rows.map((r) => this.toReg(tx, r))), total, q);
    });
  }

  /** Pending regularizations the caller may decide (reporting line or scoped permission). */
  async pendingForApprover(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    myEmployeeId: string | null,
  ) {
    const scope = employeeScopeWhere(principal, P.ATTENDANCE_RECORD_MANAGE, todayIso());
    const ors: Prisma.AttendanceRegularizationWhereInput[] = [];
    if (scope) ors.push({ employee: scope });
    if (myEmployeeId)
      ors.push({
        employee: {
          employmentRecords: {
            some: { AND: [inForceWhere(todayIso()), { managerId: myEmployeeId }] },
          },
        },
      });
    if (!ors.length) return [];
    const rows = await tx.attendanceRegularization.findMany({
      where: {
        status: 'PENDING',
        OR: ors,
        ...(myEmployeeId ? { employeeId: { not: myEmployeeId } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: regSelect,
      take: 200,
    });
    return Promise.all(rows.map((r) => this.toReg(tx, r)));
  }

  decideRegularization(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof decisionSchema>,
  ): Promise<RegularizationItem> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.attendanceRegularization.findFirst({
        where: { id },
        select: { employeeId: true, status: true, date: true },
      });
      if (!r) throw AppException.notFound('Regularization');
      const s = await subjectOf(tx, r.employeeId);
      if (!s) throw AppException.notFound('Regularization');
      const mine = principal.membershipId
        ? await tx.employee.findFirst({
            where: { membershipId: principal.membershipId },
            select: { id: true },
          })
        : null;
      const allowed =
        !isSelfSubject(principal, s) &&
        ((mine !== null && s.managerId === mine.id) ||
          can(principal, P.ATTENDANCE_RECORD_MANAGE, s.attributes));
      if (!allowed) {
        if (!can(principal, P.ATTENDANCE_RECORD_READ, s.attributes) && !isSelfSubject(principal, s))
          throw AppException.notFound('Regularization');
        throw AppException.forbidden('You cannot decide this request');
      }
      if (r.status !== 'PENDING')
        throw AppException.conflict('This request has already been decided');
      const row = await tx.attendanceRegularization.update({
        where: { id },
        data: {
          status: input.decision,
          decidedByUserId: principal.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
        select: regSelect,
      });
      await this.audit.record(tx, {
        action:
          input.decision === 'APPROVED'
            ? 'attendance.regularization_approved'
            : 'attendance.regularization_rejected',
        entityType: 'attendance_regularization',
        entityId: id,
        metadata: { employeeId: r.employeeId, date: isoDate(r.date) },
      });
      return this.toReg(tx, row);
    });
  }

  private async toReg(
    tx: TenantTransaction,
    r: Prisma.AttendanceRegularizationGetPayload<{ select: typeof regSelect }>,
  ): Promise<RegularizationItem> {
    const decider = r.decidedByUserId
      ? await tx.membership.findFirst({
          where: { userId: r.decidedByUserId },
          select: { user: { select: { fullName: true } } },
        })
      : null;
    return {
      id: r.id,
      employee: toEmployeeRef(r.employee) as RegularizationItem['employee'],
      date: isoDate(r.date),
      requestedIn: r.requestedIn.toISOString(),
      requestedOut: r.requestedOut.toISOString(),
      reason: r.reason,
      status: r.status,
      decidedBy: decider?.user.fullName ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

function emptyCounts(): Record<AttendanceStatusValue, number> {
  return { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, ON_LEAVE: 0, WEEKLY_OFF: 0, HOLIDAY: 0, PENDING: 0 };
}

function blankDay(date: string): AttendanceDayItem {
  return {
    date,
    status: 'PENDING',
    leave: null,
    holidayName: null,
    shift: null,
    scheduledStart: null,
    scheduledEnd: null,
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    missingPunch: false,
    workedOnOffDay: false,
    regularized: false,
    pendingRegularization: false,
  };
}

/** Adapter for `summarizeDays` (only status and minute fields are read). */
function asDayResult(d: AttendanceDayItem) {
  return {
    date: d.date,
    status: d.status,
    scheduledStart: null,
    scheduledEnd: null,
    firstIn: null,
    lastOut: null,
    workedMinutes: d.workedMinutes,
    lateMinutes: d.lateMinutes,
    earlyExitMinutes: d.earlyExitMinutes,
    overtimeMinutes: d.overtimeMinutes,
    missingPunch: d.missingPunch,
    workedOnOffDay: d.workedOnOffDay,
    regularized: d.regularized,
  };
}
