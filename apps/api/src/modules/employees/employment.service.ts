import { Injectable } from '@nestjs/common';
import { type EmployeeDetails, type EmploymentRecordItem, PERMISSIONS } from '@hrm/shared-types';
import type {
  confirmEmployeeSchema,
  extendProbationSchema,
  jobChangeSchema,
  rejoinSchema,
  separationSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { isOwner } from '../members/member-rules.js';
import { recordSelect, toRecordItem } from './employee-mapper.js';
import { placementAttributes, placementData, validatePlacement } from './employee-placement.js';
import { addDays, isoDate, toDate, todayIso } from './employee-scope.js';
import { authorize, EmployeesService, loadTarget } from './employees.service.js';

const P = PERMISSIONS;
type JobChange = z.output<typeof jobChangeSchema>;
type Separation = z.output<typeof separationSchema>;
type Rejoin = z.output<typeof rejoinSchema>;

/**
 * Employee lifecycle. Job history is append-only: every change closes the open record the day
 * before the new one starts (database exclusion constraint guarantees no overlaps).
 */
@Injectable()
export class EmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
    private readonly access: AccessService,
  ) {}

  history(principal: AuthPrincipal, id: string): Promise<EmploymentRecordItem[]> {
    return this.prisma.withTenant(async (tx) => {
      await loadTarget(tx, principal, id);
      const rows = await tx.employmentRecord.findMany({
        where: { employeeId: id },
        orderBy: { effectiveFrom: 'desc' },
        select: recordSelect,
      });
      return rows.map(toRecordItem);
    });
  }

  jobChange(principal: AuthPrincipal, id: string, input: JobChange): Promise<EmployeeDetails> {
    const today = todayIso();
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, id);
      authorize(principal, P.EMPLOYEES_LIFECYCLE_MANAGE, target);
      if (!can(principal, P.EMPLOYEES_LIFECYCLE_MANAGE, placementAttributes(input)))
        throw AppException.forbidden(
          'You cannot move employees into this part of the organization',
        );
      if (target.status === 'SEPARATED')
        throw AppException.conflict('This employee has left; record a rejoining instead');
      const employee = await facts(tx, id);
      const open = await openRecord(tx, id);
      if (!open) throw AppException.conflict('The employee has no open employment record');
      if (isoDate(open.effectiveFrom) > today)
        throw AppException.conflict(
          'A future change is already scheduled; it must take effect first',
        );
      if (input.effectiveFrom <= isoDate(open.effectiveFrom))
        throw AppException.badRequest(
          `The change must start after ${isoDate(open.effectiveFrom)} (start of the current assignment)`,
          'effectiveFrom',
        );
      if (employee.lastWorkingDate && input.effectiveFrom > isoDate(employee.lastWorkingDate))
        throw AppException.badRequest(
          'The change cannot start after the last working day',
          'effectiveFrom',
        );
      await validatePlacement(tx, input, id, today);

      await tx.employmentRecord.update({
        where: { id: open.id },
        data: { effectiveTo: toDate(addDays(input.effectiveFrom, -1)) },
      });
      const created = await tx.employmentRecord.create({
        data: {
          organizationId: principal.organizationId ?? '',
          employeeId: id,
          effectiveFrom: toDate(input.effectiveFrom),
          changeType: input.changeType,
          remarks: input.remarks ?? null,
          createdByUserId: principal.userId,
          ...placementData(input),
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'employee.job_changed',
        entityType: 'employee',
        entityId: id,
        metadata: {
          changeType: input.changeType,
          effectiveFrom: input.effectiveFrom,
          recordId: created.id,
        },
      });
      return this.employees.details(tx, principal, await loadTarget(tx, principal, id));
    });
  }

  confirm(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof confirmEmployeeSchema>,
  ): Promise<EmployeeDetails> {
    return this.lifecycle(principal, id, async (tx, e) => {
      if (e.status === 'SEPARATED') throw AppException.conflict('This employee has left');
      if (e.probationStatus !== 'ON_PROBATION')
        throw AppException.conflict('Only employees on probation can be confirmed');
      if (input.confirmationDate < isoDate(e.dateOfJoining))
        throw AppException.badRequest(
          'Confirmation cannot be before the joining date',
          'confirmationDate',
        );
      await tx.employee.update({
        where: { id },
        data: { probationStatus: 'CONFIRMED', confirmationDate: toDate(input.confirmationDate) },
      });
      return {
        action: 'employee.confirmed',
        metadata: { confirmationDate: input.confirmationDate },
      };
    });
  }

  extendProbation(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof extendProbationSchema>,
  ): Promise<EmployeeDetails> {
    return this.lifecycle(principal, id, async (tx, e) => {
      if (e.probationStatus !== 'ON_PROBATION' || !e.probationEndDate)
        throw AppException.conflict('Only employees on probation can have it extended');
      if (input.probationEndDate <= isoDate(e.probationEndDate))
        throw AppException.badRequest(
          `The new end date must be after ${isoDate(e.probationEndDate)}`,
          'probationEndDate',
        );
      await tx.employee.update({
        where: { id },
        data: { probationEndDate: toDate(input.probationEndDate) },
      });
      return {
        action: 'employee.probation_extended',
        metadata: { from: isoDate(e.probationEndDate), to: input.probationEndDate },
      };
    });
  }

  /** Records a resignation/termination: the employee serves notice until the last working day. */
  startSeparation(
    principal: AuthPrincipal,
    id: string,
    input: Separation,
  ): Promise<EmployeeDetails> {
    return this.lifecycle(principal, id, async (tx, e) => {
      if (e.status !== 'ACTIVE') throw AppException.conflict('A separation is already recorded');
      if (input.resignationDate < isoDate(e.dateOfJoining))
        throw AppException.badRequest(
          'The notice date cannot be before the joining date',
          'resignationDate',
        );
      const open = await openRecord(tx, id);
      if (open && input.lastWorkingDate < isoDate(open.effectiveFrom))
        throw AppException.badRequest(
          `The last working day cannot be before ${isoDate(open.effectiveFrom)} (start of the current assignment)`,
          'lastWorkingDate',
        );
      await tx.employee.update({
        where: { id },
        data: {
          status: 'ON_NOTICE',
          separationType: input.separationType,
          resignationDate: toDate(input.resignationDate),
          lastWorkingDate: toDate(input.lastWorkingDate),
          separationReason: input.reason ?? null,
        },
      });
      return {
        action: 'employee.separation_started',
        metadata: { separationType: input.separationType, lastWorkingDate: input.lastWorkingDate },
      };
    });
  }

  withdrawSeparation(principal: AuthPrincipal, id: string): Promise<EmployeeDetails> {
    return this.lifecycle(principal, id, async (tx, e) => {
      if (e.status !== 'ON_NOTICE')
        throw AppException.conflict('There is no pending separation to withdraw');
      await tx.employee.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          separationType: null,
          resignationDate: null,
          lastWorkingDate: null,
          separationReason: null,
        },
      });
      return { action: 'employee.separation_withdrawn', metadata: {} };
    });
  }

  /**
   * Completes a separation once the last working day has passed: closes the employment record
   * and suspends the linked login (unless the member is an owner, which needs an owner's action).
   */
  async completeSeparation(principal: AuthPrincipal, id: string): Promise<EmployeeDetails> {
    const state = { suspended: false };
    const result = await this.lifecycle(principal, id, async (tx, e) => {
      if (e.status !== 'ON_NOTICE' || !e.lastWorkingDate)
        throw AppException.conflict('Record the separation first');
      const lwd = isoDate(e.lastWorkingDate);
      if (lwd > todayIso())
        throw AppException.conflict(
          `The separation can be completed after the last working day (${lwd})`,
        );
      const open = await openRecord(tx, id);
      if (open) {
        if (isoDate(open.effectiveFrom) > lwd)
          throw AppException.conflict('A job change starts after the last working day');
        await tx.employmentRecord.update({
          where: { id: open.id },
          data: { effectiveTo: e.lastWorkingDate },
        });
      }
      await tx.employee.update({ where: { id }, data: { status: 'SEPARATED' } });
      if (e.membershipId && !(await isOwner(tx, e.membershipId))) {
        await tx.membership.update({
          where: { id: e.membershipId },
          data: { status: 'SUSPENDED' },
        });
        state.suspended = true;
      }
      return {
        action: 'employee.separated',
        metadata: { lastWorkingDate: lwd, accessSuspended: state.suspended },
      };
    });
    if (state.suspended) await this.access.invalidateOrganization(principal.organizationId ?? '');
    return result;
  }

  /** A former employee joins again: new joining date and placement; previous history is kept. */
  rejoin(principal: AuthPrincipal, id: string, input: Rejoin): Promise<EmployeeDetails> {
    const today = todayIso();
    if (!can(principal, P.EMPLOYEES_LIFECYCLE_MANAGE, placementAttributes(input)))
      throw AppException.forbidden('You cannot place employees in this part of the organization');
    return this.lifecycle(principal, id, async (tx, e) => {
      if (e.status !== 'SEPARATED' || !e.lastWorkingDate)
        throw AppException.conflict('Only employees who have left can rejoin');
      if (input.dateOfJoining <= isoDate(e.lastWorkingDate))
        throw AppException.badRequest(
          'Rejoining must be after the last working day',
          'dateOfJoining',
        );
      if (input.probationEndDate && input.probationEndDate <= input.dateOfJoining)
        throw AppException.badRequest(
          'Probation must end after the joining date',
          'probationEndDate',
        );
      await validatePlacement(tx, input, id, today);
      await tx.employee.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          dateOfJoining: toDate(input.dateOfJoining),
          probationStatus: input.probationEndDate ? 'ON_PROBATION' : 'NOT_APPLICABLE',
          probationEndDate: input.probationEndDate ? toDate(input.probationEndDate) : null,
          confirmationDate: null,
          separationType: null,
          resignationDate: null,
          lastWorkingDate: null,
          separationReason: null,
        },
      });
      await tx.employmentRecord.create({
        data: {
          organizationId: principal.organizationId ?? '',
          employeeId: id,
          effectiveFrom: toDate(input.dateOfJoining),
          changeType: 'REJOINING',
          remarks: input.remarks ?? null,
          createdByUserId: principal.userId,
          ...placementData(input),
        },
      });
      return { action: 'employee.rejoined', metadata: { dateOfJoining: input.dateOfJoining } };
    });
  }

  private lifecycle(
    principal: AuthPrincipal,
    id: string,
    apply: (
      tx: TenantTransaction,
      e: Awaited<ReturnType<typeof facts>>,
    ) => Promise<{ action: string; metadata: Record<string, unknown> }>,
  ): Promise<EmployeeDetails> {
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, id);
      authorize(principal, P.EMPLOYEES_LIFECYCLE_MANAGE, target);
      const { action, metadata } = await apply(tx, await facts(tx, id));
      await this.audit.record(tx, { action, entityType: 'employee', entityId: id, metadata });
      return this.employees.details(tx, principal, await loadTarget(tx, principal, id));
    });
  }
}

async function facts(tx: TenantTransaction, id: string) {
  const e = await tx.employee.findFirst({
    where: { id },
    select: {
      status: true,
      dateOfJoining: true,
      probationStatus: true,
      probationEndDate: true,
      lastWorkingDate: true,
      membershipId: true,
    },
  });
  if (!e) throw AppException.notFound('Employee');
  return e;
}

function openRecord(tx: TenantTransaction, employeeId: string) {
  return tx.employmentRecord.findFirst({
    where: { employeeId, effectiveTo: null },
    select: { id: true, effectiveFrom: true },
  });
}
