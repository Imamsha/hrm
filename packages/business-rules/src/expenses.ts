/**
 * Expense, travel and asset rules (pure, Decimal only). Limits, windows and depreciation inputs
 * are the organization's configuration — no amount is assumed here.
 */
import { Decimal, type DecimalInput, roundMoney, toDecimal } from './money.js';

// ------------------------------------------------------------------------------ currency

/** Amount in the organization's currency: bill amount × exchange rate, rounded to paise. */
export function convertAmount(amount: DecimalInput, exchangeRate: DecimalInput): Decimal {
  const rate = toDecimal(exchangeRate);
  if (rate.lessThanOrEqualTo(0)) throw new RangeError('Exchange rate must be positive');
  return roundMoney(toDecimal(amount).times(rate));
}

// ------------------------------------------------------------------------------ policy checks

export interface ExpensePolicy {
  categoryId: string;
  name: string;
  active: boolean;
  /** Per item; null = no limit. */
  maxPerItem: string | null;
  /** Per employee per calendar month across claims; null = no limit. */
  maxPerMonth: string | null;
  /** Amount above which a receipt is mandatory; null = never required, "0" = always. */
  receiptRequiredAbove: string | null;
  /** Per-day limit for items spanning days (allowances); null = none. */
  dailyLimit: string | null;
}

export interface ExpenseItemInput {
  categoryId: string;
  /** ISO date of the expense (or the first day for multi-day items). */
  date: string;
  /** Number of days covered (allowances); 1 for ordinary bills. */
  days: number;
  /** Amount in the organization's currency. */
  amount: DecimalInput;
  hasReceipt: boolean;
  justification: string | null;
}

export type IssueSeverity = 'BLOCK' | 'WARN';

export interface ExpenseIssue {
  item: number;
  code: string;
  severity: IssueSeverity;
  message: string;
}

/**
 * Checks claim items against category policies. BLOCK issues prevent submission; WARN issues need a
 * justification on the item (then they stay visible to approvers but no longer block).
 *
 * `monthToDate` is the employee's already submitted or approved spend per `categoryId|YYYY-MM`,
 * excluding this claim.
 */
export function checkExpenseItems(input: {
  items: readonly ExpenseItemInput[];
  policies: readonly ExpensePolicy[];
  today: string;
  /** Items older than this many days cannot be claimed; null = no window. */
  claimWindowDays: number | null;
  monthToDate: Readonly<Record<string, DecimalInput>>;
}): ExpenseIssue[] {
  const issues: ExpenseIssue[] = [];
  const policy = new Map(input.policies.map((p) => [p.categoryId, p]));
  const running = new Map<string, Decimal>();
  const earliest =
    input.claimWindowDays === null ? null : addDaysIso(input.today, -input.claimWindowDays);

  input.items.forEach((it, i) => {
    const p = policy.get(it.categoryId);
    const amount = toDecimal(it.amount);
    const block = (code: string, message: string) =>
      issues.push({ item: i, code, severity: 'BLOCK', message });
    const warn = (code: string, message: string) => {
      if (!it.justification?.trim())
        issues.push({
          item: i,
          code,
          severity: 'WARN',
          message: `${message} — add a justification`,
        });
    };
    if (!p) return void block('UNKNOWN_CATEGORY', 'The category does not exist');
    if (!p.active) block('CATEGORY_INACTIVE', `${p.name} is no longer claimable`);
    if (amount.lessThanOrEqualTo(0)) block('AMOUNT', 'The amount must be above zero');
    if (it.date > input.today) block('FUTURE_DATE', 'An expense cannot be in the future');
    if (earliest && it.date < earliest)
      block(
        'TOO_OLD',
        `Expenses older than ${String(input.claimWindowDays)} days cannot be claimed`,
      );
    if (
      p.receiptRequiredAbove !== null &&
      !it.hasReceipt &&
      amount.greaterThan(toDecimal(p.receiptRequiredAbove))
    )
      block(
        'RECEIPT_REQUIRED',
        `A receipt is required for ${p.name} above ${p.receiptRequiredAbove}`,
      );
    if (p.maxPerItem !== null && amount.greaterThan(toDecimal(p.maxPerItem)))
      warn('OVER_ITEM_LIMIT', `Above the ${p.name} limit of ${p.maxPerItem} per item`);
    if (
      p.dailyLimit !== null &&
      amount.greaterThan(toDecimal(p.dailyLimit).times(Math.max(1, it.days)))
    )
      warn(
        'OVER_DAILY_LIMIT',
        `Above ${p.dailyLimit} a day for ${String(Math.max(1, it.days))} day(s)`,
      );
    if (p.maxPerMonth !== null) {
      const key = `${it.categoryId}|${it.date.slice(0, 7)}`;
      const total = (running.get(key) ?? toDecimal(input.monthToDate[key] ?? 0)).plus(amount);
      running.set(key, total);
      if (total.greaterThan(toDecimal(p.maxPerMonth)))
        warn(
          'OVER_MONTHLY_LIMIT',
          `${p.name} for ${it.date.slice(0, 7)} exceeds the monthly limit of ${p.maxPerMonth}`,
        );
    }
  });
  return issues;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------------------ claim states

export type ClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'MANAGER_APPROVED'
  | 'FINANCE_APPROVED'
  | 'REIMBURSED'
  | 'REJECTED'
  | 'CANCELLED';

const CLAIM_MOVES: Record<ClaimStatus, ClaimStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['MANAGER_APPROVED', 'REJECTED', 'CANCELLED', 'DRAFT'],
  MANAGER_APPROVED: ['FINANCE_APPROVED', 'REJECTED'],
  FINANCE_APPROVED: ['REIMBURSED'],
  REIMBURSED: [],
  REJECTED: ['DRAFT'],
  CANCELLED: [],
};

export function canMoveClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_MOVES[from].includes(to);
}

// ------------------------------------------------------------------------------ travel

/**
 * Travel settlement: approved claims of the trip minus advances paid. Positive = payable to the
 * traveller, negative = to recover, zero = settled.
 */
export function travelSettlement(input: {
  advancesPaid: readonly DecimalInput[];
  approvedClaims: readonly DecimalInput[];
}): {
  advances: Decimal;
  claimed: Decimal;
  balance: Decimal;
  direction: 'PAYABLE' | 'RECOVERABLE' | 'SETTLED';
} {
  const sum = (xs: readonly DecimalInput[]) =>
    xs.reduce<Decimal>((a, x) => a.plus(toDecimal(x)), new Decimal(0));
  const advances = roundMoney(sum(input.advancesPaid));
  const claimed = roundMoney(sum(input.approvedClaims));
  const balance = claimed.minus(advances);
  return {
    advances,
    claimed,
    balance,
    direction: balance.isZero() ? 'SETTLED' : balance.isPositive() ? 'PAYABLE' : 'RECOVERABLE',
  };
}

// ------------------------------------------------------------------------------ assets

/** Whole months from `from` to `to` (ISO dates), never negative. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

/**
 * Straight-line book value (informational): cost less (cost − salvage) × elapsed / useful life,
 * never below the salvage value.
 */
export function straightLineBookValue(input: {
  cost: DecimalInput;
  salvage: DecimalInput;
  usefulLifeMonths: number;
  purchaseDate: string;
  asOf: string;
}): { bookValue: Decimal; accumulated: Decimal; elapsedMonths: number } {
  if (input.usefulLifeMonths <= 0) throw new RangeError('Useful life must be positive');
  const cost = toDecimal(input.cost);
  const salvage = toDecimal(input.salvage);
  if (salvage.greaterThan(cost)) throw new RangeError('Salvage value cannot exceed cost');
  const elapsed = Math.min(monthsBetween(input.purchaseDate, input.asOf), input.usefulLifeMonths);
  const accumulated = roundMoney(
    cost.minus(salvage).times(elapsed).dividedBy(input.usefulLifeMonths),
  );
  return { bookValue: cost.minus(accumulated), accumulated, elapsedMonths: elapsed };
}
