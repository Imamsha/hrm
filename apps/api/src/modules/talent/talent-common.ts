import { Decimal } from '@hrm/business-rules';
import type { EmployeeRef } from '@hrm/shared-types';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { displayName, inForceWhere, todayIso } from '../employees/employee-scope.js';

export const empSelect = {
  id: true,
  employeeNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  preferredName: true,
} as const;
type EmpRow = {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
};
export const ref = (e: EmpRow): EmployeeRef => ({
  id: e.id,
  employeeNumber: e.employeeNumber,
  displayName: displayName(e),
});
export const dec = (v: { toString(): string } | null | undefined, places = 2): string | null =>
  v === null || v === undefined
    ? null
    : new Decimal(v.toString()).toDecimalPlaces(places).toString();

/** The caller's employee id, or null when the login is not linked to an employee. */
export async function myEmployeeId(
  tx: TenantTransaction,
  principal: AuthPrincipal,
): Promise<string | null> {
  if (!principal.membershipId) return null;
  return (
    (
      await tx.employee.findFirst({
        where: { membershipId: principal.membershipId },
        select: { id: true },
      })
    )?.id ?? null
  );
}

export async function requireMe(tx: TenantTransaction, principal: AuthPrincipal): Promise<string> {
  const me = await myEmployeeId(tx, principal);
  if (!me) throw AppException.notFound('Employee record linked to your account');
  return me;
}

/** Employee ids whose in-force job record names `managerId` as reporting manager. */
export async function directReports(tx: TenantTransaction, managerId: string): Promise<string[]> {
  const rows = await tx.employmentRecord.findMany({
    where: { managerId, ...inForceWhere(todayIso()), employee: { status: { not: 'SEPARATED' } } },
    select: { employeeId: true },
  });
  return [...new Set(rows.map((r) => r.employeeId))];
}

/** The in-force reporting manager of an employee. */
export async function managerOf(tx: TenantTransaction, employeeId: string): Promise<string | null> {
  const r = await tx.employmentRecord.findFirst({
    where: { employeeId, ...inForceWhere(todayIso()) },
    orderBy: { effectiveFrom: 'desc' },
    select: { managerId: true },
  });
  return r?.managerId ?? null;
}

/** Active employees in an audience (whole organization, a company, or a department). */
export async function audienceEmployees(
  tx: TenantTransaction,
  audience: { companyId: string | null; departmentId: string | null },
): Promise<{ id: string; departmentId: string | null }[]> {
  const where: Prisma.EmploymentRecordWhereInput = {
    ...inForceWhere(todayIso()),
    employee: { status: { not: 'SEPARATED' } },
    ...(audience.companyId ? { companyId: audience.companyId } : {}),
    ...(audience.departmentId ? { departmentId: audience.departmentId } : {}),
  };
  const rows = await tx.employmentRecord.findMany({
    where,
    orderBy: { effectiveFrom: 'desc' },
    select: { employeeId: true, departmentId: true },
  });
  const seen = new Map<string, string | null>();
  for (const r of rows) if (!seen.has(r.employeeId)) seen.set(r.employeeId, r.departmentId);
  return [...seen].map(([id, departmentId]) => ({ id, departmentId }));
}

/** Whether an employee belongs to an audience today. */
export async function inAudience(
  tx: TenantTransaction,
  employeeId: string,
  audience: { companyId: string | null; departmentId: string | null },
): Promise<boolean> {
  if (!audience.companyId && !audience.departmentId) return true;
  const n = await tx.employmentRecord.count({
    where: {
      employeeId,
      ...inForceWhere(todayIso()),
      ...(audience.companyId ? { companyId: audience.companyId } : {}),
      ...(audience.departmentId ? { departmentId: audience.departmentId } : {}),
    },
  });
  return n > 0;
}

export async function departmentOf(
  tx: TenantTransaction,
  employeeId: string,
): Promise<string | null> {
  const r = await tx.employmentRecord.findFirst({
    where: { employeeId, ...inForceWhere(todayIso()) },
    orderBy: { effectiveFrom: 'desc' },
    select: { departmentId: true },
  });
  return r?.departmentId ?? null;
}
