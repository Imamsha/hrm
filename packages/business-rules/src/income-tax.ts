/**
 * Income tax on salary (pure, Decimal only) for one financial year and regime. Slabs, the standard
 * deduction, rebate and its marginal relief, surcharge bands and their marginal relief, cess,
 * deduction limits, HRA rules and rounding are all parameters of the organization's active
 * rule set — none is assumed here. Rates are percentages as decimal strings.
 */
import { Decimal, type DecimalInput, roundMoney, toDecimal } from './money.js';

export type TaxRegime = 'OLD' | 'NEW';

export interface TaxSlab {
  /** Inclusive upper bound of the band; null = no upper bound (last band). */
  upTo: string | null;
  ratePercent: string;
}

export interface SurchargeBand {
  /** Surcharge applies when total income exceeds this amount. */
  above: string;
  ratePercent: string;
}

export interface IncomeTaxConfig {
  /** e.g. "2026-27"; informational, the rule set's effective dates decide applicability. */
  financialYear: string;
  regime: TaxRegime;
  /** Default slabs, and optional age-specific slabs. */
  slabs: TaxSlab[];
  seniorSlabs?: { minAge: number; slabs: TaxSlab[] }[];
  standardDeduction: string;
  rebate: { maxTaxableIncome: string; maxRebate: string; marginalRelief: boolean } | null;
  surcharge: SurchargeBand[];
  surchargeMarginalRelief: boolean;
  cessPercent: string;
  /** Deduction sections allowed in this regime with their annual caps (null = uncapped). */
  deductionLimits: Record<string, string | null>;
  /** Section the employee's own PF contribution counts towards (null = not deductible). */
  employeePfSection: string | null;
  /** Whether Professional Tax paid is deductible from salary income in this regime. */
  professionalTaxDeductible: boolean;
  /** HRA exemption rule; null = no HRA exemption in this regime. */
  hra: {
    metroPercentOfBasic: string;
    nonMetroPercentOfBasic: string;
    rentExcessPercentOfBasic: string;
  } | null;
  /** Taxable income rounded down to this multiple (e.g. 10); 1 = no rounding. */
  incomeRoundingMultiple: string;
  /** Final tax rounded half-up to this multiple; 1 = rupee. */
  taxRoundingMultiple: string;
}

export interface TaxTraceStep {
  label: string;
  amount: string;
}

export interface AnnualTaxResult {
  grossSalary: Decimal;
  standardDeduction: Decimal;
  exemptions: Decimal;
  deductions: Decimal;
  taxableIncome: Decimal;
  slabTax: Decimal;
  rebate: Decimal;
  surcharge: Decimal;
  cess: Decimal;
  totalTax: Decimal;
  trace: TaxTraceStep[];
}

const D0 = new Decimal(0);
const pct = (v: Decimal, p: string) => v.times(toDecimal(p)).dividedBy(100);

function roundToMultiple(v: Decimal, multiple: string, mode: 'DOWN' | 'HALF_UP'): Decimal {
  const m = toDecimal(multiple);
  if (m.lessThanOrEqualTo(1))
    return mode === 'DOWN' ? v.floor() : v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const q = v.dividedBy(m);
  return (mode === 'DOWN' ? q.floor() : q.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)).times(m);
}

/** Progressive tax over ordered bands. */
export function slabTax(income: DecimalInput, slabs: readonly TaxSlab[]): Decimal {
  const amount = toDecimal(income);
  let tax = D0;
  let lower = D0;
  for (const s of slabs) {
    const upper = s.upTo === null ? null : toDecimal(s.upTo);
    if (amount.lessThanOrEqualTo(lower)) break;
    const top = upper === null ? amount : Decimal.min(amount, upper);
    tax = tax.plus(pct(top.minus(lower), s.ratePercent));
    if (upper === null) break;
    lower = upper;
  }
  return tax;
}

function slabsFor(config: IncomeTaxConfig, age: number | null): TaxSlab[] {
  if (age === null || !config.seniorSlabs?.length) return config.slabs;
  const match = [...config.seniorSlabs]
    .sort((a, b) => b.minAge - a.minAge)
    .find((s) => age >= s.minAge);
  return match?.slabs ?? config.slabs;
}

/** Tax after rebate (with optional marginal relief) on a taxable income. */
function taxAfterRebate(
  income: Decimal,
  config: IncomeTaxConfig,
  slabs: TaxSlab[],
): { tax: Decimal; rebate: Decimal } {
  const base = slabTax(income, slabs);
  const r = config.rebate;
  if (!r) return { tax: base, rebate: D0 };
  const limit = toDecimal(r.maxTaxableIncome);
  if (income.lessThanOrEqualTo(limit)) {
    const rebate = Decimal.min(base, toDecimal(r.maxRebate));
    return { tax: base.minus(rebate), rebate };
  }
  if (r.marginalRelief) {
    // Tax payable may not exceed the income above the rebate limit.
    const excess = income.minus(limit);
    if (base.greaterThan(excess)) return { tax: excess, rebate: base.minus(excess) };
  }
  return { tax: base, rebate: D0 };
}

function surchargeRate(income: Decimal, bands: readonly SurchargeBand[]): SurchargeBand | null {
  return (
    [...bands]
      .sort((a, b) => toDecimal(b.above).comparedTo(toDecimal(a.above)))
      .find((b) => income.greaterThan(toDecimal(b.above))) ?? null
  );
}

/** Tax plus surcharge, applying marginal relief at the band threshold when configured. */
function withSurcharge(
  income: Decimal,
  tax: Decimal,
  config: IncomeTaxConfig,
  slabs: TaxSlab[],
): Decimal {
  const band = surchargeRate(income, config.surcharge);
  if (!band) return D0;
  const surcharge = pct(tax, band.ratePercent);
  if (!config.surchargeMarginalRelief) return surcharge;
  const threshold = toDecimal(band.above);
  const taxAtThreshold = taxAfterRebate(threshold, config, slabs).tax;
  const surchargeAtThreshold = withSurcharge(threshold, taxAtThreshold, config, slabs);
  const ceiling = taxAtThreshold.plus(surchargeAtThreshold).plus(income.minus(threshold));
  return Decimal.max(D0, Decimal.min(surcharge, ceiling.minus(tax)));
}

/**
 * Annual tax on salary income. `exemptions` are salary exemptions already computed (e.g. HRA);
 * `deductions` are claimed amounts per section — only sections allowed by the regime count,
 * each up to its cap.
 */
export function computeAnnualTax(input: {
  grossSalary: DecimalInput;
  exemptions?: DecimalInput;
  deductions?: Record<string, DecimalInput>;
  employeePf?: DecimalInput;
  professionalTax?: DecimalInput;
  ageYears?: number | null;
  config: IncomeTaxConfig;
}): AnnualTaxResult {
  const c = input.config;
  const trace: TaxTraceStep[] = [];
  const step = (label: string, v: Decimal) => {
    trace.push({ label, amount: roundMoney(v).toFixed(2) });
  };
  const gross = toDecimal(input.grossSalary);
  step('Gross taxable salary', gross);
  const exemptions = toDecimal(input.exemptions ?? 0);
  if (!exemptions.isZero()) step('Exemptions', exemptions.negated());
  const sd = Decimal.min(toDecimal(c.standardDeduction), Decimal.max(D0, gross.minus(exemptions)));
  step('Standard deduction', sd.negated());

  const claimed = new Map<string, Decimal>();
  for (const [section, amount] of Object.entries(input.deductions ?? {}))
    claimed.set(section, (claimed.get(section) ?? D0).plus(toDecimal(amount)));
  if (c.employeePfSection && input.employeePf)
    claimed.set(
      c.employeePfSection,
      (claimed.get(c.employeePfSection) ?? D0).plus(toDecimal(input.employeePf)),
    );
  let deductions = D0;
  for (const [section, amount] of claimed) {
    if (!(section in c.deductionLimits)) continue;
    const cap = c.deductionLimits[section];
    const allowed =
      cap === null || cap === undefined ? amount : Decimal.min(amount, toDecimal(cap));
    if (allowed.greaterThan(0)) {
      deductions = deductions.plus(allowed);
      step(`Deduction ${section}`, allowed.negated());
    }
  }
  if (c.professionalTaxDeductible && input.professionalTax) {
    const pt = toDecimal(input.professionalTax);
    deductions = deductions.plus(pt);
    step('Professional tax', pt.negated());
  }

  const taxableRaw = Decimal.max(D0, gross.minus(exemptions).minus(sd).minus(deductions));
  const taxable = roundToMultiple(taxableRaw, c.incomeRoundingMultiple, 'DOWN');
  step('Taxable income', taxable);
  const slabs = slabsFor(c, input.ageYears ?? null);
  const base = slabTax(taxable, slabs);
  step('Tax on slabs', base);
  const { tax, rebate } = taxAfterRebate(taxable, c, slabs);
  if (!rebate.isZero()) step('Rebate', rebate.negated());
  const surcharge = withSurcharge(taxable, tax, c, slabs);
  if (!surcharge.isZero()) step('Surcharge', surcharge);
  const cess = pct(tax.plus(surcharge), c.cessPercent);
  if (!cess.isZero()) step('Cess', cess);
  const total = roundToMultiple(tax.plus(surcharge).plus(cess), c.taxRoundingMultiple, 'HALF_UP');
  step('Total tax', total);
  return {
    grossSalary: gross,
    standardDeduction: sd,
    exemptions,
    deductions,
    taxableIncome: taxable,
    slabTax: base,
    rebate,
    surcharge,
    cess,
    totalTax: total,
    trace,
  };
}

/**
 * HRA exemption for a year: the least of the HRA received, rent paid above a percentage of basic,
 * and a percentage of basic depending on whether the city is a metro (all configured).
 */
export function hraExemption(input: {
  hraReceived: DecimalInput;
  basic: DecimalInput;
  rentPaid: DecimalInput;
  metro: boolean;
  rule: NonNullable<IncomeTaxConfig['hra']>;
}): Decimal {
  const basic = toDecimal(input.basic);
  const rentExcess = toDecimal(input.rentPaid).minus(
    pct(basic, input.rule.rentExcessPercentOfBasic),
  );
  const cap = pct(
    basic,
    input.metro ? input.rule.metroPercentOfBasic : input.rule.nonMetroPercentOfBasic,
  );
  return Decimal.max(D0, Decimal.min(toDecimal(input.hraReceived), rentExcess, cap));
}

/**
 * Projected annual salary: what was paid so far this year, this month's taxable pay, and the
 * recurring monthly taxable pay for the months after this one.
 */
export function projectAnnual(input: {
  paidToDate: DecimalInput;
  currentMonth: DecimalInput;
  recurringMonthly: DecimalInput;
  monthsAfterCurrent: number;
}): Decimal {
  return toDecimal(input.paidToDate)
    .plus(toDecimal(input.currentMonth))
    .plus(toDecimal(input.recurringMonthly).times(Math.max(0, input.monthsAfterCurrent)));
}

/**
 * This month's TDS: the annual tax not yet deducted, spread evenly over the remaining months
 * (this month included), never negative. Rounded to whole rupees half-up.
 */
export function monthlyTds(input: {
  annualTax: DecimalInput;
  deductedToDate: DecimalInput;
  remainingMonthsIncludingCurrent: number;
}): Decimal {
  const remaining = Math.max(1, input.remainingMonthsIncludingCurrent);
  const due = toDecimal(input.annualTax).minus(toDecimal(input.deductedToDate));
  if (due.lessThanOrEqualTo(0)) return D0;
  return roundMoney(due.dividedBy(remaining), 0, 'HALF_UP');
}

/** Months left in an April–March financial year from `month` (1–12), this month included. */
export function remainingFyMonths(month: number, fyStartMonth = 4): number {
  const index = (month - fyStartMonth + 12) % 12;
  return 12 - index;
}
