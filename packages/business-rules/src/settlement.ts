/**
 * Arrears and full & final settlement formulas (pure, Decimal only). Gratuity factors,
 * eligibility and caps, and the encashment basis are the organization's configuration.
 */
import { Decimal, type DecimalInput, roundMoney, toDecimal } from './money.js';

export interface GratuityConfig {
  /** Days of wages per completed year of service (numerator). */
  daysPerYear: string;
  /** Working days a month's wages are divided by (denominator). */
  monthDivisor: string;
  /** Minimum completed years of service for eligibility. */
  minYears: string;
  /** Remaining months at or above this count as a full year; null = only completed years. */
  roundUpMonths: number | null;
  /** Maximum gratuity; null = uncapped. */
  cap: string | null;
}

/** Completed years of service between two ISO dates, with the configured round-up of months. */
export function serviceYears(
  joining: string,
  leaving: string,
  roundUpMonths: number | null,
): number {
  const [jy, jm, jd] = joining.split('-').map(Number) as [number, number, number];
  const [ly, lm, ld] = leaving.split('-').map(Number) as [number, number, number];
  let months = (ly - jy) * 12 + (lm - jm);
  if (ld < jd) months -= 1;
  if (months < 0) return 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return roundUpMonths !== null && rest >= roundUpMonths ? years + 1 : years;
}

export function computeGratuity(input: {
  /** Last drawn monthly wages on which gratuity is based (as configured, e.g. basic + DA). */
  monthlyWages: DecimalInput;
  years: number;
  config: GratuityConfig;
  /** Eligibility waived (e.g. death or disablement, where the organization's policy says so). */
  waiveMinimum?: boolean;
}): { eligible: boolean; amount: Decimal } {
  const c = input.config;
  const eligible =
    input.waiveMinimum === true ||
    new Decimal(input.years).greaterThanOrEqualTo(toDecimal(c.minYears));
  if (!eligible) return { eligible, amount: new Decimal(0) };
  const raw = toDecimal(input.monthlyWages)
    .times(toDecimal(c.daysPerYear))
    .dividedBy(toDecimal(c.monthDivisor))
    .times(input.years);
  const capped = c.cap ? Decimal.min(raw, toDecimal(c.cap)) : raw;
  return { eligible, amount: roundMoney(capped, 0, 'HALF_UP') };
}

/** Leave encashment: days × (monthly basis ÷ divisor), e.g. basic over 30 or 26 days. */
export function leaveEncashment(input: {
  days: DecimalInput;
  monthlyBasis: DecimalInput;
  divisor: DecimalInput;
}): Decimal {
  const divisor = toDecimal(input.divisor);
  if (divisor.lessThanOrEqualTo(0)) throw new RangeError('divisor must be positive');
  const days = Decimal.max(0, toDecimal(input.days));
  return roundMoney(days.times(toDecimal(input.monthlyBasis)).dividedBy(divisor));
}

/**
 * Notice pay: positive = paid to the employee (notice waived by the employer), negative =
 * recovered (the employee left without serving it). Days × monthly basis ÷ divisor.
 */
export function noticePay(input: {
  requiredDays: number;
  servedDays: number;
  monthlyBasis: DecimalInput;
  divisor: DecimalInput;
  waivedByEmployer: boolean;
}): Decimal {
  const shortfall = Math.max(0, input.requiredDays - input.servedDays);
  if (shortfall === 0) return new Decimal(0);
  const amount = leaveEncashment({
    days: shortfall,
    monthlyBasis: input.monthlyBasis,
    divisor: input.divisor,
  });
  return input.waivedByEmployer ? amount : amount.negated();
}

export interface AmountLine {
  code: string;
  name: string;
  amount: DecimalInput;
}

/**
 * Arrears for one past month: per component, what should have been paid minus what was paid.
 * Components only in one side count fully; zero differences are dropped.
 */
export function arrearsFor(
  paid: readonly AmountLine[],
  due: readonly AmountLine[],
): { code: string; name: string; amount: Decimal }[] {
  const out = new Map<string, { code: string; name: string; amount: Decimal }>();
  for (const d of due) out.set(d.code, { code: d.code, name: d.name, amount: toDecimal(d.amount) });
  for (const p of paid) {
    const cur = out.get(p.code);
    if (cur) cur.amount = cur.amount.minus(toDecimal(p.amount));
    else out.set(p.code, { code: p.code, name: p.name, amount: toDecimal(p.amount).negated() });
  }
  return [...out.values()]
    .filter((l) => !l.amount.isZero())
    .map((l) => ({ ...l, amount: roundMoney(l.amount) }));
}
