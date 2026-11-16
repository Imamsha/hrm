import { Injectable } from '@nestjs/common';
import type { Permission, PermissionCatalogItem, RoleDetails } from '@hrm/shared-types';
import type { CreateRoleInput, UpdateRoleInput } from '@hrm/validation';
import { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { AccessService } from '../access/access.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';

const roleSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
  permissions: { select: { permissionKey: true } },
  _count: { select: { membershipRoles: true } },
} satisfies Prisma.RoleSelect;

type RoleRow = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

function toDetails(r: RoleRow): RoleDetails {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.permissions.map((p) => p.permissionKey as Permission).sort(),
    memberCount: r._count.membershipRoles,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  catalog(): Promise<PermissionCatalogItem[]> {
    return this.prisma.permission
      .findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] })
      .then((rows) =>
        rows.map((r) => ({
          key: r.key as Permission,
          module: r.module,
          description: r.description,
        })),
      );
  }

  list(): Promise<RoleDetails[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.role.findMany({
          select: roleSelect,
          orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        })
      ).map(toDetails),
    );
  }

  private async findOrThrow(tx: TenantTransaction, roleId: string): Promise<RoleRow> {
    const role = await tx.role.findFirst({ where: { id: roleId }, select: roleSelect });
    if (!role) throw AppException.notFound('Role');
    return role;
  }

  async create(
    principal: AuthPrincipal,
    input: CreateRoleInput & { permissions: Permission[] },
  ): Promise<RoleDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      let role;
      try {
        role = await tx.role.create({
          data: {
            organizationId,
            key: input.key,
            name: input.name,
            description: input.description ?? null,
          },
          select: { id: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw AppException.conflict('A role with this key already exists');
        }
        throw err;
      }
      if (input.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: input.permissions.map((permissionKey) => ({
            organizationId,
            roleId: role.id,
            permissionKey,
          })),
        });
      }
      await this.audit.record(tx, {
        action: 'role.created',
        entityType: 'role',
        entityId: role.id,
        metadata: { key: input.key, permissions: input.permissions },
      });
      return toDetails(await this.findOrThrow(tx, role.id));
    });
  }

  async update(
    principal: AuthPrincipal,
    roleId: string,
    input: UpdateRoleInput & { permissions?: Permission[] },
  ): Promise<RoleDetails> {
    const organizationId = principal.organizationId ?? '';
    const result = await this.prisma.withTenant(async (tx) => {
      const before = await this.findOrThrow(tx, roleId);
      if (before.isSystem) throw AppException.forbidden('System roles cannot be modified');
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        },
      });
      const beforePermissions = before.permissions.map((p) => p.permissionKey).sort();
      if (input.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (input.permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: input.permissions.map((permissionKey) => ({
              organizationId,
              roleId,
              permissionKey,
            })),
          });
        }
      }
      await this.audit.record(tx, {
        action: 'role.updated',
        entityType: 'role',
        entityId: roleId,
        changes: {
          ...(input.name !== undefined && input.name !== before.name
            ? { name: { from: before.name, to: input.name } }
            : {}),
          ...(input.permissions
            ? { permissions: { from: beforePermissions, to: [...input.permissions].sort() } }
            : {}),
        },
      });
      return toDetails(await this.findOrThrow(tx, roleId));
    });
    await this.access.invalidateOrganization(organizationId);
    return result;
  }

  async remove(principal: AuthPrincipal, roleId: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const role = await this.findOrThrow(tx, roleId);
      if (role.isSystem) throw AppException.forbidden('System roles cannot be deleted');
      if (role._count.membershipRoles > 0) {
        throw AppException.conflict('Remove this role from all members before deleting it');
      }
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record(tx, {
        action: 'role.deleted',
        entityType: 'role',
        entityId: roleId,
        metadata: { key: role.key },
      });
    });
    await this.access.invalidateOrganization(principal.organizationId ?? '');
  }
}
