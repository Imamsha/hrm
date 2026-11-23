/**
 * One employee's pay for one month (pure). Combines the salary structure, proration, one-time
 * adjustments, arrears, EPF, ESI, Professional Tax and TDS. Missing statutory configuration is
 * reported as a problem — never replaced by an assumed value.
 */
import {
  computeAnnualTax,
  hraExemption,
  type IncomeTaxConfig,
  monthlyTds,
  projectAnnual,
  remainingFyMonths,
  type TaxTraceStep,
} from './income-tax.js';
import { Decimal, type DecimalInput, roundMoney, toDecimal } from './money.js';
import { type PayLine, type Problem, prorateLines, sumLines } from './payroll-salary.js';
import {
  computeEpf,
  computeEsi,
  computePt,
  type EpfConfig,
  type EsiConfig,
  type Gender,
  type PtConfig,
} from './payroll-statutory.js';

/** Fixed identifiers of engine-computed lines (application codes, not statutory values). */
export const STATUTORY_CODES = {
  EPF_EMPLOYEE: 'EPF_EE',
  EPF_EMPLOYER: 'EPF_ER',
  EPS_EMPLOYER: 'EPS_ER',
  ESI_EMPLOYEE: 'ESI_EE',
  ESI_EMPLOYER: 'ESI_ER',
  PROFESSIONAL_TAX: 'PT',
  TDS: 'TDS',
} as const;

export type ResultCategory = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';

export interface ResultLine {
  code: string;
  name: string;
  category: ResultCategory;
  /** STRUCTURE (prorated salary), ADJUSTMENT (one-time), ARREARS or STATUTORY (computed). */
  source: 'STRUCTURE' | 'ADJUSTMENT' | 'ARREARS' | 'STATUTORY';
  amount: Decimal;
  taxable: boolean;
}

export interface TaxContext {
  config: IncomeTaxConfig;
  month: number;
  fyStartMonth?: number;
  ageYears: number | null;
  /** Declared deductions per section for the year (old regime). */
  declarations: Record<string, DecimalInput>;
  /** Annual rent declared for the HRA exemption, and whether the city is a metro. */
  rentPaidAnnual: DecimalInput;
  metro: boolean;
  /** Component codes used for the HRA exemption. */
  hraComponentCode: string | null;
  basicComponentCodes: string[];
  /** Amounts already paid this financial year (finalized runs before this month). */
  ytdTaxableGross: DecimalInput;
  ytdTds: DecimalInput;
  ytdEmployeePf: DecimalInput;
  ytdProfessionalTax: DecimalInput;
  ytdByComponent: Record<string, DecimalInput>;
}

export interface MonthlyPayInput {
  month: number;
  /** Full monthly structure lines (before proration). */
  structure: readonly PayLine[];
  /**
   * Full monthly lines expected for the rest of the year (TDS projection); defaults to
   * `structure`. Differs when `structure` was already prorated by salary segments.
   */
  recurringStructure?: readonly PayLine[];
  payableDays: DecimalInput;
  denominator: DecimalInput;
  adjustments: readonly {
    code: string;
    name: string;
    category: 'EARNING' | 'DEDUCTION';
    amount: DecimalInput;
    taxable: boolean;
    pfWage?: boolean;
    esiWage?: boolean;
    ptWage?: boolean;
  }[];
  arrears: readonly {
    code: string;
    name: string;
    amount: DecimalInput;
    taxable: boolean;
    pfWage?: boolean;
    esiWage?: boolean;
    ptWage?: boolean;
  }[];
  epf: { config: EpfConfig | null; epsEligible: boolean; voluntaryFullWages?: boolean } | null;
  esi: { config: EsiConfig | null; covered: boolean } | null;
  pt: { config: PtConfig | null; gender: Gender | null } | null;
  tax: (Omit<TaxContext, 'config'> & { config: IncomeTaxConfig | null }) | null;
}

export interface MonthlyPayResult {
  lines: ResultLine[];
  gross: Decimal;
  totalDeductions: Decimal;
  netPay: Decimal;
  employerCost: Decimal;
  wages: { pf: Decimal; esi: Decimal; pt: Decimal };
  tax: { projectedGross: Decimal; annualTax: Decimal; trace: TaxTraceStep[] } | null;
  problems: Problem[];
}

export function computeMonthlyPay(input: MonthlyPayInput): MonthlyPayResult {
  const problems: Problem[] = [];
  const prorated = prorateLines(input.structure, input.payableDays, input.denominator);
  const lines: ResultLine[] = [];
  for (const l of prorated) {
    if (l.amount.isZero()) continue;
    lines.push({
      code: l.code,
      name: l.name,
      category: l.kind,
      source: 'STRUCTURE',
      amount: l.amount,
      taxable: l.taxable,
    });
  }
  for (const a of input.arrears) {
    const amount = roundMoney(toDecimal(a.amount));
    if (!amount.isZero())
      lines.push({
        code: `ARR_${a.code}`,
        name: `${a.name} arrears`,
        category: 'EARNING',
        source: 'ARREARS',
        amount,
        taxable: a.taxable,
      });
  }
  for (const a of input.adjustments) {
    const amount = roundMoney(toDecimal(a.amount));
    if (!amount.isZero())
      lines.push({
        code: a.code,
        name: a.name,
        category: a.category,
        source: 'ADJUSTMENT',
        amount,
        taxable: a.taxable,
      });
  }

  const earnings = (
    where: (x: { pfWage?: boolean; esiWage?: boolean; ptWage?: boolean }) => boolean | undefined,
  ) =>
    sumLines(prorated, (l) => l.kind === 'EARNING' && Boolean(where(l)))
      .plus(
        input.arrears
          .filter((a) => where(a))
          .reduce((s, a) => s.plus(toDecimal(a.amount)), new Decimal(0)),
      )
      .plus(
        input.adjustments
          .filter((a) => a.category === 'EARNING' && where(a))
          .reduce((s, a) => s.plus(toDecimal(a.amount)), new Decimal(0)),
      );
  const pfWages = earnings((x) => x.pfWage);
  const esiWages = earnings((x) => x.esiWage);
  const ptWages = earnings((x) => x.ptWage);

  const push = (code: string, name: string, category: ResultCategory, amount: Decimal) => {
    if (!amount.isZero())
      lines.push({ code, name, category, source: 'STATUTORY', amount, taxable: false });
  };

  let employeePf = new Decimal(0);
  if (input.epf) {
    if (!input.epf.config)
      problems.push({
        code: 'EPF_RULE_MISSING',
        message: 'No active EPF rule set covers this month',
      });
    else {
      const r = computeEpf({
        pfWages,
        config: input.epf.config,
        epsEligible: input.epf.epsEligible,
        voluntaryFullWages: input.epf.voluntaryFullWages ?? false,
      });
      employeePf = r.employee;
      push(STATUTORY_CODES.EPF_EMPLOYEE, 'Provident fund', 'DEDUCTION', r.employee);
      push(
        STATUTORY_CODES.EPF_EMPLOYER,
        'Employer provident fund',
        'EMPLOYER_CONTRIBUTION',
        r.employerEpf,
      );
      push(
        STATUTORY_CODES.EPS_EMPLOYER,
        'Employer pension scheme',
        'EMPLOYER_CONTRIBUTION',
        r.employerEps,
      );
    }
  }
  if (input.esi?.covered) {
    if (!input.esi.config)
      problems.push({
        code: 'ESI_RULE_MISSING',
        message: 'No active ESI rule set covers this month',
      });
    else {
      const r = computeEsi({ esiWages, covered: true, config: input.esi.config });
      push(STATUTORY_CODES.ESI_EMPLOYEE, 'Employee state insurance', 'DEDUCTION', r.employee);
      push(
        STATUTORY_CODES.ESI_EMPLOYER,
        'Employer state insurance',
        'EMPLOYER_CONTRIBUTION',
        r.employer,
      );
    }
  }
  let pt = new Decimal(0);
  if (input.pt) {
    if (!input.pt.config)
      problems.push({
        code: 'PT_RULE_MISSING',
        message: 'No active Professional Tax rule set for the employee’s state covers this month',
      });
    else {
      pt = computePt({
        ptWages,
        month: input.month,
        gender: input.pt.gender,
        config: input.pt.config,
      }).amount;
      push(STATUTORY_CODES.PROFESSIONAL_TAX, 'Professional tax', 'DEDUCTION', pt);
    }
  }

  let tax: MonthlyPayResult['tax'] = null;
  if (input.tax) {
    const t = input.tax;
    if (!t.config)
      problems.push({
        code: 'TAX_RULE_MISSING',
        message:
          'No active income-tax rule set for the employee’s regime covers this financial year',
      });
    else {
      const remaining = remainingFyMonths(t.month, t.fyStartMonth ?? 4);
      const after = remaining - 1;
      const currentTaxable = lines
        .filter((l) => l.category === 'EARNING' && l.taxable)
        .reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const recurring = sumLines(
        input.recurringStructure ?? input.structure,
        (l) => l.kind === 'EARNING' && l.taxable,
      );
      const projectedGross = projectAnnual({
        paidToDate: t.ytdTaxableGross,
        currentMonth: currentTaxable,
        recurringMonthly: recurring,
        monthsAfterCurrent: after,
      });
      const annualOf = (codes: string[]) =>
        codes.reduce((s, code) => {
          const full =
            (input.recurringStructure ?? input.structure).find((l) => l.code === code)?.amount ??
            new Decimal(0);
          const now = prorated.find((l) => l.code === code)?.amount ?? new Decimal(0);
          return s
            .plus(toDecimal(t.ytdByComponent[code] ?? 0))
            .plus(now)
            .plus(full.times(after));
        }, new Decimal(0));
      let exemptions = new Decimal(0);
      if (t.config.hra && t.hraComponentCode && toDecimal(t.rentPaidAnnual).greaterThan(0)) {
        exemptions = hraExemption({
          hraReceived: annualOf([t.hraComponentCode]),
          basic: annualOf(t.basicComponentCodes),
          rentPaid: t.rentPaidAnnual,
          metro: t.metro,
          rule: t.config.hra,
        });
      }
      const annual = computeAnnualTax({
        grossSalary: projectedGross,
        exemptions,
        deductions: t.declarations,
        employeePf: toDecimal(t.ytdEmployeePf).plus(employeePf.times(remaining)),
        professionalTax: toDecimal(t.ytdProfessionalTax).plus(pt.times(remaining)),
        ageYears: t.ageYears,
        config: t.config,
      });
      const tds = monthlyTds({
        annualTax: annual.totalTax,
        deductedToDate: t.ytdTds,
        remainingMonthsIncludingCurrent: remaining,
      });
      push(STATUTORY_CODES.TDS, 'Income tax (TDS)', 'DEDUCTION', tds);
      tax = { projectedGross, annualTax: annual.totalTax, trace: annual.trace };
    }
  }

  const gross = lines
    .filter((l) => l.category === 'EARNING')
    .reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const totalDeductions = lines
    .filter((l) => l.category === 'DEDUCTION')
    .reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const employer = lines
    .filter((l) => l.category === 'EMPLOYER_CONTRIBUTION')
    .reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const netPay = gross.minus(totalDeductions);
  if (netPay.isNegative())
    problems.push({
      code: 'NEGATIVE_NET_PAY',
      message: `Deductions exceed earnings by ${netPay.abs().toFixed(2)}`,
    });
  return {
    lines,
    gross,
    totalDeductions,
    netPay,
    employerCost: gross.plus(employer),
    wages: { pf: pfWages, esi: esiWages, pt: ptWages },
    tax,
    problems,
  };
}
