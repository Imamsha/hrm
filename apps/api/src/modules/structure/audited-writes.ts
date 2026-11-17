import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { type AuditService, diffChanges } from '../audit/audit.service.js';
import { notFound } from './structure-base.js';
import { mapWriteError } from './structure.util.js';

/**
 * Write helpers shared by the structure services. Each one performs the change, maps constraint
 * violations to API errors, and records the audit entry in the same transaction.
 */
export interface EntityMeta {
  /** Human label used in messages ("company", "legal entity"). */
  label: string;
  /** Audit entity type / action prefix ("company" → company.created). */
  type: string;
  uniqueField?: string;
}

export async function auditedCreate<R extends { id: string }>(
  tx: TenantTransaction,
  audit: AuditService,
  meta: EntityMeta,
  create: () => Promise<R>,
  metadata: (row: R) => Record<string, unknown>,
): Promise<R> {
  const row = await create().catch((err: unknown) =>
    mapWriteError(err, {
      entity: meta.label,
      ...(meta.uniqueField ? { uniqueField: meta.uniqueField } : {}),
    }),
  );
  await audit.record(tx, {
    action: `${meta.type}.created`,
    entityType: meta.type,
    entityId: row.id,
    metadata: metadata(row),
  });
  return row;
}

export async function auditedUpdate<R>(
  tx: TenantTransaction,
  audit: AuditService,
  meta: EntityMeta & { id: string },
  before: object | null,
  data: Record<string, unknown>,
  update: () => Promise<R>,
): Promise<R> {
  if (!before) notFound(capitalize(meta.label));
  const row = await update().catch((err: unknown) =>
    mapWriteError(err, {
      entity: meta.label,
      ...(meta.uniqueField ? { uniqueField: meta.uniqueField } : {}),
    }),
  );
  const changes = diffChanges(before as Record<string, unknown>, data);
  if (Object.keys(changes).length > 0) {
    await audit.record(tx, {
      action: `${meta.type}.updated`,
      entityType: meta.type,
      entityId: meta.id,
      changes,
    });
  }
  return row;
}

export async function auditedDelete(
  tx: TenantTransaction,
  audit: AuditService,
  meta: EntityMeta & { id: string },
  existing: Record<string, unknown> | null,
  remove: () => Promise<unknown>,
): Promise<void> {
  if (!existing) notFound(capitalize(meta.label));
  await remove().catch((err: unknown) =>
    mapWriteError(err, { entity: meta.label, deleting: true }),
  );
  await audit.record(tx, {
    action: `${meta.type}.deleted`,
    entityType: meta.type,
    entityId: meta.id,
    metadata: existing,
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Case-insensitive search across code and name (most structure entities). */
export function codeNameSearch(search: string | undefined) {
  return search
    ? {
        OR: [
          { code: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};
}

export const codeNameSorts = {
  code: (d: 'asc' | 'desc') => ({ code: d }),
  name: (d: 'asc' | 'desc') => ({ name: d }),
  status: (d: 'asc' | 'desc') => ({ status: d }),
  createdAt: (d: 'asc' | 'desc') => ({ createdAt: d }),
};
