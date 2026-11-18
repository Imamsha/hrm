import { Injectable } from '@nestjs/common';
import {
  type EmployeeDetails,
  type EmployeeListItem,
  type EmployeeSettingsItem,
  type PaginatedResult,
  PERMISSIONS,
  type Permission,
} from '@hrm/shared-types';
import {
  type createEmployeeSchema,
  type EmployeeListQuery,
  type employeeSettingsSchema,
  formatEmployeeNumber,
  type updateEmployeeSchema,
  type updateSelfSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, resolveSort, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import { mapWriteError } from '../structure/structure.util.js';
import {
  type EmployeeDetailRow,
  employeeDetailSelect,
  employeeListSelect,
  recordSelect,
  toDetails,
  toListItem,
} from './employee-mapper.js';
import { placementAttributes, placementData, validatePlacement } from './employee-placement.js';
import {
  currentRecord,
  employeeAttributes,
  employeeScopeWhere,
  inForceWhere,
  toDate,
  todayIso,
} from './employee-scope.js';

const P = PERMISSIONS;
type CreateInput = z.output<typeof createEmployeeSchema>;
type UpdateInput = z.output<typeof updateEmployeeSchema>;
type SettingsInput = z.output<typeof employeeSettingsSchema>;

/** Personal fields: audit records that they changed, never their values. */
const PERSONAL_FIELDS = new Set([
  'dateOfBirth',
  'gender',
  'maritalStatus',
  'nationality',
  'personalEmail',
  'personalPhone',
]);

export interface AccessTarget {
  id: string;
  status: 'ACTIVE' | 'ON_NOTICE' | 'SEPARATED';
  ownerUserId: string | null;
  attributes: ReturnType<typeof employeeAttributes>;
}

/**
 * Loads the minimal facts needed to authorize an action on an employee. Returns 404 when the
 * caller may not even see the employee (`employees.employee.read` in scope, or themselves).
 */
export async function loadTarget(
  tx: TenantTransaction,
  principal: AuthPrincipal,
  employeeId: string,
): Promise<AccessTarget> {
  const today = todayIso();
  const e = await tx.employee.findFirst({
    where: { id: employeeId },
    select: {
      id: true,
      status: true,
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
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 3,
      },
    },
  });
  if (!e) throw AppException.notFound('Employee');
  const target: AccessTarget = {
    id: e.id,
    status: e.status,
    ownerUserId: e.membership?.userId ?? null,
    attributes: employeeAttributes(currentRecord(e.employmentRecords, today), e.membership?.userId),
  };
  if (!can(principal, P.EMPLOYEES_EMPLOYEE_READ, target.attributes) && !isSelf(principal, target))
    throw AppException.notFound('Employee');
  return target;
}

export function isSelf(principal: AuthPrincipal, target: { ownerUserId: string | null }): boolean {
  return target.ownerUserId !== null && target.ownerUserId === principal.userId;
}

/** 403 unless `permission` covers the employee (the employee is already known to be visible). */
export function authorize(
  principal: AuthPrincipal,
  permission: Permission,
  target: AccessTarget,
): void {
  if (!can(principal, permission, target.attributes)) throw AppException.forbidden();
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(
    principal: AuthPrincipal,
    query: EmployeeListQuery,
  ): Promise<PaginatedResult<EmployeeListItem>> {
    const today = todayIso();
    const scope = employeeScopeWhere(principal, P.EMPLOYEES_EMPLOYEE_READ, today);
    if (!scope) return Promise.resolve(paginate([], 0, query));
    return this.prisma.withTenant(async (tx) => {
      const placement: Prisma.EmploymentRecordWhereInput = {
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.teamId ? { teamId: query.teamId } : {}),
        ...(query.designationId ? { designationId: query.designationId } : {}),
        ...(query.managerId ? { managerId: query.managerId } : {}),
        ...(query.employmentType ? { employmentType: query.employmentType } : {}),
        ...(query.departmentId
          ? { departmentId: { in: await departmentSubtree(tx, query.departmentId) } }
          : {}),
      };
      const where: Prisma.EmployeeWhereInput = {
        AND: [
          scope,
          query.status ? { status: query.status } : {},
          Object.keys(placement).length > 0
            ? { employmentRecords: { some: { AND: [inForceWhere(today), placement] } } }
            : {},
          query.search
            ? {
                OR: [
                  { firstName: { contains: query.search, mode: 'insensitive' } },
                  { lastName: { contains: query.search, mode: 'insensitive' } },
                  { preferredName: { contains: query.search, mode: 'insensitive' } },
                  { employeeNumber: { contains: query.search, mode: 'insensitive' } },
                  { workEmail: { contains: query.search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      };
      const orderBy = resolveSort<
        'name' | 'employeeNumber' | 'dateOfJoining' | 'status',
        Prisma.EmployeeOrderByWithRelationInput[]
      >(
        query.sortBy,
        {
          name: (d) => [{ firstName: d }, { lastName: d }],
          employeeNumber: (d) => [{ employeeNumber: d }],
          dateOfJoining: (d) => [{ dateOfJoining: d }],
          status: (d) => [{ status: d }],
        },
        query.sortDir,
        'name',
      );
      const [rows, total] = await Promise.all([
        tx.employee.findMany({
          where,
          orderBy: [...orderBy, { id: 'asc' }],
          select: employeeListSelect,
          ...skipTake(query),
        }),
        tx.employee.count({ where }),
      ]);
      return paginate(
        rows.map((r) => toListItem(r, today)),
        total,
        query,
      );
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<EmployeeDetails> {
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, id);
      return this.details(tx, principal, target);
    });
  }

  /** Profile with the caller's affordances. */
  async details(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    target: AccessTarget,
  ): Promise<EmployeeDetails> {
    const row = (await tx.employee.findFirst({
      where: { id: target.id },
      select: employeeDetailSelect,
    })) as EmployeeDetailRow;
    const a = target.attributes;
    return toDetails(row, todayIso(), {
      update: can(principal, P.EMPLOYEES_EMPLOYEE_UPDATE, a),
      lifecycle: can(principal, P.EMPLOYEES_LIFECYCLE_MANAGE, a),
      personal: can(principal, P.EMPLOYEES_PERSONAL_READ, a),
      sensitive: can(principal, P.EMPLOYEES_SENSITIVE_READ, a),
      sensitiveManage: can(principal, P.EMPLOYEES_SENSITIVE_MANAGE, a),
      documents: can(principal, P.EMPLOYEES_DOCUMENT_READ, a),
      documentsManage: can(principal, P.EMPLOYEES_DOCUMENT_MANAGE, a),
      self: isSelf(principal, target),
    });
  }

  /** Joining: the employee and their first employment record, atomically. */
  create(principal: AuthPrincipal, input: CreateInput): Promise<EmployeeDetails> {
    const organizationId = principal.organizationId ?? '';
    if (!can(principal, P.EMPLOYEES_EMPLOYEE_CREATE, placementAttributes(input)))
      throw AppException.forbidden('You cannot add employees to this part of the organization');
    const today = todayIso();
    return this.prisma.withTenant(async (tx) => {
      await validatePlacement(tx, input, null, today);
      if (input.membershipId) await assertLinkableMember(tx, input.membershipId);
      const employeeNumber = input.employeeNumber ?? (await nextEmployeeNumber(tx, organizationId));
      const employee = await tx.employee
        .create({
          data: {
            organizationId,
            employeeNumber,
            membershipId: input.membershipId ?? null,
            firstName: input.firstName,
            middleName: input.middleName ?? null,
            lastName: input.lastName ?? null,
            preferredName: input.preferredName ?? null,
            workEmail: input.workEmail ?? null,
            workPhone: input.workPhone ?? null,
            dateOfJoining: toDate(input.dateOfJoining),
            probationStatus: input.probationEndDate ? 'ON_PROBATION' : 'NOT_APPLICABLE',
            probationEndDate: input.probationEndDate ? toDate(input.probationEndDate) : null,
            noticePeriodDays: input.noticePeriodDays ?? null,
            dateOfBirth: input.dateOfBirth ? toDate(input.dateOfBirth) : null,
            gender: input.gender ?? null,
            maritalStatus: input.maritalStatus ?? null,
            nationality: input.nationality ?? null,
            personalEmail: input.personalEmail ?? null,
            personalPhone: input.personalPhone ?? null,
          },
          select: { id: true },
        })
        .catch((err: unknown) => mapEmployeeWriteError(err));
      await tx.employmentRecord.create({
        data: {
          organizationId,
          employeeId: employee.id,
          effectiveFrom: toDate(input.dateOfJoining),
          changeType: 'JOINING',
          createdByUserId: principal.userId,
          ...placementData(input),
        },
      });
      await this.audit.record(tx, {
        action: 'employee.joined',
        entityType: 'employee',
        entityId: employee.id,
        metadata: {
          employeeNumber,
          dateOfJoining: input.dateOfJoining,
          companyId: input.companyId,
        },
      });
      return this.details(tx, principal, await loadTarget(tx, principal, employee.id));
    });
  }

  update(principal: AuthPrincipal, id: string, input: UpdateInput): Promise<EmployeeDetails> {
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, id);
      authorize(principal, P.EMPLOYEES_EMPLOYEE_UPDATE, target);
      const data = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      ) as Record<string, unknown>;
      const touchesPersonal = Object.keys(data).some((k) => PERSONAL_FIELDS.has(k));
      if (touchesPersonal && !can(principal, P.EMPLOYEES_PERSONAL_READ, target.attributes))
        throw AppException.forbidden('Updating personal details requires access to them');
      const before = await tx.employee.findFirst({ where: { id }, select: employeeDetailSelect });
      if (typeof data.dateOfBirth === 'string') {
        if (before && data.dateOfBirth >= before.dateOfJoining.toISOString().slice(0, 10))
          throw AppException.badRequest(
            'Date of birth must be before the joining date',
            'dateOfBirth',
          );
      }
      const dbData: Prisma.EmployeeUpdateInput = {
        ...data,
        ...('dateOfBirth' in data
          ? { dateOfBirth: data.dateOfBirth ? toDate(data.dateOfBirth as string) : null }
          : {}),
      };
      await tx.employee
        .update({ where: { id }, data: dbData })
        .catch((err: unknown) => mapEmployeeWriteError(err));
      const changes = redactPersonal(diffChanges(serializable(before), data));
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          action: 'employee.updated',
          entityType: 'employee',
          entityId: id,
          changes,
        });
      }
      return this.details(tx, principal, target);
    });
  }

  /** Links (or unlinks) the employee's login account in this organization. */
  linkMember(
    principal: AuthPrincipal,
    id: string,
    membershipId: string | null,
  ): Promise<EmployeeDetails> {
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, id);
      authorize(principal, P.EMPLOYEES_EMPLOYEE_UPDATE, target);
      if (membershipId) await assertLinkableMember(tx, membershipId, id);
      await tx.employee
        .update({ where: { id }, data: { membershipId } })
        .catch((err: unknown) => mapEmployeeWriteError(err));
      await this.audit.record(tx, {
        action: membershipId ? 'employee.account_linked' : 'employee.account_unlinked',
        entityType: 'employee',
        entityId: id,
        metadata: { membershipId },
      });
      return this.details(tx, principal, await loadTarget(tx, principal, id));
    });
  }

  /** Employees whose current placement reports to `id`, limited to what the caller may read. */
  directReports(principal: AuthPrincipal, id: string): Promise<EmployeeListItem[]> {
    const today = todayIso();
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, id);
      const scope = isSelf(principal, target)
        ? {}
        : (employeeScopeWhere(principal, P.EMPLOYEES_EMPLOYEE_READ, today) ?? { id: { in: [] } });
      return reportsOf(tx, id, scope, today);
    });
  }

  /** The caller's own employee id (self-service). */
  selfId(principal: AuthPrincipal): Promise<string> {
    return this.prisma.withTenant(async (tx) => {
      const e = principal.membershipId
        ? await tx.employee.findFirst({
            where: { membershipId: principal.membershipId },
            select: { id: true },
          })
        : null;
      if (!e) throw AppException.notFound('Employee record linked to your account');
      return e.id;
    });
  }

  /** Self-service profile changes (contact details only; everything else goes through HR). */
  updateSelf(
    principal: AuthPrincipal,
    input: z.output<typeof updateSelfSchema>,
  ): Promise<EmployeeDetails> {
    return this.selfId(principal).then((id) =>
      this.prisma.withTenant(async (tx) => {
        const target = await loadTarget(tx, principal, id);
        if (target.status === 'SEPARATED')
          throw AppException.forbidden('Your employment has ended');
        const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        await tx.employee.update({ where: { id }, data });
        await this.audit.record(tx, {
          action: 'employee.self_updated',
          entityType: 'employee',
          entityId: id,
          metadata: { fields: Object.keys(data) },
        });
        return this.details(tx, principal, target);
      }),
    );
  }

  /** Direct reports of the caller (managers see their team without an HR role). */
  myTeam(principal: AuthPrincipal): Promise<EmployeeListItem[]> {
    return this.selfId(principal).then((id) =>
      this.prisma.withTenant((tx) => reportsOf(tx, id, {}, todayIso())),
    );
  }

  getSettings(principal: AuthPrincipal): Promise<EmployeeSettingsItem> {
    return this.prisma.withTenant(async (tx) =>
      toSettings(await ensureSettings(tx, principal.organizationId ?? '')),
    );
  }

  updateSettings(principal: AuthPrincipal, input: SettingsInput): Promise<EmployeeSettingsItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await ensureSettings(tx, principal.organizationId ?? '');
      const row = await tx.employeeSettings.update({
        where: { organizationId: before.organizationId },
        data: input,
      });
      const changes = diffChanges(before, input);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          action: 'employee_settings.updated',
          entityType: 'employee_settings',
          entityId: before.organizationId,
          changes,
        });
      }
      return toSettings(row);
    });
  }
}

export async function reportsOf(
  tx: TenantTransaction,
  managerId: string,
  scope: Prisma.EmployeeWhereInput,
  today: string,
): Promise<EmployeeListItem[]> {
  const rows = await tx.employee.findMany({
    where: {
      AND: [
        scope,
        { status: { not: 'SEPARATED' } },
        { employmentRecords: { some: { AND: [inForceWhere(today), { managerId }] } } },
      ],
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: employeeListSelect,
    take: 500,
  });
  return rows.map((r) => toListItem(r, today));
}

async function departmentSubtree(tx: TenantTransaction, root: string): Promise<string[]> {
  const ids = [root];
  let frontier = [root];
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const children = await tx.department.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

async function assertLinkableMember(
  tx: TenantTransaction,
  membershipId: string,
  employeeId?: string,
) {
  const m = await tx.membership.findFirst({
    where: { id: membershipId },
    select: { id: true, employee: { select: { id: true } } },
  });
  if (!m) throw AppException.badRequest('Member not found', 'membershipId');
  if (m.employee && m.employee.id !== employeeId)
    throw AppException.conflictOn(
      'This member is already linked to another employee',
      'membershipId',
    );
}

async function ensureSettings(tx: TenantTransaction, organizationId: string) {
  return tx.employeeSettings.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

function toSettings(s: {
  numberPrefix: string;
  numberPadding: number;
  nextNumber: number;
}): EmployeeSettingsItem {
  return {
    numberPrefix: s.numberPrefix,
    numberPadding: s.numberPadding,
    nextNumber: s.nextNumber,
    preview: formatEmployeeNumber(s.numberPrefix, s.numberPadding, s.nextNumber),
  };
}

/**
 * Allocates the next employee number. The settings row is locked by the UPDATE for the rest
 * of the transaction, so concurrent joinings never receive the same number; numbers already
 * taken manually are skipped.
 */
async function nextEmployeeNumber(tx: TenantTransaction, organizationId: string): Promise<string> {
  await ensureSettings(tx, organizationId);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const s = await tx.employeeSettings.update({
      where: { organizationId },
      data: { nextNumber: { increment: 1 } },
    });
    const candidate = formatEmployeeNumber(s.numberPrefix, s.numberPadding, s.nextNumber - 1);
    const taken = await tx.employee.findFirst({
      where: { employeeNumber: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw AppException.conflict('Could not allocate an employee number; review numbering settings');
}

function mapEmployeeWriteError(err: unknown): never {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('employee_number')) {
    throw AppException.conflictOn('An employee with this number already exists', 'employeeNumber');
  }
  if (msg.includes('work_email')) {
    throw AppException.conflictOn('Another employee already uses this work e-mail', 'workEmail');
  }
  if (msg.includes('membership_id')) {
    throw AppException.conflictOn(
      'This member is already linked to another employee',
      'membershipId',
    );
  }
  return mapWriteError(err, { entity: 'employee', uniqueField: 'employeeNumber' });
}

function redactPersonal(changes: Record<string, { from: unknown; to: unknown }>) {
  for (const key of Object.keys(changes)) {
    if (PERSONAL_FIELDS.has(key)) changes[key] = { from: '[REDACTED]', to: '[REDACTED]' };
  }
  return changes;
}

function serializable(row: object | null): Record<string, unknown> {
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]),
  );
}

export { recordSelect };
