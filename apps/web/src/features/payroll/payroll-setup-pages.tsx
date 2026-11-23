import type {
  SalaryComponentItem,
  SalaryStructureItem,
  StatutoryRuleSetItem,
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
  Checkbox,
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
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@hrm/ui-web';
import {
  payrollSettingsSchema,
  salaryComponentSchema,
  salaryStructureSchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { api, errorMessage } from '@/lib/api';
import {
  PAYROLL,
  RULE_TYPE_LABEL,
  RUN_VARIANT,
  useComponents,
  useRuleSets,
  useSettings,
  useStructures,
} from './payroll-api';
import { RuleSetForm } from './rule-set-form';

const P = PERMISSIONS;

function useAction() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: PAYROLL });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return { error, setError, run };
}

// ------------------------------------------------------------------------------ statutory rules

function scopeLabel(r: StatutoryRuleSetItem): string {
  if (r.type === 'PT') return r.stateCode ?? '';
  if (r.type === 'INCOME_TAX') return `${r.regime === 'NEW' ? 'New' : 'Old'} regime`;
  return 'Organization';
}

export function StatutoryRulesPage() {
  const canManage = usePermission(P.PAYROLL_STATUTORY_MANAGE);
  const [type, setType] = useState('');
  const rules = useRuleSets({ type: type || undefined });
  const [dialog, setDialog] = useState<{
    initial: StatutoryRuleSetItem | null;
    editingId: string | null;
  } | null>(null);
  const { error, run } = useAction();
  const columns = useMemo<DataTableColumnDef<StatutoryRuleSetItem>[]>(
    () => [
      {
        id: 'type',
        header: 'Rule',
        size: 170,
        cell: ({ row }) => RULE_TYPE_LABEL[row.original.type],
      },
      { id: 'scope', header: 'Scope', size: 130, cell: ({ row }) => scopeLabel(row.original) },
      {
        id: 'name',
        header: 'Name',
        size: 220,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: 'dates',
        header: 'In force',
        size: 190,
        cell: ({ row }) => `${row.original.effectiveFrom} → ${row.original.effectiveTo ?? 'open'}`,
      },
      {
        id: 'source',
        header: 'Source',
        size: 220,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.sourceReference}</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        size: 100,
        cell: ({ row }) => (
          <Badge variant={RUN_VARIANT[row.original.status] ?? 'neutral'}>
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 230,
        cell: ({ row }) => {
          const r = row.original;
          if (!canManage) return null;
          return (
            <div className="flex gap-1">
              {r.status === 'DRAFT' ? (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setDialog({ initial: r, editingId: r.id });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    onClick={() => {
                      run.mutate(() =>
                        api.put(`/payroll/rule-sets/${r.id}/status`, { status: 'ACTIVE' }),
                      );
                    }}
                  >
                    Activate
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      run.mutate(() => api.delete(`/payroll/rule-sets/${r.id}`));
                    }}
                  >
                    Delete
                  </Button>
                </>
              ) : null}
              {r.status === 'ACTIVE' ? (
                <>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setDialog({
                        initial: {
                          ...r,
                          name: `${r.name} (new version)`,
                          effectiveFrom: '',
                          effectiveTo: null,
                        },
                        editingId: null,
                      });
                    }}
                  >
                    New version
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      run.mutate(() =>
                        api.put(`/payroll/rule-sets/${r.id}/status`, { status: 'RETIRED' }),
                      );
                    }}
                  >
                    Retire
                  </Button>
                </>
              ) : null}
            </div>
          );
        },
      },
    ],
    [canManage, run],
  );
  return (
    <Page>
      <PageHeader
        title="Statutory rules"
        description="EPF, ESI, professional tax, income tax and gratuity rules, each with its official source and dates. Nothing is pre-loaded: payroll uses only the rule sets you activate."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setDialog({ initial: null, editingId: null });
              }}
            >
              <Plus /> New rule set
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
        aria-label="Statutory rule sets"
        columns={columns}
        data={rules.data ?? []}
        getRowId={(r) => r.id}
        isLoading={rules.isPending}
        error={rules.isError ? errorMessage(rules.error) : null}
        emptyTitle="No statutory rule sets"
        emptyDescription="Add the rules that apply to your organization from their official sources, then activate them."
        toolbar={
          <Select
            aria-label="Filter by rule"
            className="h-7 w-48"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
            }}
            options={[
              { value: '', label: 'All rules' },
              ...Object.entries(RULE_TYPE_LABEL).map(([value, label]) => ({ value, label })),
            ]}
          />
        }
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader
            title={dialog?.editingId ? 'Edit rule set (draft)' : 'New statutory rule set'}
          />
          {dialog ? (
            <RuleSetForm
              initial={dialog.initial}
              editingId={dialog.editingId}
              onDone={() => {
                setDialog(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ salary setup

const KIND_LABEL = {
  EARNING: 'Earning',
  DEDUCTION: 'Deduction',
  EMPLOYER_CONTRIBUTION: 'Employer contribution',
} as const;
const FLAG_LABELS: [keyof SalaryComponentItem, string][] = [
  ['taxable', 'Taxable'],
  ['pfWage', 'PF wages'],
  ['esiWage', 'ESI wages'],
  ['ptWage', 'PT wages'],
  ['prorate', 'Prorate by payable days'],
];

function ComponentForm({
  component,
  onDone,
}: {
  component: SalaryComponentItem | null;
  onDone: () => void;
}) {
  const { error, setError, run } = useAction();
  const [v, setV] = useState({
    code: component?.code ?? '',
    name: component?.name ?? '',
    kind: component?.kind ?? '',
    payslipOrder: String(component?.payslipOrder ?? 100),
    taxable: component?.taxable ?? true,
    pfWage: component?.pfWage ?? false,
    esiWage: component?.esiWage ?? false,
    ptWage: component?.ptWage ?? false,
    prorate: component?.prorate ?? true,
    status: component?.status ?? 'ACTIVE',
  });
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Code" required>
            <Input
              value={v.code}
              disabled={!!component}
              onChange={(e) => {
                setV({ ...v, code: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Name" required>
            <Input
              value={v.name}
              onChange={(e) => {
                setV({ ...v, name: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Kind" required>
            <Select
              value={v.kind}
              placeholder="Select…"
              disabled={!!component}
              onChange={(e) => {
                setV({ ...v, kind: e.target.value });
              }}
              options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </FormField>
          <FormField label="Payslip order">
            <Input
              inputMode="numeric"
              value={v.payslipOrder}
              onChange={(e) => {
                setV({ ...v, payslipOrder: e.target.value });
              }}
            />
          </FormField>
          {FLAG_LABELS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v[k as keyof typeof v] === true}
                onCheckedChange={(c) => {
                  setV({ ...v, [k]: c === true });
                }}
              />{' '}
              {label}
            </label>
          ))}
          {component ? (
            <FormField label="Status">
              <Select
                value={v.status}
                onChange={(e) => {
                  setV({ ...v, status: e.target.value as 'ACTIVE' });
                }}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
              />
            </FormField>
          ) : null}
        </FormGrid>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={run.isPending}
          onClick={() => {
            const body = { ...v, payslipOrder: Number(v.payslipOrder) };
            const parsed = salaryComponentSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the form');
              return;
            }
            const { code: _code, kind: _kind, ...update } = body;
            run.mutate(
              () =>
                component
                  ? api.patch(`/payroll/components/${component.id}`, update)
                  : api.post('/payroll/components', { ...body, status: undefined }),
              { onSuccess: onDone },
            );
            return undefined;
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

type CalcRow = { componentId: string; type: string; value: string; base: string };

function StructureForm({
  components,
  onDone,
}: {
  components: SalaryComponentItem[];
  onDone: () => void;
}) {
  const { error, setError, run } = useAction();
  const [name, setName] = useState('');
  const [inCtc, setInCtc] = useState(false);
  const [lines, setLines] = useState<CalcRow[]>([
    { componentId: '', type: '', value: '', base: '' },
  ]);
  const active = components.filter((c) => c.status === 'ACTIVE');
  const options = active.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
  const set = (i: number, patch: Partial<CalcRow>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const body = {
    name,
    employerStatutoryInCtc: inCtc,
    components: lines.map((l) => ({
      componentId: l.componentId,
      calc:
        l.type === 'FIXED'
          ? { type: 'FIXED', monthlyAmount: l.value }
          : l.type === 'PERCENT_OF_CTC'
            ? { type: 'PERCENT_OF_CTC', percent: l.value }
            : l.type === 'PERCENT_OF_COMPONENT'
              ? { type: 'PERCENT_OF_COMPONENT', percent: l.value, componentCode: l.base }
              : { type: l.type },
    })),
  };
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        <Alert tone="info">
          A structure cannot be changed once saved, so past salaries stay reproducible. Create a new
          structure to change the split.
        </Alert>
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Name" required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Checkbox
              checked={inCtc}
              onCheckedChange={(c) => {
                setInCtc(c === true);
              }}
            />{' '}
            Employer EPF/ESI is part of CTC
          </label>
        </FormGrid>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_11rem_7rem_9rem_auto] items-center gap-2">
            <Select
              aria-label={`Line ${String(i + 1)} component`}
              value={l.componentId}
              placeholder="Component…"
              options={options}
              onChange={(e) => {
                set(i, { componentId: e.target.value });
              }}
            />
            <Select
              aria-label={`Line ${String(i + 1)} calculation`}
              value={l.type}
              placeholder="Calculation…"
              onChange={(e) => {
                set(i, { type: e.target.value });
              }}
              options={[
                { value: 'FIXED', label: 'Fixed monthly' },
                { value: 'PERCENT_OF_CTC', label: '% of CTC' },
                { value: 'PERCENT_OF_COMPONENT', label: '% of component' },
                { value: 'BALANCING', label: 'Balance of CTC' },
              ]}
            />
            <Input
              aria-label={`Line ${String(i + 1)} value`}
              placeholder={l.type === 'FIXED' ? 'Amount' : '%'}
              disabled={!l.type || l.type === 'BALANCING'}
              value={l.value}
              onChange={(e) => {
                set(i, { value: e.target.value });
              }}
            />
            <Select
              aria-label={`Line ${String(i + 1)} base`}
              value={l.base}
              placeholder="Of…"
              disabled={l.type !== 'PERCENT_OF_COMPONENT'}
              options={active.map((c) => ({ value: c.code, label: c.code }))}
              onChange={(e) => {
                set(i, { base: e.target.value });
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove line ${String(i + 1)}`}
              disabled={lines.length === 1}
              onClick={() => {
                setLines((ls) => ls.filter((_, j) => j !== i));
              }}
            >
              <X />
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLines((ls) => [...ls, { componentId: '', type: '', value: '', base: '' }]);
            }}
          >
            <Plus /> Add component
          </Button>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={run.isPending}
          onClick={() => {
            const parsed = salaryStructureSchema.safeParse(body);
            if (!parsed.success) {
              setError(
                parsed.error.issues[0]?.message ??
                  'Choose a component and calculation for every line',
              );
              return;
            }
            run.mutate(() => api.post('/payroll/structures', body), { onSuccess: onDone });
            return undefined;
          }}
        >
          Create structure
        </Button>
      </DialogFooter>
    </>
  );
}

function calcLabel(c: SalaryStructureItem['components'][number]['calc']): string {
  switch (c.type) {
    case 'FIXED':
      return `₹${c.monthlyAmount} a month`;
    case 'PERCENT_OF_CTC':
      return `${c.percent}% of CTC`;
    case 'PERCENT_OF_COMPONENT':
      return `${c.percent}% of ${c.componentCode}`;
    default:
      return 'Balance of CTC';
  }
}

function SettingsForm() {
  const settings = useSettings();
  const components = useComponents();
  const { error, setError, run } = useAction();
  const [v, setV] = useState<Record<string, string | boolean> | null>(null);
  if (settings.isPending) return <Skeleton className="h-40" />;
  if (settings.isError) return <ErrorState description={errorMessage(settings.error)} />;
  const s = settings.data;
  const cur = v ?? {
    payableDaysMethod: s.payableDaysMethod,
    fixedDays: s.fixedDays ? String(s.fixedDays) : '',
    absentIsLossOfPay: s.absentIsLossOfPay,
    hraComponentCode: s.hraComponentCode ?? '',
    basicComponentCodes: s.basicComponentCodes.join(', '),
    defaultTaxRegime: s.defaultTaxRegime ?? '',
  };
  const codeOptions = [
    { value: '', label: '— None —' },
    ...(components.data ?? []).map((c) => ({ value: c.code, label: `${c.name} (${c.code})` })),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Payable days are counted as" required>
            <Select
              value={String(cur.payableDaysMethod)}
              onChange={(e) => {
                setV({ ...cur, payableDaysMethod: e.target.value });
              }}
              options={[
                { value: 'CALENDAR_DAYS', label: 'Calendar days of the month' },
                { value: 'FIXED_DAYS', label: 'A fixed number of days' },
                { value: 'WORKING_DAYS', label: 'Working days (employee calendar)' },
              ]}
            />
          </FormField>
          {cur.payableDaysMethod === 'FIXED_DAYS' ? (
            <FormField label="Fixed days" required>
              <Input
                inputMode="numeric"
                value={String(cur.fixedDays)}
                onChange={(e) => {
                  setV({ ...cur, fixedDays: e.target.value });
                }}
              />
            </FormField>
          ) : null}
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Checkbox
              checked={cur.absentIsLossOfPay === true}
              onCheckedChange={(c) => {
                setV({ ...cur, absentIsLossOfPay: c === true });
              }}
            />{' '}
            Absent days are loss of pay (unpaid leave always is)
          </label>
          <FormField
            label="Default tax regime"
            description="Used when an employee has not chosen one for the year. Your organization's decision."
          >
            <Select
              value={String(cur.defaultTaxRegime)}
              onChange={(e) => {
                setV({ ...cur, defaultTaxRegime: e.target.value });
              }}
              options={[
                { value: '', label: 'None (employees must choose)' },
                { value: 'NEW', label: 'New regime' },
                { value: 'OLD', label: 'Old regime' },
              ]}
            />
          </FormField>
          <FormField label="HRA component" description="For the HRA exemption.">
            <Select
              value={String(cur.hraComponentCode)}
              onChange={(e) => {
                setV({ ...cur, hraComponentCode: e.target.value });
              }}
              options={codeOptions}
            />
          </FormField>
          <FormField label="Basic salary components" description="Comma separated, e.g. BASIC, DA.">
            <Input
              value={String(cur.basicComponentCodes)}
              onChange={(e) => {
                setV({ ...cur, basicComponentCodes: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        <div>
          <Button
            disabled={run.isPending || v === null}
            onClick={() => {
              const body = {
                payableDaysMethod: cur.payableDaysMethod,
                fixedDays: cur.payableDaysMethod === 'FIXED_DAYS' ? Number(cur.fixedDays) : null,
                absentIsLossOfPay: cur.absentIsLossOfPay === true,
                hraComponentCode: cur.hraComponentCode || null,
                basicComponentCodes: String(cur.basicComponentCodes)
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
                defaultTaxRegime: cur.defaultTaxRegime || null,
              };
              const parsed = payrollSettingsSchema.safeParse(body);
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? 'Check the settings');
                return;
              }
              run.mutate(() => api.put('/payroll/settings', body), {
                onSuccess: () => {
                  setV(null);
                },
              });
              return undefined;
            }}
          >
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SalarySetupPage() {
  const canManage = usePermission(P.PAYROLL_SETTINGS_MANAGE);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'components';
  const components = useComponents();
  const structures = useStructures();
  const [dialog, setDialog] = useState<SalaryComponentItem | 'component' | 'structure' | null>(
    null,
  );
  const componentColumns = useMemo<DataTableColumnDef<SalaryComponentItem>[]>(
    () => [
      {
        id: 'code',
        header: 'Code',
        size: 110,
        cell: ({ row }) => <span className="font-mono">{row.original.code}</span>,
      },
      { id: 'name', header: 'Name', size: 200, cell: ({ row }) => row.original.name },
      { id: 'kind', header: 'Kind', size: 170, cell: ({ row }) => KIND_LABEL[row.original.kind] },
      {
        id: 'flags',
        header: 'Counts towards',
        size: 260,
        cell: ({ row }) =>
          FLAG_LABELS.filter(([k]) => row.original[k] === true)
            .map(([, l]) => l)
            .join(', ') || '—',
      },
      {
        id: 'status',
        header: 'Status',
        size: 90,
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
      {
        id: 'edit',
        header: '',
        size: 70,
        cell: ({ row }) =>
          canManage ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setDialog(row.original);
              }}
            >
              Edit
            </Button>
          ) : null,
      },
    ],
    [canManage],
  );
  return (
    <Page>
      <PageHeader
        title="Salary setup"
        description="Components, salary structures and how payable days are counted."
      />
      <Tabs
        value={tab}
        onValueChange={(t) => {
          setParams({ tab: t }, { replace: true });
        }}
      >
        <TabsList aria-label="Salary setup sections">
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="structures">Structures</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="components">
          <DataTable
            aria-label="Salary components"
            columns={componentColumns}
            data={components.data ?? []}
            getRowId={(r) => r.id}
            isLoading={components.isPending}
            error={components.isError ? errorMessage(components.error) : null}
            emptyTitle="No salary components"
            toolbar={
              canManage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog('component');
                  }}
                >
                  <Plus /> New component
                </Button>
              ) : null
            }
          />
        </TabsContent>
        <TabsContent value="structures">
          {canManage ? (
            <div className="mb-3">
              <Button
                size="sm"
                onClick={() => {
                  setDialog('structure');
                }}
                disabled={!components.data?.length}
              >
                <Plus /> New structure
              </Button>
            </div>
          ) : null}
          {structures.isPending ? (
            <Skeleton className="h-32" />
          ) : !structures.data?.length ? (
            <EmptyState
              title="No salary structures"
              description="Create components first, then a structure that splits CTC into them."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2" aria-label="Salary structures">
              {structures.data.map((s) => (
                <Card key={s.id}>
                  <CardHeader>
                    <CardTitle>{s.name}</CardTitle>
                    <span className="text-sm text-muted-foreground">
                      {s.employeeCount} salary record(s)
                      {s.employerStatutoryInCtc ? ' · employer EPF/ESI in CTC' : ''}
                    </span>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ul className="divide-y divide-border text-sm">
                      {s.components.map((c) => (
                        <li key={c.componentId} className="flex justify-between px-4 py-2">
                          <span>
                            {c.name}{' '}
                            <span className="font-mono text-muted-foreground">{c.code}</span>
                          </span>
                          <span className="text-muted-foreground">{calcLabel(c.calc)}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="settings">{tab === 'settings' ? <SettingsForm /> : null}</TabsContent>
      </Tabs>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size="lg">
          {dialog === 'structure' ? (
            <>
              <DialogHeader title="New salary structure" />
              <StructureForm
                components={components.data ?? []}
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog ? (
            <>
              <DialogHeader
                title={dialog === 'component' ? 'New salary component' : `Edit ${dialog.code}`}
              />
              <ComponentForm
                component={dialog === 'component' ? null : dialog}
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
