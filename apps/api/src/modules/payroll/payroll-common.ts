import {
  breakdownFromCtc,
  computeEpf,
  computeEsi,
  type ComponentCalc,
  Decimal,
  type EpfConfig,
  type EsiConfig,
  esiCovered,
  esiPeriodFor,
  type PayLine,
  type Problem,
  type StructureComponent,
  sumLines,
  toMoneyString,
} from '@hrm/business-rules';
import type { SalaryLineItem } from '@hrm/shared-types';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { isoDate, toDate } from '../employees/employee-scope.js';

/** Decimal / Prisma.Decimal / string → fixed 2-decimal string. */
export const money = (v: { toString(): string } | string | number | null | undefined): string =>
  toMoneyString(v === null || v === undefined ? '0' : String(v));
export const moneyOrNull = (v: { toString(): string } | null | undefined): string | null =>
  v === null || v === undefined ? null : money(v);

/**
 * Indian financial year (April–March) containing a month — the year structure of the Income-tax
 * Act, not a rate or threshold.
 */
export const FY_START_MONTH = 4;
export function financialYearOf(year: number, month: number): string {
  const start = month >= FY_START_MONTH ? year : year - 1;
  return `${String(start)}-${String((start + 1) % 100).padStart(2, '0')}`;
}
/** Months of a financial year before (year, month), as [year, month] pairs. */
export function fyMonthsBefore(year: number, month: number): [number, number][] {
  const out: [number, number][] = [];
  let y = month >= FY_START_MONTH ? year : year - 1;
  let m = FY_START_MONTH;
  while (!(y === year && m === month)) {
    out.push([y, m]);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function monthBounds(
  year: number,
  month: number,
): { start: string; end: string; days: number } {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    start: `${String(year)}-${mm}-01`,
    end: `${String(year)}-${mm}-${String(days).padStart(2, '0')}`,
    days,
  };
}

/** Whole years of age on a date. */
export function ageOn(dateOfBirth: Date | null, on: string): number | null {
  if (!dateOfBirth) return null;
  const dob = isoDate(dateOfBirth);
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

// ------------------------------------------------------------------------------ rule sets

export interface ActiveRule<T> {
  id: string;
  name: string;
  effectiveFrom: string;
  config: T;
}

/** The ACTIVE rule set of a type (and scope) in force on a date, or null — never a default. */
export async function activeRuleSet<T>(
  tx: TenantTransaction,
  type: 'EPF' | 'ESI' | 'PT' | 'INCOME_TAX' | 'GRATUITY',
  on: string,
  scope: { stateCode?: string; regime?: 'OLD' | 'NEW' } = {},
): Promise<ActiveRule<T> | null> {
  const r = await tx.statutoryRuleSet.findFirst({
    where: {
      type,
      status: 'ACTIVE',
      effectiveFrom: { lte: toDate(on) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(on) } }],
      ...(scope.stateCode ? { stateCode: scope.stateCode } : {}),
      ...(scope.regime ? { regime: scope.regime } : {}),
    },
    orderBy: { effectiveFrom: 'desc' },
    select: { id: true, name: true, effectiveFrom: true, config: true },
  });
  return r
    ? { id: r.id, name: r.name, effectiveFrom: isoDate(r.effectiveFrom), config: r.config as T }
    : null;
}

// ------------------------------------------------------------------------------ structures

export interface StructureDef {
  id: string;
  name: string;
  employerStatutoryInCtc: boolean;
  components: StructureComponent[];
}

export async function loadStructures(
  tx: TenantTransaction,
  ids: string[],
): Promise<Map<string, StructureDef>> {
  const rows = await tx.salaryStructure.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      name: true,
      employerStatutoryInCtc: true,
      components: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          calcType: true,
          percent: true,
          monthlyAmount: true,
          baseComponent: { select: { code: true } },
          component: {
            select: {
              code: true,
              name: true,
              kind: true,
              taxable: true,
              pfWage: true,
              esiWage: true,
              ptWage: true,
              prorate: true,
            },
          },
        },
      },
    },
  });
  return new Map(
    rows.map((s) => [
      s.id,
      {
        id: s.id,
        name: s.name,
        employerStatutoryInCtc: s.employerStatutoryInCtc,
        components: s.components.map((c): StructureComponent => {
          let calc: ComponentCalc;
          if (c.calcType === 'FIXED')
            calc = { type: 'FIXED', monthlyAmount: String(c.monthlyAmount ?? 0) };
          else if (c.calcType === 'PERCENT_OF_CTC')
            calc = { type: 'PERCENT_OF_CTC', percent: String(c.percent ?? 0) };
          else if (c.calcType === 'PERCENT_OF_COMPONENT')
            calc = {
              type: 'PERCENT_OF_COMPONENT',
              percent: String(c.percent ?? 0),
              componentCode: c.baseComponent?.code ?? '',
            };
          else calc = { type: 'BALANCING' };
          return { ...c.component, calc };
        }),
      },
    ]),
  );
}

export interface SalaryRow {
  id: string;
  employeeId: string;
  structureId: string;
  annualCtc: string;
  effectiveFrom: string;
}

/** Salaries of employees effective on or before `to`, ascending (latest last). */
export async function salariesUpTo(
  tx: TenantTransaction,
  employeeIds: string[],
  to: string,
): Promise<Map<string, SalaryRow[]>> {
  const rows = await tx.employeeSalary.findMany({
    where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: toDate(to) } },
    orderBy: { effectiveFrom: 'asc' },
    select: { id: true, employeeId: true, structureId: true, annualCtc: true, effectiveFrom: true },
  });
  const out = new Map<string, SalaryRow[]>();
  for (const r of rows) {
    const list = out.get(r.employeeId) ?? [];
    list.push({
      id: r.id,
      employeeId: r.employeeId,
      structureId: r.structureId,
      annualCtc: String(r.annualCtc),
      effectiveFrom: isoDate(r.effectiveFrom),
    });
    out.set(r.employeeId, list);
  }
  return out;
}

export function salaryOn(list: readonly SalaryRow[] | undefined, on: string): SalaryRow | null {
  let found: SalaryRow | null = null;
  for (const s of list ?? []) if (s.effectiveFrom <= on) found = s;
  return found;
}

/**
 * Monthly breakdown of a salary. When the structure puts the employer's statutory contributions
 * inside CTC, they are reserved from the balancing component using the ACTIVE rule sets — two
 * passes (the contributions depend on the wages the balance produces).
 */
export function salaryBreakdown(
  salary: SalaryRow,
  structure: StructureDef,
  employer: {
    epf: { config: EpfConfig; epsEligible: boolean } | null;
    esi: { config: EsiConfig } | null;
  },
): { lines: PayLine[]; monthlyCtc: Decimal; problems: Problem[]; reserved: Decimal } {
  const first = breakdownFromCtc(salary.annualCtc, structure.components);
  if (!structure.employerStatutoryInCtc) return { ...first, reserved: new Decimal(0) };
  const employerCost = (lines: PayLine[]) => {
    let cost = new Decimal(0);
    if (employer.epf) {
      const r = computeEpf({
        pfWages: sumLines(lines, (l) => l.kind === 'EARNING' && l.pfWage),
        config: employer.epf.config,
        epsEligible: employer.epf.epsEligible,
      });
      cost = cost.plus(r.employerEpf).plus(r.employerEps);
    }
    if (employer.esi) {
      const wages = sumLines(lines, (l) => l.kind === 'EARNING' && l.esiWage);
      if (esiCovered(wages, employer.esi.config))
        cost = cost.plus(
          computeEsi({ esiWages: wages, covered: true, config: employer.esi.config }).employer,
        );
    }
    return cost;
  };
  const r1 = employerCost(first.lines);
  const second = breakdownFromCtc(salary.annualCtc, structure.components, r1);
  const r2 = employerCost(second.lines);
  const final = r2.equals(r1)
    ? second
    : breakdownFromCtc(salary.annualCtc, structure.components, r2);
  return { ...final, reserved: r2 };
}

export function toSalaryLines(lines: readonly PayLine[]): SalaryLineItem[] {
  return lines.map((l) => ({
    code: l.code,
    name: l.name,
    kind: l.kind,
    monthly: money(l.amount),
    annual: money(l.amount.times(12)),
  }));
}

/** First month (1–12) of the ESI contribution period containing `month`. */
export function esiPeriodStartMonth(month: number, config: EsiConfig): number | null {
  return esiPeriodFor(month, config.contributionPeriods)?.[0] ?? null;
}
