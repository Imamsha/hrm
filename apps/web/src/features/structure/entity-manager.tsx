import type { Permission, RecordStatus } from '@hrm/shared-types';
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumnDef,
  Dialog,
  DialogContent,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  type PaginationState,
  Select,
  type SelectOption,
  type SortingState,
} from '@hrm/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import { usePermission } from '@/features/auth/auth-store';
import { ConfirmDialog } from '@/features/members/member-dialogs';
import { api, errorMessage } from '@/lib/api';
import { type RefSource, useEntityPage, useRefOptions } from './api';
import type { FieldDef, FormValues } from './entity-payload';
import { ResourceForm } from './resource-form';

export type { FieldDef, FormValues } from './entity-payload';

export interface ListFilter {
  param: string;
  label: string;
  ref: RefSource;
}

interface Base {
  id: string;
  status: RecordStatus;
}

export interface EntityConfig<T extends Base> {
  path: string;
  singular: string;
  plural: string;
  manage: Permission;
  /** Columns before the status and actions columns. Column ids are server sort keys. */
  columns: DataTableColumnDef<T>[];
  defaultSort: string;
  fields: FieldDef[];
  createSchema: z.ZodType;
  updateSchema: z.ZodType;
  emptyValues: FormValues;
  toValues: (item: T) => FormValues;
  title: (item: T) => string;
  filters?: ListFilter[];
}

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

export function StatusBadge({ status }: { status: RecordStatus }) {
  return status === 'ACTIVE' ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="neutral">Inactive</Badge>
  );
}

function EntityForm<T extends Base>({
  config,
  item,
  onDone,
}: {
  config: EntityConfig<T>;
  item: T | null;
  onDone: () => void;
}) {
  const editing = item !== null;
  return (
    <ResourceForm
      fields={config.fields}
      defaultValues={item ? config.toValues(item) : config.emptyValues}
      schema={editing ? config.updateSchema : config.createSchema}
      submit={(body) =>
        item ? api.patch(`${config.path}/${item.id}`, body) : api.post(config.path, body)
      }
      invalidate={[['structure']]}
      submitLabel={editing ? 'Save changes' : `Create ${config.singular}`}
      onDone={onDone}
      editing={editing}
      {...(editing ? { statusOptions: STATUS_OPTIONS } : {})}
    />
  );
}

function FilterSelect({
  filter,
  value,
  onChange,
}: {
  filter: ListFilter;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = useRefOptions(filter.ref);
  return (
    <Select
      aria-label={`Filter by ${filter.label.toLowerCase()}`}
      className="h-7 w-48"
      placeholder={`All ${filter.label.toLowerCase()}`}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      options={options.data ?? []}
    />
  );
}

/**
 * List + create/edit/archive/delete for one structure entity, driven by `config`.
 * Server-side search, sorting, status and reference filters, and pagination.
 */
export function EntityManager<T extends Base>({ config }: { config: EntityConfig<T> }) {
  const queryClient = useQueryClient();
  const canManage = usePermission(config.manage);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: config.defaultSort, desc: false }]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      setDebounced((prev) => {
        if (prev !== next) setPagination((p) => ({ ...p, pageIndex: 0 }));
        return next;
      });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [search]);

  const sort = sorting[0];
  const page = useEntityPage<T>(config.path, {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    sortBy: sort?.id,
    sortDir: sort?.desc ? 'desc' : 'asc',
    search: debounced || undefined,
    status: status || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });

  const remove = useMutation({
    mutationFn: (item: T) => api.delete(`${config.path}/${item.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['structure'] });
      setDeleting(null);
    },
    onError: (err) => {
      setDeleteError(errorMessage(err));
    },
  });

  const columns = useMemo<DataTableColumnDef<T>[]>(
    () => [
      ...config.columns,
      {
        id: 'status',
        header: 'Status',
        size: 100,
        enableSorting: false,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: '',
        size: 52,
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        cell: ({ row }) =>
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${config.title(row.original)}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setEditing(row.original);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    setDeleteError(null);
                    setDeleting(row.original);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [config, canManage],
  );

  const filtered = Boolean(debounced || status || Object.values(filters).some(Boolean));
  const resetPage = () => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        aria-label={config.plural}
        mode="server"
        columns={columns}
        data={page.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={page.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        isLoading={page.isPending}
        isFetching={page.isFetching}
        error={page.isError ? errorMessage(page.error) : null}
        onRetry={() => void page.refetch()}
        onRowActivate={
          canManage
            ? (row) => {
                setEditing(row);
              }
            : undefined
        }
        emptyTitle={
          filtered
            ? `No ${config.plural.toLowerCase()} match your filters`
            : `No ${config.plural.toLowerCase()} yet`
        }
        emptyDescription={
          !filtered && canManage ? `Create the first ${config.singular} to get started.` : undefined
        }
        toolbar={
          <>
            <div className="relative w-full max-w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={`Search ${config.plural.toLowerCase()}`}
                placeholder="Search code or name"
                className="h-7 pl-7"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
              />
            </div>
            {config.filters?.map((f) => (
              <FilterSelect
                key={f.param}
                filter={f}
                value={filters[f.param] ?? ''}
                onChange={(v) => {
                  setFilters((prev) => ({ ...prev, [f.param]: v }));
                  resetPage();
                }}
              />
            ))}
            <Select
              aria-label="Filter by status"
              className="h-7 w-36"
              placeholder="All statuses"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
              options={STATUS_OPTIONS}
            />
            {status || Object.values(filters).some(Boolean) ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatus('');
                  setFilters({});
                  resetPage();
                }}
              >
                Clear
              </Button>
            ) : null}
            {canManage ? (
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => {
                  setEditing('new');
                }}
              >
                <Plus /> New {config.singular}
              </Button>
            ) : null}
          </>
        }
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader
            title={editing === 'new' ? `New ${config.singular}` : `Edit ${config.singular}`}
            description={editing && editing !== 'new' ? config.title(editing) : undefined}
          />
          {editing ? (
            <EntityForm
              config={config}
              item={editing === 'new' ? null : editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete ${config.singular}?`}
          description={`${config.title(deleting)} will be permanently deleted. Records still in use cannot be deleted — set them to inactive instead.`}
          confirmLabel="Delete"
          destructive
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => {
            remove.mutate(deleting);
          }}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}
