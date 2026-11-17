import type { PaginatedResult } from '@hrm/shared-types';
import type { StructureListQuery } from '@hrm/validation';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, resolveSort, skipTake } from '../../common/pagination.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';

type Dir = 'asc' | 'desc';

/**
 * Resolves the allow-listed sort for a list query. Callers pass the model's orderBy type
 * explicitly (`sortOf<Prisma.CompanyOrderByWithRelationInput>(...)`) so every entry is checked.
 */
export function sortOf<Order>(
  query: StructureListQuery,
  sorts: Record<string, (dir: Dir) => Order>,
  defaultSort: string,
): Order {
  return resolveSort(query.sortBy, sorts, query.sortDir, defaultSort);
}

/** Runs a paginated list query (rows + total) with the shared list-query contract. */
export async function pagedList<Row, Item>(params: {
  query: StructureListQuery;
  findMany: (args: { skip: number; take: number }) => Promise<Row[]>;
  count: () => Promise<number>;
  map: (row: Row) => Item;
}): Promise<PaginatedResult<Item>> {
  const [rows, total] = await Promise.all([
    params.findMany(skipTake(params.query)),
    params.count(),
  ]);
  return paginate(rows.map(params.map), total, params.query);
}

export type RefKind =
  | 'company'
  | 'legalEntity'
  | 'location'
  | 'branch'
  | 'costCenter'
  | 'department'
  | 'team'
  | 'jobGrade'
  | 'workWeek'
  | 'holidayCalendar';

const LABEL: Record<RefKind, string> = {
  company: 'Company',
  legalEntity: 'Legal entity',
  location: 'Location',
  branch: 'Branch',
  costCenter: 'Cost center',
  department: 'Department',
  team: 'Team',
  jobGrade: 'Job grade',
  workWeek: 'Work week',
  holidayCalendar: 'Holiday calendar',
};

/**
 * Verifies a referenced record exists in the current tenant (RLS hides other tenants, so
 * "not found" also covers cross-tenant ids) and reports it on the given field.
 */
export async function assertRef(
  tx: TenantTransaction,
  kind: RefKind,
  id: string | null | undefined,
  field: string,
): Promise<void> {
  if (!id) return;
  const where = { where: { id }, select: { id: true } } as const;
  const found =
    kind === 'company'
      ? await tx.company.findFirst(where)
      : kind === 'legalEntity'
        ? await tx.legalEntity.findFirst(where)
        : kind === 'location'
          ? await tx.location.findFirst(where)
          : kind === 'branch'
            ? await tx.branch.findFirst(where)
            : kind === 'costCenter'
              ? await tx.costCenter.findFirst(where)
              : kind === 'department'
                ? await tx.department.findFirst(where)
                : kind === 'team'
                  ? await tx.team.findFirst(where)
                  : kind === 'jobGrade'
                    ? await tx.jobGrade.findFirst(where)
                    : kind === 'workWeek'
                      ? await tx.workWeek.findFirst(where)
                      : await tx.holidayCalendar.findFirst(where);
  if (!found) throw AppException.badRequest(`${LABEL[kind]} not found`, field);
}

export function notFound(entity: string): never {
  throw AppException.notFound(entity);
}
