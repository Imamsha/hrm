import {
  type EmployeeDetails,
  type EmployeeListItem,
  type EmployeeStatusValue,
  PERMISSIONS,
} from '@hrm/shared-types';
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  type DataTableColumnDef,
  Dialog,
  DialogContent,
  DialogHeader,
  Input,
  type PaginationState,
  Select,
  type SortingState,
} from '@hrm/ui-web';
import { createEmployeeSchema, employeeSettingsSchema } from '@hrm/validation';
import { Hash, Search, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { useRefOptions } from '@/features/structure/api';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import { useEmployeeSettings, useEmployeesPage } from './api';
import { createEmployeeFields, emptyEmployee, settingsFields } from './employee-fields';
import { EMPLOYMENT_TYPE_LABEL, formatDate, options, STATUS_LABEL } from './labels';

export function EmployeeStatusBadge({ status }: { status: EmployeeStatusValue }) {
  const variant = status === 'ACTIVE' ? 'success' : status === 'ON_NOTICE' ? 'warning' : 'neutral';
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

function FilterRef({
  path,
  label,
  value,
  onChange,
}: {
  path: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const opts = useRefOptions({ path });
  return (
    <Select
      aria-label={`Filter by ${label.toLowerCase()}`}
      className="h-7 w-44"
      placeholder={`All ${label.toLowerCase()}`}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      options={opts.data ?? []}
    />
  );
}

/** Employee directory: server-side search, filters, sorting and pagination. */
export function EmployeesPage() {
  const navigate = useNavigate();
  const canCreate = usePermission(PERMISSIONS.EMPLOYEES_EMPLOYEE_CREATE);
  const canSettings = usePermission(PERMISSIONS.EMPLOYEES_SETTINGS_MANAGE);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<'create' | 'settings' | null>(null);
  const settings = useEmployeeSettings(dialog !== null && (canCreate || canSettings));

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
  const page = useEmployeesPage({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    sortBy: sort?.id,
    sortDir: sort?.desc ? 'desc' : 'asc',
    search: debounced || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  });
  const setFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  const columns = useMemo<DataTableColumnDef<EmployeeListItem>[]>(
    () => [
      {
        id: 'name',
        header: 'Employee',
        size: 260,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={row.original.displayName} />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.displayName}</p>
              <p className="truncate font-mono text-sm text-muted-foreground">
                {row.original.employeeNumber}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'designation',
        header: 'Designation',
        size: 180,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.job?.designation?.name ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: 'department',
        header: 'Department',
        size: 180,
        enableSorting: false,
        cell: ({ row }) => {
          const j = row.original.job;
          return j ? (
            <div className="min-w-0">
              <p className="truncate">{j.department?.name ?? '—'}</p>
              <p className="truncate text-sm text-muted-foreground">
                {[j.company.name, j.branch?.name].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: 'manager',
        header: 'Manager',
        size: 160,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.job?.manager?.displayName ?? (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
      },
      {
        id: 'dateOfJoining',
        header: 'Joined',
        size: 120,
        meta: { numeric: true },
        cell: ({ row }) => formatDate(row.original.dateOfJoining),
      },
    ],
    [],
  );

  const filtered = Boolean(debounced || Object.values(filters).some(Boolean));

  return (
    <Page>
      <PageHeader
        title="Employees"
        description="Everyone employed by your organization, with their current placement."
        actions={
          <>
            {canSettings ? (
              <Button
                variant="outline"
                onClick={() => {
                  setDialog('settings');
                }}
              >
                <Hash /> Numbering
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                onClick={() => {
                  setDialog('create');
                }}
              >
                <UserPlus /> Add employee
              </Button>
            ) : null}
          </>
        }
      />
      <DataTable
        aria-label="Employees"
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
        onRowActivate={(row) => void navigate(`/people/employees/${row.id}`)}
        emptyTitle={filtered ? 'No employees match your filters' : 'No employees yet'}
        emptyDescription={
          !filtered && canCreate ? 'Add your first employee to build the directory.' : undefined
        }
        toolbar={
          <>
            <div className="relative w-full max-w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search employees"
                placeholder="Name, number or e-mail"
                className="h-7 pl-7"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
              />
            </div>
            <FilterRef
              path="/companies"
              label="Companies"
              value={filters.companyId ?? ''}
              onChange={(v) => {
                setFilter('companyId', v);
              }}
            />
            <FilterRef
              path="/departments"
              label="Departments"
              value={filters.departmentId ?? ''}
              onChange={(v) => {
                setFilter('departmentId', v);
              }}
            />
            <Select
              aria-label="Filter by employment type"
              className="h-7 w-36"
              placeholder="All types"
              value={filters.employmentType ?? ''}
              onChange={(e) => {
                setFilter('employmentType', e.target.value);
              }}
              options={options(EMPLOYMENT_TYPE_LABEL)}
            />
            <Select
              aria-label="Filter by status"
              className="h-7 w-32"
              placeholder="All statuses"
              value={filters.status ?? ''}
              onChange={(e) => {
                setFilter('status', e.target.value);
              }}
              options={[{ value: '', label: 'All statuses' }, ...options(STATUS_LABEL)]}
            />
          </>
        }
      />

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size="lg">
          {dialog === 'create' ? (
            <>
              <DialogHeader
                title="Add employee"
                description={
                  settings.data
                    ? `Next number: ${settings.data.preview}`
                    : 'Records joining and the first job assignment.'
                }
              />
              <ResourceForm
                fields={createEmployeeFields}
                defaultValues={emptyEmployee}
                schema={createEmployeeSchema}
                submit={async (body) => {
                  const created = await api.post<EmployeeDetails>('/employees', body);
                  void navigate(`/people/employees/${created.id}`);
                  return created;
                }}
                invalidate={[['employees']]}
                submitLabel="Add employee"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'settings' ? (
            <>
              <DialogHeader
                title="Employee numbering"
                description={
                  settings.data ? `The next employee will be ${settings.data.preview}.` : undefined
                }
              />
              {settings.data ? (
                <ResourceForm
                  fields={settingsFields}
                  defaultValues={{
                    numberPrefix: settings.data.numberPrefix,
                    numberPadding: String(settings.data.numberPadding),
                    nextNumber: String(settings.data.nextNumber),
                  }}
                  schema={employeeSettingsSchema}
                  submit={(body) => api.put('/employees/settings', body)}
                  invalidate={[['employees', 'settings']]}
                  submitLabel="Save numbering"
                  onDone={() => {
                    setDialog(null);
                  }}
                />
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
