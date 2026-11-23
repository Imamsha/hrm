import {
  type ApplicationItem,
  type CandidateItem,
  type OpeningItem,
  PERMISSIONS,
  type RequisitionItem,
} from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumnDef,
  Dialog,
  DialogContent,
  DialogHeader,
  ErrorState,
  Input,
  type PaginationState,
  Select,
  Skeleton,
} from '@hrm/ui-web';
import {
  candidateSchema,
  createOpeningSchema,
  createRequisitionSchema,
  updateOpeningSchema,
  updateRequisitionSchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { Page, PageHeader } from '@/app/layout/page';
import { useAuth, usePermission } from '@/features/auth/auth-store';
import type { RefRow } from '@/features/structure/api';
import type { FieldDef, FormValues } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  formatMoney,
  RECRUIT,
  STAGE_LABEL,
  STAGES,
  STATUS_VARIANT,
  useApplications,
  useCandidates,
  useOpening,
  useOpenings,
  useRequisitions,
} from './recruit-api';

const P = PERMISSIONS;
const EMPLOYMENT = [
  { value: 'FULL_TIME', label: 'Full-time' },
  { value: 'PART_TIME', label: 'Part-time' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'INTERN', label: 'Intern' },
  { value: 'CONSULTANT', label: 'Consultant' },
];

function useSearch() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [search]);
  return { search, setSearch, debounced };
}

function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="relative w-full max-w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label={label}
        placeholder="Search"
        className="h-7 pl-7"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </div>
  );
}

const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant={STATUS_VARIANT[status] ?? 'neutral'}>
    {status.replace('_', ' ').toLowerCase()}
  </Badge>
);

// ------------------------------------------------------------------------------ requisitions

const companies = { path: '/companies' };
const placementFields: FieldDef[] = [
  { name: 'companyId', label: 'Company', kind: 'ref', ref: companies, required: true },
  {
    name: 'departmentId',
    label: 'Department',
    kind: 'ref',
    ref: { path: '/departments' },
    refFilter: { field: 'companyId', param: 'companyId' },
  },
  {
    name: 'branchId',
    label: 'Branch',
    kind: 'ref',
    ref: { path: '/branches' },
    refFilter: { field: 'companyId', param: 'companyId' },
  },
  {
    name: 'employmentType',
    label: 'Employment type',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: EMPLOYMENT,
  },
];

const requisitionFields: FieldDef[] = [
  { name: 'title', label: 'Role', required: true, wide: true },
  ...placementFields,
  { name: 'designationId', label: 'Designation', kind: 'ref', ref: { path: '/designations' } },
  { name: 'headcount', label: 'Headcount', kind: 'number', required: true },
  { name: 'targetDate', label: 'Hire by', kind: 'date' },
  { name: 'budgetMin', label: 'Budget from (annual)', placeholder: '1200000' },
  { name: 'budgetMax', label: 'Budget to (annual)', placeholder: '1800000' },
  { name: 'currency', label: 'Currency', required: true },
  { name: 'justification', label: 'Justification', kind: 'textarea' },
];

const reqValues = (r: RequisitionItem | null): FormValues =>
  r
    ? {
        title: r.title,
        companyId: r.company.id,
        departmentId: r.department?.id ?? '',
        branchId: r.branch?.id ?? '',
        employmentType: r.employmentType,
        designationId: r.designation?.id ?? '',
        headcount: String(r.headcount),
        targetDate: r.targetDate ?? '',
        budgetMin: r.budget.min ?? '',
        budgetMax: r.budget.max ?? '',
        currency: r.budget.currency,
        justification: r.justification ?? '',
      }
    : {
        title: '',
        companyId: '',
        departmentId: '',
        branchId: '',
        employmentType: '',
        designationId: '',
        headcount: '1',
        targetDate: '',
        budgetMin: '',
        budgetMax: '',
        currency: 'INR',
        justification: '',
      };

export function RequisitionsPage() {
  const queryClient = useQueryClient();
  const canManage = usePermission(P.RECRUITMENT_REQUISITION_MANAGE);
  const userId = useAuth((st) => st.session?.user.id);
  const canApprove = usePermission(P.RECRUITMENT_REQUISITION_APPROVE);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [status, setStatus] = useState('');
  const page = useRequisitions({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    status: status || undefined,
  });
  const [editing, setEditing] = useState<RequisitionItem | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (a: { id: string; path: string; body?: object }) =>
      api.post(`/recruitment/requisitions/${a.id}/${a.path}`, a.body ?? {}),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: RECRUIT });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const columns = useMemo<DataTableColumnDef<RequisitionItem>[]>(
    () => [
      {
        id: 'title',
        header: 'Role',
        size: 240,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        id: 'where',
        header: 'Department',
        size: 200,
        cell: ({ row }) =>
          [row.original.department?.name, row.original.company.name].filter(Boolean).join(' · '),
      },
      {
        id: 'headcount',
        header: 'Headcount',
        size: 100,
        meta: { numeric: true },
        cell: ({ row }) => row.original.headcount,
      },
      {
        id: 'budget',
        header: 'Budget',
        size: 220,
        cell: ({ row }) =>
          row.original.budget.min || row.original.budget.max
            ? `${formatMoney(row.original.budget.min, row.original.budget.currency)} – ${formatMoney(row.original.budget.max, row.original.budget.currency)}`
            : '—',
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: '',
        size: 220,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex gap-1">
              {canManage && (r.status === 'DRAFT' || r.status === 'REJECTED') ? (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setEditing(r);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      act.mutate({ id: r.id, path: 'submit' });
                    }}
                  >
                    Submit
                  </Button>
                </>
              ) : null}
              {canApprove && r.status === 'SUBMITTED' && r.requestedByUserId !== userId ? (
                <>
                  <Button
                    size="xs"
                    onClick={() => {
                      act.mutate({ id: r.id, path: 'decision', body: { decision: 'APPROVED' } });
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      act.mutate({ id: r.id, path: 'decision', body: { decision: 'REJECTED' } });
                    }}
                  >
                    Reject
                  </Button>
                </>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canManage, canApprove, act, userId],
  );
  return (
    <Page>
      <PageHeader
        title="Requisitions"
        description="Requests to hire, approved before openings are published."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus /> New requisition
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <DataTable
        aria-label="Requisitions"
        mode="server"
        columns={columns}
        data={page.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={page.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={page.isPending}
        isFetching={page.isFetching}
        error={page.isError ? errorMessage(page.error) : null}
        emptyTitle="No requisitions"
        toolbar={
          <Select
            aria-label="Filter by status"
            className="h-7 w-36"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
            options={['', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FILLED', 'CANCELLED'].map(
              (s) => ({ value: s, label: s ? s.toLowerCase() : 'All statuses' }),
            )}
          />
        }
      />
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader title={editing === 'new' ? 'New requisition' : 'Edit requisition'} />
          {editing ? (
            <ResourceForm
              fields={requisitionFields}
              defaultValues={reqValues(editing === 'new' ? null : editing)}
              schema={editing === 'new' ? createRequisitionSchema : updateRequisitionSchema}
              submit={(body) =>
                editing === 'new'
                  ? api.post('/recruitment/requisitions', body)
                  : api.patch(`/recruitment/requisitions/${editing.id}`, body)
              }
              invalidate={[RECRUIT]}
              submitLabel={editing === 'new' ? 'Create' : 'Save'}
              onDone={() => {
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ openings

const openingFields: FieldDef[] = [
  { name: 'title', label: 'Job title', required: true, wide: true },
  {
    name: 'requisitionId',
    label: 'Requisition',
    kind: 'ref',
    ref: {
      path: '/recruitment/requisitions',
      sortBy: 'createdAt',
      label: (r: RefRow) => String(r.title),
    },
    refParams: { status: 'APPROVED' },
    description: 'Approved requisitions only.',
  },
  ...placementFields,
  { name: 'location', label: 'Location (shown publicly)' },
  { name: 'positions', label: 'Positions', kind: 'number', required: true },
  { name: 'experienceMinYears', label: 'Experience from (years)', kind: 'number' },
  { name: 'experienceMaxYears', label: 'Experience to (years)', kind: 'number' },
  { name: 'salaryMin', label: 'Salary from (annual)' },
  { name: 'salaryMax', label: 'Salary to (annual)' },
  { name: 'currency', label: 'Currency', required: true },
  { name: 'showSalary', label: 'Show salary on the career site', kind: 'checkbox' },
  { name: 'closesOn', label: 'Applications close on', kind: 'date' },
  { name: 'description', label: 'Description', kind: 'textarea', required: true },
  { name: 'requirements', label: 'Requirements', kind: 'textarea' },
];

const openingValues = (o: OpeningItem | null): FormValues =>
  o
    ? {
        title: o.title,
        requisitionId: o.requisition?.id ?? '',
        companyId: o.company.id,
        departmentId: o.department?.id ?? '',
        branchId: o.branch?.id ?? '',
        employmentType: o.employmentType,
        location: o.location ?? '',
        positions: String(o.positions),
        experienceMinYears: o.experienceMinYears === null ? '' : String(o.experienceMinYears),
        experienceMaxYears: o.experienceMaxYears === null ? '' : String(o.experienceMaxYears),
        salaryMin: o.salary.min ?? '',
        salaryMax: o.salary.max ?? '',
        currency: o.salary.currency,
        showSalary: String(o.showSalary),
        closesOn: o.closesOn ?? '',
        description: o.description,
        requirements: o.requirements ?? '',
      }
    : {
        title: '',
        requisitionId: '',
        companyId: '',
        departmentId: '',
        branchId: '',
        employmentType: '',
        location: '',
        positions: '1',
        experienceMinYears: '',
        experienceMaxYears: '',
        salaryMin: '',
        salaryMax: '',
        currency: 'INR',
        showSalary: 'false',
        closesOn: '',
        description: '',
        requirements: '',
      };

export function OpeningsPage() {
  const navigate = useNavigate();
  const canManage = usePermission(P.RECRUITMENT_OPENING_MANAGE);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [status, setStatus] = useState('');
  const { search, setSearch, debounced } = useSearch();
  const page = useOpenings({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    status: status || undefined,
    search: debounced || undefined,
  });
  const [creating, setCreating] = useState(false);
  const columns = useMemo<DataTableColumnDef<OpeningItem>[]>(
    () => [
      {
        id: 'title',
        header: 'Opening',
        size: 260,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        id: 'where',
        header: 'Department',
        size: 200,
        cell: ({ row }) =>
          [row.original.department?.name, row.original.location ?? row.original.branch?.name]
            .filter(Boolean)
            .join(' · ') || row.original.company.name,
      },
      {
        id: 'pipeline',
        header: 'Pipeline',
        size: 260,
        cell: ({ row }) => {
          const p = row.original.pipeline;
          return `${String(p.APPLIED + p.SCREENING)} new · ${String(p.ASSESSMENT + p.INTERVIEW)} interviewing · ${String(p.OFFER)} offer · ${String(p.HIRED)}/${String(row.original.positions)} hired`;
        },
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );
  return (
    <Page>
      <PageHeader
        title="Job openings"
        description="Published openings appear on your public career site."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> New opening
            </Button>
          ) : null
        }
      />
      <DataTable
        aria-label="Job openings"
        mode="server"
        columns={columns}
        data={page.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={page.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={page.isPending}
        isFetching={page.isFetching}
        error={page.isError ? errorMessage(page.error) : null}
        onRowActivate={(r) => void navigate(`/recruitment/openings/${r.id}`)}
        emptyTitle="No openings yet"
        toolbar={
          <>
            <SearchBox value={search} onChange={setSearch} label="Search openings" />
            <Select
              aria-label="Filter by status"
              className="h-7 w-36"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
              options={['', 'DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED'].map((s) => ({
                value: s,
                label: s ? s.replace('_', ' ').toLowerCase() : 'All statuses',
              }))}
            />
          </>
        }
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="New job opening" />
          {creating ? (
            <ResourceForm
              fields={openingFields}
              defaultValues={openingValues(null)}
              schema={createOpeningSchema}
              submit={async (body) => {
                const o = await api.post<OpeningItem>('/recruitment/openings', body);
                void navigate(`/recruitment/openings/${o.id}`);
                return o;
              }}
              invalidate={[RECRUIT]}
              submitLabel="Create opening"
              onDone={() => {
                setCreating(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

const addCandidateSchema = z.object({ candidateId: z.uuid('Select a candidate') });

/** One opening: details, status actions and the pipeline board. */
export function OpeningPipelinePage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const canManage = usePermission(P.RECRUITMENT_OPENING_MANAGE);
  const canCandidates = usePermission(P.RECRUITMENT_CANDIDATE_MANAGE);
  const opening = useOpening(id);
  const orgSlug = useAuth((st) => st.session?.activeOrganization?.organizationSlug);
  const apps = useApplications({ openingId: id, pageSize: 200 });
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useMutation({
    mutationFn: (s: string) => api.put(`/recruitment/openings/${id}/status`, { status: s }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECRUIT }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  if (opening.isPending)
    return (
      <Page>
        <Skeleton className="h-64" />
      </Page>
    );
  if (opening.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(opening.error)} />
      </Page>
    );
  const o = opening.data;
  const byStage = (s: string) => (apps.data?.items ?? []).filter((a) => a.stage === s);
  const closed = (apps.data?.items ?? []).filter(
    (a) => a.stage === 'REJECTED' || a.stage === 'WITHDRAWN',
  );
  return (
    <Page>
      <PageHeader
        title={o.title}
        description={`${[o.department?.name, o.location ?? o.branch?.name, o.company.name].filter(Boolean).join(' · ')} · ${String(o.positions)} position(s)`}
        actions={
          <>
            <StatusBadge status={o.status} />
            {o.status === 'PUBLISHED' && orgSlug ? (
              <Link
                to={`/careers/${orgSlug}/${o.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline"
              >
                Career site page
              </Link>
            ) : null}
            {canManage ? (
              <>
                {o.status !== 'PUBLISHED' ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      status.mutate('PUBLISHED');
                    }}
                  >
                    Publish
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      status.mutate('ON_HOLD');
                    }}
                  >
                    Put on hold
                  </Button>
                )}
                {o.status !== 'CLOSED' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      status.mutate('CLOSED');
                    }}
                  >
                    Close
                  </Button>
                ) : null}
                {o.status !== 'CLOSED' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDialog('edit');
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
              </>
            ) : null}
            {canCandidates && o.status !== 'CLOSED' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog('add');
                }}
              >
                <Plus /> Add candidate
              </Button>
            ) : null}
          </>
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Pipeline">
        {STAGES.map((s) => (
          <Card key={s}>
            <CardHeader>
              <CardTitle>{STAGE_LABEL[s]}</CardTitle>
              <Badge>{byStage(s).length}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 p-2">
              <ul className="flex flex-col gap-2" aria-label={`${STAGE_LABEL[s]} candidates`}>
                {byStage(s).map((a: ApplicationItem) => (
                  <li key={a.id}>
                    <Link
                      to={`/recruitment/applications/${a.id}`}
                      className="block rounded-md border border-border p-2 text-sm hover:bg-accent"
                    >
                      <span className="block font-medium">{a.candidate.displayName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {a.feedback.averageRating !== null
                          ? `★ ${String(a.feedback.averageRating)} · `
                          : ''}
                        {new Date(a.appliedAt).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      {closed.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {closed.length} rejected or withdrawn:{' '}
          {closed.map((a, i) => (
            <span key={a.id}>
              {i > 0 ? ', ' : ''}
              <Link className="hover:underline" to={`/recruitment/applications/${a.id}`}>
                {a.candidate.displayName}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent size={dialog === 'edit' ? 'lg' : 'md'}>
          {dialog === 'edit' ? (
            <>
              <DialogHeader title="Edit opening" />
              <ResourceForm
                fields={openingFields}
                defaultValues={openingValues(o)}
                schema={updateOpeningSchema}
                submit={(body) => api.patch(`/recruitment/openings/${id}`, body)}
                invalidate={[RECRUIT]}
                submitLabel="Save"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'add' ? (
            <>
              <DialogHeader title="Add a candidate to this opening" />
              <ResourceForm
                fields={[
                  {
                    name: 'candidateId',
                    label: 'Candidate',
                    kind: 'ref',
                    required: true,
                    ref: {
                      path: '/recruitment/candidates',
                      sortBy: 'createdAt',
                      label: (r: RefRow) => `${String(r.displayName)} (${String(r.email)})`,
                    },
                    wide: true,
                  },
                ]}
                defaultValues={{ candidateId: '' }}
                schema={addCandidateSchema}
                submit={(body) => api.post('/recruitment/applications', { ...body, openingId: id })}
                invalidate={[RECRUIT]}
                submitLabel="Add"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ candidates

const candidateFields: FieldDef[] = [
  { name: 'firstName', label: 'First name', required: true },
  { name: 'lastName', label: 'Last name' },
  { name: 'email', label: 'E-mail', kind: 'email', required: true },
  { name: 'phone', label: 'Phone' },
  { name: 'currentCompany', label: 'Current company' },
  { name: 'currentTitle', label: 'Current title' },
  { name: 'totalExperienceMonths', label: 'Experience (months)', kind: 'number' },
  { name: 'location', label: 'Location' },
  {
    name: 'source',
    label: 'Source',
    kind: 'select',
    required: true,
    options: [
      { value: 'DIRECT', label: 'Direct' },
      { value: 'REFERRAL', label: 'Referral' },
      { value: 'AGENCY', label: 'Agency' },
      { value: 'OTHER', label: 'Other' },
    ],
  },
  { name: 'sourceDetail', label: 'Source detail', placeholder: 'e.g. referred by …' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
];

export function CandidatesPage() {
  const navigate = useNavigate();
  const canManage = usePermission(P.RECRUITMENT_CANDIDATE_MANAGE);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const { search, setSearch, debounced } = useSearch();
  const page = useCandidates({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debounced || undefined,
  });
  const [creating, setCreating] = useState(false);
  const columns = useMemo<DataTableColumnDef<CandidateItem>[]>(
    () => [
      {
        id: 'name',
        header: 'Candidate',
        size: 260,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.displayName}</p>
            <p className="truncate text-sm text-muted-foreground">{row.original.email}</p>
          </div>
        ),
      },
      {
        id: 'current',
        header: 'Current role',
        size: 220,
        cell: ({ row }) =>
          [row.original.currentTitle, row.original.currentCompany].filter(Boolean).join(' · ') ||
          '—',
      },
      {
        id: 'source',
        header: 'Source',
        size: 120,
        cell: ({ row }) => row.original.source.replace('_', ' ').toLowerCase(),
      },
      {
        id: 'apps',
        header: 'Applications',
        size: 110,
        meta: { numeric: true },
        cell: ({ row }) => row.original.applicationCount,
      },
      {
        id: 'resume',
        header: 'Resume',
        size: 90,
        cell: ({ row }) => (row.original.hasResume ? 'Yes' : '—'),
      },
      {
        id: 'employee',
        header: 'Hired',
        size: 90,
        cell: ({ row }) =>
          row.original.employee ? <Badge variant="success">Employee</Badge> : null,
      },
    ],
    [],
  );
  return (
    <Page>
      <PageHeader
        title="Candidates"
        description="Everyone who applied or was added. Decisions on candidates are always made by people."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> Add candidate
            </Button>
          ) : null
        }
      />
      <DataTable
        aria-label="Candidates"
        mode="server"
        columns={columns}
        data={page.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={page.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={page.isPending}
        isFetching={page.isFetching}
        error={page.isError ? errorMessage(page.error) : null}
        onRowActivate={(r) => void navigate(`/recruitment/applications?candidateId=${r.id}`)}
        emptyTitle="No candidates yet"
        toolbar={<SearchBox value={search} onChange={setSearch} label="Search candidates" />}
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader
            title="Add a candidate"
            description="Record only data the candidate agreed to share."
          />
          {creating ? (
            <ResourceForm
              fields={candidateFields}
              defaultValues={Object.fromEntries(
                candidateFields.map((f) => [f.name, f.name === 'source' ? 'DIRECT' : '']),
              )}
              schema={candidateSchema}
              submit={(body) => api.post('/recruitment/candidates', body)}
              invalidate={[RECRUIT]}
              submitLabel="Add candidate"
              onDone={() => {
                setCreating(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

/** Applications list (all, or one candidate's), linking to the application workspace. */
export function ApplicationsListPage() {
  const params = new URLSearchParams(window.location.search);
  const candidateId = params.get('candidateId') ?? undefined;
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [stage, setStage] = useState('');
  const { search, setSearch, debounced } = useSearch();
  const navigate = useNavigate();
  const page = useApplications({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    stage: stage || undefined,
    candidateId,
    search: debounced || undefined,
  });
  const columns = useMemo<DataTableColumnDef<ApplicationItem>[]>(
    () => [
      {
        id: 'candidate',
        header: 'Candidate',
        size: 240,
        cell: ({ row }) => row.original.candidate.displayName,
      },
      {
        id: 'opening',
        header: 'Opening',
        size: 240,
        cell: ({ row }) => row.original.opening.title,
      },
      {
        id: 'stage',
        header: 'Stage',
        size: 120,
        cell: ({ row }) => <Badge variant="outline">{STAGE_LABEL[row.original.stage]}</Badge>,
      },
      {
        id: 'rating',
        header: 'Rating',
        size: 90,
        cell: ({ row }) => row.original.feedback.averageRating ?? '—',
      },
      {
        id: 'updated',
        header: 'Updated',
        size: 120,
        cell: ({ row }) => new Date(row.original.updatedAt).toLocaleDateString(),
      },
    ],
    [],
  );
  return (
    <Page>
      <PageHeader title="Applications" description="Every application across openings." />
      <DataTable
        aria-label="Applications"
        mode="server"
        columns={columns}
        data={page.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={page.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={page.isPending}
        isFetching={page.isFetching}
        error={page.isError ? errorMessage(page.error) : null}
        onRowActivate={(r) => void navigate(`/recruitment/applications/${r.id}`)}
        emptyTitle="No applications"
        toolbar={
          <>
            <SearchBox value={search} onChange={setSearch} label="Search applications" />
            <Select
              aria-label="Filter by stage"
              className="h-7 w-36"
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
              }}
              options={[
                { value: '', label: 'All stages' },
                ...Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </>
        }
      />
    </Page>
  );
}
