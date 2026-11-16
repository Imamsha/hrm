import type { Permission } from '@hrm/shared-types';
import { AppException } from '../../common/http/app.exception.js';

export type ScopeType = 'ORGANIZATION' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT' | 'TEAM' | 'SELF';

export interface ScopedGrant {
  scopeType: ScopeType;
  scopeId: string | null;
}

/** Authenticated caller, resolved by the AccessGuard for every non-public request. */
export interface AuthPrincipal {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  membershipId: string | null;
  /** Permission → scopes under which it is granted in the active organization. */
  grants: ReadonlyMap<Permission, readonly ScopedGrant[]>;
}

export interface ResourceAttributes {
  /** User who owns the resource (enables SELF-scoped grants, e.g. "own profile"). */
  ownerUserId?: string;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  teamId?: string;
}

/**
 * ABAC evaluation. A permission applies when granted at a scope that contains the resource:
 *  - ORGANIZATION: always (the tenant boundary itself is enforced by RLS).
 *  - SELF: only when the resource belongs to the caller.
 *  - COMPANY / BRANCH / DEPARTMENT / TEAM: evaluated once the organization structure exists
 *    (Phase 03). Until then such grants never match (deny by default).
 */
export function can(
  principal: AuthPrincipal,
  permission: Permission,
  resource?: ResourceAttributes,
): boolean {
  const grants = principal.grants.get(permission);
  if (!grants?.length) return false;
  return grants.some((g) => {
    switch (g.scopeType) {
      case 'ORGANIZATION':
        return true;
      case 'SELF':
        return resource?.ownerUserId !== undefined && resource.ownerUserId === principal.userId;
      default:
        return false;
    }
  });
}

export function hasOrganizationWide(principal: AuthPrincipal, permission: Permission): boolean {
  return principal.grants.get(permission)?.some((g) => g.scopeType === 'ORGANIZATION') ?? false;
}

export function assertCan(
  principal: AuthPrincipal,
  permission: Permission,
  resource?: ResourceAttributes,
): void {
  if (!can(principal, permission, resource)) throw AppException.forbidden();
}

export function permissionList(principal: AuthPrincipal): Permission[] {
  return [...principal.grants.keys()].sort();
}
