import type {
  LeavePreview,
  LeaveRequestItem,
  LeaveSessionValue,
  LeaveTypeItem,
  RegularizationItem,
} from '@hrm/shared-types';
import { PERMISSIONS } from '@hrm/shared-types';
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
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  type PaginationState,
  Select,
  Skeleton,
  Textarea,
} from '@hrm/ui-web';
import { createLeaveTypeSchema, timeSettingsSchema, updateLeaveTypeSchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, Inbox, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  clock,
  REQUEST_VARIANT,
  SESSION_LABEL,
  TIME,
  useBalances,
  useInbox,
  useLeaveRequests,
  useLeaveTypes,
  useTimeSettings,
} from './time-api';

const SESSION_OPTIONS = (Object.keys(SESSION_LABEL) as LeaveSessionValue[]).map((value) => ({
  value,
  label: SESSION_LABEL[value],
}));

function range(r: LeaveRequestItem): string {
  const s = r.startSession === 'FULL' ? '' : ` (${SESSION_LABEL[r.startSession].toLowerCase()})`;
  const e =
    r.endSession === 'FULL' || r.startDate === r.endDate
      ? ''
      : ` (${SESSION_LABEL[r.endSession].toLowerCase()})`;
  return r.startDate === r.endDate ? `${r.startDate}${s}` : `${r.startDate}${s} → ${r.endDate}${e}`;
}

// ------------------------------------------------------------------------------ apply

function ApplyForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const types = useLeaveTypes();
  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    startSession: 'FULL' as LeaveSessionValue,
    endSession: 'FULL' as LeaveSessionValue,
    reason: '',
  });
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const single = form.startDate !== '' && form.startDate === form.endDate;
  const body = {
    ...form,
    endDate: form.endDate || form.startDate,
    endSession: single ? form.startSession : form.endSession,
    reason: form.reason.trim() || null,
  };
  const ready = Boolean(form.leaveTypeId && form.startDate);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      api
        .post<LeavePreview>('/me/leave/requests/preview', body)
        .then((p) => {
          setPreview(p);
          setError(null);
        })
        .catch((e: unknown) => {
          setPreview(null);
          setError(errorMessage(e));
        });
    }, 300);
    return () => {
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- body is derived from form
  }, [form, ready]);

  const apply = useMutation({
    mutationFn: () => api.post('/me/leave/requests', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TIME });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
  };
  const type = types.data?.find((t) => t.id === form.leaveTypeId);
  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Leave type" required className="sm:col-span-2">
            <Select
              value={form.leaveTypeId}
              onChange={(e) => {
                set({ leaveTypeId: e.target.value });
              }}
              options={(types.data ?? []).map((t) => ({
                value: t.id,
                label: `${t.name}${t.isPaid ? '' : ' (unpaid)'}`,
              }))}
            />
          </FormField>
          <FormField label="From" required>
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => {
                set({ startDate: e.target.value, endDate: form.endDate || e.target.value });
              }}
            />
          </FormField>
          <FormField label="To" required>
            <Input
              type="date"
              value={form.endDate}
              min={form.startDate}
              onChange={(e) => {
                set({ endDate: e.target.value });
              }}
            />
          </FormField>
          {type?.allowHalfDay ? (
            <>
              <FormField label={single ? 'Day' : 'First day'}>
                <Select
                  value={form.startSession}
                  onChange={(e) => {
                    set({ startSession: e.target.value as LeaveSessionValue });
                  }}
                  options={
                    single
                      ? SESSION_OPTIONS
                      : SESSION_OPTIONS.filter((o) => o.value !== 'FIRST_HALF')
                  }
                />
              </FormField>
              {!single ? (
                <FormField label="Last day">
                  <Select
                    value={form.endSession}
                    onChange={(e) => {
                      set({ endSession: e.target.value as LeaveSessionValue });
                    }}
                    options={SESSION_OPTIONS.filter((o) => o.value !== 'SECOND_HALF')}
                  />
                </FormField>
              ) : null}
            </>
          ) : null}
          <FormField label="Reason" className="sm:col-span-2">
            <Textarea
              value={form.reason}
              onChange={(e) => {
                set({ reason: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        {preview ? (
          <div className="rounded-md border border-border p-3 text-sm" aria-live="polite">
            <p className="font-medium">{preview.days} day(s)</p>
            {preview.balance ? (
              <p className="text-muted-foreground">
                Available {preview.balance.available} · after this{' '}
                {(Number(preview.balance.available) - Number(preview.days)).toFixed(2)}
              </p>
            ) : (
              <p className="text-muted-foreground">No balance is tracked for this leave type.</p>
            )}
            {preview.problems.map((p) => (
              <p key={p} className="text-destructive">
                {p}
              </p>
            ))}
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!ready || apply.isPending}
          aria-busy={apply.isPending}
          onClick={() => {
            apply.mutate();
          }}
        >
          Apply
        </Button>
      </DialogFooter>
    </>
  );
}

// ------------------------------------------------------------------------------ requests list

function RequestList({
  items,
  onCancel,
  showEmployee,
}: {
  items: LeaveRequestItem[];
  onCancel?: (r: LeaveRequestItem) => void;
  showEmployee?: boolean;
}) {
  if (!items.length) return <p className="px-4 py-3 text-muted-foreground">No leave requests.</p>;
  return (
    <ul className="divide-y divide-border" aria-label="Leave requests">
      {items.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {showEmployee ? `${r.employee.displayName} · ` : ''}
              {r.leaveType.name} · {r.days} day(s)
            </p>
            <p className="text-muted-foreground">
              {range(r)}
              {r.reason ? ` · ${r.reason}` : ''}
              {r.approver && r.status === 'PENDING' ? ` · with ${r.approver.displayName}` : ''}
              {r.decidedBy ? ` · ${r.status.toLowerCase()} by ${r.decidedBy}` : ''}
            </p>
          </div>
          <Badge variant={REQUEST_VARIANT[r.status]}>{r.status.toLowerCase()}</Badge>
          {onCancel && (r.status === 'PENDING' || r.status === 'APPROVED') ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onCancel(r);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function MyLeavePage() {
  const queryClient = useQueryClient();
  const balances = useBalances('/me/leave/balances');
  const requests = useLeaveRequests('/me/leave/requests', { pageSize: 50, sortDir: 'desc' });
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: (r: LeaveRequestItem) => api.post(`/leave/requests/${r.id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <Page>
      <PageHeader
        title="My leave"
        description="Balances for the current leave year, applications and their status."
        actions={
          <Button
            onClick={() => {
              setApplying(true);
            }}
          >
            <CalendarPlus /> Apply for leave
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {balances.isPending ? (
          <Skeleton className="h-24" />
        ) : balances.isError ? (
          <ErrorState description={errorMessage(balances.error)} />
        ) : balances.data.length === 0 ? (
          <EmptyState title="No leave types yet" description="HR has not configured leave types." />
        ) : (
          <ul
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Leave balances"
          >
            {balances.data.map((b) => (
              <li key={b.leaveType.id}>
                <Card>
                  <CardContent className="flex flex-col gap-1 pt-4">
                    <p className="text-sm text-muted-foreground">{b.leaveType.name}</p>
                    {b.leaveType.tracksBalance ? (
                      <>
                        <p className="text-2xl font-semibold tabular-nums">{b.available}</p>
                        <p className="text-xs text-muted-foreground">
                          available · {b.used} used · {b.pending} pending
                        </p>
                      </>
                    ) : (
                      <p className="text-md">Not tracked</p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <Card>
          <CardHeader>
            <CardTitle>My requests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {requests.data ? (
              <RequestList
                items={requests.data.items}
                onCancel={(r) => {
                  cancel.mutate(r);
                }}
              />
            ) : (
              <Skeleton className="m-4 h-12" />
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog open={applying} onOpenChange={setApplying}>
        <DialogContent>
          <DialogHeader
            title="Apply for leave"
            description="Days are counted with your work week and holidays."
          />
          {applying ? (
            <ApplyForm
              onDone={() => {
                setApplying(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ approvals

function DecisionButtons({
  onDecide,
  pending,
}: {
  onDecide: (d: 'APPROVED' | 'REJECTED') => void;
  pending: boolean;
}) {
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          onDecide('APPROVED');
        }}
      >
        <Check /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          onDecide('REJECTED');
        }}
      >
        <X /> Reject
      </Button>
    </div>
  );
}

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const inbox = useInbox();
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (a: {
      kind: 'leave' | 'regularization';
      id: string;
      decision: 'APPROVED' | 'REJECTED';
    }) =>
      api.post(
        a.kind === 'leave'
          ? `/leave/requests/${a.id}/decision`
          : `/attendance/regularizations/${a.id}/decision`,
        {
          decision: a.decision,
        },
      ),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: TIME });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const empty = inbox.data && !inbox.data.leave.length && !inbox.data.regularizations.length;
  return (
    <Page>
      <PageHeader
        title="Approvals"
        description="Leave and attendance corrections waiting for your decision."
      />
      {error ? (
        <Alert tone="destructive" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {inbox.isPending ? (
        <Skeleton className="h-32" />
      ) : inbox.isError ? (
        <ErrorState description={errorMessage(inbox.error)} />
      ) : empty ? (
        <EmptyState
          icon={<Inbox />}
          title="Nothing to approve"
          description="Requests from your team appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {inbox.data.leave.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Leave</CardTitle>
                <Badge>{inbox.data.leave.length}</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border" aria-label="Leave approvals">
                  {inbox.data.leave.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {r.employee.displayName} · {r.leaveType.name} · {r.days} day(s)
                        </p>
                        <p className="text-muted-foreground">
                          {range(r)}
                          {r.reason ? ` · ${r.reason}` : ''}
                        </p>
                      </div>
                      <DecisionButtons
                        pending={decide.isPending}
                        onDecide={(d) => {
                          decide.mutate({ kind: 'leave', id: r.id, decision: d });
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {inbox.data.regularizations.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Attendance corrections</CardTitle>
                <Badge>{inbox.data.regularizations.length}</Badge>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border" aria-label="Regularization approvals">
                  {inbox.data.regularizations.map((r: RegularizationItem) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {r.employee.displayName} · {r.date}
                        </p>
                        <p className="text-muted-foreground">
                          {clock(r.requestedIn)}–{clock(r.requestedOut)} · {r.reason}
                        </p>
                      </div>
                      <DecisionButtons
                        pending={decide.isPending}
                        onDecide={(d) => {
                          decide.mutate({ kind: 'regularization', id: r.id, decision: d });
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------------------ HR: requests

export function LeaveRequestsPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [status, setStatus] = useState('PENDING');
  const page = useLeaveRequests('/leave/requests', {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    status: status || undefined,
    sortDir: 'desc',
  });
  const columns = useMemo<DataTableColumnDef<LeaveRequestItem>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        size: 200,
        cell: ({ row }) => row.original.employee.displayName,
      },
      { id: 'type', header: 'Type', size: 150, cell: ({ row }) => row.original.leaveType.name },
      { id: 'dates', header: 'Dates', size: 260, cell: ({ row }) => range(row.original) },
      {
        id: 'days',
        header: 'Days',
        size: 80,
        meta: { numeric: true },
        cell: ({ row }) => row.original.days,
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => (
          <Badge variant={REQUEST_VARIANT[row.original.status]}>
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
      {
        id: 'approver',
        header: 'Approver',
        size: 160,
        cell: ({ row }) => row.original.approver?.displayName ?? 'HR',
      },
    ],
    [],
  );
  return (
    <Page>
      <PageHeader
        title="Leave requests"
        description="Leave across the employees you can see. Decide pending requests in Approvals."
      />
      <DataTable
        aria-label="Leave requests"
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
        emptyTitle="No leave requests"
        toolbar={
          <Select
            aria-label="Filter by status"
            className="h-7 w-36"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPagination((p) => ({ ...p, pageIndex: 0 }));
            }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'PENDING', label: 'Pending' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
        }
      />
    </Page>
  );
}

// ------------------------------------------------------------------------------ policies

const ACCRUAL = [
  { value: 'YEARLY', label: 'Granted yearly' },
  { value: 'MONTHLY', label: 'Accrued monthly' },
  { value: 'NONE', label: 'No accrual (manual only)' },
];

const leaveTypeFields: FieldDef[] = [
  { name: 'code', label: 'Code', required: true, placeholder: 'CL', section: 'Leave type' },
  { name: 'name', label: 'Name', required: true, section: 'Leave type' },
  { name: 'description', label: 'Description', kind: 'textarea', section: 'Leave type' },
  { name: 'isPaid', label: 'Paid leave', kind: 'checkbox', section: 'Leave type' },
  { name: 'tracksBalance', label: 'Track a balance', kind: 'checkbox', section: 'Leave type' },
  {
    name: 'accrualMethod',
    label: 'Entitlement',
    kind: 'select',
    required: true,
    options: ACCRUAL,
    section: 'Entitlement',
  },
  { name: 'annualQuota', label: 'Days per leave year', required: true, section: 'Entitlement' },
  {
    name: 'carryForwardMax',
    label: 'Max carry forward (days)',
    description: 'Empty = nothing carries forward.',
    section: 'Entitlement',
  },
  {
    name: 'prorateOnJoining',
    label: 'Prorate yearly grant for joiners',
    kind: 'checkbox',
    section: 'Entitlement',
  },
  {
    name: 'allowNegativeBalance',
    label: 'Allow negative balance',
    kind: 'checkbox',
    section: 'Entitlement',
  },
  { name: 'allowHalfDay', label: 'Allow half days', kind: 'checkbox', section: 'Rules' },
  {
    name: 'countWeeklyOffs',
    label: 'Count weekly offs inside a leave',
    kind: 'checkbox',
    section: 'Rules',
  },
  {
    name: 'countHolidays',
    label: 'Count holidays inside a leave',
    kind: 'checkbox',
    section: 'Rules',
  },
  {
    name: 'allowDuringProbation',
    label: 'Available during probation',
    kind: 'checkbox',
    section: 'Rules',
  },
  {
    name: 'minNoticeDays',
    label: 'Minimum notice (days)',
    kind: 'number',
    required: true,
    section: 'Rules',
  },
  { name: 'maxConsecutiveDays', label: 'Max days per request', section: 'Rules' },
];

const emptyType = {
  code: '',
  name: '',
  description: '',
  isPaid: 'true',
  tracksBalance: 'true',
  accrualMethod: 'YEARLY',
  annualQuota: '0',
  carryForwardMax: '',
  prorateOnJoining: 'false',
  allowNegativeBalance: 'false',
  allowHalfDay: 'true',
  countWeeklyOffs: 'false',
  countHolidays: 'false',
  allowDuringProbation: 'true',
  minNoticeDays: '0',
  maxConsecutiveDays: '',
};

const typeValues = (t: LeaveTypeItem) => ({
  code: t.code,
  name: t.name,
  description: t.description ?? '',
  isPaid: String(t.isPaid),
  tracksBalance: String(t.tracksBalance),
  accrualMethod: t.accrualMethod,
  annualQuota: t.annualQuota,
  carryForwardMax: t.carryForwardMax ?? '',
  prorateOnJoining: String(t.prorateOnJoining),
  allowNegativeBalance: String(t.allowNegativeBalance),
  allowHalfDay: String(t.allowHalfDay),
  countWeeklyOffs: String(t.countWeeklyOffs),
  countHolidays: String(t.countHolidays),
  allowDuringProbation: String(t.allowDuringProbation),
  minNoticeDays: String(t.minNoticeDays),
  maxConsecutiveDays: t.maxConsecutiveDays ?? '',
  status: t.status,
});

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const settingsFields: FieldDef[] = [
  {
    name: 'leaveYearStartMonth',
    label: 'Leave year starts in',
    kind: 'select',
    required: true,
    options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
  },
  {
    name: 'qrRotationSeconds',
    label: 'Kiosk QR rotation (seconds)',
    kind: 'number',
    required: true,
  },
  { name: 'webPunchEnabled', label: 'Allow clock-in from the web', kind: 'checkbox' },
  { name: 'mobilePunchEnabled', label: 'Allow clock-in from the mobile app', kind: 'checkbox' },
  { name: 'qrPunchEnabled', label: 'Allow kiosk QR clock-in', kind: 'checkbox' },
  {
    name: 'geolocationRequired',
    label: 'Require location for web/mobile punches',
    kind: 'checkbox',
  },
];

export function LeavePoliciesPage() {
  const canSettings = usePermission(PERMISSIONS.ATTENDANCE_SETTINGS_MANAGE);
  const types = useLeaveTypes(true);
  const settings = useTimeSettings();
  const [editing, setEditing] = useState<LeaveTypeItem | 'new' | 'settings' | null>(null);
  return (
    <Page>
      <PageHeader
        title="Leave & attendance policies"
        description="Leave types are entirely your organization's policy — no statutory entitlement is assumed."
        actions={
          <>
            {canSettings ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditing('settings');
                }}
              >
                Settings
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus /> New leave type
            </Button>
          </>
        }
      />
      {settings.data ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Leave year starts in {MONTHS[settings.data.leaveYearStartMonth - 1]} · web{' '}
          {settings.data.webPunchEnabled ? 'on' : 'off'} · mobile{' '}
          {settings.data.mobilePunchEnabled ? 'on' : 'off'} · QR{' '}
          {settings.data.qrPunchEnabled ? 'on' : 'off'}
          {settings.data.geolocationRequired ? ' · location required' : ''}
        </p>
      ) : null}
      {types.isPending ? (
        <Skeleton className="h-32" />
      ) : types.isError ? (
        <ErrorState description={errorMessage(types.error)} />
      ) : types.data.length === 0 ? (
        <EmptyState
          title="No leave types yet"
          description="Create the leave types your policy defines (e.g. casual, sick, earned)."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Leave types">
          {types.data.map((t) => (
            <li key={t.id}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t.name}{' '}
                    <span className="font-mono text-sm text-muted-foreground">{t.code}</span>
                  </CardTitle>
                  {t.status === 'INACTIVE' ? (
                    <Badge>Inactive</Badge>
                  ) : !t.isPaid ? (
                    <Badge variant="outline">Unpaid</Badge>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${t.name}`}
                    onClick={() => {
                      setEditing(t);
                    }}
                  >
                    <Pencil />
                  </Button>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {t.tracksBalance
                    ? `${t.annualQuota} days/year, ${ACCRUAL.find((a) => a.value === t.accrualMethod)?.label.toLowerCase() ?? ''}; carry forward ${t.carryForwardMax ?? 'none'}`
                    : 'Balance not tracked'}
                  {t.minNoticeDays ? ` · ${String(t.minNoticeDays)} days notice` : ''}
                  {t.allowHalfDay ? ' · half days' : ''}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent size="lg">
          {editing === 'settings' ? (
            <>
              <DialogHeader title="Attendance & leave settings" />
              {settings.data ? (
                <ResourceForm
                  fields={settingsFields}
                  defaultValues={{
                    leaveYearStartMonth: String(settings.data.leaveYearStartMonth),
                    qrRotationSeconds: String(settings.data.qrRotationSeconds),
                    webPunchEnabled: String(settings.data.webPunchEnabled),
                    mobilePunchEnabled: String(settings.data.mobilePunchEnabled),
                    qrPunchEnabled: String(settings.data.qrPunchEnabled),
                    geolocationRequired: String(settings.data.geolocationRequired),
                  }}
                  schema={timeSettingsSchema}
                  submit={(body) => api.put('/attendance/settings', body)}
                  invalidate={[TIME]}
                  submitLabel="Save settings"
                  onDone={() => {
                    setEditing(null);
                  }}
                />
              ) : null}
            </>
          ) : editing ? (
            <>
              <DialogHeader title={editing === 'new' ? 'New leave type' : `Edit ${editing.name}`} />
              <ResourceForm
                fields={leaveTypeFields}
                defaultValues={editing === 'new' ? emptyType : typeValues(editing)}
                schema={editing === 'new' ? createLeaveTypeSchema : updateLeaveTypeSchema}
                submit={(body) =>
                  editing === 'new'
                    ? api.post('/leave/types', body)
                    : api.patch(`/leave/types/${editing.id}`, body)
                }
                invalidate={[TIME]}
                submitLabel={editing === 'new' ? 'Create' : 'Save'}
                onDone={() => {
                  setEditing(null);
                }}
                editing={editing !== 'new'}
                {...(editing !== 'new'
                  ? {
                      statusOptions: [
                        { value: 'ACTIVE', label: 'Active' },
                        { value: 'INACTIVE', label: 'Inactive' },
                      ],
                    }
                  : {})}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
