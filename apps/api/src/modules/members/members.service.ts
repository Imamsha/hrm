import { Injectable } from '@nestjs/common';
import { type MemberListItem, OWNER_ROLE_KEY, type PaginatedResult } from '@hrm/shared-types';
import type { MemberListQuery } from '@hrm/validation';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, resolveSort, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { assertCanGrantRoles, countActiveOwners, isOwner, loadRoles } from './member-rules.js';

const memberSelect = {
  id: true,
  userId: true,
  status: true,
  joinedAt: true,
  user: { select: { email: true, fullName: true, mfaEnabled: true, lastLoginAt: true } },
  roles: { select: { role: { select: { id: true, key: true, name: true } } } },
} satisfies Prisma.MembershipSelect;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

function toItem(m: MemberRow): MemberListItem {
  return {
    membershipId: m.id,
    userId: m.userId,
    email: m.user.email,
    fullName: m.user.fullName,
    status: m.status,
    mfaEnabled: m.user.mfaEnabled,
    lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
    joinedAt: m.joinedAt.toISOString(),
    // A role may be assigned organization-wide and with scopes; list it once.
    roles: [...new Map(m.roles.map((r) => [r.role.id, r.role])).values()],
  };
}

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  list(query: MemberListQuery): Promise<PaginatedResult<MemberListItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.MembershipWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.roleId ? { roles: { some: { roleId: query.roleId } } } : {}),
        ...(query.search
          ? {
              user: {
                OR: [
                  { fullName: { contains: query.search, mode: 'insensitive' } },
                  { email: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      };
      const orderBy = resolveSort<
        'fullName' | 'email' | 'joinedAt' | 'status',
        Prisma.MembershipOrderByWithRelationInput
      >(
        query.sortBy,
        {
          fullName: (d) => ({ user: { fullName: d } }),
          email: (d) => ({ user: { email: d } }),
          joinedAt: (d) => ({ joinedAt: d }),
          status: (d) => ({ status: d }),
        },
        query.sortDir,
        'fullName',
      );
      const [rows, total] = await Promise.all([
        tx.membership.findMany({
          where,
          orderBy: [orderBy, { id: 'asc' }],
          select: memberSelect,
          ...skipTake(query),
        }),
        tx.membership.count({ where }),
      ]);
      return paginate(rows.map(toItem), total, query);
    });
  }

  private async findOrThrow(tx: TenantTransaction, membershipId: string): Promise<MemberRow> {
    const m = await tx.membership.findFirst({ where: { id: membershipId }, select: memberSelect });
    if (!m) throw AppException.notFound('Member');
    return m;
  }

  async updateStatus(
    principal: AuthPrincipal,
    membershipId: string,
    status: 'ACTIVE' | 'SUSPENDED',
  ): Promise<MemberListItem> {
    const result = await this.prisma.withTenant(async (tx) => {
      const member = await this.findOrThrow(tx, membershipId);
      if (member.status === status) return toItem(member);
      if (membershipId === principal.membershipId)
        throw AppException.badRequest('You cannot change your own status', 'status');
      if (status === 'SUSPENDED' && (await isOwner(tx, membershipId))) {
        if (!(await isOwner(tx, principal.membershipId ?? ''))) {
          throw AppException.forbidden('Only owners can suspend another owner');
        }
        if ((await countActiveOwners(tx, membershipId)) === 0) {
          throw AppException.conflict('The organization must keep at least one active owner');
        }
      }
      await tx.membership.update({ where: { id: membershipId }, data: { status } });
      await this.audit.record(tx, {
        action: status === 'SUSPENDED' ? 'member.suspended' : 'member.reactivated',
        entityType: 'membership',
        entityId: membershipId,
        changes: { status: { from: member.status, to: status } },
      });
      return toItem({ ...member, status });
    });
    await this.access.invalidateOrganization(principal.organizationId ?? '');
    return result;
  }

  async setRoles(
    principal: AuthPrincipal,
    membershipId: string,
    roleIds: string[],
  ): Promise<MemberListItem> {
    const result = await this.prisma.withTenant(async (tx) => {
      const member = await this.findOrThrow(tx, membershipId);
      const roles = await loadRoles(tx, roleIds);
      const actor = principal.membershipId ?? '';
      const before = member.roles.map((r) => r.role);
      const ownerChanging =
        before.some((r) => r.key === OWNER_ROLE_KEY) !==
        roles.some((r) => r.key === OWNER_ROLE_KEY);
      if (ownerChanging && !(await isOwner(tx, actor))) {
        throw AppException.forbidden('Only owners can grant or revoke the owner role');
      }
      await assertCanGrantRoles(tx, actor, roles);

      // Organization-scoped assignments are replaced; scoped (ABAC) assignments arrive in Phase 03.
      await tx.membershipRole.deleteMany({ where: { membershipId, scopeType: 'ORGANIZATION' } });
      await tx.membershipRole.createMany({
        data: roles.map((r) => ({
          organizationId: principal.organizationId ?? '',
          membershipId,
          roleId: r.id,
        })),
      });
      if ((await countActiveOwners(tx)) === 0) {
        throw AppException.conflict('The organization must keep at least one active owner');
      }
      await this.audit.record(tx, {
        action: 'member.roles_changed',
        entityType: 'membership',
        entityId: membershipId,
        changes: {
          roles: { from: before.map((r) => r.key).sort(), to: roles.map((r) => r.key).sort() },
        },
      });
      return this.findOrThrow(tx, membershipId).then(toItem);
    });
    await this.access.invalidateOrganization(principal.organizationId ?? '');
    return result;
  }

  async remove(principal: AuthPrincipal, membershipId: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const member = await this.findOrThrow(tx, membershipId);
      if (membershipId === principal.membershipId)
        throw AppException.badRequest('You cannot remove yourself', 'membershipId');
      if (await isOwner(tx, membershipId)) {
        if (!(await isOwner(tx, principal.membershipId ?? ''))) {
          throw AppException.forbidden('Only owners can remove another owner');
        }
        if ((await countActiveOwners(tx, membershipId)) === 0) {
          throw AppException.conflict('The organization must keep at least one active owner');
        }
      }
      await tx.membership.delete({ where: { id: membershipId } });
      await this.audit.record(tx, {
        action: 'member.removed',
        entityType: 'membership',
        entityId: membershipId,
        metadata: { userId: member.userId, email: member.user.email },
      });
    });
    await this.access.invalidateOrganization(principal.organizationId ?? '');
  }
}
