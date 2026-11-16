import type { AuditLogItem } from '@hrm/shared-types';
import {
  Badge,
  DataTable,
  type DataTableColumnDef,
  Input,
  type PaginationState,
  type SortingState,
} from '@hrm/ui-web';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { api, errorMessage } from '@/lib/api';

function formatChanges(changes: unknown): string {
  if (!changes || typeof changes !== 'object') return '—';
  return Object.entries(changes as Record<string, { from: unknown; to: unknown }>)
    .map(([k, v]) => `${k}: ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
    .join('; ');
}

const getRowId = (r: AuditLogItem) => r.id;

export function AuditPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'occurredAt', desc: true }]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [search]);

  const query = {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    sortDir: sorting[0]?.desc === false ? 'asc' : 'desc',
    search: debounced || undefined,
  };
  const logs = useQuery({
    queryKey: ['audit-logs', query],
    queryFn: ({ signal }) => api.getPage<AuditLogItem>('/audit-logs', { query, signal }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo<DataTableColumnDef<AuditLogItem>[]>(
    () => [
      {
        id: 'occurredAt',
        accessorKey: 'occurredAt',
        header: 'When',
        size: 180,
        meta: { numeric: true },
        cell: ({ row }) => new Date(row.original.occurredAt).toLocaleString(),
      },
      {
        id: 'actor',
        header: 'Actor',
        size: 180,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.actorName ?? <Badge>{row.original.actorType.toLowerCase()}</Badge>,
      },
      {
        id: 'action',
        header: 'Action',
        size: 200,
        enableSorting: false,
        cell: ({ row }) => <code className="font-mono text-sm">{row.original.action}</code>,
      },
      {
        id: 'entity',
        header: 'Entity',
        size: 160,
        enableSorting: false,
        cell: ({ row }) => row.original.entityType,
      },
      {
        id: 'changes',
        header: 'Changes',
        size: 360,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{formatChanges(row.original.changes)}</span>
        ),
      },
      {
        id: 'ip',
        header: 'IP address',
        size: 130,
        enableSorting: false,
        cell: ({ row }) => row.original.ipAddress ?? '—',
      },
    ],
    [],
  );

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="Tamper-evident record of administrative changes in this organization."
      />
      <DataTable
        aria-label="Audit log"
        mode="server"
        columns={columns}
        data={logs.data?.items ?? []}
        getRowId={getRowId}
        rowCount={logs.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        pageSizeOptions={[50, 100, 200]}
        isLoading={logs.isPending}
        isFetching={logs.isFetching}
        error={logs.isError ? errorMessage(logs.error) : null}
        onRetry={() => void logs.refetch()}
        emptyTitle="No audit entries"
        toolbar={
          <div className="relative w-full max-w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search audit log"
              placeholder="Search action or entity"
              className="h-7 pl-7"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
        }
      />
    </Page>
  );
}
