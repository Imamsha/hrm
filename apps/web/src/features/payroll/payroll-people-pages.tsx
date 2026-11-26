import type { EmployeePayrollItem, SettlementItem, TaxDeclarationItem } from '@hrm/shared-types';
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
  Select,
  Skeleton,
} from '@hrm/ui-web';
import {
  employeeSalarySchema,
  payrollProfileSchema,
  settlementSchema,
  taxDeclarationSchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Printer, X } from 'lucide-react';
import { saveDownload } from '@/features/recruitment/recruit-api';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { type RefRow, useRefOptions } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  financialYearOf,
  inr,
  PAYROLL,
  period,
  RUN_VARIANT,
  useDeclaration,
  useEmployeePayroll,
  useMyPayslips,
  useMySalary,
  usePayslip,
  useSettlements,
  useStructures,
} from './payroll-api';
import { STATE_OPTIONS } from './indian-states';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};

// ------------------------------------------------------------------------------ salary display

function SalaryHistory({
  data,
  onDelete,
}: {
  data: EmployeePayrollItem;
  onDelete?: (id: string) => void;
}) {
  if (!data.salaries.length) return <EmptyState title="No salary yet" />;
  return (
    <div className="flex flex-col gap-3">
      {data.salaries.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <CardTitle>
              {inr(s.annualCtc)} a year · from {s.effectiveFrom}
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              {s.structure.name} · {s.reason.toLowerCase()}
              {data.current?.id === s.id ? ' · current' : ''}
            </span>
            {onDelete ? (
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  onDelete(s.id);
                }}
              >
                Remove
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {s.breakdown.problems.length ? (
              <Alert tone="destructive">
                {s.breakdown.problems.map((p) => p.message).join(' ')}
              </Alert>
            ) : null}
            <table className="w-full text-sm" aria-label={`Breakdown from ${s.effectiveFrom}`}>
              <thead className="text-muted-foreground">
                <tr>
                  <th className="px-4 py-1 text-left font-normal">Component</th>
                  <th className="px-4 py-1 text-right font-normal">Monthly</th>
                  <th className="px-4 py-1 text-right font-normal">Annual</th>
                </tr>
              </thead>
              <tbody>
                {s.breakdown.lines.map((l) => (
                  <tr key={l.code} className="border-t border-border">
                    <td className="px-4 py-1.5">{l.name}</td>
                    <td className="px-4 py-1.5 text-right">{inr(l.monthly)}</td>
                    <td className="px-4 py-1.5 text-right">{inr(l.annual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DeclarationForm({
  employeeId,
  fy,
  current,
}: {
  employeeId: string | null;
  fy: string;
  current: TaxDeclarationItem | null;
}) {
  const queryClient = useQueryClient();
  const [regime, setRegime] = useState(current?.regime ?? '');
  const [rent, setRent] = useState(current?.rentPaidAnnual ?? '');
  const [rows, setRows] = useState<{ section: string; amount: string }[]>(
    Object.entries(current?.deductions ?? {}).map(([section, amount]) => ({ section, amount })),
  );
  const [message, setMessage] = useState<{ tone: 'success' | 'destructive'; text: string } | null>(
    null,
  );
  const save = useMutation({
    mutationFn: (body: object) =>
      employeeId
        ? api.put(`/payroll/employees/${employeeId}/declarations`, body)
        : api.put('/me/tax-declarations', body),
    onSuccess: async () => {
      setMessage({
        tone: 'success',
        text: 'Declaration saved. It applies from the next payroll calculation.',
      });
      await queryClient.invalidateQueries({ queryKey: PAYROLL });
    },
    onError: (e) => {
      setMessage({ tone: 'destructive', text: errorMessage(e) });
    },
  });
  return (
    <div className="flex flex-col gap-3">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {!current?.updatedAt && current ? (
        <Alert tone="info">
          No choice saved yet for {fy}; the organization default (
          {current.regime === 'NEW' ? 'new' : 'old'} regime) applies.
        </Alert>
      ) : null}
      <FormGrid columns={2}>
        <FormField label="Tax regime" required>
          <Select
            value={regime}
            placeholder="Select…"
            onChange={(e) => {
              setRegime(e.target.value);
            }}
            options={[
              { value: 'NEW', label: 'New regime' },
              { value: 'OLD', label: 'Old regime' },
            ]}
          />
        </FormField>
        <FormField
          label="Rent paid in the year"
          description="For the HRA exemption, where your regime allows it."
        >
          <Input
            value={rent}
            onChange={(e) => {
              setRent(e.target.value);
            }}
          />
        </FormField>
      </FormGrid>
      <p className="text-sm text-muted-foreground">
        Investments and other deductions by section. Only sections your organization's rule for the
        chosen regime allows are counted, up to their limits.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`Section ${String(i + 1)}`}
            placeholder="Section, e.g. 80C"
            value={r.section}
            onChange={(e) => {
              setRows(rows.map((x, j) => (j === i ? { ...x, section: e.target.value } : x)));
            }}
          />
          <Input
            aria-label={`Amount ${String(i + 1)}`}
            placeholder="Annual amount"
            value={r.amount}
            onChange={(e) => {
              setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)));
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove section ${String(i + 1)}`}
            onClick={() => {
              setRows(rows.filter((_, j) => j !== i));
            }}
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRows([...rows, { section: '', amount: '' }]);
          }}
        >
          <Plus /> Add section
        </Button>
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => {
            const body = {
              financialYear: fy,
              regime,
              rentPaidAnnual: rent || '0',
              deductions: Object.fromEntries(
                rows.filter((r) => r.section).map((r) => [r.section, r.amount]),
              ),
            };
            const parsed = taxDeclarationSchema.safeParse(body);
            if (!parsed.success) {
              setMessage({
                tone: 'destructive',
                text: parsed.error.issues[0]?.message ?? 'Check the declaration',
              });
              return;
            }
            save.mutate(body);
          }}
        >
          Save declaration
        </Button>
      </div>
    </div>
  );
}

function DeclarationCard({ employeeId }: { employeeId: string | null }) {
  const [fy, setFy] = useState(financialYearOf());
  const declaration = useDeclaration(employeeId, fy);
  const start = Number(financialYearOf().slice(0, 4));
  const years = [start - 1, start, start + 1].map(
    (y) => `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}`,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax declaration</CardTitle>
        <Select
          aria-label="Financial year"
          className="ml-auto h-7 w-32"
          value={fy}
          onChange={(e) => {
            setFy(e.target.value);
          }}
          options={years.map((y) => ({ value: y, label: `FY ${y}` }))}
        />
      </CardHeader>
      <CardContent>
        {declaration.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <DeclarationForm
            key={`${fy}-${declaration.data?.updatedAt ?? 'none'}`}
            employeeId={employeeId}
            fy={fy}
            current={declaration.data ?? null}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------------ HR: employee payroll

const salaryFields: FieldDef[] = [
  {
    name: 'structureId',
    label: 'Salary structure',
    kind: 'ref',
    required: true,
    ref: { path: '/payroll/structures', paged: false },
  },
  { name: 'annualCtc', label: 'Annual CTC', required: true },
  {
    name: 'effectiveFrom',
    label: 'Effective from',
    kind: 'date',
    required: true,
    description: 'A date in an already finalized month pays arrears in the next run.',
  },
  {
    name: 'reason',
    label: 'Reason',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'JOINING', label: 'Joining' },
      { value: 'REVISION', label: 'Revision' },
      { value: 'PROMOTION', label: 'Promotion' },
      { value: 'CORRECTION', label: 'Correction' },
    ],
  },
  { name: 'note', label: 'Note', kind: 'textarea' },
];

function ProfileForm({ employeeId, data }: { employeeId: string; data: EmployeePayrollItem }) {
  const queryClient = useQueryClient();
  const p = data.profile;
  const [v, setV] = useState({
    pfApplicable: p?.pfApplicable ?? false,
    voluntaryPfFullWages: p?.voluntaryPfFullWages ?? false,
    epsEligible: p?.epsEligible ?? true,
    esiApplicable: p?.esiApplicable ?? false,
    esiNumber: p?.esiNumber ?? '',
    ptStateCode: p?.ptStateCode ?? '',
    metroCity: p?.metroCity ?? false,
    taxApplicable: p?.taxApplicable ?? true,
  });
  const [message, setMessage] = useState<{ tone: 'success' | 'destructive'; text: string } | null>(
    null,
  );
  const save = useMutation({
    mutationFn: () => api.put(`/payroll/employees/${employeeId}/profile`, v),
    onSuccess: async () => {
      setMessage({ tone: 'success', text: 'Payroll profile saved.' });
      await queryClient.invalidateQueries({ queryKey: PAYROLL });
    },
    onError: (e) => {
      setMessage({ tone: 'destructive', text: errorMessage(e) });
    },
  });
  const flag = (k: keyof typeof v, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={v[k] === true}
        onCheckedChange={(c) => {
          setV({ ...v, [k]: c === true });
        }}
      />{' '}
      {label}
    </label>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        {!p ? (
          <Alert tone="warning">
            No payroll profile yet: PF, ESI and professional tax are not applied until you save one.
          </Alert>
        ) : null}
        <FormGrid columns={2}>
          {flag('pfApplicable', 'Provident fund applies')}
          {flag('voluntaryPfFullWages', 'Employee contributes on full wages')}
          {flag('epsEligible', 'Member of the pension scheme')}
          {flag('esiApplicable', 'ESI applies')}
          <FormField label="ESI number">
            <Input
              value={v.esiNumber}
              onChange={(e) => {
                setV({ ...v, esiNumber: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Professional tax state" description="Blank = no professional tax.">
            <Select
              value={v.ptStateCode}
              onChange={(e) => {
                setV({ ...v, ptStateCode: e.target.value });
              }}
              options={[{ value: '', label: '— None —' }, ...STATE_OPTIONS]}
            />
          </FormField>
          {flag('metroCity', 'Lives in a metro city (HRA)')}
          {flag('taxApplicable', 'Deduct income tax (TDS)')}
        </FormGrid>
        <div>
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              const parsed = payrollProfileSchema.safeParse(v);
              if (!parsed.success) {
                setMessage({
                  tone: 'destructive',
                  text: parsed.error.issues[0]?.message ?? 'Check the profile',
                });
                return;
              }
              save.mutate();
            }}
          >
            Save profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmployeePayrollPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = usePermission(P.PAYROLL_SALARY_MANAGE);
  const employees = useRefOptions(employeeRef, {});
  const data = useEmployeePayroll(id);
  const structures = useStructures();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Page>
      <PageHeader
        title={data.data ? `Payroll · ${data.data.employee.displayName}` : 'Employee payroll'}
        description="Salary history, statutory profile and tax declaration."
        actions={
          <Select
            aria-label="Employee"
            className="h-8 w-72"
            value={id}
            placeholder="Choose an employee…"
            options={employees.data ?? []}
            onChange={(e) => {
              void navigate(`/payroll/employees/${e.target.value}`);
            }}
          />
        }
      />
      {!id ? (
        <EmptyState title="Choose an employee" />
      ) : data.isPending ? (
        <Skeleton className="h-40" />
      ) : data.isError ? (
        <ErrorState description={errorMessage(data.error)} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
          <div className="flex flex-col gap-3">
            {error ? <Alert tone="destructive">{error}</Alert> : null}
            <div className="flex items-center justify-between">
              <h2 className="text-md font-semibold">Salary history</h2>
              {canManage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setAdding(true);
                  }}
                  disabled={!structures.data?.length}
                >
                  <Plus /> {data.data.salaries.length ? 'Revise salary' : 'Set salary'}
                </Button>
              ) : null}
            </div>
            <SalaryHistory
              data={data.data}
              onDelete={
                canManage
                  ? (salaryId) => {
                      void api
                        .delete(`/payroll/employees/${id}/salaries/${salaryId}`)
                        .then(() => queryClient.invalidateQueries({ queryKey: PAYROLL }))
                        .catch((e: unknown) => {
                          setError(errorMessage(e));
                        });
                    }
                  : undefined
              }
            />
          </div>
          <div className="flex flex-col gap-4">
            {canManage ? <ProfileForm key={id} employeeId={id} data={data.data} /> : null}
            <DeclarationCard employeeId={id} />
          </div>
        </div>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader title="Set salary" />
          <ResourceForm
            fields={salaryFields}
            defaultValues={{
              structureId: '',
              annualCtc: '',
              effectiveFrom: '',
              reason: '',
              note: '',
            }}
            schema={employeeSalarySchema}
            submit={(body) => api.post(`/payroll/employees/${id}/salaries`, body)}
            invalidate={[PAYROLL]}
            submitLabel="Save salary"
            onDone={() => {
              setAdding(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ settlements

function SettlementForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const employees = useRefOptions(employeeRef, { status: 'ON_NOTICE' });
  const [v, setV] = useState({
    employeeId: '',
    leaveEncashmentDays: '0',
    encashmentComponentCodes: 'BASIC',
    encashmentDivisor: '30',
    noticeRequiredDays: '0',
    noticeServedDays: '0',
    noticeWaivedByEmployer: false,
    includeGratuity: true,
    gratuityTaxable: true,
    encashmentTaxable: true,
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.post('/payroll/settlements', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PAYROLL });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const field = (k: keyof typeof v, label: string, description?: string) => (
    <FormField label={label} description={description}>
      <Input
        value={String(v[k])}
        onChange={(e) => {
          setV({ ...v, [k]: e.target.value });
        }}
      />
    </FormField>
  );
  const flag = (k: keyof typeof v, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={v[k] === true}
        onCheckedChange={(c) => {
          setV({ ...v, [k]: c === true });
        }}
      />{' '}
      {label}
    </label>
  );
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <Alert tone="info">
          Gratuity uses your active gratuity rule set. Exempt portions of gratuity or leave
          encashment are statutory limits this system does not compute: mark them non-taxable only
          after your payroll professional confirms.
        </Alert>
        <FormGrid columns={2}>
          <FormField label="Employee (on notice)" required className="sm:col-span-2">
            <Select
              value={v.employeeId}
              placeholder="Select…"
              options={employees.data ?? []}
              onChange={(e) => {
                setV({ ...v, employeeId: e.target.value });
              }}
            />
          </FormField>
          {field('leaveEncashmentDays', 'Leave days to encash')}
          {field(
            'encashmentComponentCodes',
            'Encashment based on components',
            'Comma separated, e.g. BASIC',
          )}
          {field('encashmentDivisor', 'Encashment day divisor')}
          {field('noticeRequiredDays', 'Notice required (days)')}
          {field('noticeServedDays', 'Notice served (days)')}
          {flag('noticeWaivedByEmployer', 'Employer waived the notice (pay it out)')}
          {flag('includeGratuity', 'Include gratuity')}
          {flag('gratuityTaxable', 'Gratuity is taxable')}
          {flag('encashmentTaxable', 'Leave encashment is taxable')}
        </FormGrid>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const body = {
              ...v,
              encashmentComponentCodes: v.encashmentComponentCodes
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
              encashmentDivisor: Number(v.encashmentDivisor),
              noticeRequiredDays: Number(v.noticeRequiredDays),
              noticeServedDays: Number(v.noticeServedDays),
              note: v.note || null,
            };
            const parsed = settlementSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the form');
              return;
            }
            save.mutate(body);
          }}
        >
          Calculate settlement
        </Button>
      </DialogFooter>
    </>
  );
}

function SettlementCard({ s }: { s: SettlementItem }) {
  const queryClient = useQueryClient();
  const canManage = usePermission(P.PAYROLL_SETTLEMENT_MANAGE);
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (a: { path: string; body?: object }) =>
      api.post(`/payroll/settlements/${s.id}/${a.path}`, a.body ?? {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PAYROLL }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {s.employee.displayName} · last day {s.lastWorkingDate}
        </CardTitle>
        <Badge variant={RUN_VARIANT[s.status] ?? 'neutral'}>{s.status.toLowerCase()}</Badge>
        <span className="ml-auto font-semibold">{inr(s.netPayable)}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {s.problems.length ? (
          <Alert tone="destructive">{s.problems.map((p) => p.message).join(' ')}</Alert>
        ) : null}
        <table className="w-full" aria-label={`Settlement of ${s.employee.displayName}`}>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={`${l.code}-${String(i)}`} className="border-t border-border">
                <td className="py-1">{l.name}</td>
                <td
                  className={`py-1 text-right ${l.category === 'DEDUCTION' ? 'text-destructive' : ''}`}
                >
                  {l.category === 'DEDUCTION' ? '−' : ''}
                  {inr(l.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2">
          {s.canApprove ? (
            <>
              <Button
                size="xs"
                onClick={() => {
                  act.mutate({ path: 'decision', body: { decision: 'APPROVED' } });
                }}
              >
                Approve
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  act.mutate({ path: 'decision', body: { decision: 'REJECTED' } });
                }}
              >
                Send back
              </Button>
            </>
          ) : null}
          {canManage && s.status === 'APPROVED' ? (
            <Button
              size="xs"
              onClick={() => {
                act.mutate({ path: 'finalize' });
              }}
            >
              Finalize
            </Button>
          ) : null}
          {canManage && s.status !== 'FINALIZED' && s.status !== 'CANCELLED' ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                act.mutate({ path: 'cancel' });
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function SettlementsPage() {
  const settlements = useSettlements();
  const [creating, setCreating] = useState(false);
  return (
    <Page>
      <PageHeader
        title="Full & final settlements"
        description="Final month's salary, leave encashment, notice pay and gratuity for employees who are leaving. Approved by someone other than the preparer."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New settlement
          </Button>
        }
      />
      {settlements.isPending ? (
        <Skeleton className="h-32" />
      ) : settlements.isError ? (
        <ErrorState description={errorMessage(settlements.error)} />
      ) : !settlements.data.length ? (
        <EmptyState
          title="No settlements"
          description="Record the separation on the employee's profile first."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {settlements.data.map((s) => (
            <SettlementCard key={s.id} s={s} />
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="New full & final settlement" />
          {creating ? (
            <SettlementForm
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

// ------------------------------------------------------------------------------ self-service

export function MyPayslipsPage() {
  const slips = useMyPayslips();
  return (
    <Page>
      <PageHeader title="My payslips" description="Payslips of finalized payroll months." />
      {slips.isPending ? (
        <Skeleton className="h-32" />
      ) : slips.isError ? (
        <ErrorState description={errorMessage(slips.error)} />
      ) : !slips.data.length ? (
        <EmptyState title="No payslips yet" />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Payslips">
          {slips.data.map((s) => (
            <li key={s.resultId}>
              <Link
                to={`/me/payslips/${s.resultId}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent"
              >
                <span className="min-w-0 flex-1 font-medium">{period(s.year, s.month)}</span>
                <span className="text-sm text-muted-foreground">{s.company}</span>
                <span className="w-32 text-right font-semibold">{inr(s.netPay)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** A printable payslip (the browser prints or saves it as PDF). */
export function PayslipPage({ self }: { self: boolean }) {
  const { id = '' } = useParams<{ id: string }>();
  const slip = usePayslip(id, self);
  if (slip.isPending)
    return (
      <Page>
        <Skeleton className="h-64" />
      </Page>
    );
  if (slip.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(slip.error)} />
      </Page>
    );
  const s = slip.data;
  const section = (cat: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION', title: string) => {
    const lines = s.lines.filter((l) => l.category === cat);
    if (!lines.length) return null;
    return (
      <table className="w-full text-sm" aria-label={title}>
        <thead>
          <tr>
            <th className="border-b border-border py-1 text-left">{title}</th>
            <th className="border-b border-border py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={`${l.code}-${String(i)}`}>
              <td className="py-1">
                {l.name}
                {l.forMonth ? ` (${period(l.forYear ?? 0, l.forMonth)})` : ''}
              </td>
              <td className="py-1 text-right">{inr(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };
  return (
    <Page>
      <PageHeader
        title={`Payslip · ${period(s.year, s.month)}`}
        description={s.company.legalName ?? s.company.name}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                void saveDownload(
                  self ? `/me/payslips/${id}/pdf` : `/payroll/payslips/${id}/pdf`,
                  `Payslip ${String(s.year)}-${String(s.month).padStart(2, '0')}.pdf`,
                );
              }}
            >
              <Download /> PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                window.print();
              }}
            >
              <Printer /> Print
            </Button>
          </>
        }
      />
      <Card className="print:border-0 print:shadow-none">
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <p>
              <span className="text-muted-foreground">Employee</span>
              <br />
              {s.employee.displayName} ({s.employee.employeeNumber})
            </p>
            <p>
              <span className="text-muted-foreground">Paid days</span>
              <br />
              {s.payableDays} of {s.periodDays}
              {s.lossOfPayDays !== '0' && s.lossOfPayDays !== '0.00'
                ? ` · ${s.lossOfPayDays} loss of pay`
                : ''}
            </p>
            <p>
              <span className="text-muted-foreground">Bank</span>
              <br />
              {s.bankAccount
                ? `${s.bankAccount.bankName} ••••${s.bankAccount.last4}`
                : 'No primary account'}
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {section('EARNING', 'Earnings')}
            {section('DEDUCTION', 'Deductions')}
          </div>
          <div className="flex flex-wrap justify-end gap-6 border-t border-border pt-3 text-sm">
            <span>Gross {inr(s.gross)}</span>
            <span>Deductions {inr(s.totalDeductions)}</span>
            <span className="text-base font-semibold">Net pay {inr(s.netPay)}</span>
          </div>
          {section('EMPLOYER_CONTRIBUTION', 'Employer contributions (not deducted)')}
          {s.taxTrace ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                Income tax projection ({s.taxRegime === 'NEW' ? 'new' : 'old'} regime):{' '}
                {inr(s.annualTaxProjection)} for the year
              </summary>
              <table className="mt-2 w-full max-w-md">
                <tbody>
                  {s.taxTrace.map((t, i) => (
                    <tr key={`${t.label}-${String(i)}`}>
                      <td className="py-0.5">{t.label}</td>
                      <td className="py-0.5 text-right">{inr(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </Page>
  );
}

export function MySalaryPage() {
  const salary = useMySalary();
  return (
    <Page>
      <PageHeader
        title="My salary & tax"
        description="Your salary breakdown and your tax declaration for the year."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
        <div>
          {salary.isPending ? (
            <Skeleton className="h-40" />
          ) : salary.isError ? (
            <ErrorState description={errorMessage(salary.error)} />
          ) : (
            <SalaryHistory data={salary.data} />
          )}
        </div>
        <DeclarationCard employeeId={null} />
      </div>
    </Page>
  );
}
