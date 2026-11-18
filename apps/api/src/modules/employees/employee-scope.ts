import type { Permission } from '@hrm/shared-types';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthPrincipal, ResourceAttributes } from '../access/principal.js';

/** `YYYY-MM-DD` → Date at UTC midnight (Prisma `@db.Date` round-trips in UTC). */
export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Date → `YYYY-MM-DD` (UTC). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoOrNull(d: Date | null | undefined): string | null {
  return d ? isoDate(d) : null;
}

export function todayIso(now: Date = new Date()): string {
  return isoDate(now);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/**
 * The employment record that describes an employee "now": the one in force today, or — for an
 * employee who has not joined yet — their pending joining/rejoining record.
 */
export function inForceWhere(today: string): Prisma.EmploymentRecordWhereInput {
  const day = toDate(today);
  return {
    OR: [
      { effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] },
      { effectiveFrom: { gt: day }, changeType: { in: ['JOINING', 'REJOINING'] } },
    ],
  };
}

/** Picks the record describing an employee now (see `inForceWhere`), else the latest one. */
export function currentRecord<
  R extends { effectiveFrom: Date; effectiveTo: Date | null; changeType: string },
>(records: readonly R[], today: string): R | null {
  const day = toDate(today).getTime();
  const sorted = [...records].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  const inForce = sorted.find(
    (r) => r.effectiveFrom.getTime() <= day && (!r.effectiveTo || r.effectiveTo.getTime() >= day),
  );
  if (inForce) return inForce;
  const pending = [...sorted]
    .reverse()
    .find(
      (r) =>
        r.effectiveFrom.getTime() > day &&
        (r.changeType === 'JOINING' || r.changeType === 'REJOINING'),
    );
  return pending ?? sorted[0] ?? null;
}

/**
 * Translates the caller's grants for `permission` into a filter on employees. Returns `null`
 * when nothing is visible, `{}` for organization-wide access, otherwise an OR of the scopes:
 *  - SELF: the caller's own employee record;
 *  - COMPANY / BRANCH / DEPARTMENT (subtree) / TEAM: the in-force placement matches.
 * RLS still bounds everything to the tenant.
 */
export function employeeScopeWhere(
  principal: AuthPrincipal,
  permission: Permission,
  today: string,
): Prisma.EmployeeWhereInput | null {
  const grants = principal.grants.get(permission) ?? [];
  if (grants.some((g) => g.scopeType === 'ORGANIZATION')) return {};
  const placement = (where: Prisma.EmploymentRecordWhereInput): Prisma.EmployeeWhereInput => ({
    employmentRecords: { some: { AND: [inForceWhere(today), where] } },
  });
  const ors: Prisma.EmployeeWhereInput[] = [];
  for (const g of grants) {
    switch (g.scopeType) {
      case 'SELF':
        if (principal.membershipId) ors.push({ membershipId: principal.membershipId });
        break;
      case 'COMPANY':
        if (g.scopeId) ors.push(placement({ companyId: g.scopeId }));
        break;
      case 'BRANCH':
        if (g.scopeId) ors.push(placement({ branchId: g.scopeId }));
        break;
      case 'TEAM':
        if (g.scopeId) ors.push(placement({ teamId: g.scopeId }));
        break;
      case 'DEPARTMENT':
        if (g.scopeId) ors.push(placement({ departmentId: { in: g.coveredIds ?? [g.scopeId] } }));
        break;
      case 'ORGANIZATION':
        break;
    }
  }
  return ors.length > 0 ? { OR: ors } : null;
}

/** ABAC attributes of an employee from their current placement and login account. */
export function employeeAttributes(
  record: {
    companyId: string;
    branchId: string | null;
    departmentId: string | null;
    teamId: string | null;
  } | null,
  ownerUserId: string | null | undefined,
): ResourceAttributes {
  return {
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(record
      ? {
          companyId: record.companyId,
          ...(record.branchId ? { branchId: record.branchId } : {}),
          ...(record.departmentId ? { departmentId: record.departmentId } : {}),
          ...(record.teamId ? { teamId: record.teamId } : {}),
        }
      : {}),
  };
}

export function displayName(e: {
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
}): string {
  const first = e.preferredName ?? e.firstName;
  return e.lastName ? `${first} ${e.lastName}` : first;
}

/** "XXXXXX1234" style mask showing only the last characters. */
export function mask(last: string, length = 10): string {
  return `${'•'.repeat(Math.max(0, length - last.length))}${last}`;
}
