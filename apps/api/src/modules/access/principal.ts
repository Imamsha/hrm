import type { Permission } from '@hrm/shared-types';
import { AppException } from '../../common/http/app.exception.js';

export type ScopeType = 'ORGANIZATION' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT' | 'TEAM' | 'SELF';

export interface ScopedGrant {
  scopeType: ScopeType;
  scopeId: string | null;
  /**
   * DEPARTMENT scope only: the department and all of its sub-departments, expanded when access
   * is resolved, so a manager of "Engineering" also covers "Engineering › Platform".
   */
  coveredIds?: string[];
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
 *  - COMPANY / BRANCH / TEAM: the resource carries the matching attribute.
 *  - DEPARTMENT: the resource's department is the scoped department or one of its descendants.
 * Resources must supply every structural attribute they have (company, branch, department, team);
 * a missing attribute never matches (deny by default).
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
      case 'COMPANY':
        return g.scopeId !== null && resource?.companyId === g.scopeId;
      case 'BRANCH':
        return g.scopeId !== null && resource?.branchId === g.scopeId;
      case 'TEAM':
        return g.scopeId !== null && resource?.teamId === g.scopeId;
      case 'DEPARTMENT': {
        const dept = resource?.departmentId;
        if (dept === undefined || g.scopeId === null) return false;
        return (g.coveredIds ?? [g.scopeId]).includes(dept);
      }
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
