import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  countLeaveDays,
  Decimal,
  leaveYearOf,
  leaveYearRange,
  validateLeaveSessions,
} from '@hrm/business-rules';
import {
  type LeaveBalanceItem,
  type LeaveLedgerItem,
  type LeavePreview,
  type LeaveRequestItem,
  type LeaveTypeItem,
  type PaginatedResult,
  PERMISSIONS,
} from '@hrm/shared-types';
import type {
  balanceAdjustmentSchema,
  createLeaveTypeSchema,
  decisionSchema,
  leaveRequestQuerySchema,
  leaveRequestSchema,
  updateLeaveTypeSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { WorkflowEngine } from '../workflows/workflow-engine.service.js';
import { WorkflowRegistry } from '../workflows/workflow-registry.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import { employeeRefSelect, toEmployeeRef } from '../employees/employee-mapper.js';
import {
  addDays,
  employeeScopeWhere,
  inForceWhere,
  isoDate,
  toDate,
  todayIso,
} from '../employees/employee-scope.js';
import { definedOnly, mapWriteError } from '../structure/structure.util.js';
import { applies, balanceOf, ensureLedger, type LeaveTypeRow } from './leave-ledger.js';
import {
  employeeCalendar,
  isSelfSubject,
  loadSubject,
  selfEmployeeId,
  type Subject,
  subjectOf,
} from './time-context.js';
import { timeSettings } from './time-settings.service.js';

const P = PERMISSIONS;
type RequestInput = z.output<typeof leaveRequestSchema>;

function toType(t: LeaveTypeRow): LeaveTypeItem {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isPaid: t.isPaid,
    tracksBalance: t.tracksBalance,
    accrualMethod: t.accrualMethod,
    annualQuota: t.annualQuota.toFixed(2),
    prorateOnJoining: t.prorateOnJoining,
    carryForwardMax: t.carryForwardMax ? t.carryForwardMax.toFixed(2) : null,
    allowNegativeBalance: t.allowNegativeBalance,
    allowHalfDay: t.allowHalfDay,
    countWeeklyOffs: t.countWeeklyOffs,
    countHolidays: t.countHolidays,
    minNoticeDays: t.minNoticeDays,
    maxConsecutiveDays: t.maxConsecutiveDays ? t.maxConsecutiveDays.toFixed(2) : null,
    allowDuringProbation: t.allowDuringProbation,
    employmentTypes: t.employmentTypes,
    status: t.status,
  };
}

const requestSelect = {
  id: true,
  startDate: true,
  endDate: true,
  startSession: true,
  endSession: true,
  days: true,
  reason: true,
  status: true,
  decidedByUserId: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  employeeId: true,
  approverEmployeeId: true,
  employee: { select: employeeRefSelect },
  approver: { select: employeeRefSelect },
  leaveType: { select: { id: true, code: true, name: true } },
} as const;
type RequestRow = Prisma.LeaveRequestGetPayload<{ select: typeof requestSelect }>;

interface Problem {
  message: string;
  path: string;
  /** Balance problems may be overridden by the policy (negative balance). */
  balance?: boolean;
}

@Injectable()
export class LeaveService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly engine: WorkflowEngine,
    private readonly registry: WorkflowRegistry,
  ) {}

  /** Lets the approval inbox summarise and decide leave requests (ADR-018). */
  onModuleInit(): void {
    this.registry.register({
      process: 'LEAVE_REQUEST',
      link: () => '/me/approvals',
      summaries: async (tx, ids) => {
        const rows = await tx.leaveRequest.findMany({
          where: { id: { in: ids } },
          select: { id: true, days: true, startDate: true, leaveType: { select: { name: true } } },
        });
        return new Map(
          rows.map((r) => [
            r.id,
            `${r.leaveType.name}, ${r.days.toFixed(2)} day(s) from ${isoDate(r.startDate)}`,
          ]),
        );
      },
      decide: (principal, id, decision, note) => this.decide(principal, id, { decision, note }),
    });
  }

  // ------------------------------------------------------------------ leave types

  listTypes(includeInactive: boolean): Promise<LeaveTypeItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.leaveType.findMany({
          where: includeInactive ? {} : { status: 'ACTIVE' },
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
        })
      ).map(toType),
    );
  }

  createType(
    principal: AuthPrincipal,
    input: z.output<typeof createLeaveTypeSchema>,
  ): Promise<LeaveTypeItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.leaveType
        .create({ data: { organizationId: principal.organizationId ?? '', ...input } })
        .catch((err: unknown) => mapWriteError(err, { entity: 'leave type', uniqueField: 'code' }));
      await this.audit.record(tx, {
        action: 'leave_type.created',
        entityType: 'leave_type',
        entityId: row.id,
        metadata: { code: row.code },
      });
      return toType(row);
    });
  }

  updateType(id: string, input: z.output<typeof updateLeaveTypeSchema>): Promise<LeaveTypeItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.leaveType.findFirst({ where: { id } });
      if (!before) throw AppException.notFound('Leave type');
      const data = definedOnly(input);
      const row = await tx.leaveType
        .update({ where: { id }, data })
        .catch((err: unknown) => mapWriteError(err, { entity: 'leave type', uniqueField: 'code' }));
      const changes = diffChanges(toType(before) as unknown as Record<string, unknown>, data);
      if (Object.keys(changes).length > 0)
        await this.audit.record(tx, {
          action: 'leave_type.updated',
          entityType: 'leave_type',
          entityId: id,
          changes,
        });
      return toType(row);
    });
  }

  // ------------------------------------------------------------------ balances

  balances(
    principal: AuthPrincipal,
    employeeId: string,
    year?: number,
  ): Promise<LeaveBalanceItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const s = await this.subject(tx, principal, employeeId);
      const settings = await timeSettings(tx, principal.organizationId ?? '');
      const y = year ?? leaveYearOf(todayIso(), settings.leaveYearStartMonth);
      const types = await tx.leaveType.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
      });
      const out: LeaveBalanceItem[] = [];
      for (const t of types) {
        if (applies(t, s)) continue;
        await ensureLedger(
          tx,
          principal.organizationId ?? '',
          s,
          t,
          y,
          settings.leaveYearStartMonth,
        );
        out.push(await balanceOf(tx, s.id, t, y, settings.leaveYearStartMonth));
      }
      return out;
    });
  }

  ledger(
    principal: AuthPrincipal,
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<LeaveLedgerItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const s = await this.subject(tx, principal, employeeId);
      const rows = await tx.leaveLedgerEntry.findMany({
        where: { employeeId: s.id, leaveTypeId, year },
        orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map((r) => ({
        id: r.id,
        entryType: r.entryType,
        days: r.days.toFixed(2),
        effectiveDate: isoDate(r.effectiveDate),
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  adjust(
    principal: AuthPrincipal,
    employeeId: string,
    input: z.output<typeof balanceAdjustmentSchema>,
  ): Promise<LeaveBalanceItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await this.subject(tx, principal, employeeId);
      if (!can(principal, P.LEAVE_BALANCE_ADJUST, s.attributes)) throw AppException.forbidden();
      if (isSelfSubject(principal, s))
        throw AppException.forbidden('You cannot adjust your own balance');
      const type = await tx.leaveType.findFirst({ where: { id: input.leaveTypeId } });
      if (!type) throw AppException.badRequest('Leave type not found', 'leaveTypeId');
      if (!type.tracksBalance)
        throw AppException.badRequest('This leave type does not track a balance', 'leaveTypeId');
      const settings = await timeSettings(tx, principal.organizationId ?? '');
      const range = leaveYearRange(input.year, settings.leaveYearStartMonth);
      await tx.leaveLedgerEntry.create({
        data: {
          organizationId: principal.organizationId ?? '',
          employeeId: s.id,
          leaveTypeId: type.id,
          year: input.year,
          entryType: input.kind,
          days: input.days,
          effectiveDate: toDate(
            todayIso() < range.from ? range.from : todayIso() > range.to ? range.to : todayIso(),
          ),
          note: input.note,
          createdByUserId: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'leave.balance_adjusted',
        entityType: 'employee',
        entityId: s.id,
        metadata: {
          leaveType: type.code,
          year: input.year,
          days: input.days,
          kind: input.kind,
          note: input.note,
        },
      });
      await ensureLedger(
        tx,
        principal.organizationId ?? '',
        s,
        type,
        input.year,
        settings.leaveYearStartMonth,
      );
      return balanceOf(tx, s.id, type, input.year, settings.leaveYearStartMonth);
    });
  }

  // ------------------------------------------------------------------ requests

  preview(
    principal: AuthPrincipal,
    employeeId: string,
    input: RequestInput,
  ): Promise<LeavePreview> {
    return this.prisma.withTenant(async (tx) => {
      const s = await this.subject(tx, principal, employeeId);
      const r = await this.evaluate(tx, principal, s, input, employeeId === 'self');
      return {
        days: r.days.toFixed(2),
        breakdown: r.breakdown,
        balance: r.balance,
        problems: r.problems.map((p) => p.message),
      };
    });
  }

  /** Applies for leave (self, or HR on behalf with approve permission in scope). */
  apply(
    principal: AuthPrincipal,
    employeeId: string,
    input: RequestInput,
  ): Promise<LeaveRequestItem> {
    return this.prisma.withTenant(async (tx) => {
      const id = employeeId === 'self' ? await selfEmployeeId(tx, principal) : employeeId;
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${id}::uuid FOR UPDATE`;
      const s = await this.subject(tx, principal, employeeId);
      if (employeeId !== 'self' && !can(principal, P.LEAVE_REQUEST_APPROVE, s.attributes))
        throw AppException.forbidden();
      const r = await this.evaluate(tx, principal, s, input, employeeId === 'self');
      const blocking = r.problems.find((p) => !p.balance || !r.type.allowNegativeBalance);
      if (blocking) throw AppException.badRequest(blocking.message, blocking.path);
      const row = await tx.leaveRequest.create({
        data: {
          organizationId: principal.organizationId ?? '',
          employeeId: s.id,
          leaveTypeId: r.type.id,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
          startSession: input.startSession,
          endSession: input.endSession,
          days: r.days.toFixed(2),
          reason: input.reason ?? null,
          approverEmployeeId: s.managerId && s.managerId !== s.id ? s.managerId : null,
          requestedByUserId: principal.userId,
        },
        select: requestSelect,
      });
      await this.engine.start(tx, principal, {
        process: 'LEAVE_REQUEST',
        subjectId: row.id,
        requesterEmployeeId: s.id,
        measure: r.days.toFixed(2),
      });
      await this.audit.record(tx, {
        action: 'leave.requested',
        entityType: 'leave_request',
        entityId: row.id,
        metadata: {
          employeeId: s.id,
          leaveType: r.type.code,
          days: r.days.toFixed(2),
          by: employeeId === 'self' ? 'self' : 'hr',
        },
      });
      return this.toItem(tx, principal, row);
    });
  }

  list(
    principal: AuthPrincipal,
    q: z.output<typeof leaveRequestQuerySchema>,
    self: boolean,
  ): Promise<PaginatedResult<LeaveRequestItem>> {
    return this.prisma.withTenant(async (tx) => {
      let scope: Prisma.EmployeeWhereInput | null;
      if (self) scope = { id: await selfEmployeeId(tx, principal) };
      else scope = employeeScopeWhere(principal, P.LEAVE_REQUEST_READ, todayIso());
      if (!scope) return paginate([], 0, q);
      const where: Prisma.LeaveRequestWhereInput = {
        employee: scope,
        ...(q.status ? { status: q.status } : {}),
        ...(q.employeeId && !self ? { employeeId: q.employeeId } : {}),
        ...(q.leaveTypeId ? { leaveTypeId: q.leaveTypeId } : {}),
        ...(q.from ? { endDate: { gte: toDate(q.from) } } : {}),
        ...(q.to ? { startDate: { lte: toDate(q.to) } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.leaveRequest.findMany({
          where,
          orderBy: [{ startDate: q.sortDir === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }],
          select: requestSelect,
          ...skipTake(q),
        }),
        tx.leaveRequest.count({ where }),
      ]);
      return paginate(await Promise.all(rows.map((r) => this.toItem(tx, principal, r))), total, q);
    });
  }

  /** Pending leave the caller may decide: their direct reports or employees in approve scope. */
  async pendingForApprover(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    myEmployeeId: string | null,
  ) {
    const scope = employeeScopeWhere(principal, P.LEAVE_REQUEST_APPROVE, todayIso());
    const ors: Prisma.LeaveRequestWhereInput[] = [];
    if (scope) ors.push({ employee: scope });
    if (myEmployeeId) {
      const waiting = await this.engine.subjectsWaitingFor(tx, 'LEAVE_REQUEST', myEmployeeId);
      if (waiting.length) ors.push({ id: { in: waiting } });
      ors.push({ approverEmployeeId: myEmployeeId });
      ors.push({
        employee: {
          employmentRecords: {
            some: { AND: [inForceWhere(todayIso()), { managerId: myEmployeeId }] },
          },
        },
      });
    }
    if (!ors.length) return [];
    const rows = await tx.leaveRequest.findMany({
      where: {
        status: 'PENDING',
        OR: ors,
        ...(myEmployeeId ? { employeeId: { not: myEmployeeId } } : {}),
      },
      orderBy: { startDate: 'asc' },
      select: requestSelect,
      take: 200,
    });
    const items = await Promise.all(rows.map((r) => this.toItem(tx, principal, r)));
    return items.filter((i) => i.canDecide);
  }

  decide(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof decisionSchema>,
  ): Promise<LeaveRequestItem> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.leaveRequest.findFirst({ where: { id }, select: requestSelect });
      if (!r) throw AppException.notFound('Leave request');
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${r.employeeId}::uuid FOR UPDATE`;
      const s = await subjectOf(tx, r.employeeId);
      if (!s) throw AppException.notFound('Leave request');
      if (!(await this.canDecide(tx, principal, s, r))) {
        if (!can(principal, P.LEAVE_REQUEST_READ, s.attributes) && !isSelfSubject(principal, s))
          throw AppException.notFound('Leave request');
        throw AppException.forbidden('You cannot decide this request');
      }
      if (r.status !== 'PENDING')
        throw AppException.conflict('This request has already been decided');
      const outcome = await this.engine.decide(
        tx,
        principal,
        'LEAVE_REQUEST',
        id,
        input.decision,
        input.note ?? null,
      );
      if (outcome === 'PENDING') {
        await this.audit.record(tx, {
          action: 'leave.step_approved',
          entityType: 'leave_request',
          entityId: id,
          metadata: { employeeId: s.id, note: input.note ?? null },
        });
        return this.toItem(tx, principal, r);
      }
      const decision = outcome ?? input.decision;
      const settings = await timeSettings(tx, principal.organizationId ?? '');
      const year = leaveYearOf(isoDate(r.startDate), settings.leaveYearStartMonth);
      const type = await tx.leaveType.findFirst({ where: { id: r.leaveType.id } });
      if (!type) throw AppException.notFound('Leave type');
      if (decision === 'APPROVED' && type.tracksBalance) {
        await ensureLedger(
          tx,
          principal.organizationId ?? '',
          s,
          type,
          year,
          settings.leaveYearStartMonth,
        );
        const b = await balanceOf(tx, s.id, type, year, settings.leaveYearStartMonth);
        // `available` already excludes this pending request; the balance must still cover it.
        if (!type.allowNegativeBalance && new Decimal(b.balance).lt(r.days))
          throw AppException.conflict(
            `Insufficient balance: ${b.balance} day(s) left, ${r.days.toFixed(2)} requested`,
          );
      }
      const row = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: decision,
          decidedByUserId: principal.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
        select: requestSelect,
      });
      if (decision === 'APPROVED' && type.tracksBalance) {
        await tx.leaveLedgerEntry.create({
          data: {
            organizationId: principal.organizationId ?? '',
            employeeId: s.id,
            leaveTypeId: type.id,
            year,
            entryType: 'USAGE',
            days: r.days.neg().toFixed(2),
            effectiveDate: r.startDate,
            leaveRequestId: id,
            createdByUserId: principal.userId,
          },
        });
      }
      await this.audit.record(tx, {
        action: decision === 'APPROVED' ? 'leave.approved' : 'leave.rejected',
        entityType: 'leave_request',
        entityId: id,
        metadata: { employeeId: s.id, days: r.days.toFixed(2), note: input.note ?? null },
      });
      return this.toItem(tx, principal, row);
    });
  }

  /**
   * Cancels a request. Employees cancel their own pending requests, or approved ones that have
   * not started; approvers may cancel approved leave (e.g. recalled). Approved usage is reversed.
   */
  cancel(principal: AuthPrincipal, id: string): Promise<LeaveRequestItem> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.leaveRequest.findFirst({ where: { id }, select: requestSelect });
      if (!r) throw AppException.notFound('Leave request');
      const s = await subjectOf(tx, r.employeeId);
      if (!s) throw AppException.notFound('Leave request');
      const self = isSelfSubject(principal, s);
      const approver =
        (await this.canDecide(tx, principal, s, r)) ||
        can(principal, P.LEAVE_REQUEST_APPROVE, s.attributes);
      if (!self && !approver) {
        if (!can(principal, P.LEAVE_REQUEST_READ, s.attributes))
          throw AppException.notFound('Leave request');
        throw AppException.forbidden();
      }
      if (r.status !== 'PENDING' && r.status !== 'APPROVED')
        throw AppException.conflict('This request can no longer be cancelled');
      if (self && !approver && r.status === 'APPROVED' && isoDate(r.startDate) <= todayIso())
        throw AppException.conflict('Leave that has started can only be cancelled by an approver');
      if (r.status === 'PENDING') await this.engine.cancel(tx, 'LEAVE_REQUEST', id);
      const row = await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED' },
        select: requestSelect,
      });
      if (r.status === 'APPROVED') {
        const usage = await tx.leaveLedgerEntry.findFirst({
          where: { leaveRequestId: id, entryType: 'USAGE' },
          select: { year: true, days: true, leaveTypeId: true },
        });
        if (usage) {
          await tx.leaveLedgerEntry.create({
            data: {
              organizationId: principal.organizationId ?? '',
              employeeId: s.id,
              leaveTypeId: usage.leaveTypeId,
              year: usage.year,
              entryType: 'REVERSAL',
              days: usage.days.neg().toFixed(2),
              effectiveDate: r.startDate,
              leaveRequestId: id,
              createdByUserId: principal.userId,
            },
          });
        }
      }
      await this.audit.record(tx, {
        action: 'leave.cancelled',
        entityType: 'leave_request',
        entityId: id,
        metadata: {
          employeeId: s.id,
          wasApproved: r.status === 'APPROVED',
          by: self ? 'self' : 'approver',
        },
      });
      return this.toItem(tx, principal, row);
    });
  }

  // ------------------------------------------------------------------ internals

  /** The employee acted on: yourself, or someone visible through `leave.request.read` (ABAC). */
  private async subject(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    employeeId: string,
  ): Promise<Subject> {
    const id = employeeId === 'self' ? await selfEmployeeId(tx, principal) : employeeId;
    return loadSubject(tx, principal, id, employeeId === 'self' ? null : P.LEAVE_REQUEST_READ);
  }

  private async canDecide(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    s: Subject,
    r: { id: string; approverEmployeeId: string | null },
  ): Promise<boolean> {
    if (isSelfSubject(principal, s)) return false;
    const wf = await this.engine.canDecide(tx, principal, 'LEAVE_REQUEST', r.id);
    if (wf !== null) return wf;
    if (can(principal, P.LEAVE_REQUEST_APPROVE, s.attributes)) return true;
    if (!principal.membershipId) return false;
    const me = await tx.employee.findFirst({
      where: { membershipId: principal.membershipId },
      select: { id: true },
    });
    return !!me && (r.approverEmployeeId === me.id || s.managerId === me.id);
  }

  private async evaluate(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    s: Subject,
    input: RequestInput,
    self: boolean,
  ): Promise<{
    type: LeaveTypeRow;
    days: Decimal;
    breakdown: LeavePreview['breakdown'];
    balance: LeaveBalanceItem | null;
    problems: Problem[];
  }> {
    const problems: Problem[] = [];
    const type = await tx.leaveType.findFirst({ where: { id: input.leaveTypeId } });
    if (!type || type.status !== 'ACTIVE')
      throw AppException.badRequest('Leave type not found', 'leaveTypeId');
    if (s.status === 'SEPARATED')
      throw AppException.badRequest('The employee has left', 'startDate');
    const na = applies(type, s);
    if (na) problems.push({ message: na, path: 'leaveTypeId' });
    for (const message of validateLeaveSessions(
      input.startDate,
      input.endDate,
      input.startSession,
      input.endSession,
      type.allowHalfDay,
    ))
      problems.push({ message, path: 'startSession' });
    if (input.startDate < s.dateOfJoining)
      problems.push({ message: 'Leave cannot start before the joining date', path: 'startDate' });
    if (s.lastWorkingDate && input.endDate > s.lastWorkingDate)
      problems.push({ message: 'Leave cannot end after the last working day', path: 'endDate' });
    const settings = await timeSettings(tx, principal.organizationId ?? '');
    const year = leaveYearOf(input.startDate, settings.leaveYearStartMonth);
    if (leaveYearOf(input.endDate, settings.leaveYearStartMonth) !== year)
      problems.push({
        message: 'A leave cannot span two leave years; split it into two requests',
        path: 'endDate',
      });
    if (self && type.minNoticeDays > 0 && input.startDate < addDays(todayIso(), type.minNoticeDays))
      problems.push({
        message: `Apply at least ${String(type.minNoticeDays)} day(s) in advance`,
        path: 'startDate',
      });

    const { days: calendar, configured } = await employeeCalendar(
      tx,
      s.id,
      input.startDate,
      input.endDate,
    );
    if (!configured)
      problems.push({
        message: 'No work week is configured for this employee; leave days cannot be counted',
        path: 'startDate',
      });
    const counted = countLeaveDays(
      [...calendar.values()],
      input.startSession,
      input.endSession,
      type,
    );
    const days = new Decimal(counted.total);
    if (days.lte(0))
      problems.push({ message: 'The selected dates are all non-working days', path: 'startDate' });
    if (type.maxConsecutiveDays && days.gt(type.maxConsecutiveDays))
      problems.push({
        message: `At most ${type.maxConsecutiveDays.toFixed(2)} day(s) at a time`,
        path: 'endDate',
      });

    const overlap = await this.overlap(tx, s.id, input);
    if (overlap)
      problems.push({ message: `Overlaps an existing ${overlap} request`, path: 'startDate' });

    let balance: LeaveBalanceItem | null = null;
    if (type.tracksBalance) {
      await ensureLedger(
        tx,
        principal.organizationId ?? '',
        s,
        type,
        year,
        settings.leaveYearStartMonth,
      );
      balance = await balanceOf(tx, s.id, type, year, settings.leaveYearStartMonth);
      if (new Decimal(balance.available).lt(days))
        problems.push({
          message: `Insufficient balance: ${balance.available} day(s) available, ${days.toFixed(2)} requested`,
          path: 'leaveTypeId',
          balance: true,
        });
    }
    return {
      type,
      days,
      breakdown: counted.days.map((d) => ({
        date: d.date,
        days: d.days,
        kind: calendar.get(d.date)?.kind ?? 'WORKING',
      })),
      balance,
      problems,
    };
  }

  /** Half-day aware overlap with pending/approved requests; returns the clashing status. */
  private async overlap(
    tx: TenantTransaction,
    employeeId: string,
    input: RequestInput,
  ): Promise<string | null> {
    const existing = await tx.leaveRequest.findMany({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: toDate(input.endDate) },
        endDate: { gte: toDate(input.startDate) },
      },
      select: {
        startDate: true,
        endDate: true,
        startSession: true,
        endSession: true,
        status: true,
      },
    });
    const halves = (from: string, to: string, ss: string, es: string) => {
      const set = new Set<string>();
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const am = !(d === from && ss === 'SECOND_HALF') && !(from === to && ss === 'SECOND_HALF');
        const pm = !(d === to && es === 'FIRST_HALF') && !(from === to && ss === 'FIRST_HALF');
        if (am) set.add(`${d}:AM`);
        if (pm) set.add(`${d}:PM`);
      }
      return set;
    };
    const wanted = halves(input.startDate, input.endDate, input.startSession, input.endSession);
    for (const e of existing) {
      const taken = halves(isoDate(e.startDate), isoDate(e.endDate), e.startSession, e.endSession);
      for (const h of wanted) if (taken.has(h)) return e.status.toLowerCase();
    }
    return null;
  }

  private async toItem(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    r: RequestRow,
  ): Promise<LeaveRequestItem> {
    const decider = r.decidedByUserId
      ? await tx.membership.findFirst({
          where: { userId: r.decidedByUserId },
          select: { user: { select: { fullName: true } } },
        })
      : null;
    const s = r.status === 'PENDING' ? await subjectOf(tx, r.employeeId) : null;
    return {
      id: r.id,
      employee: toEmployeeRef(r.employee) as LeaveRequestItem['employee'],
      leaveType: r.leaveType,
      startDate: isoDate(r.startDate),
      endDate: isoDate(r.endDate),
      startSession: r.startSession,
      endSession: r.endSession,
      days: r.days.toFixed(2),
      reason: r.reason,
      status: r.status,
      approver: toEmployeeRef(r.approver),
      decidedBy: decider?.user.fullName ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      canDecide: s ? await this.canDecide(tx, principal, s, r) : false,
    };
  }
}
