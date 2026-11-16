import type { PaginatedResult } from '@hrm/shared-types';
import type { ListQuery } from '@hrm/validation';
import { AppException } from './http/app.exception.js';

export function paginate<T>(
  items: T[],
  total: number,
  query: Pick<ListQuery, 'page' | 'pageSize'>,
): PaginatedResult<T> {
  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export function skipTake(query: Pick<ListQuery, 'page' | 'pageSize'>): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/** Maps an allow-listed public sort field to an ORM orderBy; rejects anything else. */
export function resolveSort<K extends string, O>(
  sortBy: string | undefined,
  allowed: Record<K, (dir: 'asc' | 'desc') => O>,
  dir: 'asc' | 'desc',
  fallback: K,
): O {
  const key = (sortBy ?? fallback) as K;
  const build = allowed[key] as ((d: 'asc' | 'desc') => O) | undefined;
  if (!build) {
    throw AppException.badRequest(`Cannot sort by "${sortBy ?? ''}"`, 'sortBy');
  }
  return build(dir);
}
