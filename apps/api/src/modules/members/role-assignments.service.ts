import { Injectable } from '@nestjs/common';
import { OWNER_ROLE_KEY, type Ref, type ScopedRoleAssignment } from '@hrm/shared-types';
import type { ScopedRoleAssignmentInput } from '@hrm/validation';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { sqlState } from '../structure/structure.util.js';
import { countActiveOwners, isOwner } from './member-rules.js';

type ScopeType = ScopedRoleAssignment['scopeType'];

/** Resolves the display reference of a structural scope (null for ORGANIZATION / SELF). */
async function scopeRef(
  tx: TenantTransaction,
  scopeType: ScopeType,
  scopeId: string | null,
): Promise<Ref | null> {
  if (!scopeId) return null;
  const select = { id: true, code: true, name: true } as const;
  switch (scopeType) {
    case 'COMPANY':
      return tx.company.findFirst({ where: { id: scopeId }, select });
    case 'BRANCH':
      return tx.branch.findFirst({ where: { id: scopeId }, select });
    case 'DEPARTMENT':
      return tx.department.findFirst({ where: { id: scopeId }, select });
    case 'TEAM':
      return tx.team.findFirst({ where: { id: scopeId }, select });
    default:
      return null;
  }
}

/**
 * Role assignments with an ABAC scope ("HR admin for the Pune branch", "Manager of Engineering").
 * Organization-wide assignments are also managed by PUT /members/:id/roles.
 */
@Injectable()
export class RoleAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  list(membershipId: string): Promise<ScopedRoleAssignment[]> {
    return this.prisma.withTenant(async (tx) => {
      if (!(await tx.membership.findFirst({ where: { id: membershipId }, select: { id: true } }))) {
        throw AppException.notFound('Member');
      }
      const rows = await tx.membershipRole.findMany({
        where: { membershipId },
        include: { role: { select: { id: true, key: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const out: ScopedRoleAssignment[] = [];
      for (const r of rows) {
        out.push({
          id: r.id,
          role: r.role,
          scopeType: r.scopeType,
          scope: await scopeRef(tx, r.scopeType, r.scopeId),
        });
      }
      return out;
    });
  }

  async add(
    principal: AuthPrincipal,
    membershipId: string,
    input: ScopedRoleAssignmentInput,
  ): Promise<ScopedRoleAssignment> {
    const organizationId = principal.organizationId ?? '';
    const result = await this.prisma.withTenant(async (tx) => {
      if (!(await tx.membership.findFirst({ where: { id: membershipId }, select: { id: true } }))) {
        throw AppException.notFound('Member');
      }
      const role = await tx.role.findFirst({
        where: { id: input.roleId },
        select: { id: true, key: true, name: true },
      });
      if (!role) throw AppException.badRequest('Role not found', 'roleId');
      if (role.key === OWNER_ROLE_KEY) {
        if (input.scopeType !== 'ORGANIZATION') {
          throw AppException.badRequest(
            'The owner role can only be granted organization-wide',
            'scopeType',
          );
        }
        if (!(await isOwner(tx, principal.membershipId ?? ''))) {
          throw AppException.forbidden('Only owners can grant the owner role');
        }
      }
      const scope = await scopeRef(tx, input.scopeType, input.scopeId ?? null);
      if (input.scopeType !== 'ORGANIZATION' && !scope) {
        throw AppException.badRequest('The selected scope does not exist', 'scopeId');
      }
      const created = await tx.membershipRole
        .create({
          data: {
            organizationId,
            membershipId,
            roleId: role.id,
            scopeType: input.scopeType,
            scopeId: input.scopeId ?? null,
          },
        })
        .catch((err: unknown) => {
          if (sqlState(err) === '23505')
            throw AppException.conflict('This role is already assigned with this scope');
          throw err;
        });
      await this.audit.record(tx, {
        action: 'member.role_assigned',
        entityType: 'membership',
        entityId: membershipId,
        metadata: { role: role.key, scopeType: input.scopeType, scopeId: input.scopeId ?? null },
      });
      return {
        id: created.id,
        role,
        scopeType: input.scopeType,
        scope,
      } satisfies ScopedRoleAssignment;
    });
    await this.access.invalidateOrganization(organizationId);
    return result;
  }

  async remove(
    principal: AuthPrincipal,
    membershipId: string,
    assignmentId: string,
  ): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const assignment = await tx.membershipRole.findFirst({
        where: { id: assignmentId, membershipId },
        include: { role: { select: { key: true } } },
      });
      if (!assignment) throw AppException.notFound('Role assignment');
      if (assignment.role.key === OWNER_ROLE_KEY) {
        if (!(await isOwner(tx, principal.membershipId ?? ''))) {
          throw AppException.forbidden('Only owners can revoke the owner role');
        }
      }
      await tx.membershipRole.delete({ where: { id: assignmentId } });
      if (assignment.role.key === OWNER_ROLE_KEY && (await countActiveOwners(tx)) === 0) {
        throw AppException.conflict('The organization must keep at least one active owner');
      }
      await this.audit.record(tx, {
        action: 'member.role_unassigned',
        entityType: 'membership',
        entityId: membershipId,
        metadata: {
          role: assignment.role.key,
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeId,
        },
      });
    });
    await this.access.invalidateOrganization(principal.organizationId ?? '');
  }
}
