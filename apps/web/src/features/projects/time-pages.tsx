import type { TimesheetItem } from '@hrm/shared-types';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@hrm/ui-web';
import { timesheetSchema } from '@hrm/validation';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { api } from '@/lib/api';
import {
  addDays,
  label,
  mondayOf,
  todayLocal,
  useMyTimesheet,
  useProjects,
  useTimeReport,
  useTimesheets,
  VARIANT,
  useAct,
} from './projects-api';

const P = PERMISSIONS;
const Status = ({ s }: { s: string }) => (
  <Badge variant={VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);
const dayName = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

interface Row {
  key: string;
  date: string;
  projectId: string;
  hours: string;
  billable: boolean;
  note: string;
}

function WeekEditor({ sheet }: { sheet: TimesheetItem }) {
  const projects = useProjects({ mine: true });
  const { error, setError, run } = useAct();
  const days = Array.from({ length: 7 }, (_, i) => addDays(sheet.weekStart, i));
  const [rows, setRows] = useState<Row[]>(
    sheet.entries.map((e) => ({
      key: e.id,
      date: e.date,
      projectId: e.project.id,
      hours: e.hours,
      billable: e.billable,
      note: e.note ?? '',
    })),
  );
  const editable = sheet.can.edit;
  const open = (projects.data ?? []).filter(
    (p) =>
      p.myRole && p.myRole !== 'VIEWER' && p.status !== 'COMPLETED' && p.status !== 'CANCELLED',
  );
  const set = (i: number, patch: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const body = () => ({
    weekStart: sheet.weekStart,
    entries: rows.map((r) => ({
      date: r.date,
      projectId: r.projectId,
      hours: r.hours,
      billable: r.billable,
      note: r.note || null,
    })),
  });
  const total = rows.reduce((a, r) => a + (Number(r.hours) || 0), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entries</CardTitle>
        <span className="text-sm text-muted-foreground">{total.toFixed(2)} h this week</span>
        <Status s={sheet.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sheet.status === 'REJECTED' && sheet.decisionNote ? (
          <Alert tone="warning">Returned: {sheet.decisionNote}</Alert>
        ) : null}
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {rows.map((r, i) => (
          <div
            key={r.key}
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={`Entry ${String(i + 1)}`}
          >
            <Select
              aria-label="Day"
              className="w-32"
              disabled={!editable}
              value={r.date}
              options={days.map((d) => ({ value: d, label: dayName(d) }))}
              onChange={(e) => {
                set(i, { date: e.target.value });
              }}
            />
            <Select
              aria-label="Project"
              className="w-56"
              disabled={!editable}
              value={r.projectId}
              placeholder="Project…"
              options={[
                ...open,
                ...(projects.data ?? []).filter((p) => p.id === r.projectId && !open.includes(p)),
              ].map((p) => ({ value: p.id, label: `${p.name} (${p.key})` }))}
              onChange={(e) => {
                const p = projects.data?.find((x) => x.id === e.target.value);
                set(i, {
                  projectId: e.target.value,
                  billable: p ? p.billingType !== 'NON_BILLABLE' : r.billable,
                });
              }}
            />
            <Input
              aria-label="Hours"
              className="w-20"
              disabled={!editable}
              value={r.hours}
              onChange={(e) => {
                set(i, { hours: e.target.value });
              }}
            />
            <label className="flex items-center gap-1 text-sm">
              <Checkbox
                disabled={!editable}
                checked={r.billable}
                onCheckedChange={(c) => {
                  set(i, { billable: c === true });
                }}
              />{' '}
              billable
            </label>
            <Input
              aria-label="Note"
              className="min-w-40 flex-1"
              disabled={!editable}
              value={r.note}
              onChange={(e) => {
                set(i, { note: e.target.value });
              }}
            />
            {editable ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove entry ${String(i + 1)}`}
                onClick={() => {
                  setRows(rows.filter((_, j) => j !== i));
                }}
              >
                <X />
              </Button>
            ) : null}
          </div>
        ))}
        {!rows.length ? <p className="text-sm text-muted-foreground">No time yet.</p> : null}
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRows([
                    ...rows,
                    {
                      key: `n${String(Date.now())}`,
                      date: days.includes(todayLocal()) ? todayLocal() : sheet.weekStart,
                      projectId: open[0]?.id ?? '',
                      hours: '',
                      billable: open[0] ? open[0].billingType !== 'NON_BILLABLE' : true,
                      note: '',
                    },
                  ]);
                }}
              >
                <Plus /> Add time
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const parsed = timesheetSchema.safeParse(body());
                  if (!parsed.success) {
                    setError(parsed.error.issues[0]?.message ?? 'Check the entries');
                    return;
                  }
                  run.mutate(() => api.put('/me/timesheet', body()));
                }}
              >
                Save
              </Button>
              {sheet.id && sheet.entries.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    run.mutate(() => api.post(`/timesheets/${sheet.id ?? ''}/submit`, {}));
                  }}
                >
                  Submit for approval
                </Button>
              ) : null}
            </>
          ) : null}
          {sheet.status === 'SUBMITTED' && sheet.id ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                run.mutate(() => api.post(`/timesheets/${sheet.id ?? ''}/recall`, {}));
              }}
            >
              Recall
            </Button>
          ) : null}
        </div>
        {sheet.approver && sheet.status === 'SUBMITTED' ? (
          <p className="text-sm text-muted-foreground">Waiting for {sheet.approver.displayName}.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function MyTimesheetPage() {
  const [week, setWeek] = useState(mondayOf(todayLocal()));
  const sheet = useMyTimesheet(week);
  return (
    <Page>
      <PageHeader
        title="My timesheet"
        description="Log time against your projects, then submit the week to your manager."
        actions={
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Previous week"
              onClick={() => {
                setWeek(addDays(week, -7));
              }}
            >
              <ChevronLeft />
            </Button>
            <span className="px-2 text-sm">Week of {week}</span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Next week"
              onClick={() => {
                setWeek(addDays(week, 7));
              }}
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {sheet.data ? (
        <WeekEditor
          key={`${sheet.data.weekStart}:${sheet.data.status}:${String(sheet.data.entries.length)}:${sheet.data.totalHours}`}
          sheet={sheet.data}
        />
      ) : (
        <Skeleton className="h-40" />
      )}
    </Page>
  );
}

function SheetCard({ s }: { s: TimesheetItem }) {
  const { error, run } = useAct();
  const [note, setNote] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{s.employee.displayName}</CardTitle>
        <span className="text-sm text-muted-foreground">
          week of {s.weekStart} · {s.totalHours} h ({s.billableHours} billable)
        </span>
        <Status s={s.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <table className="w-full" aria-label={`Entries of ${s.employee.displayName}`}>
          <tbody>
            {s.entries.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="py-1">{dayName(e.date)}</td>
                <td className="py-1">{e.project.name}</td>
                <td className="py-1">{e.hours} h</td>
                <td className="py-1">{e.billable ? 'billable' : 'non-billable'}</td>
                <td className="py-1 text-muted-foreground">{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.can.decide ? (
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="Note (required to return)" className="min-w-60 flex-1">
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </FormField>
            <Button
              size="sm"
              onClick={() => {
                run.mutate(() =>
                  api.post(`/timesheets/${s.id ?? ''}/decision`, {
                    decision: 'APPROVED',
                    note: note || null,
                  }),
                );
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!note.trim()}
              onClick={() => {
                run.mutate(() =>
                  api.post(`/timesheets/${s.id ?? ''}/decision`, { decision: 'REJECTED', note }),
                );
              }}
            >
              Return
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TimesheetsPage() {
  const readAll = usePermission(P.PROJECTS_TIMESHEET_READ);
  const billing = usePermission(P.PROJECTS_BILLING_MANAGE);
  const [tab, setTab] = useState('approvals');
  const approvals = useTimesheets({ scope: 'approvals' });
  const [status, setStatus] = useState('');
  const all = useTimesheets(
    { scope: 'all', status: status || undefined },
    readAll && tab === 'all',
  );
  const [range, setRange] = useState({
    from: addDays(mondayOf(todayLocal()), -28),
    to: todayLocal(),
  });
  const report = useTimeReport(range, (readAll || billing) && tab === 'report');
  return (
    <Page>
      <PageHeader
        title="Timesheets"
        description="Approve your team's weeks; see all time and its billable value."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Timesheet views">
          <TabsTrigger value="approvals">To approve ({approvals.data?.length ?? 0})</TabsTrigger>
          {readAll ? <TabsTrigger value="all">All timesheets</TabsTrigger> : null}
          {readAll || billing ? <TabsTrigger value="report">Time report</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="approvals">
          {!approvals.data?.length ? (
            <EmptyState title="Nothing to approve" />
          ) : (
            <div className="flex flex-col gap-3">
              {approvals.data.map((s) => (
                <SheetCard key={s.id} s={s} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="all">
          <div className="mb-3 w-48">
            <Select
              aria-label="Status"
              value={status}
              placeholder="All statuses"
              options={['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].map((x) => ({
                value: x,
                label: label(x),
              }))}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-3">
            {(all.data ?? []).map((s) => (
              <SheetCard key={s.id} s={s} />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="report">
          <div className="mb-3 flex flex-wrap gap-2">
            <FormField label="From">
              <Input
                type="date"
                value={range.from}
                onChange={(e) => {
                  setRange({ ...range, from: e.target.value });
                }}
              />
            </FormField>
            <FormField label="To">
              <Input
                type="date"
                value={range.to}
                onChange={(e) => {
                  setRange({ ...range, to: e.target.value });
                }}
              />
            </FormField>
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm" aria-label="Time report">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-normal">Project</th>
                    <th className="px-3 py-2 font-normal">Person</th>
                    <th className="px-3 py-2 font-normal">Hours</th>
                    <th className="px-3 py-2 font-normal">Billable</th>
                    <th className="px-3 py-2 font-normal">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.data?.rows ?? []).map((r) => (
                    <tr key={`${r.project.id}:${r.employee.id}`} className="border-t border-border">
                      <td className="px-3 py-2">
                        {r.project.name}
                        {r.client ? ` · ${r.client.name}` : ''}
                      </td>
                      <td className="px-3 py-2">{r.employee.displayName}</td>
                      <td className="px-3 py-2">{r.hours}</td>
                      <td className="px-3 py-2">{r.billableHours}</td>
                      <td className="px-3 py-2">{r.amount ?? 'no rate'}</td>
                    </tr>
                  ))}
                </tbody>
                {report.data ? (
                  <tfoot>
                    <tr className="border-t border-border font-medium">
                      <td className="px-3 py-2" colSpan={2}>
                        Approved time
                      </td>
                      <td className="px-3 py-2">{report.data.totals.hours}</td>
                      <td className="px-3 py-2">{report.data.totals.billableHours}</td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
