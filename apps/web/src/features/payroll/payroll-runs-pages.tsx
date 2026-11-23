import type { PayrollResultItem, PayrollRunItem } from '@hrm/shared-types';
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
  DataTable,
  type DataTableColumnDef,
  Dialog,
  DialogContent,
  DialogHeader,
  ErrorState,
  type PaginationState,
  Skeleton,
} from '@hrm/ui-web';
import { createPayrollRunSchema, payrollAdjustmentSchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { saveDownload } from '@/features/recruitment/recruit-api';
import type { RefRow } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  inr,
  MONTHS,
  PAYROLL,
  period,
  RUN_VARIANT,
  useAdjustments,
  useResults,
  useRun,
  useRuns,
} from './payroll-api';

const P = PERMISSIONS;

const runFields: FieldDef[] = [
  { name: 'companyId', label: 'Company', kind: 'ref', required: true, ref: { path: '/companies' } },
  {
    name: 'month',
    label: 'Month',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
  },
  { name: 'year', label: 'Year', kind: 'number', required: true },
];

export function PayrollRunsPage() {
  const canManage = usePermission(P.PAYROLL_RUN_MANAGE);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const runs = useRuns({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });
  const [creating, setCreating] = useState(false);
  const columns = useMemo<DataTableColumnDef<PayrollRunItem>[]>(
    () => [
      {
        id: 'period',
        header: 'Period',
        size: 170,
        cell: ({ row }) => (
          <Link
            to={`/payroll/runs/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {period(row.original.year, row.original.month)}
          </Link>
        ),
      },
      { id: 'company', header: 'Company', size: 180, cell: ({ row }) => row.original.company.name },
      {
        id: 'employees',
        header: 'Employees',
        size: 100,
        meta: { numeric: true },
        cell: ({ row }) => row.original.employeeCount,
      },
      {
        id: 'net',
        header: 'Net pay',
        size: 150,
        meta: { numeric: true },
        cell: ({ row }) => inr(row.original.totals.net),
      },
      {
        id: 'problems',
        header: 'Problems',
        size: 100,
        meta: { numeric: true },
        cell: ({ row }) =>
          row.original.problemCount ? (
            <Badge variant="destructive">{row.original.problemCount}</Badge>
          ) : (
            '—'
          ),
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => (
          <Badge variant={RUN_VARIANT[row.original.status] ?? 'neutral'}>
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
    ],
    [],
  );
  const now = new Date();
  return (
    <Page>
      <PageHeader
        title="Payroll runs"
        description="Monthly payroll per company: calculate, have it approved by someone else, then finalize into payslips."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> New run
            </Button>
          ) : null
        }
      />
      <DataTable
        aria-label="Payroll runs"
        mode="server"
        columns={columns}
        data={runs.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={runs.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={runs.isPending}
        isFetching={runs.isFetching}
        error={runs.isError ? errorMessage(runs.error) : null}
        emptyTitle="No payroll runs"
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="New payroll run" />
          <ResourceForm
            fields={runFields}
            defaultValues={{ companyId: '', month: '', year: String(now.getFullYear()) }}
            schema={createPayrollRunSchema}
            submit={(body) => api.post('/payroll/runs', body)}
            invalidate={[PAYROLL]}
            submitLabel="Create run"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

const adjustmentFields: FieldDef[] = [
  {
    name: 'employeeId',
    label: 'Employee',
    kind: 'ref',
    required: true,
    ref: {
      path: '/employees',
      label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
    },
    wide: true,
  },
  {
    name: 'category',
    label: 'Type',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'EARNING', label: 'Earning' },
      { value: 'DEDUCTION', label: 'Deduction' },
    ],
  },
  { name: 'amount', label: 'Amount', required: true },
  { name: 'code', label: 'Code', required: true, placeholder: 'e.g. BONUS' },
  { name: 'name', label: 'Payslip label', required: true, placeholder: 'e.g. Performance bonus' },
  { name: 'taxable', label: 'Taxable', kind: 'checkbox' },
  { name: 'pfWage', label: 'Counts as PF wages', kind: 'checkbox' },
  { name: 'note', label: 'Note', kind: 'textarea' },
];

function ResultRow({ r }: { r: PayrollResultItem }) {
  const [open, setOpen] = useState(r.problems.length > 0);
  return (
    <li className="text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="min-w-0 flex-1 font-medium">
          {r.employee.displayName}{' '}
          <span className="text-muted-foreground">{r.employee.employeeNumber}</span>
        </span>
        <span className="w-28 text-right text-muted-foreground">
          {r.payableDays}/{r.periodDays} days
        </span>
        <span className="w-32 text-right">{inr(r.gross)}</span>
        <span className="w-32 text-right text-muted-foreground">−{inr(r.totalDeductions)}</span>
        <span className="w-32 text-right font-medium">{inr(r.netPay)}</span>
        {r.problems.length ? (
          <Badge variant="destructive">{r.problems.length} problem(s)</Badge>
        ) : null}
      </button>
      {open ? (
        <div className="grid gap-3 bg-muted/40 px-10 py-3 md:grid-cols-2">
          {r.problems.length ? (
            <ul className="md:col-span-2" aria-label={`Problems for ${r.employee.displayName}`}>
              {r.problems.map((p) => (
                <li key={p.code} className="text-destructive">
                  {p.message}
                </li>
              ))}
            </ul>
          ) : null}
          {(['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION'] as const).map((cat) => {
            const lines = r.lines.filter((l) => l.category === cat);
            if (!lines.length) return null;
            return (
              <table key={cat} className="w-full">
                <caption className="pb-1 text-left text-xs font-semibold text-muted-foreground uppercase">
                  {cat === 'EARNING'
                    ? 'Earnings'
                    : cat === 'DEDUCTION'
                      ? 'Deductions'
                      : 'Employer contributions'}
                </caption>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.code}-${String(i)}`}>
                      <td>
                        {l.name}
                        {l.forMonth ? (
                          <span className="text-muted-foreground">
                            {' '}
                            ({MONTHS[l.forMonth - 1]} {l.forYear})
                          </span>
                        ) : null}
                      </td>
                      <td className="text-right">{inr(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

export function PayrollRunPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const canManage = usePermission(P.PAYROLL_RUN_MANAGE);
  const canExport = usePermission(P.PAYROLL_BANK_FILE_EXPORT);
  const run = useRun(id);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const results = useResults(id, problemsOnly);
  const adjustments = useAdjustments(id);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (a: { path: string; body?: object }) =>
      api.post(`/payroll/runs/${id}/${a.path}`, a.body ?? {}),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: PAYROLL });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  if (run.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (run.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(run.error)} />
      </Page>
    );
  const r = run.data;
  const open = r.status === 'DRAFT' || r.status === 'CALCULATED';
  return (
    <Page>
      <PageHeader
        title={`${period(r.year, r.month)} · ${r.company.name}`}
        description={`${r.periodStart} to ${r.periodEnd}${r.calculatedBy ? ` · calculated by ${r.calculatedBy}` : ''}${r.approvedBy ? ` · approved by ${r.approvedBy}` : ''}`}
        actions={
          <>
            <Badge variant={RUN_VARIANT[r.status] ?? 'neutral'}>{r.status.toLowerCase()}</Badge>
            {canManage && open ? (
              <Button
                size="sm"
                disabled={act.isPending}
                aria-busy={act.isPending}
                onClick={() => {
                  act.mutate({ path: 'calculate' });
                }}
              >
                {r.status === 'DRAFT' ? 'Calculate' : 'Recalculate'}
              </Button>
            ) : null}
            {r.canApprove ? (
              <>
                <Button
                  size="sm"
                  disabled={act.isPending}
                  onClick={() => {
                    act.mutate({ path: 'decision', body: { decision: 'APPROVED' } });
                  }}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => {
                    act.mutate({ path: 'decision', body: { decision: 'REJECTED' } });
                  }}
                >
                  Send back
                </Button>
              </>
            ) : null}
            {canManage && r.status === 'APPROVED' ? (
              <Button
                size="sm"
                disabled={act.isPending}
                onClick={() => {
                  act.mutate({ path: 'finalize' });
                }}
              >
                Finalize
              </Button>
            ) : null}
            {canExport && r.status === 'FINALIZED' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void saveDownload(
                    `/payroll/runs/${id}/bank-file`,
                    `salary-${String(r.year)}-${String(r.month).padStart(2, '0')}.csv`,
                  ).catch((e: unknown) => {
                    setError(errorMessage(e));
                  })
                }
              >
                <Download /> Bank file
              </Button>
            ) : null}
            {canManage && r.status !== 'FINALIZED' && r.status !== 'CANCELLED' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending}
                onClick={() => {
                  act.mutate({ path: 'cancel' });
                }}
              >
                Cancel run
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
      {r.status === 'CALCULATED' && !r.canApprove && r.problemCount === 0 ? (
        <Alert tone="info" className="mb-3">
          Ready for approval by someone other than the person who calculated it.
        </Alert>
      ) : null}
      {r.problemCount > 0 ? (
        <Alert tone="destructive" className="mb-3">
          {r.problemCount} employee(s) have problems — usually a missing salary, profile or
          statutory rule set. Fix them and recalculate; the run cannot be approved until then.
        </Alert>
      ) : null}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Run totals">
        {[
          ['Employees', String(r.employeeCount)],
          ['Gross', inr(r.totals.gross)],
          ['Deductions', inr(r.totals.deductions)],
          ['Net pay', inr(r.totals.net)],
          ['Employer cost', inr(r.totals.employerCost)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground uppercase">{label}</p>
              <p className="text-lg font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Employees</CardTitle>
            <label className="ml-auto flex items-center gap-2 text-sm">
              <Checkbox
                checked={problemsOnly}
                onCheckedChange={(v) => {
                  setProblemsOnly(v === true);
                }}
              />{' '}
              Only with problems
            </label>
          </CardHeader>
          <CardContent className="p-0">
            {results.isPending ? (
              <Skeleton className="m-4 h-24" />
            ) : !results.data?.length ? (
              <p className="p-4 text-sm text-muted-foreground">
                {r.status === 'DRAFT' ? 'Calculate the run to see results.' : 'No employees.'}
              </p>
            ) : (
              <ul className="divide-y divide-border" aria-label="Payroll results">
                {results.data.map((x) => (
                  <ResultRow key={x.id} r={x} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>One-time adjustments</CardTitle>
            {canManage && open ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setAdding(true);
                }}
              >
                <Plus /> Add
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {!adjustments.data?.length ? (
              <p className="p-4 text-sm text-muted-foreground">
                Bonuses, incentives or recoveries for this month only.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="Adjustments">
                {adjustments.data.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      {a.employee.displayName} · {a.name}
                    </span>
                    <span className={a.category === 'DEDUCTION' ? 'text-destructive' : ''}>
                      {a.category === 'DEDUCTION' ? '−' : ''}
                      {inr(a.amount)}
                    </span>
                    {canManage && open ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          void api
                            .delete(`/payroll/runs/${id}/adjustments/${a.id}`)
                            .then(() => queryClient.invalidateQueries({ queryKey: PAYROLL }))
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader
            title="Add adjustment"
            description="Changing inputs sends a calculated run back to draft; recalculate afterwards."
          />
          <ResourceForm
            fields={adjustmentFields}
            defaultValues={{
              employeeId: '',
              category: '',
              amount: '',
              code: '',
              name: '',
              taxable: 'true',
              pfWage: 'false',
              note: '',
            }}
            schema={payrollAdjustmentSchema}
            submit={(body) => api.post(`/payroll/runs/${id}/adjustments`, body)}
            invalidate={[PAYROLL]}
            submitLabel="Add"
            onDone={() => {
              setAdding(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}
