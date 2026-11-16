import { Decimal as DecimalJs } from 'decimal.js';

/**
 * Isolated Decimal constructor for all financial math. Cloned so global
 * Decimal configuration elsewhere can never change payroll results.
 * Precision 34 matches IEEE 754 decimal128 and comfortably exceeds
 * PostgreSQL numeric(20,4) used for monetary columns.
 */
export const Decimal = DecimalJs.clone({
  precision: 34,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});
export type Decimal = InstanceType<typeof Decimal>;

export type DecimalInput = Decimal | string | number;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'UP' | 'DOWN' | 'CEIL' | 'FLOOR';

const ROUNDING: Record<RoundingMode, DecimalJs.Rounding> = {
  HALF_UP: DecimalJs.ROUND_HALF_UP,
  HALF_EVEN: DecimalJs.ROUND_HALF_EVEN,
  UP: DecimalJs.ROUND_UP,
  DOWN: DecimalJs.ROUND_DOWN,
  CEIL: DecimalJs.ROUND_CEIL,
  FLOOR: DecimalJs.ROUND_FLOOR,
};

/** Creates a Decimal, rejecting non-finite numbers and malformed strings. */
export function toDecimal(value: DecimalInput): Decimal {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError(`Non-finite numeric value: ${value}`);
  }
  const d = new Decimal(value);
  if (!d.isFinite()) throw new RangeError(`Non-finite decimal value: ${String(value)}`);
  return d;
}

/**
 * Rounds a monetary amount. Rounding mode and scale are parameters because
 * statutory rules differ per component and must come from configuration.
 */
export function roundMoney(
  value: DecimalInput,
  scale = 2,
  mode: RoundingMode = 'HALF_UP',
): Decimal {
  return toDecimal(value).toDecimalPlaces(scale, ROUNDING[mode]);
}

export function sumMoney(values: readonly DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/**
 * Pro-rates an amount: amount * numerator / denominator, without intermediate rounding.
 * Example: monthly salary for 18 of 30 payable days.
 */
export function prorate(
  amount: DecimalInput,
  numerator: DecimalInput,
  denominator: DecimalInput,
): Decimal {
  const den = toDecimal(denominator);
  if (den.isZero()) throw new RangeError('Proration denominator must not be zero');
  const num = toDecimal(numerator);
  if (num.isNegative() || den.isNegative())
    throw new RangeError('Proration factors must be non-negative');
  return toDecimal(amount).times(num).dividedBy(den);
}

/**
 * Splits `total` into parts proportional to `weights`, rounding each part to `scale`
 * and assigning the rounding remainder to the largest parts so the parts always sum to the total.
 */
export function allocate(
  total: DecimalInput,
  weights: readonly DecimalInput[],
  scale = 2,
): Decimal[] {
  if (weights.length === 0) throw new RangeError('At least one weight is required');
  const w = weights.map(toDecimal);
  if (w.some((x) => x.isNegative())) throw new RangeError('Weights must be non-negative');
  const weightSum = sumMoney(w);
  if (weightSum.isZero()) throw new RangeError('Sum of weights must be greater than zero');

  const t = roundMoney(total, scale);
  const parts = w.map((x) =>
    t.times(x).dividedBy(weightSum).toDecimalPlaces(scale, DecimalJs.ROUND_DOWN),
  );
  const unit = new Decimal(1).dividedBy(new Decimal(10).pow(scale));
  let remainder = t.minus(sumMoney(parts));

  const order = w.map((x, i) => ({ x, i })).sort((a, b) => b.x.comparedTo(a.x) || a.i - b.i);
  for (let k = 0; remainder.greaterThan(0); k = (k + 1) % order.length) {
    const idx = order[k]?.i ?? 0;
    parts[idx] = (parts[idx] ?? new Decimal(0)).plus(unit);
    remainder = remainder.minus(unit);
  }
  return parts;
}

/** Serialises for transport/storage as a fixed-scale string (never a JS number). */
export function toMoneyString(value: DecimalInput, scale = 2): string {
  return roundMoney(value, scale).toFixed(scale);
}
