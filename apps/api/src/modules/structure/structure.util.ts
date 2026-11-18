import type { Ref } from '@hrm/shared-types';
import { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';

/** PostgreSQL SQLSTATE of a Prisma/driver error, when one can be determined. */
export function sqlState(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return '23505';
    if (err.code === 'P2003') return '23503';
    const meta = err.meta as
      { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
    const original = meta?.driverAdapterError?.cause?.originalCode;
    if (original) return original;
  }
  if (err instanceof Error) {
    const match = /Code: `([0-9A-Z]{5})`/.exec(err.message);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

/** Message raised by our integrity triggers (RAISE EXCEPTION ...), if present. */
function triggerMessage(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const match = /Message: `([^`]+)`/.exec(err.message);
  return match?.[1];
}

/**
 * Translates constraint violations into stable API errors:
 *  - unique violation → 409 with the offending field,
 *  - FK violation on delete → 409 "in use" (archive instead),
 *  - integrity trigger / check violation → 400 with the trigger's message.
 */
export function mapWriteError(
  err: unknown,
  ctx: { entity: string; uniqueField?: string; deleting?: boolean },
): never {
  const state = sqlState(err);
  if (state === '23505') {
    const field = uniqueFieldOf(err) ?? ctx.uniqueField ?? 'code';
    throw AppException.conflictOn(
      `A ${ctx.entity} with this ${humanize(field)} already exists`,
      field,
    );
  }
  if (state === '23503') {
    if (ctx.deleting) {
      throw AppException.conflict(
        `This ${ctx.entity} is still in use. Set its status to inactive instead of deleting it.`,
      );
    }
    throw AppException.badRequest(triggerMessage(err) ?? `A referenced record does not exist`);
  }
  if (state === '23514') {
    throw AppException.badRequest(triggerMessage(err) ?? `The ${ctx.entity} violates a data rule`);
  }
  throw err;
}

function uniqueFieldOf(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const meta = (err as { meta?: unknown }).meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
      }
    | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  // With driver adapters the target is absent; the constraint name is in the cause or the message.
  const target =
    meta?.target ??
    constraint?.fields ??
    constraint?.index ??
    /constraint: `([^`]+)`/.exec(err.message)?.[1];
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];
  const field = fields.find((f) => f !== 'organization_id' && f !== 'organizationId');
  if (!field) return undefined;
  // Constraint names look like `companies_organization_id_code_key`; map to a camelCase field.
  // Other names (e.g. `employee_addresses_employee_id_type_key`) cannot be split reliably, so
  // callers' `uniqueField` applies to them.
  if (field.endsWith('_key') && !field.includes('organization_id_')) return undefined;
  const name = field.replace(/^.*organization_id_/, '').replace(/_key$/, '');
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function humanize(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').toLowerCase();
}

export function toRef(
  row: { id: string; code: string; name: string } | null | undefined,
): Ref | null {
  return row ? { id: row.id, code: row.code, name: row.name } : null;
}

export const refSelect = { id: true, code: true, name: true } as const;

/** Copies only the keys present in `input` (undefined = "not provided" for PATCH). */
export function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}
