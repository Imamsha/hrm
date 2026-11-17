import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '@hrm/shared-types';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import type { ScopedGrant } from './principal.js';

export interface ResolvedAccess {
  membershipId: string;
  grants: [Permission, ScopedGrant[]][];
}

const CACHE_TTL_SECONDS = 60;
const REVOKED_PREFIX = 'auth:session:revoked:';

/**
 * Resolves a user's membership and effective grants in an organization, with a short Redis cache.
 * Any change to members, roles or role permissions bumps the organization's access version, which
 * invalidates every cached entry for that organization immediately.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private versionKey(organizationId: string) {
    return `access:ver:${organizationId}`;
  }

  async resolve(organizationId: string, userId: string): Promise<ResolvedAccess | null> {
    const version = (await this.redis.get(this.versionKey(organizationId))) ?? '0';
    const cacheKey = `access:${organizationId}:${userId}:${version}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as ResolvedAccess);

    const resolved = await this.prisma.withTenant(
      async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { organizationId, userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
          select: {
            id: true,
            roles: {
              select: {
                scopeType: true,
                scopeId: true,
                role: { select: { permissions: { select: { permissionKey: true } } } },
              },
            },
          },
        });
        if (!membership) return null;

        // Expand DEPARTMENT scopes to their whole subtree once per resolution (cached below).
        const deptRoots = [
          ...new Set(
            membership.roles
              .filter((r) => r.scopeType === 'DEPARTMENT' && r.scopeId)
              .map((r) => r.scopeId as string),
          ),
        ];
        const covered = new Map<string, string[]>();
        for (const root of deptRoots) {
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
          covered.set(root, ids);
        }

        const grants = new Map<Permission, ScopedGrant[]>();
        for (const assignment of membership.roles) {
          for (const { permissionKey } of assignment.role.permissions) {
            const list = grants.get(permissionKey as Permission) ?? [];
            if (
              !list.some(
                (g) => g.scopeType === assignment.scopeType && g.scopeId === assignment.scopeId,
              )
            ) {
              list.push({
                scopeType: assignment.scopeType,
                scopeId: assignment.scopeId,
                ...(assignment.scopeType === 'DEPARTMENT' && assignment.scopeId
                  ? { coveredIds: covered.get(assignment.scopeId) ?? [assignment.scopeId] }
                  : {}),
              });
            }
            grants.set(permissionKey as Permission, list);
          }
        }
        return { membershipId: membership.id, grants: [...grants.entries()] };
      },
      { organizationId, userId },
    );

    await this.redis.set(
      cacheKey,
      resolved ? JSON.stringify(resolved) : 'none',
      'EX',
      CACHE_TTL_SECONDS,
    );
    return resolved;
  }

  /** Call after any change to memberships, role assignments or role permissions. */
  async invalidateOrganization(organizationId: string): Promise<void> {
    await this.redis.incr(this.versionKey(organizationId));
  }

  /** Marks sessions revoked for the remaining lifetime of their access tokens. */
  async markSessionsRevoked(sessionIds: string[], ttlSeconds: number): Promise<void> {
    if (sessionIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const id of sessionIds) pipeline.set(`${REVOKED_PREFIX}${id}`, '1', 'EX', ttlSeconds + 60);
    await pipeline.exec();
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(`${REVOKED_PREFIX}${sessionId}`)) === 1;
  }
}
