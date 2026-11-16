import { Injectable } from '@nestjs/common';
import type { AuditLogItem, PaginatedResult } from '@hrm/shared-types';
import type { AuditLogQuery } from '@hrm/validation';
import { Prisma } from '../../../generated/prisma/client.js';
import { RequestContext } from '../../common/context/request-context.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  metadata?: Record<string, unknown> | null;
}

const REDACTED_FIELDS = /password|secret|token|hash/i;

/** Field-level diff of the keys present in `next`, with sensitive fields redacted. */
export function diffChanges(
  before: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(next)) {
    const from = before[key];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
    if (JSON.stringify(norm(from)) === JSON.stringify(norm(to))) continue;
    out[key] = REDACTED_FIELDS.test(key)
      ? { from: '[REDACTED]', to: '[REDACTED]' }
      : { from: norm(from) ?? null, to: norm(to) ?? null };
  }
  return out;
}

/**
 * Business audit trail. `record()` must be called with the SAME transaction as the change it
 * describes, so the change and its audit entry commit or roll back together.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `override` is for transactions whose tenant/actor differ from the request context
   * (registration, invitation acceptance); it must match the transaction's tenant (RLS enforces it).
   */
  async record(
    tx: TenantTransaction,
    entry: AuditEntry,
    override?: { organizationId: string; actorId: string | null },
  ): Promise<void> {
    const ctx = RequestContext.get();
    const organizationId = override?.organizationId ?? ctx?.organizationId;
    if (!organizationId) throw new Error('Audit requires a tenant context');
    const actorId = override ? override.actorId : (ctx?.userId ?? null);
    await tx.auditLog.create({
      data: {
        organizationId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        requestId: ctx?.requestId ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        changes: entry.changes ? (entry.changes as Prisma.InputJsonValue) : Prisma.DbNull,
        metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  }

  async list(query: AuditLogQuery): Promise<PaginatedResult<AuditLogItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.AuditLogWhereInput = {
        ...(query.action ? { action: { startsWith: query.action } } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.from || query.to
          ? {
              occurredAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { action: { contains: query.search, mode: 'insensitive' } },
                { entityType: { contains: query.search, mode: 'insensitive' } },
                { entityId: { contains: query.search } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { occurredAt: query.sortDir === 'asc' ? 'asc' : 'desc' },
          ...skipTake(query),
        }),
        tx.auditLog.count({ where }),
      ]);
      const actorIds = [
        ...new Set(rows.map((r) => r.actorId).filter((v): v is string => Boolean(v))),
      ];
      const actors = actorIds.length
        ? await tx.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, fullName: true },
          })
        : [];
      const names = new Map(actors.map((a) => [a.id, a.fullName]));
      return paginate(
        rows.map((r) => ({
          id: r.id,
          actorType: r.actorType,
          actorId: r.actorId,
          actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          changes: r.changes,
          ipAddress: r.ipAddress,
          occurredAt: r.occurredAt.toISOString(),
        })),
        total,
        query,
      );
    });
  }
}
