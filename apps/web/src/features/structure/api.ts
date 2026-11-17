import type { PaginatedResult } from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Largest page the API serves; reference pickers load one page of this size. */
export const REF_PAGE_SIZE = 200;

export type QueryParams = Record<string, string | number | boolean | undefined>;

export function useEntityPage<T>(path: string, query: QueryParams) {
  return useQuery<PaginatedResult<T>>({
    queryKey: ['structure', path, 'page', query],
    queryFn: ({ signal }) => api.getPage<T>(path, { query, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Where a reference picker loads its options from. */
export interface RefSource {
  path: string;
  /** `false` for endpoints that return a plain array (work weeks, holiday calendars). */
  paged?: boolean;
  sortBy?: string;
  label?: (row: RefRow) => string;
}

export interface RefRow {
  id: string;
  name: string;
  code?: string;
  legalName?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  [key: string]: unknown;
}

export interface RefOption {
  value: string;
  label: string;
}

export const refLabel = (row: RefRow): string => {
  const name = row.legalName ?? row.name;
  const base = row.code ? `${name} (${row.code})` : name;
  return row.status === 'INACTIVE' ? `${base} · inactive` : base;
};

/**
 * Options for a reference picker. Inactive records are included (labelled) so an existing
 * reference to an archived record still displays; the API rejects nothing it would accept.
 */
export function useRefOptions(
  source: RefSource | undefined,
  params: QueryParams = {},
  enabled = true,
) {
  const paged = source?.paged ?? true;
  return useQuery({
    queryKey: ['structure', source?.path, 'options', params],
    enabled: Boolean(source) && enabled,
    queryFn: async ({ signal }): Promise<RefOption[]> => {
      if (!source) return [];
      const rows = paged
        ? (
            await api.getPage<RefRow>(source.path, {
              query: { pageSize: REF_PAGE_SIZE, sortBy: source.sortBy ?? 'name', ...params },
              signal,
            })
          ).items
        : await api.get<RefRow[]>(source.path, { signal });
      return rows.map((r) => ({ value: r.id, label: (source.label ?? refLabel)(r) }));
    },
  });
}
