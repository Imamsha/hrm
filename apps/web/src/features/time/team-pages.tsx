import type {
  AttendanceStatusValue,
  EmployeeRef,
  ShiftAssignmentItem,
  ShiftItem,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@hrm/ui-web';
import { createShiftSchema, manualPunchSchema, updateShiftSchema } from '@hrm/validation';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { useRefOptions } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import { AttendanceMonth } from './my-attendance-page';
import {
  clock,
  hm,
  localToIso,
  STATUS_STYLE,
  TIME,
  useAssignments,
  useShifts,
  useSummary,
} from './time-api';

const today = () => new Date().toISOString().slice(0, 10);

function ManualPunchForm({ employee, onDone }: { employee: EmployeeRef; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [at, setAt] = useState('');
  const [direction, setDirection] = useState('IN');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.post(`/employees/${employee.id}/attendance/punches`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TIME });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Date and time" required>
            <Input
              type="datetime-local"
              value={at}
              onChange={(e) => {
                setAt(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Direction" required>
            <Select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
              }}
              options={[
                { value: 'IN', label: 'In' },
                { value: 'OUT', label: 'Out' },
              ]}
            />
          </FormField>
          <FormField
            label="Reason"
            required
            className="sm:col-span-2"
            description="Recorded in the audit log."
          >
            <Textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </FormField>
        </FormGrid>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const body = { punchedAt: at ? localToIso(at) : '', direction, note };
            const parsed = manualPunchSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues.map((i) => i.message).join('. '));
              return;
            }
            save.mutate(body);
          }}
        >
          Record punch
        </Button>
      </DialogFooter>
    </>
  );
}

/** Day overview of the team (scope) and drill-down into one employee's month. */
export function TeamAttendancePage() {
  const canManage = usePermission(PERMISSIONS.ATTENDANCE_RECORD_MANAGE);
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const [selected, setSelected] = useState<EmployeeRef | null>(null);
  const [punchFor, setPunchFor] = useState<EmployeeRef | null>(null);
  const departments = useRefOptions({ path: '/departments' });
  const summary = useSummary({ date, departmentId: departmentId || undefined });
  const counts = summary.data?.counts;
  return (
    <Page>
      <PageHeader
        title="Team attendance"
        description="Who is in today, who is late or absent, across the employees you can see."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Date">
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSelected(null);
            }}
            className="w-44"
          />
        </FormField>
        <FormField label="Department">
          <Select
            className="w-56"
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
            }}
            options={[{ value: '', label: 'All departments' }, ...(departments.data ?? [])]}
          />
        </FormField>
      </div>
      {summary.isPending ? (
        <Skeleton className="h-40" />
      ) : summary.isError ? (
        <ErrorState description={errorMessage(summary.error)} />
      ) : (
        <div className="flex flex-col gap-4">
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7"
            aria-label="Status counts"
          >
            {(Object.keys(STATUS_STYLE) as AttendanceStatusValue[]).map((s) => (
              <li key={s}>
                <Card>
                  <CardContent className="pt-3">
                    <p className="text-sm text-muted-foreground">{STATUS_STYLE[s].label}</p>
                    <p className="text-xl font-semibold tabular-nums">{counts?.[s] ?? 0}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Card>
            <CardHeader>
              <CardTitle>Employees</CardTitle>
              <span className="text-sm text-muted-foreground">
                {summary.data.late} late · {summary.data.missingPunches} missing punches
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {summary.data.employees.length === 0 ? (
                <EmptyState title="No employees" />
              ) : (
                <ul className="divide-y divide-border" aria-label="Employees attendance">
                  {summary.data.employees.map((e) => (
                    <li
                      key={e.employee.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left hover:underline"
                        onClick={() => {
                          setSelected(e.employee);
                        }}
                      >
                        <span className="font-medium">{e.employee.displayName}</span>{' '}
                        <span className="text-muted-foreground">{e.department ?? ''}</span>
                      </button>
                      <span className="text-muted-foreground tabular-nums">
                        {clock(e.firstIn)}–{clock(e.lastOut)}
                        {e.lateMinutes ? ` · late ${hm(e.lateMinutes)}` : ''}
                      </span>
                      <Badge variant="outline">{STATUS_STYLE[e.status].label}</Badge>
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPunchFor(e.employee);
                          }}
                        >
                          Add punch
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {selected ? (
            <section aria-label={`${selected.displayName} attendance`}>
              <h2 className="mb-2 text-md font-semibold">{selected.displayName}</h2>
              <AttendanceMonth
                key={selected.id}
                base={`/employees/${selected.id}/attendance/days`}
                self={false}
              />
            </section>
          ) : null}
        </div>
      )}
      <Dialog
        open={punchFor !== null}
        onOpenChange={(o) => {
          if (!o) setPunchFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Record a manual punch" description={punchFor?.displayName} />
          {punchFor ? (
            <ManualPunchForm
              employee={punchFor}
              onDone={() => {
                setPunchFor(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ shifts

const shiftFields: FieldDef[] = [
  { name: 'code', label: 'Code', required: true, placeholder: 'GEN' },
  { name: 'name', label: 'Name', required: true },
  { name: 'startTime', label: 'Starts', kind: 'time', required: true },
  {
    name: 'endTime',
    label: 'Ends',
    kind: 'time',
    required: true,
    description: 'Earlier than the start = ends next day.',
  },
  { name: 'breakMinutes', label: 'Break (minutes)', kind: 'number', required: true },
  {
    name: 'fullDayMinutes',
    label: 'Full day needs (minutes worked)',
    kind: 'number',
    required: true,
  },
  {
    name: 'halfDayMinutes',
    label: 'Half day needs (minutes worked)',
    kind: 'number',
    required: true,
  },
  { name: 'graceInMinutes', label: 'Late after (grace, minutes)', kind: 'number', required: true },
  { name: 'graceOutMinutes', label: 'Early exit grace (minutes)', kind: 'number', required: true },
  {
    name: 'overtimeAfterMinutes',
    label: 'Overtime after (minutes beyond shift)',
    kind: 'number',
    description: 'Empty = no overtime.',
  },
  {
    name: 'windowBeforeMinutes',
    label: 'Accept punches from (minutes before start)',
    kind: 'number',
    required: true,
  },
  {
    name: 'windowAfterMinutes',
    label: 'Accept punches until (minutes after end)',
    kind: 'number',
    required: true,
  },
  { name: 'isDefault', label: 'Organization default shift', kind: 'checkbox' },
];

const emptyShift = {
  code: '',
  name: '',
  startTime: '',
  endTime: '',
  breakMinutes: '60',
  fullDayMinutes: '',
  halfDayMinutes: '',
  graceInMinutes: '0',
  graceOutMinutes: '0',
  overtimeAfterMinutes: '',
  windowBeforeMinutes: '240',
  windowAfterMinutes: '360',
  isDefault: 'false',
};

const shiftValues = (s: ShiftItem) => ({
  code: s.code,
  name: s.name,
  startTime: s.startTime,
  endTime: s.endTime,
  breakMinutes: String(s.breakMinutes),
  fullDayMinutes: String(s.fullDayMinutes),
  halfDayMinutes: String(s.halfDayMinutes),
  graceInMinutes: String(s.graceInMinutes),
  graceOutMinutes: String(s.graceOutMinutes),
  overtimeAfterMinutes: s.overtimeAfterMinutes === null ? '' : String(s.overtimeAfterMinutes),
  windowBeforeMinutes: String(s.windowBeforeMinutes),
  windowAfterMinutes: String(s.windowAfterMinutes),
  isDefault: String(s.isDefault),
  status: s.status,
});

/** One employee per assignment in the UI; the API accepts lists for bulk assignment. */
const assignFormSchema = z
  .object({
    employeeId: z.uuid('Select an employee'),
    shiftId: z.uuid('Select a shift'),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: 'The end date cannot be before the start date',
    path: ['effectiveTo'],
  });

const assignFields: FieldDef[] = [
  {
    name: 'employeeId',
    label: 'Employee',
    kind: 'ref',
    required: true,
    ref: {
      path: '/employees',
      label: (r) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
    },
    refParams: { status: 'ACTIVE' },
    wide: true,
  },
  {
    name: 'shiftId',
    label: 'Shift',
    kind: 'ref',
    required: true,
    ref: { path: '/shifts', paged: false },
  },
  { name: 'effectiveFrom', label: 'From', kind: 'date', required: true },
  { name: 'effectiveTo', label: 'Until', kind: 'date', description: 'Empty = until changed.' },
];

function ShiftDefinitions({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const shifts = useShifts();
  const [editing, setEditing] = useState<ShiftItem | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (s: ShiftItem) => api.delete(`/shifts/${s.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus /> New shift
          </Button>
        </div>
      ) : null}
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      {shifts.isPending ? (
        <Skeleton className="h-24" />
      ) : shifts.isError ? (
        <ErrorState description={errorMessage(shifts.error)} />
      ) : shifts.data.length === 0 ? (
        <EmptyState
          title="No shifts yet"
          description="Without a shift, attendance only records presence by punches."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Shifts">
          {shifts.data.map((s) => (
            <li key={s.id}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    {s.name}{' '}
                    <span className="font-mono text-sm text-muted-foreground">{s.code}</span>
                  </CardTitle>
                  {s.isDefault ? <Badge variant="primary">Default</Badge> : null}
                  {s.status === 'INACTIVE' ? <Badge>Inactive</Badge> : null}
                  {canManage ? (
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${s.name}`}
                        onClick={() => {
                          setEditing(s);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${s.name}`}
                        onClick={() => {
                          remove.mutate(s);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {s.startTime}–{s.endTime}
                  {s.crossesMidnight ? ' (next day)' : ''} · break {s.breakMinutes} min · full day{' '}
                  {hm(s.fullDayMinutes)} · half {hm(s.halfDayMinutes)} · grace {s.graceInMinutes}{' '}
                  min
                  {s.overtimeAfterMinutes !== null
                    ? ` · overtime after +${String(s.overtimeAfterMinutes)} min`
                    : ''}{' '}
                  · {s.assignmentCount} assignments
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
          {editing ? (
            <>
              <DialogHeader
                title={editing === 'new' ? 'New shift' : `Edit ${editing.name}`}
                description="Times are local to each employee's branch."
              />
              <ResourceForm
                fields={shiftFields}
                defaultValues={editing === 'new' ? emptyShift : shiftValues(editing)}
                schema={editing === 'new' ? createShiftSchema : updateShiftSchema}
                submit={(body) =>
                  editing === 'new'
                    ? api.post('/shifts', body)
                    : api.patch(`/shifts/${editing.id}`, body)
                }
                invalidate={[TIME]}
                submitLabel={editing === 'new' ? 'Create shift' : 'Save'}
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
    </div>
  );
}

function Assignments({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [assigning, setAssigning] = useState(false);
  const page = useAssignments({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });
  const remove = useMutation({
    mutationFn: (a: ShiftAssignmentItem) => api.delete(`/shift-assignments/${a.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME }),
  });
  const columns = useMemo<DataTableColumnDef<ShiftAssignmentItem>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        size: 220,
        cell: ({ row }) =>
          `${row.original.employee.displayName} (${row.original.employee.employeeNumber})`,
      },
      { id: 'shift', header: 'Shift', size: 160, cell: ({ row }) => row.original.shift.name },
      { id: 'from', header: 'From', size: 120, cell: ({ row }) => row.original.effectiveFrom },
      {
        id: 'to',
        header: 'Until',
        size: 120,
        cell: ({ row }) => row.original.effectiveTo ?? 'Open-ended',
      },
      {
        id: 'actions',
        header: '',
        size: 52,
        cell: ({ row }) =>
          canManage ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove assignment"
              onClick={() => {
                remove.mutate(row.original);
              }}
            >
              <Trash2 />
            </Button>
          ) : null,
      },
    ],
    [canManage, remove],
  );
  return (
    <>
      <DataTable
        aria-label="Shift assignments"
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
        emptyTitle="No assignments — employees use the default shift"
        toolbar={
          canManage ? (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                setAssigning(true);
              }}
            >
              <Plus /> Assign shift
            </Button>
          ) : null
        }
      />
      <Dialog open={assigning} onOpenChange={setAssigning}>
        <DialogContent>
          <DialogHeader
            title="Assign a shift"
            description="The employee's current assignment ends the day before."
          />
          {assigning ? (
            <ResourceForm
              fields={assignFields}
              defaultValues={{ employeeId: '', shiftId: '', effectiveFrom: '', effectiveTo: '' }}
              schema={assignFormSchema}
              submit={(body) => {
                const { employeeId, ...rest } = body;
                return api.post('/shift-assignments', { ...rest, employeeIds: [employeeId] });
              }}
              invalidate={[TIME]}
              submitLabel="Assign"
              onDone={() => {
                setAssigning(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ShiftsPage() {
  const canManage = usePermission(PERMISSIONS.SHIFTS_SHIFT_MANAGE);
  const [tab, setTab] = useState('shifts');
  return (
    <Page>
      <PageHeader
        title="Shifts"
        description="Shift timings, grace and overtime thresholds, and who works which shift."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Shift sections">
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
        </TabsList>
        <TabsContent value="shifts">
          {tab === 'shifts' ? <ShiftDefinitions canManage={canManage} /> : null}
        </TabsContent>
        <TabsContent value="assignments">
          {tab === 'assignments' ? <Assignments canManage={canManage} /> : null}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
