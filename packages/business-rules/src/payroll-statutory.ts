/**
 * Statutory contribution formulas (pure, Decimal only). Every rate, ceiling, threshold, slab and
 * rounding rule is a parameter from the organization's active rule set — none is assumed here.
 * Rates are percentages as decimal strings ("12" = 12 %).
 */
import { Decimal, type DecimalInput, type RoundingMode, roundMoney, toDecimal } from './money.js';

export interface RoundingRule {
  /** Decimal places of the result (0 = whole rupees). */
  scale: 0 | 2;
  mode: RoundingMode;
}

const pct = (amount: Decimal, percent: string) => amount.times(toDecimal(percent)).dividedBy(100);
const round = (v: Decimal, r: RoundingRule) => roundMoney(v, r.scale, r.mode);

// --------------------------------------------------------------------------------------- EPF

export interface EpfConfig {
  employeeRatePercent: string;
  /** Employer's total contribution rate; the pension (EPS) share is carved out of it. */
  employerRatePercent: string;
  /** Pension scheme share of the employer contribution. */
  epsRatePercent: string;
  /** Wage ceiling for the pension share; null = no ceiling. */
  epsWageCeiling: string | null;
  /** Wage ceiling for the employee and employer contributions; null = full PF wages. */
  wageCeiling: string | null;
  /** Employer-side charges reported for costing (not deducted from pay); optional. */
  edliRatePercent?: string | null;
  adminChargesPercent?: string | null;
  rounding: RoundingRule;
}

export interface EpfResult {
  pfWages: Decimal;
  contributionWages: Decimal;
  employee: Decimal;
  employerEpf: Decimal;
  employerEps: Decimal;
  edli: Decimal;
  adminCharges: Decimal;
}

/**
 * EPF for a month. `voluntaryFullWages` lets an employee contribute on wages above the ceiling
 * where the organization allows it; `epsEligible` is false for members not in the pension
 * scheme (the whole employer share then goes to EPF).
 */
export function computeEpf(input: {
  pfWages: DecimalInput;
  config: EpfConfig;
  epsEligible: boolean;
  voluntaryFullWages?: boolean;
}): EpfResult {
  const { config: c } = input;
  const wages = Decimal.max(0, toDecimal(input.pfWages));
  const capped = c.wageCeiling ? Decimal.min(wages, toDecimal(c.wageCeiling)) : wages;
  const employeeBase = input.voluntaryFullWages ? wages : capped;
  const employee = round(pct(employeeBase, c.employeeRatePercent), c.rounding);
  const employerTotal = round(pct(capped, c.employerRatePercent), c.rounding);
  const epsBase = c.epsWageCeiling ? Decimal.min(wages, toDecimal(c.epsWageCeiling)) : wages;
  const eps = input.epsEligible
    ? Decimal.min(round(pct(epsBase, c.epsRatePercent), c.rounding), employerTotal)
    : new Decimal(0);
  return {
    pfWages: wages,
    contributionWages: capped,
    employee,
    employerEps: eps,
    employerEpf: employerTotal.minus(eps),
    edli: c.edliRatePercent ? round(pct(capped, c.edliRatePercent), c.rounding) : new Decimal(0),
    adminCharges: c.adminChargesPercent
      ? round(pct(capped, c.adminChargesPercent), c.rounding)
      : new Decimal(0),
  };
}

// --------------------------------------------------------------------------------------- ESI

export interface EsiConfig {
  employeeRatePercent: string;
  employerRatePercent: string;
  /** Employees whose ESI wages are at or below this at the start of a contribution period are covered. */
  wageThreshold: string;
  /** Contribution periods as [startMonth, endMonth] (1–12), e.g. two half-years. */
  contributionPeriods: [number, number][];
  rounding: RoundingRule;
}

/** The contribution period containing `month` (handles periods that wrap the year end). */
export function esiPeriodFor(
  month: number,
  periods: readonly [number, number][],
): [number, number] | null {
  for (const [start, end] of periods) {
    const inside = start <= end ? month >= start && month <= end : month >= start || month <= end;
    if (inside) return [start, end];
  }
  return null;
}

/**
 * Coverage is decided once per contribution period from the wages at its start and then holds
 * for the whole period, even if wages rise above the threshold during it.
 */
export function esiCovered(wagesAtPeriodStart: DecimalInput, config: EsiConfig): boolean {
  return toDecimal(wagesAtPeriodStart).lessThanOrEqualTo(toDecimal(config.wageThreshold));
}

export function computeEsi(input: {
  esiWages: DecimalInput;
  covered: boolean;
  config: EsiConfig;
}): {
  esiWages: Decimal;
  employee: Decimal;
  employer: Decimal;
} {
  const wages = Decimal.max(0, toDecimal(input.esiWages));
  if (!input.covered)
    return { esiWages: wages, employee: new Decimal(0), employer: new Decimal(0) };
  return {
    esiWages: wages,
    employee: round(pct(wages, input.config.employeeRatePercent), input.config.rounding),
    employer: round(pct(wages, input.config.employerRatePercent), input.config.rounding),
  };
}

// --------------------------------------------------------------------------- Professional tax

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export interface PtSlab {
  /** Inclusive lower bound of monthly PT wages. */
  minWage: string;
  /** Inclusive upper bound; null = no upper bound. */
  maxWage: string | null;
  amount: string;
  /** Slab applies only to this gender; null = everyone (a gender-specific slab wins). */
  gender?: Gender | null;
  /** Month-specific amounts (1–12), e.g. a different final instalment. */
  monthAmounts?: Partial<Record<string, string>>;
}

export interface PtConfig {
  /** ISO 3166-2:IN subdivision code, e.g. "IN-MH". */
  stateCode: string;
  slabs: PtSlab[];
  /** Months (1–12) in which PT is deducted; empty or absent = every month. */
  deductionMonths?: number[];
}

/** Professional Tax for a month, or zero when the state's rule does not deduct in that month. */
export function computePt(input: {
  ptWages: DecimalInput;
  month: number;
  gender: Gender | null;
  config: PtConfig;
}): { amount: Decimal; slab: PtSlab | null } {
  const { config } = input;
  if (config.deductionMonths?.length && !config.deductionMonths.includes(input.month))
    return { amount: new Decimal(0), slab: null };
  const wages = toDecimal(input.ptWages);
  const fits = (s: PtSlab) =>
    wages.greaterThanOrEqualTo(toDecimal(s.minWage)) &&
    (s.maxWage === null || wages.lessThanOrEqualTo(toDecimal(s.maxWage)));
  const specific = config.slabs.find((s) => s.gender && s.gender === input.gender && fits(s));
  const slab = specific ?? config.slabs.find((s) => !s.gender && fits(s)) ?? null;
  if (!slab) return { amount: new Decimal(0), slab: null };
  const amount = slab.monthAmounts?.[String(input.month)] ?? slab.amount;
  return { amount: toDecimal(amount), slab };
}
