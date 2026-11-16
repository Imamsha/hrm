import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumnDef,
  ErrorState,
  Skeleton,
  StatusIndicator,
} from '@hrm/ui-web';
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { errorMessage } from '@/lib/api';
import { type DependencyRow, formatUptime, toDependencyRows, useHealthReport } from './use-health';

const columns: DataTableColumnDef<DependencyRow>[] = [
  {
    accessorKey: 'name',
    header: 'Dependency',
    size: 200,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 120,
    cell: ({ row }) =>
      row.original.status === 'up' ? (
        <StatusIndicator tone="success">Operational</StatusIndicator>
      ) : (
        <StatusIndicator tone="destructive">Down</StatusIndicator>
      ),
  },
  {
    accessorKey: 'latencyMs',
    header: 'Latency',
    size: 100,
    meta: { align: 'right', numeric: true },
    cell: ({ row }) => `${String(row.original.latencyMs)} ms`,
  },
  {
    accessorKey: 'error',
    header: 'Detail',
    size: 160,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.error ? (
        <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">
          {row.original.error}
        </code>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: 'description',
    header: 'Role',
    size: 320,
    enableSorting: false,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.description}</span>,
  },
];

const getRowId = (r: DependencyRow) => r.id;

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-md font-medium tabular">{children}</dd>
    </div>
  );
}

export function SystemStatusPage() {
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt } = useHealthReport();
  const rows = data ? toDependencyRows(data) : [];
  const down = rows.filter((r) => r.status === 'down').length;

  return (
    <Page>
      <PageHeader
        title="System status"
        description="Live health of the API and its infrastructure dependencies. Refreshes every 15 seconds."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-busy={isFetching}
          >
            <RefreshCw className={isFetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />

      {error && !data ? (
        <Card>
          <ErrorState
            title="API unreachable"
            description={errorMessage(error)}
            onRetry={() => void refetch()}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Overall</CardTitle>
              {data ? (
                data.status === 'ok' ? (
                  <Badge variant="success">All systems operational</Badge>
                ) : (
                  <Badge variant="destructive">
                    {down} of {rows.length} dependencies down
                  </Badge>
                )
              ) : (
                <Skeleton className="h-5 w-40" />
              )}
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="API version">
                  {data ? data.version : <Skeleton className="h-5 w-16" />}
                </Stat>
                <Stat label="Environment">
                  {data ? data.environment : <Skeleton className="h-5 w-20" />}
                </Stat>
                <Stat label="Uptime">
                  {data ? formatUptime(data.uptimeSeconds) : <Skeleton className="h-5 w-12" />}
                </Stat>
                <Stat label="Last checked">
                  {dataUpdatedAt ? (
                    new Date(dataUpdatedAt).toLocaleTimeString()
                  ) : (
                    <Skeleton className="h-5 w-20" />
                  )}
                </Stat>
              </dl>
            </CardContent>
          </Card>

          <DataTable
            aria-label="Dependency health"
            columns={columns}
            data={rows}
            getRowId={getRowId}
            isLoading={isPending}
            isFetching={isFetching}
            hidePagination
            emptyTitle="No dependencies reported"
          />
        </div>
      )}
    </Page>
  );
}
