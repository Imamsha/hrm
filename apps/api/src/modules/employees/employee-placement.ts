import { AppException } from '../../common/http/app.exception.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { inForceWhere } from './employee-scope.js';

export interface Placement {
  companyId: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN' | 'CONSULTANT';
  legalEntityId?: string | null | undefined;
  branchId?: string | null | undefined;
  departmentId?: string | null | undefined;
  teamId?: string | null | undefined;
  designationId?: string | null | undefined;
  jobGradeId?: string | null | undefined;
  costCenterId?: string | null | undefined;
  managerId?: string | null | undefined;
}

type Status = 'ACTIVE' | 'INACTIVE';

function usable(
  row: { status: Status } | null,
  label: string,
  field: string,
): asserts row is { status: Status } {
  if (!row) throw AppException.badRequest(`${label} not found`, field);
  if (row.status !== 'ACTIVE') throw AppException.badRequest(`${label} is inactive`, field);
}

/**
 * Validates a placement before it is written, returning field errors the UI can show. RLS
 * makes other tenants' ids "not found"; database triggers re-check the same rules.
 */
export async function validatePlacement(
  tx: TenantTransaction,
  p: Placement,
  employeeId: string | null,
  today: string,
): Promise<void> {
  const company = await tx.company.findFirst({
    where: { id: p.companyId },
    select: { status: true },
  });
  usable(company, 'Company', 'companyId');

  if (p.legalEntityId) {
    const le = await tx.legalEntity.findFirst({
      where: { id: p.legalEntityId },
      select: { status: true, companyId: true },
    });
    usable(le, 'Legal entity', 'legalEntityId');
    if (le.companyId !== p.companyId)
      throw AppException.badRequest('The legal entity belongs to another company', 'legalEntityId');
  }
  if (p.branchId) {
    const b = await tx.branch.findFirst({
      where: { id: p.branchId },
      select: { status: true, companyId: true },
    });
    usable(b, 'Branch', 'branchId');
    if (b.companyId !== p.companyId)
      throw AppException.badRequest('The branch belongs to another company', 'branchId');
  }
  if (p.departmentId) {
    const d = await tx.department.findFirst({
      where: { id: p.departmentId },
      select: { status: true, companyId: true },
    });
    usable(d, 'Department', 'departmentId');
    if (d.companyId !== p.companyId)
      throw AppException.badRequest('The department belongs to another company', 'departmentId');
  }
  if (p.teamId) {
    const t = await tx.team.findFirst({
      where: { id: p.teamId },
      select: { status: true, departmentId: true },
    });
    usable(t, 'Team', 'teamId');
    if (t.departmentId !== p.departmentId)
      throw AppException.badRequest('The team belongs to another department', 'teamId');
  }
  if (p.designationId) {
    usable(
      await tx.designation.findFirst({ where: { id: p.designationId }, select: { status: true } }),
      'Designation',
      'designationId',
    );
  }
  if (p.jobGradeId) {
    usable(
      await tx.jobGrade.findFirst({ where: { id: p.jobGradeId }, select: { status: true } }),
      'Job grade',
      'jobGradeId',
    );
  }
  if (p.costCenterId) {
    const cc = await tx.costCenter.findFirst({
      where: { id: p.costCenterId },
      select: { status: true, companyId: true },
    });
    usable(cc, 'Cost center', 'costCenterId');
    if (cc.companyId && cc.companyId !== p.companyId)
      throw AppException.badRequest('The cost center belongs to another company', 'costCenterId');
  }
  if (p.managerId) await assertManager(tx, p.managerId, employeeId, today);
}

/** The manager must be a current employee and must not report (directly or not) to the employee. */
async function assertManager(
  tx: TenantTransaction,
  managerId: string,
  employeeId: string | null,
  today: string,
): Promise<void> {
  if (managerId === employeeId)
    throw AppException.badRequest('An employee cannot be their own manager', 'managerId');
  const manager = await tx.employee.findFirst({
    where: { id: managerId },
    select: { status: true },
  });
  if (!manager) throw AppException.badRequest('Manager not found', 'managerId');
  if (manager.status === 'SEPARATED')
    throw AppException.badRequest('The manager has left the organization', 'managerId');
  if (!employeeId) return;
  // Walk up the manager's reporting chain; reaching the employee would create a cycle.
  const seen = new Set<string>();
  let current: string | null = managerId;
  for (let depth = 0; current && depth < 50; depth++) {
    if (current === employeeId)
      throw AppException.badRequest(
        'This manager reports to the employee (circular reporting)',
        'managerId',
      );
    if (seen.has(current)) return;
    seen.add(current);
    const rec: { managerId: string | null } | null = await tx.employmentRecord.findFirst({
      where: { AND: [{ employeeId: current }, inForceWhere(today)] },
      orderBy: { effectiveFrom: 'desc' },
      select: { managerId: true },
    });
    current = rec?.managerId ?? null;
  }
}

/** Data for an employment record insert from a placement. */
export function placementData(p: Placement) {
  return {
    companyId: p.companyId,
    employmentType: p.employmentType,
    legalEntityId: p.legalEntityId ?? null,
    branchId: p.branchId ?? null,
    departmentId: p.departmentId ?? null,
    teamId: p.teamId ?? null,
    designationId: p.designationId ?? null,
    jobGradeId: p.jobGradeId ?? null,
    costCenterId: p.costCenterId ?? null,
    managerId: p.managerId ?? null,
  };
}

export function placementAttributes(p: Placement) {
  return {
    companyId: p.companyId,
    ...(p.branchId ? { branchId: p.branchId } : {}),
    ...(p.departmentId ? { departmentId: p.departmentId } : {}),
    ...(p.teamId ? { teamId: p.teamId } : {}),
  };
}
