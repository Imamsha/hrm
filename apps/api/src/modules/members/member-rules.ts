import { OWNER_ROLE_KEY } from '@hrm/shared-types';
import { AppException } from '../../common/http/app.exception.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';

/** Number of ACTIVE memberships holding the owner role (organization-wide). */
export async function countActiveOwners(
  tx: TenantTransaction,
  excludingMembershipId?: string,
): Promise<number> {
  return tx.membership.count({
    where: {
      status: 'ACTIVE',
      ...(excludingMembershipId ? { id: { not: excludingMembershipId } } : {}),
      roles: { some: { role: { key: OWNER_ROLE_KEY }, scopeType: 'ORGANIZATION' } },
    },
  });
}

export async function isOwner(tx: TenantTransaction, membershipId: string): Promise<boolean> {
  const count = await tx.membershipRole.count({
    where: { membershipId, role: { key: OWNER_ROLE_KEY }, scopeType: 'ORGANIZATION' },
  });
  return count > 0;
}

/** Validates role ids belong to this tenant (RLS hides others) and returns them. */
export async function loadRoles(tx: TenantTransaction, roleIds: string[]) {
  const roles = await tx.role.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, key: true, name: true },
  });
  if (roles.length !== roleIds.length)
    throw AppException.badRequest('One or more roles do not exist', 'roleIds');
  return roles;
}

/** Only owners may grant the owner role. */
export async function assertCanGrantRoles(
  tx: TenantTransaction,
  actorMembershipId: string,
  roles: { key: string }[],
): Promise<void> {
  if (roles.some((r) => r.key === OWNER_ROLE_KEY) && !(await isOwner(tx, actorMembershipId))) {
    throw AppException.forbidden('Only owners can grant the owner role');
  }
}
