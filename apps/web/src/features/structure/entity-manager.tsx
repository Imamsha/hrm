import type { Permission, RecordStatus } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  type DataTableColumnDef,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FormField,
  FormGrid,
  Input,
  type PaginationState,
  Select,
  type SelectOption,
  type SortingState,
  Textarea,
} from '@hrm/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { usePermission } from '@/features/auth/auth-store';
import { ConfirmDialog } from '@/features/members/member-dialogs';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { type QueryParams, type RefSource, useEntityPage, useRefOptions } from './api';
import { type FieldDef, type FormValues, toPayload } from './entity-payload';

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

function RefSelect({
  field,
  value,
  onChange,
  values,
  disabled,
  ...aria
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  values: FormValues;
  disabled?: boolean;
  /** Wiring injected by FormField (label association, error description). */
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}) {
  const filterValue = field.refFilter ? values[field.refFilter.field] : undefined;
  const params: QueryParams =
    field.refFilter && filterValue ? { [field.refFilter.param]: filterValue } : {};
  const waiting = Boolean(field.refFilter && !filterValue);
  const options = useRefOptions(field.ref, params, !waiting);
  const list = options.data ?? [];
  return (
    <Select
      value={value}
      disabled={disabled || waiting || options.isPending}
      {...aria}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      placeholder={
        waiting
          ? 'Select the parent first'
          : options.isPending
            ? 'Loading…'
            : (field.placeholder ?? 'None')
      }
      options={field.required ? list : [{ value: '', label: '— None —' }, ...list]}
    />
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
  const queryClient = useQueryClient();
  const editing = item !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    defaultValues: item ? config.toValues(item) : config.emptyValues,
  });
  const values = useWatch({ control: form.control }) as FormValues;
  const fieldNames = config.fields.map((f) => f.name);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing ? api.patch(`${config.path}/${item.id}`, body) : api.post(config.path, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['structure'] });
      onDone();
    },
    onError: (err) => {
      setFormError(applyServerErrors(err, form.setError, [...fieldNames, 'status']));
    },
  });

  const submit = form.handleSubmit((raw) => {
    setFormError(null);
    const body = toPayload(config.fields, raw, editing);
    const parsed = (editing ? config.updateSchema : config.createSchema).safeParse(body);
    if (!parsed.success) {
      let unmapped: string | null = null;
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? '');
        if (fieldNames.includes(name))
          form.setError(name, { type: 'validate', message: issue.message });
        else unmapped ??= issue.message;
      }
      setFormError(unmapped);
      return;
    }
    // Send what the user entered; the API applies the same schema (and its normalisation).
    save.mutate(body);
  });

  const { errors } = form.formState;
  const errorOf = (name: string) => {
    const e = errors[name];
    return typeof e?.message === 'string' ? e.message : undefined;
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)}>
      <DialogBody className="flex flex-col gap-4">
        {formError ? <Alert tone="destructive">{formError}</Alert> : null}
        <FormGrid columns={2}>
          {config.fields
            .filter((f) => (f.show ? f.show(values) : true))
            .map((f) => {
              const locked = editing && f.createOnly;
              const error = errorOf(f.name);
              return (
                <FormField
                  key={f.name}
                  label={f.label}
                  error={error}
                  description={f.description}
                  required={f.required ?? false}
                  className={f.wide || f.kind === 'textarea' ? 'sm:col-span-2' : undefined}
                >
                  {f.kind === 'ref' ? (
                    <RefSelect
                      field={f}
                      value={values[f.name] ?? ''}
                      onChange={(v) => {
                        form.setValue(f.name, v, { shouldDirty: true });
                        form.clearErrors(f.name);
                        // A dependent reference becomes invalid when its parent changes.
                        for (const dep of config.fields) {
                          if (dep.refFilter?.field === f.name) form.setValue(dep.name, '');
                        }
                      }}
                      values={values}
                      disabled={locked ?? false}
                    />
                  ) : f.kind === 'select' ? (
                    <Select
                      {...form.register(f.name)}
                      value={values[f.name] ?? ''}
                      options={f.options ?? []}
                      disabled={locked ?? false}
                    />
                  ) : f.kind === 'textarea' ? (
                    <Textarea {...form.register(f.name)} placeholder={f.placeholder} />
                  ) : (
                    <Input
                      {...form.register(f.name)}
                      inputMode={f.kind === 'number' ? 'numeric' : undefined}
                      placeholder={f.placeholder}
                      disabled={locked ?? false}
                    />
                  )}
                </FormField>
              );
            })}
          {editing ? (
            <FormField label="Status" error={errorOf('status')}>
              <Select
                {...form.register('status')}
                value={values.status ?? ''}
                options={STATUS_OPTIONS}
              />
            </FormField>
          ) : null}
        </FormGrid>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
          {editing ? 'Save changes' : `Create ${config.singular}`}
        </Button>
      </DialogFooter>
    </form>
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
