/**
 * Salary structure rules (pure, Decimal only). How CTC is split into components is the
 * organization's own configuration — no component, percentage or amount is assumed here.
 */
import { Decimal, type DecimalInput, roundMoney, toDecimal } from './money.js';

export type ComponentKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';

/** How a structure computes a component's monthly amount. */
export type ComponentCalc =
  | { type: 'FIXED'; monthlyAmount: string }
  | { type: 'PERCENT_OF_CTC'; percent: string }
  | { type: 'PERCENT_OF_COMPONENT'; percent: string; componentCode: string }
  /** Monthly CTC minus every other earning and employer contribution (e.g. a special allowance). */
  | { type: 'BALANCING' };

export interface ComponentFlags {
  /** Counts as taxable salary income. */
  taxable: boolean;
  /** Part of PF wages. */
  pfWage: boolean;
  /** Part of ESI wages. */
  esiWage: boolean;
  /** Part of the wages Professional Tax slabs are applied to. */
  ptWage: boolean;
  /** Reduced in proportion to payable days. */
  prorate: boolean;
}

export interface StructureComponent extends ComponentFlags {
  code: string;
  name: string;
  kind: ComponentKind;
  calc: ComponentCalc;
}

export interface PayLine extends ComponentFlags {
  code: string;
  name: string;
  kind: ComponentKind;
  /** Monthly amount, 2 decimals. */
  amount: Decimal;
}

export interface Problem {
  code: string;
  message: string;
}

const MONTHS = 12;

/**
 * Monthly component amounts for an annual CTC. Percentages of other components are resolved in
 * dependency order; at most one BALANCING component absorbs the remainder of the monthly CTC.
 * Returns problems instead of throwing for configuration errors (cycles, negative balance).
 *
 * `reservedMonthly` is part of the monthly CTC kept out of the balancing component — e.g. the
 * employer's statutory contributions when the organization includes them in CTC (computed by the
 * caller from the active rule sets, so no rate is assumed here).
 */
export function breakdownFromCtc(
  annualCtc: DecimalInput,
  components: readonly StructureComponent[],
  reservedMonthly: DecimalInput = 0,
): { lines: PayLine[]; monthlyCtc: Decimal; problems: Problem[] } {
  const problems: Problem[] = [];
  const monthlyCtc = roundMoney(toDecimal(annualCtc).dividedBy(MONTHS));
  const byCode = new Map(components.map((c) => [c.code, c]));
  const amounts = new Map<string, Decimal>();
  const visiting = new Set<string>();
  const balancing = components.filter((c) => c.calc.type === 'BALANCING');
  if (balancing.length > 1)
    problems.push({
      code: 'MULTIPLE_BALANCING',
      message: 'A structure can have only one balancing component',
    });

  const resolve = (code: string): Decimal | null => {
    const done = amounts.get(code);
    if (done) return done;
    const c = byCode.get(code);
    if (!c) {
      problems.push({
        code: 'UNKNOWN_COMPONENT',
        message: `Component ${code} is not in the structure`,
      });
      return null;
    }
    if (c.calc.type === 'BALANCING') {
      problems.push({
        code: 'BALANCING_AS_BASE',
        message: `${code} is balancing and cannot be a percentage base`,
      });
      return null;
    }
    if (visiting.has(code)) {
      problems.push({ code: 'CYCLE', message: `Percentage bases form a cycle at ${code}` });
      return null;
    }
    visiting.add(code);
    let value: Decimal | null;
    switch (c.calc.type) {
      case 'FIXED':
        value = toDecimal(c.calc.monthlyAmount);
        break;
      case 'PERCENT_OF_CTC':
        value = monthlyCtc.times(toDecimal(c.calc.percent)).dividedBy(100);
        break;
      case 'PERCENT_OF_COMPONENT': {
        const base = resolve(c.calc.componentCode);
        value = base ? base.times(toDecimal(c.calc.percent)).dividedBy(100) : null;
        break;
      }
    }
    visiting.delete(code);
    if (value) amounts.set(code, roundMoney(value));
    return value ? roundMoney(value) : null;
  };

  for (const c of components) if (c.calc.type !== 'BALANCING') resolve(c.code);

  const bal = balancing[0];
  if (bal) {
    // Deductions are not part of CTC; earnings and employer contributions are.
    const allocated = components
      .filter((c) => c.calc.type !== 'BALANCING' && c.kind !== 'DEDUCTION')
      .reduce((s, c) => s.plus(amounts.get(c.code) ?? 0), new Decimal(0));
    const rest = monthlyCtc.minus(allocated).minus(toDecimal(reservedMonthly));
    if (rest.isNegative())
      problems.push({
        code: 'NEGATIVE_BALANCE',
        message: `Components exceed the monthly CTC by ${rest.abs().toFixed(2)}; ${bal.code} cannot be negative`,
      });
    amounts.set(bal.code, Decimal.max(rest, 0));
  }

  const lines = components.map((c) => ({
    code: c.code,
    name: c.name,
    kind: c.kind,
    taxable: c.taxable,
    pfWage: c.pfWage,
    esiWage: c.esiWage,
    ptWage: c.ptWage,
    prorate: c.prorate,
    amount: amounts.get(c.code) ?? new Decimal(0),
  }));
  return { lines, monthlyCtc, problems };
}

export type PayableDaysMethod = 'CALENDAR_DAYS' | 'FIXED_DAYS' | 'WORKING_DAYS';

/**
 * The proration denominator for a month: its calendar days, a fixed number configured by the
 * organization (e.g. 30), or the working days from the employee's calendar.
 */
export function periodDays(
  method: PayableDaysMethod,
  daysInMonth: number,
  options: { fixedDays?: number; workingDays?: number } = {},
): number {
  if (method === 'CALENDAR_DAYS') return daysInMonth;
  if (method === 'FIXED_DAYS') {
    if (!options.fixedDays || options.fixedDays <= 0) throw new RangeError('fixedDays is required');
    return options.fixedDays;
  }
  if (options.workingDays === undefined || options.workingDays < 0)
    throw new RangeError('workingDays is required');
  return options.workingDays;
}

/**
 * Payable days: the employee's days in the period (after joining / before leaving) minus
 * loss-of-pay days, never below zero or above the denominator.
 */
export function payableDays(input: {
  denominator: number;
  /** Days the employee was employed in the period, measured in the same unit as the denominator. */
  employedDays: number;
  lossOfPayDays: DecimalInput;
}): Decimal {
  const employed = Decimal.min(input.employedDays, input.denominator);
  const result = employed.minus(toDecimal(input.lossOfPayDays));
  return Decimal.max(0, Decimal.min(result, input.denominator));
}

/** Applies proration to lines flagged `prorate`; others are paid in full. */
export function prorateLines(
  lines: readonly PayLine[],
  payable: DecimalInput,
  denominator: DecimalInput,
): PayLine[] {
  const den = toDecimal(denominator);
  return lines.map((l) =>
    l.prorate && !den.isZero()
      ? { ...l, amount: roundMoney(l.amount.times(toDecimal(payable)).dividedBy(den)) }
      : { ...l },
  );
}

/** Sums the amounts of lines matching a predicate. */
export function sumLines(lines: readonly PayLine[], where: (l: PayLine) => boolean): Decimal {
  return lines.filter(where).reduce((s, l) => s.plus(l.amount), new Decimal(0));
}

export interface LopDay {
  status: 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'WEEKLY_OFF' | 'HOLIDAY' | 'PENDING';
  /** Approved leave session on the day, if any. */
  leaveSession: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF' | null;
  /** Portion of the day on unpaid leave (0, 0.5 or 1). */
  unpaidLeaveDays: number;
  /** The calendar makes the day a half working day. */
  halfWorkingDay: boolean;
}

/**
 * Loss-of-pay days from evaluated attendance days: unpaid leave always counts; when the
 * organization says so, the unworked part of the working portion counts too (ABSENT = all of
 * it, HALF_DAY = half of it). Paid leave, off days, holidays and pending days never count.
 */
export function lossOfPayDays(days: readonly LopDay[], absentIsLossOfPay: boolean): Decimal {
  let total = new Decimal(0);
  for (const d of days) {
    total = total.plus(d.unpaidLeaveDays);
    if (!absentIsLossOfPay) continue;
    const unit = d.halfWorkingDay ? new Decimal(0.5) : new Decimal(1);
    const leavePart =
      d.leaveSession === 'FULL' ? unit : d.leaveSession ? Decimal.min(unit, 0.5) : new Decimal(0);
    const working = Decimal.max(0, unit.minus(leavePart));
    if (d.status === 'ABSENT') total = total.plus(working);
    else if (d.status === 'HALF_DAY') total = total.plus(working.dividedBy(2));
  }
  return total;
}
