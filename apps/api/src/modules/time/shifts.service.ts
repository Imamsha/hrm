import { Injectable } from '@nestjs/common';
import {
  type PaginatedResult,
  PERMISSIONS,
  type RosterEntryItem,
  type ShiftAssignmentItem,
  type ShiftItem,
} from '@hrm/shared-types';
import {
  type createShiftSchema,
  minutesOf,
  type rosterEntriesSchema,
  type rosterQuerySchema,
  type shiftAssignmentQuerySchema,
  type shiftAssignmentSchema,
  shiftRuleOf,
  timeOf,
  type updateShiftSchema,
} from '@hrm/validation';
import { validateShift } from '@hrm/business-rules';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import { employeeRefSelect, toEmployeeRef } from '../employees/employee-mapper.js';
import {
  addDays,
  employeeScopeWhere,
  isoDate,
  toDate,
  todayIso,
} from '../employees/employee-scope.js';
import { definedOnly, mapWriteError } from '../structure/structure.util.js';
import { subjectOf } from './time-context.js';

const P = PERMISSIONS;
type ShiftRow = Prisma.ShiftGetPayload<{ include: { _count: { select: { assignments: true } } } }>;

function toShift(s: ShiftRow): ShiftItem {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    startTime: timeOf(s.startMinutes),
    endTime: timeOf(s.endMinutes),
    crossesMidnight: s.endMinutes <= s.startMinutes,
    breakMinutes: s.breakMinutes,
    graceInMinutes: s.graceInMinutes,
    graceOutMinutes: s.graceOutMinutes,
    fullDayMinutes: s.fullDayMinutes,
    halfDayMinutes: s.halfDayMinutes,
    overtimeAfterMinutes: s.overtimeAfterMinutes,
    windowBeforeMinutes: s.windowBeforeMinutes,
    windowAfterMinutes: s.windowAfterMinutes,
    isDefault: s.isDefault,
    status: s.status,
    assignmentCount: s._count.assignments,
  };
}

const shiftRef = { select: { id: true, code: true, name: true } } as const;

function shiftData(input: Partial<z.output<typeof createShiftSchema>>) {
  const { startTime, endTime, ...rest } = input;
  return {
    ...definedOnly(rest),
    ...(startTime !== undefined ? { startMinutes: minutesOf(startTime) } : {}),
    ...(endTime !== undefined ? { endMinutes: minutesOf(endTime) } : {}),
  };
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<ShiftItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.shift.findMany({
          orderBy: [{ status: 'asc' }, { startMinutes: 'asc' }, { code: 'asc' }],
          include: { _count: { select: { assignments: true } } },
        })
      ).map(toShift),
    );
  }

  create(principal: AuthPrincipal, input: z.output<typeof createShiftSchema>): Promise<ShiftItem> {
    return this.prisma.withTenant(async (tx) => {
      if (input.isDefault)
        await tx.shift.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const row = await tx.shift
        .create({
          data: {
            organizationId: principal.organizationId ?? '',
            ...shiftData(input),
          } as Prisma.ShiftUncheckedCreateInput,
          include: { _count: { select: { assignments: true } } },
        })
        .catch((err: unknown) => mapWriteError(err, { entity: 'shift', uniqueField: 'code' }));
      await this.audit.record(tx, {
        action: 'shift.created',
        entityType: 'shift',
        entityId: row.id,
        metadata: { code: row.code },
      });
      return toShift(row);
    });
  }

  update(id: string, input: z.output<typeof updateShiftSchema>): Promise<ShiftItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.shift.findFirst({
        where: { id },
        include: { _count: { select: { assignments: true } } },
      });
      if (!before) throw AppException.notFound('Shift');
      // Validate the merged configuration (times and thresholds depend on each other).
      const merged = {
        ...toShift(before),
        ...definedOnly(input),
      };
      const problems = validateShift(
        shiftRuleOf({
          ...merged,
          overtimeAfterMinutes: merged.overtimeAfterMinutes ?? null,
          isDefault: merged.isDefault,
        }),
      );
      if (problems[0]) throw AppException.badRequest(problems[0], 'fullDayMinutes');
      if (input.isDefault === true)
        await tx.shift.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      const data = shiftData(input);
      const row = await tx.shift
        .update({ where: { id }, data, include: { _count: { select: { assignments: true } } } })
        .catch((err: unknown) => mapWriteError(err, { entity: 'shift', uniqueField: 'code' }));
      const changes = diffChanges(before, data);
      if (Object.keys(changes).length > 0)
        await this.audit.record(tx, {
          action: 'shift.updated',
          entityType: 'shift',
          entityId: id,
          changes,
        });
      return toShift(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.shift.findFirst({ where: { id }, select: { code: true } });
      if (!before) throw AppException.notFound('Shift');
      await tx.shift
        .delete({ where: { id } })
        .catch((err: unknown) => mapWriteError(err, { entity: 'shift', deleting: true }));
      await this.audit.record(tx, {
        action: 'shift.deleted',
        entityType: 'shift',
        entityId: id,
        metadata: before,
      });
    });
  }

  // ------------------------------------------------------------------ assignments

  listAssignments(
    principal: AuthPrincipal,
    q: z.output<typeof shiftAssignmentQuerySchema>,
  ): Promise<PaginatedResult<ShiftAssignmentItem>> {
    const scope = employeeScopeWhere(principal, P.SHIFTS_SHIFT_READ, todayIso());
    if (!scope) return Promise.resolve(paginate([], 0, q));
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.ShiftAssignmentWhereInput = {
        employee: scope,
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.shiftId ? { shiftId: q.shiftId } : {}),
        ...(q.on
          ? {
              effectiveFrom: { lte: toDate(q.on) },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(q.on) } }],
            }
          : {}),
        ...(q.search
          ? {
              employee: {
                AND: [
                  scope,
                  {
                    OR: [
                      { firstName: { contains: q.search, mode: 'insensitive' } },
                      { lastName: { contains: q.search, mode: 'insensitive' } },
                      { employeeNumber: { contains: q.search, mode: 'insensitive' } },
                    ],
                  },
                ],
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.shiftAssignment.findMany({
          where,
          orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            effectiveFrom: true,
            effectiveTo: true,
            employee: { select: employeeRefSelect },
            shift: shiftRef,
          },
          ...skipTake(q),
        }),
        tx.shiftAssignment.count({ where }),
      ]);
      return paginate(
        rows.map((r) => ({
          id: r.id,
          employee: toEmployeeRef(r.employee) as ShiftAssignmentItem['employee'],
          shift: r.shift,
          effectiveFrom: isoDate(r.effectiveFrom),
          effectiveTo: r.effectiveTo ? isoDate(r.effectiveTo) : null,
        })),
        total,
        q,
      );
    });
  }

  /**
   * Assigns a shift from a date to several employees. Each employee's open assignment ends the
   * day before; assignments that start on or after the new start must be removed first.
   */
  assign(
    principal: AuthPrincipal,
    input: z.output<typeof shiftAssignmentSchema>,
  ): Promise<{ assigned: number }> {
    return this.prisma.withTenant(async (tx) => {
      const shift = await tx.shift.findFirst({
        where: { id: input.shiftId },
        select: { status: true, code: true },
      });
      if (!shift) throw AppException.badRequest('Shift not found', 'shiftId');
      if (shift.status !== 'ACTIVE')
        throw AppException.badRequest('The shift is inactive', 'shiftId');
      for (const employeeId of [...new Set(input.employeeIds)]) {
        await this.authorizeEmployee(tx, principal, employeeId);
        const later = await tx.shiftAssignment.findFirst({
          where: { employeeId, effectiveFrom: { gte: toDate(input.effectiveFrom) } },
          select: { effectiveFrom: true },
        });
        if (later)
          throw AppException.conflictOn(
            `An assignment already starts on ${isoDate(later.effectiveFrom)}; remove it first`,
            'effectiveFrom',
          );
        await tx.shiftAssignment.updateMany({
          where: {
            employeeId,
            effectiveFrom: { lt: toDate(input.effectiveFrom) },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(input.effectiveFrom) } }],
          },
          data: { effectiveTo: toDate(addDays(input.effectiveFrom, -1)) },
        });
        await tx.shiftAssignment.create({
          data: {
            organizationId: principal.organizationId ?? '',
            employeeId,
            shiftId: input.shiftId,
            effectiveFrom: toDate(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'shift.assigned',
        entityType: 'shift',
        entityId: input.shiftId,
        metadata: {
          employees: input.employeeIds.length,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo,
        },
      });
      return { assigned: new Set(input.employeeIds).size };
    });
  }

  removeAssignment(principal: AuthPrincipal, id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const a = await tx.shiftAssignment.findFirst({
        where: { id },
        select: { employeeId: true, shiftId: true },
      });
      if (!a) throw AppException.notFound('Shift assignment');
      await this.authorizeEmployee(tx, principal, a.employeeId);
      await tx.shiftAssignment.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'shift.unassigned',
        entityType: 'shift_assignment',
        entityId: id,
        metadata: a,
      });
    });
  }

  // ------------------------------------------------------------------ roster

  roster(
    principal: AuthPrincipal,
    q: z.output<typeof rosterQuerySchema>,
  ): Promise<RosterEntryItem[]> {
    const scope = employeeScopeWhere(principal, P.SHIFTS_SHIFT_READ, todayIso());
    if (!scope) return Promise.resolve([]);
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.rosterEntry.findMany({
        where: {
          date: { gte: toDate(q.from), lte: toDate(q.to) },
          employee: scope,
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        },
        orderBy: [{ date: 'asc' }],
        select: {
          id: true,
          date: true,
          note: true,
          employee: { select: employeeRefSelect },
          shift: shiftRef,
        },
        take: 5000,
      });
      return rows.map((r) => ({
        id: r.id,
        employee: toEmployeeRef(r.employee) as RosterEntryItem['employee'],
        date: isoDate(r.date),
        shift: r.shift,
        note: r.note,
      }));
    });
  }

  setRoster(
    principal: AuthPrincipal,
    input: z.output<typeof rosterEntriesSchema>,
  ): Promise<{ saved: number }> {
    return this.prisma.withTenant(async (tx) => {
      const checked = new Set<string>();
      for (const e of input.entries) {
        if (!checked.has(e.employeeId)) {
          await this.authorizeEmployee(tx, principal, e.employeeId);
          checked.add(e.employeeId);
        }
        if (e.shiftId) {
          const s = await tx.shift.findFirst({
            where: { id: e.shiftId },
            select: { status: true },
          });
          if (!s || s.status !== 'ACTIVE')
            throw AppException.badRequest('Shift not found or inactive', 'shiftId');
        }
        await tx.rosterEntry.upsert({
          where: { employeeId_date: { employeeId: e.employeeId, date: toDate(e.date) } },
          create: {
            organizationId: principal.organizationId ?? '',
            employeeId: e.employeeId,
            date: toDate(e.date),
            shiftId: e.shiftId,
            note: e.note ?? null,
          },
          update: { shiftId: e.shiftId, note: e.note ?? null },
        });
      }
      await this.audit.record(tx, {
        action: 'roster.updated',
        entityType: 'roster',
        metadata: { entries: input.entries.length, employees: checked.size },
      });
      return { saved: input.entries.length };
    });
  }

  removeRosterEntry(principal: AuthPrincipal, id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.rosterEntry.findFirst({
        where: { id },
        select: { employeeId: true, date: true },
      });
      if (!r) throw AppException.notFound('Roster entry');
      await this.authorizeEmployee(tx, principal, r.employeeId);
      await tx.rosterEntry.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'roster.entry_removed',
        entityType: 'roster',
        entityId: id,
        metadata: { employeeId: r.employeeId, date: isoDate(r.date) },
      });
    });
  }

  private async authorizeEmployee(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    employeeId: string,
  ) {
    const s = await subjectOf(tx, employeeId);
    if (!s || !can(principal, P.SHIFTS_SHIFT_READ, s.attributes))
      throw AppException.badRequest('Employee not found', 'employeeIds');
    if (!can(principal, P.SHIFTS_SHIFT_MANAGE, s.attributes)) throw AppException.forbidden();
    return s;
  }
}
