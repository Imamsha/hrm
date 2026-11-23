import type { StatutoryRuleSetItem } from '@hrm/shared-types';
import {
  Alert,
  Button,
  Checkbox,
  DialogBody,
  DialogFooter,
  FormField,
  FormGrid,
  Input,
  Select,
  Textarea,
} from '@hrm/ui-web';
import { statutoryRuleSetSchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { STATE_OPTIONS } from './indian-states';
import { MONTHS, PAYROLL, RULE_TYPE_LABEL } from './payroll-api';

const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));
const ROUND_MODES = [
  { value: 'HALF_UP', label: 'Half up' },
  { value: 'HALF_EVEN', label: 'Half even' },
  { value: 'UP', label: 'Up' },
  { value: 'CEIL', label: 'Ceiling' },
  { value: 'DOWN', label: 'Down' },
  { value: 'FLOOR', label: 'Floor' },
];

type Row = Record<string, string>;
type Draft = Record<string, string | boolean | Row[] | { minAge: string; slabs: Row[] }[]>;

const blank = (v: string) => (v.trim() === '' ? null : v.trim());
const str = (d: Draft, k: string) => (typeof d[k] === 'string' ? d[k] : '');
const bool = (d: Draft, k: string) => d[k] === true;
const rows = (d: Draft, k: string) => (Array.isArray(d[k]) ? (d[k] as Row[]) : []);

function RowsEditor({
  label,
  columns,
  value,
  onChange,
  addLabel,
}: {
  label: string;
  columns: {
    key: string;
    label: string;
    options?: { value: string; label: string }[];
    placeholder?: string;
  }[];
  value: Row[];
  onChange: (r: Row[]) => void;
  addLabel: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      {value.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          {columns.map((c) =>
            c.options ? (
              <Select
                key={c.key}
                aria-label={`${label} ${String(i + 1)} ${c.label}`}
                className="min-w-0 flex-1"
                value={r[c.key] ?? ''}
                options={c.options}
                onChange={(e) => {
                  onChange(value.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)));
                }}
              />
            ) : (
              <Input
                key={c.key}
                aria-label={`${label} ${String(i + 1)} ${c.label}`}
                placeholder={c.placeholder ?? c.label}
                className="min-w-0 flex-1"
                value={r[c.key] ?? ''}
                onChange={(e) => {
                  onChange(value.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)));
                }}
              />
            ),
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${label} ${String(i + 1)}`}
            onClick={() => {
              onChange(value.filter((_, j) => j !== i));
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
            onChange([...value, Object.fromEntries(columns.map((c) => [c.key, '']))]);
          }}
        >
          <Plus /> {addLabel}
        </Button>
      </div>
    </fieldset>
  );
}

/** Draft state from an existing rule set (editing a draft or copying a version). */
function draftOf(r: StatutoryRuleSetItem | null): Draft {
  if (!r)
    return {
      type: '',
      name: '',
      effectiveFrom: '',
      effectiveTo: '',
      sourceReference: '',
      notes: '',
      scale: '0',
      mode: 'HALF_UP',
    };
  const c = r.config;
  const s = (v: unknown): string =>
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
  const rr = (v: unknown, map: (x: Record<string, unknown>) => Row) =>
    Array.isArray(v) ? (v as Record<string, unknown>[]).map(map) : [];
  const rounding = (c.rounding ?? {}) as { scale?: number; mode?: string };
  return {
    type: r.type,
    name: r.name,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? '',
    sourceReference: r.sourceReference,
    notes: r.notes ?? '',
    scale: s(rounding.scale ?? 0),
    mode: rounding.mode ?? 'HALF_UP',
    ...Object.fromEntries(
      Object.entries(c)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([k, v]) => [k, s(v)]),
    ),
    ...Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === 'boolean')),
    periods: rr(c.contributionPeriods, (p) => ({
      start: s((p as unknown as unknown[])[0]),
      end: s((p as unknown as unknown[])[1]),
    })),
    ptSlabs: rr(c.slabs, (x) => ({
      minWage: s(x.minWage),
      maxWage: s(x.maxWage),
      amount: s(x.amount),
      gender: s(x.gender),
      monthAmounts: Object.entries((x.monthAmounts ?? {}) as Record<string, string>)
        .map(([m, a]) => `${m}=${a}`)
        .join(', '),
    })),
    deductionMonths: Array.isArray(c.deductionMonths)
      ? (c.deductionMonths as number[]).join(', ')
      : '',
    taxSlabs: rr(c.slabs, (x) => ({ upTo: s(x.upTo), ratePercent: s(x.ratePercent) })),
    seniorSlabs: Array.isArray(c.seniorSlabs)
      ? (c.seniorSlabs as { minAge: number; slabs: Record<string, unknown>[] }[]).map((g) => ({
          minAge: String(g.minAge),
          slabs: g.slabs.map((x) => ({ upTo: s(x.upTo), ratePercent: s(x.ratePercent) })),
        }))
      : [],
    surcharge: rr(c.surcharge, (x) => ({ above: s(x.above), ratePercent: s(x.ratePercent) })),
    limits: Object.entries((c.deductionLimits ?? {}) as Record<string, string | null>).map(
      ([section, cap]) => ({ section, cap: cap ?? '' }),
    ),
    rebateOn: !!c.rebate,
    rebateMax: s((c.rebate as Record<string, unknown> | null)?.maxTaxableIncome),
    rebateAmount: s((c.rebate as Record<string, unknown> | null)?.maxRebate),
    rebateRelief: (c.rebate as Record<string, unknown> | null)?.marginalRelief === true,
    hraOn: !!c.hra,
    hraMetro: s((c.hra as Record<string, unknown> | null)?.metroPercentOfBasic),
    hraNonMetro: s((c.hra as Record<string, unknown> | null)?.nonMetroPercentOfBasic),
    hraRent: s((c.hra as Record<string, unknown> | null)?.rentExcessPercentOfBasic),
    wageComponentCodes: Array.isArray(c.wageComponentCodes)
      ? (c.wageComponentCodes as string[]).join(', ')
      : '',
    stateCode: r.stateCode ?? '',
  };
}

const list = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function payloadOf(d: Draft): Record<string, unknown> {
  const rounding = { scale: Number(str(d, 'scale') || '0'), mode: str(d, 'mode') || 'HALF_UP' };
  const base = {
    type: str(d, 'type'),
    name: str(d, 'name'),
    effectiveFrom: str(d, 'effectiveFrom'),
    effectiveTo: str(d, 'effectiveTo'),
    sourceReference: str(d, 'sourceReference'),
    notes: str(d, 'notes') || null,
  };
  const taxSlabs = (r: Row[]) =>
    r.map((x) => ({ upTo: blank(x.upTo ?? ''), ratePercent: x.ratePercent ?? '' }));
  switch (base.type) {
    case 'EPF':
      return {
        ...base,
        config: {
          employeeRatePercent: str(d, 'employeeRatePercent'),
          employerRatePercent: str(d, 'employerRatePercent'),
          epsRatePercent: str(d, 'epsRatePercent'),
          wageCeiling: blank(str(d, 'wageCeiling')),
          epsWageCeiling: blank(str(d, 'epsWageCeiling')),
          edliRatePercent: blank(str(d, 'edliRatePercent')),
          adminChargesPercent: blank(str(d, 'adminChargesPercent')),
          epsMaxAgeYears: blank(str(d, 'epsMaxAgeYears')),
          rounding,
        },
      };
    case 'ESI':
      return {
        ...base,
        config: {
          employeeRatePercent: str(d, 'employeeRatePercent'),
          employerRatePercent: str(d, 'employerRatePercent'),
          wageThreshold: str(d, 'wageThreshold'),
          contributionPeriods: rows(d, 'periods').map((p) => [Number(p.start), Number(p.end)]),
          rounding,
        },
      };
    case 'PT':
      return {
        ...base,
        config: {
          stateCode: str(d, 'stateCode'),
          slabs: rows(d, 'ptSlabs').map((x) => ({
            minWage: x.minWage ?? '',
            maxWage: blank(x.maxWage ?? ''),
            amount: x.amount ?? '',
            gender: blank(x.gender ?? ''),
            ...(list(x.monthAmounts ?? '').length
              ? {
                  monthAmounts: Object.fromEntries(
                    list(x.monthAmounts ?? '').map((p): [string, string] => {
                      const [m = '', a = ''] = p.split('=');
                      return [m.trim(), a.trim()];
                    }),
                  ),
                }
              : {}),
          })),
          ...(list(str(d, 'deductionMonths')).length
            ? { deductionMonths: list(str(d, 'deductionMonths')).map(Number) }
            : {}),
        },
      };
    case 'INCOME_TAX':
      return {
        ...base,
        config: {
          financialYear: str(d, 'financialYear'),
          regime: str(d, 'regime'),
          slabs: taxSlabs(rows(d, 'taxSlabs')),
          seniorSlabs: (Array.isArray(d.seniorSlabs)
            ? (d.seniorSlabs as { minAge: string; slabs: Row[] }[])
            : []
          ).map((g) => ({ minAge: g.minAge, slabs: taxSlabs(g.slabs) })),
          standardDeduction: str(d, 'standardDeduction'),
          rebate: bool(d, 'rebateOn')
            ? {
                maxTaxableIncome: str(d, 'rebateMax'),
                maxRebate: str(d, 'rebateAmount'),
                marginalRelief: bool(d, 'rebateRelief'),
              }
            : null,
          surcharge: rows(d, 'surcharge').map((x) => ({
            above: x.above ?? '',
            ratePercent: x.ratePercent ?? '',
          })),
          surchargeMarginalRelief: bool(d, 'surchargeMarginalRelief'),
          cessPercent: str(d, 'cessPercent'),
          deductionLimits: Object.fromEntries(
            rows(d, 'limits')
              .filter((x) => x.section)
              .map((x) => [x.section ?? '', blank(x.cap ?? '')]),
          ),
          employeePfSection: blank(str(d, 'employeePfSection')),
          professionalTaxDeductible: bool(d, 'professionalTaxDeductible'),
          hra: bool(d, 'hraOn')
            ? {
                metroPercentOfBasic: str(d, 'hraMetro'),
                nonMetroPercentOfBasic: str(d, 'hraNonMetro'),
                rentExcessPercentOfBasic: str(d, 'hraRent'),
              }
            : null,
          incomeRoundingMultiple: str(d, 'incomeRoundingMultiple'),
          taxRoundingMultiple: str(d, 'taxRoundingMultiple'),
        },
      };
    case 'GRATUITY':
      return {
        ...base,
        config: {
          daysPerYear: str(d, 'daysPerYear'),
          monthDivisor: str(d, 'monthDivisor'),
          minYears: str(d, 'minYears'),
          roundUpMonths: blank(str(d, 'roundUpMonths')),
          cap: blank(str(d, 'cap')),
          wageComponentCodes: list(str(d, 'wageComponentCodes')),
        },
      };
    default:
      return base;
  }
}

/**
 * Create or edit (draft) a statutory rule set. Fields start empty: every value must come from the
 * official source cited in "Source".
 */
export function RuleSetForm({
  initial,
  editingId,
  onDone,
}: {
  initial: StatutoryRuleSetItem | null;
  editingId: string | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftOf(initial));
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: Draft[string]) => {
    setD((x) => ({ ...x, [k]: v }));
  };
  const text = (
    k: string,
    label: string,
    opts: { required?: boolean; type?: string; description?: string; placeholder?: string } = {},
  ) => (
    <FormField label={label} required={opts.required ?? false} description={opts.description}>
      <Input
        type={opts.type ?? 'text'}
        value={str(d, k)}
        placeholder={opts.placeholder}
        onChange={(e) => {
          set(k, e.target.value);
        }}
      />
    </FormField>
  );
  const check = (k: string, label: string) => (
    <label className="flex items-center gap-2 self-end pb-2 text-sm">
      <Checkbox
        checked={bool(d, k)}
        onCheckedChange={(v) => {
          set(k, v === true);
        }}
      />{' '}
      {label}
    </label>
  );
  const rounding = (
    <>
      <FormField label="Rounding: decimals">
        <Select
          value={str(d, 'scale')}
          onChange={(e) => {
            set('scale', e.target.value);
          }}
          options={[
            { value: '0', label: 'Whole rupees' },
            { value: '2', label: 'Paise (2 decimals)' },
          ]}
        />
      </FormField>
      <FormField label="Rounding: mode">
        <Select
          value={str(d, 'mode')}
          onChange={(e) => {
            set('mode', e.target.value);
          }}
          options={ROUND_MODES}
        />
      </FormField>
    </>
  );
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editingId
        ? api.put(`/payroll/rule-sets/${editingId}`, body)
        : api.post('/payroll/rule-sets', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PAYROLL });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const type = str(d, 'type');
  const senior = Array.isArray(d.seniorSlabs)
    ? (d.seniorSlabs as { minAge: string; slabs: Row[] }[])
    : [];
  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <Alert tone="info">
          Enter every value from the official source you cite. Nothing is pre-filled; the rule set
          is saved as a draft until you activate it.
        </Alert>
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Rule type" required>
            <Select
              value={type}
              disabled={!!editingId}
              placeholder="Select…"
              onChange={(e) => {
                set('type', e.target.value);
              }}
              options={Object.entries(RULE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </FormField>
          {text('name', 'Name', { required: true })}
          {text('effectiveFrom', 'Effective from', { required: true, type: 'date' })}
          {text('effectiveTo', 'Effective to', { type: 'date' })}
          <FormField
            label="Source"
            required
            description="Notification, circular, Act section or schedule the values come from."
            className="sm:col-span-2"
          >
            <Input
              value={str(d, 'sourceReference')}
              onChange={(e) => {
                set('sourceReference', e.target.value);
              }}
            />
          </FormField>

          {type === 'EPF' ? (
            <>
              {text('employeeRatePercent', 'Employee rate (%)', { required: true })}
              {text('employerRatePercent', 'Employer rate (%)', { required: true })}
              {text('epsRatePercent', 'Pension (EPS) share of employer rate (%)', {
                required: true,
              })}
              {text('wageCeiling', 'Wage ceiling', {
                description: 'Blank = contributions on full PF wages.',
              })}
              {text('epsWageCeiling', 'Pension wage ceiling', {
                description: 'Blank = no ceiling.',
              })}
              {text('epsMaxAgeYears', 'Pension stops at age', {
                description: 'Blank = not applied.',
              })}
              {text('edliRatePercent', 'EDLI rate (%) — costing only')}
              {text('adminChargesPercent', 'Admin charges (%) — costing only')}
              {rounding}
            </>
          ) : null}

          {type === 'ESI' ? (
            <>
              {text('employeeRatePercent', 'Employee rate (%)', { required: true })}
              {text('employerRatePercent', 'Employer rate (%)', { required: true })}
              {text('wageThreshold', 'Coverage wage threshold (monthly)', { required: true })}
              {rounding}
              <RowsEditor
                label="Contribution period"
                addLabel="Add period"
                value={rows(d, 'periods')}
                onChange={(r) => {
                  set('periods', r);
                }}
                columns={[
                  { key: 'start', label: 'From month', options: MONTH_OPTIONS },
                  { key: 'end', label: 'To month', options: MONTH_OPTIONS },
                ]}
              />
            </>
          ) : null}

          {type === 'PT' ? (
            <>
              <FormField label="State" required>
                <Select
                  value={str(d, 'stateCode')}
                  placeholder="Select…"
                  onChange={(e) => {
                    set('stateCode', e.target.value);
                  }}
                  options={STATE_OPTIONS}
                />
              </FormField>
              {text('deductionMonths', 'Deduct only in months', {
                description: 'e.g. "9, 3"; blank = every month.',
              })}
              <RowsEditor
                label="Slab"
                addLabel="Add slab"
                value={rows(d, 'ptSlabs')}
                onChange={(r) => {
                  set('ptSlabs', r);
                }}
                columns={[
                  { key: 'minWage', label: 'From wages' },
                  { key: 'maxWage', label: 'To wages (blank = no limit)' },
                  { key: 'amount', label: 'Tax per month' },
                  {
                    key: 'gender',
                    label: 'Applies to',
                    options: [
                      { value: '', label: 'Everyone' },
                      { value: 'FEMALE', label: 'Women' },
                      { value: 'MALE', label: 'Men' },
                      { value: 'OTHER', label: 'Other' },
                    ],
                  },
                  { key: 'monthAmounts', label: 'Month overrides', placeholder: 'e.g. 2=300' },
                ]}
              />
            </>
          ) : null}

          {type === 'INCOME_TAX' ? (
            <>
              {text('financialYear', 'Financial year', {
                required: true,
                placeholder: 'e.g. 2026-27',
              })}
              <FormField label="Regime" required>
                <Select
                  value={str(d, 'regime')}
                  placeholder="Select…"
                  onChange={(e) => {
                    set('regime', e.target.value);
                  }}
                  options={[
                    { value: 'NEW', label: 'New regime' },
                    { value: 'OLD', label: 'Old regime' },
                  ]}
                />
              </FormField>
              <RowsEditor
                label="Tax band"
                addLabel="Add band"
                value={rows(d, 'taxSlabs')}
                onChange={(r) => {
                  set('taxSlabs', r);
                }}
                columns={[
                  { key: 'upTo', label: 'Up to (blank on the last band)' },
                  { key: 'ratePercent', label: 'Rate (%)' },
                ]}
              />
              {senior.map((g, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-md border border-border p-2 sm:col-span-2"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Age group ${String(i + 1)} minimum age`}
                      placeholder="Minimum age"
                      className="w-40"
                      value={g.minAge}
                      onChange={(e) => {
                        set(
                          'seniorSlabs',
                          senior.map((x, j) => (j === i ? { ...x, minAge: e.target.value } : x)),
                        );
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        set(
                          'seniorSlabs',
                          senior.filter((_, j) => j !== i),
                        );
                      }}
                    >
                      Remove age group
                    </Button>
                  </div>
                  <RowsEditor
                    label={`Age group ${String(i + 1)} band`}
                    addLabel="Add band"
                    value={g.slabs}
                    onChange={(r) => {
                      set(
                        'seniorSlabs',
                        senior.map((x, j) => (j === i ? { ...x, slabs: r } : x)),
                      );
                    }}
                    columns={[
                      { key: 'upTo', label: 'Up to' },
                      { key: 'ratePercent', label: 'Rate (%)' },
                    ]}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    set('seniorSlabs', [...senior, { minAge: '', slabs: [] }]);
                  }}
                >
                  <Plus /> Add age-specific bands
                </Button>
              </div>
              {text('standardDeduction', 'Standard deduction', { required: true })}
              {text('cessPercent', 'Cess (%)', { required: true })}
              {check('rebateOn', 'Rebate applies')}
              {bool(d, 'rebateOn') ? (
                <>
                  {text('rebateMax', 'Rebate: maximum taxable income', { required: true })}
                  {text('rebateAmount', 'Rebate: maximum rebate', { required: true })}
                  {check('rebateRelief', 'Marginal relief above the rebate limit')}
                </>
              ) : null}
              <RowsEditor
                label="Surcharge band"
                addLabel="Add surcharge band"
                value={rows(d, 'surcharge')}
                onChange={(r) => {
                  set('surcharge', r);
                }}
                columns={[
                  { key: 'above', label: 'Income above' },
                  { key: 'ratePercent', label: 'Rate (%)' },
                ]}
              />
              {check('surchargeMarginalRelief', 'Marginal relief on surcharge')}
              <RowsEditor
                label="Allowed deduction"
                addLabel="Add section"
                value={rows(d, 'limits')}
                onChange={(r) => {
                  set('limits', r);
                }}
                columns={[
                  { key: 'section', label: 'Section (e.g. 80C)' },
                  { key: 'cap', label: 'Annual cap (blank = no cap)' },
                ]}
              />
              {text('employeePfSection', 'Section for employee PF', {
                description: 'Blank = not deductible.',
              })}
              {check('professionalTaxDeductible', 'Professional tax is deductible')}
              {check('hraOn', 'HRA exemption applies')}
              {bool(d, 'hraOn') ? (
                <>
                  {text('hraMetro', 'HRA: % of basic (metro)', { required: true })}
                  {text('hraNonMetro', 'HRA: % of basic (non-metro)', { required: true })}
                  {text('hraRent', 'HRA: rent above % of basic', { required: true })}
                </>
              ) : null}
              {text('incomeRoundingMultiple', 'Round taxable income down to multiple of', {
                required: true,
              })}
              {text('taxRoundingMultiple', 'Round tax to multiple of', { required: true })}
            </>
          ) : null}

          {type === 'GRATUITY' ? (
            <>
              {text('daysPerYear', 'Days of wages per year of service', { required: true })}
              {text('monthDivisor', 'Days a month’s wages are divided by', { required: true })}
              {text('minYears', 'Minimum years of service', { required: true })}
              {text('roundUpMonths', 'Count a part year from months', {
                description: 'Blank = completed years only.',
              })}
              {text('cap', 'Maximum gratuity', { description: 'Blank = no cap.' })}
              {text('wageComponentCodes', 'Wage components', {
                required: true,
                placeholder: 'e.g. BASIC, DA',
              })}
            </>
          ) : null}

          <FormField label="Notes" className="sm:col-span-2">
            <Textarea
              value={str(d, 'notes')}
              onChange={(e) => {
                set('notes', e.target.value);
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
            const body = payloadOf(d);
            const parsed = statutoryRuleSetSchema.safeParse(body);
            if (!parsed.success) {
              const issue = parsed.error.issues[0];
              setError(
                issue ? `${issue.path.join(' › ') || 'Form'}: ${issue.message}` : 'Check the form',
              );
              return;
            }
            setError(null);
            save.mutate(body);
          }}
        >
          Save draft
        </Button>
      </DialogFooter>
    </>
  );
}
