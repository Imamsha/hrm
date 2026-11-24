/**
 * Performance rules (pure, Decimal only). Rating scales, weights and minimums are the
 * organization's configuration — nothing here assumes a scale or a distribution.
 */
import { Decimal, type DecimalInput, toDecimal } from './money.js';

const D0 = new Decimal(0);
const D100 = new Decimal(100);
const clampPct = (v: Decimal) => Decimal.max(D0, Decimal.min(D100, v));

// ------------------------------------------------------------------------------ goals

export type GoalDirection = 'INCREASE' | 'DECREASE';

/**
 * Progress of a measured goal (KPI) in percent, 0–100: how far `current` has moved from `start`
 * towards `target`. Works for targets below the start (DECREASE, e.g. defect counts).
 */
export function metricProgress(input: {
  start: DecimalInput;
  target: DecimalInput;
  current: DecimalInput;
}): Decimal {
  const start = toDecimal(input.start);
  const target = toDecimal(input.target);
  const current = toDecimal(input.current);
  const span = target.minus(start);
  if (span.isZero()) return current.equals(target) ? D100 : D0;
  return clampPct(current.minus(start).dividedBy(span).times(100)).toDecimalPlaces(2);
}

/** Weighted average of child progress (key results); equal weights when none are given. */
export function rollUpProgress(
  children: readonly { progress: DecimalInput; weight?: DecimalInput | null }[],
): Decimal {
  if (!children.length) return D0;
  const weights = children.map((c) =>
    c.weight === null || c.weight === undefined ? new Decimal(1) : toDecimal(c.weight),
  );
  const total = weights.reduce((a, w) => a.plus(w), D0);
  if (total.isZero()) return D0;
  const sum = children.reduce(
    (a, c, i) => a.plus(clampPct(toDecimal(c.progress)).times(weights[i] ?? 0)),
    D0,
  );
  return sum.dividedBy(total).toDecimalPlaces(2);
}

// ------------------------------------------------------------------------------ ratings

export interface ScalePoint {
  value: string;
  label: string;
}

/** Validates a scale: at least two points with distinct, ascending numeric values. */
export function validateScale(points: readonly ScalePoint[]): string[] {
  const problems: string[] = [];
  if (points.length < 2) problems.push('A rating scale needs at least two points');
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev && cur && !toDecimal(cur.value).greaterThan(toDecimal(prev.value)))
      problems.push('Scale values must be in ascending order');
  }
  return [...new Set(problems)];
}

/** The scale point nearest to a score (ties go to the higher point). */
export function nearestPoint(
  score: DecimalInput,
  points: readonly ScalePoint[],
): ScalePoint | null {
  const s = toDecimal(score);
  let best: ScalePoint | null = null;
  let bestDistance: Decimal | null = null;
  for (const p of points) {
    const d = toDecimal(p.value).minus(s).abs();
    if (
      bestDistance === null ||
      d.lessThan(bestDistance) ||
      (d.equals(bestDistance) && best && toDecimal(p.value).greaterThan(toDecimal(best.value)))
    ) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * Overall review score on the organization's scale:
 *   goals part   = scale min + (max − min) × weighted goal achievement %
 *   competencies = weighted average of competency ratings (already on the scale)
 *   overall      = goals part × goalsWeight% + competencies × (100 − goalsWeight)%
 * Missing parts fall back to the other part (a template without goals uses competencies only).
 */
export function reviewScore(input: {
  scale: readonly ScalePoint[];
  goalsWeightPercent: DecimalInput;
  goals: readonly { achievementPercent: DecimalInput; weight: DecimalInput }[];
  competencies: readonly { rating: DecimalInput; weight: DecimalInput }[];
}): {
  goals: Decimal | null;
  competencies: Decimal | null;
  overall: Decimal | null;
  point: ScalePoint | null;
} {
  const values = input.scale.map((p) => toDecimal(p.value));
  if (values.length < 2) return { goals: null, competencies: null, overall: null, point: null };
  const min = Decimal.min(...values);
  const max = Decimal.max(...values);
  const weighted = (items: readonly { v: Decimal; w: Decimal }[]) => {
    const total = items.reduce((a, x) => a.plus(x.w), D0);
    return total.isZero()
      ? null
      : items.reduce((a, x) => a.plus(x.v.times(x.w)), D0).dividedBy(total);
  };
  const achievement = weighted(
    input.goals.map((g) => ({
      v: clampPct(toDecimal(g.achievementPercent)),
      w: toDecimal(g.weight),
    })),
  );
  const goals =
    achievement === null ? null : min.plus(max.minus(min).times(achievement).dividedBy(100));
  const competencies = weighted(
    input.competencies.map((c) => ({ v: toDecimal(c.rating), w: toDecimal(c.weight) })),
  );
  let overall: Decimal | null;
  if (goals !== null && competencies !== null) {
    const gw = Decimal.max(D0, Decimal.min(D100, toDecimal(input.goalsWeightPercent)));
    overall = goals
      .times(gw)
      .plus(competencies.times(D100.minus(gw)))
      .dividedBy(100);
  } else overall = goals ?? competencies;
  const round = (v: Decimal | null) => (v === null ? null : v.toDecimalPlaces(2));
  return {
    goals: round(goals),
    competencies: round(competencies),
    overall: round(overall),
    point: overall === null ? null : nearestPoint(overall, input.scale),
  };
}

/** Distribution of final ratings by scale point (calibration view), with percentages. */
export function ratingDistribution(
  ratings: readonly string[],
  points: readonly ScalePoint[],
): { value: string; label: string; count: number; percent: string }[] {
  const total = ratings.length;
  return points.map((p) => {
    const count = ratings.filter((r) => toDecimal(r).equals(toDecimal(p.value))).length;
    return {
      value: p.value,
      label: p.label,
      count,
      percent: total ? new Decimal(count).times(100).dividedBy(total).toFixed(1) : '0.0',
    };
  });
}

/** Peer/upward feedback is shown to the reviewee only as an aggregate and only at the minimum count. */
export function canRevealAggregate(responseCount: number, minimum: number): boolean {
  return minimum > 0 && responseCount >= minimum;
}

// ------------------------------------------------------------------------------ cycles

export type CycleStatus = 'DRAFT' | 'OPEN' | 'CALIBRATION' | 'CLOSED';
const CYCLE_MOVES: Record<CycleStatus, CycleStatus[]> = {
  DRAFT: ['OPEN'],
  OPEN: ['CALIBRATION'],
  CALIBRATION: ['OPEN', 'CLOSED'],
  CLOSED: [],
};
export function canMoveCycle(from: CycleStatus, to: CycleStatus): boolean {
  return CYCLE_MOVES[from].includes(to);
}
