/**
 * Clients & projects rules (pure, Decimal only; ADR-017). Tax rates and billing rates are the
 * organization's configuration — nothing here assumes a tax regime.
 */
import { Decimal, type DecimalInput, roundMoney, toDecimal } from './money.js';

const D0 = new Decimal(0);

// ------------------------------------------------------------------------------ work items

const CATEGORY_LABEL = { TODO: 'to do', IN_PROGRESS: 'in progress', DONE: 'done' } as const;

export type WorkItemType = 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG' | 'SUBTASK';
export type BoardCategory = 'TODO' | 'IN_PROGRESS' | 'DONE';

/** Which parent types each work item type may have (`null` = may be top-level). */
const ALLOWED_PARENTS: Record<WorkItemType, readonly (WorkItemType | null)[]> = {
  EPIC: [null],
  FEATURE: [null, 'EPIC'],
  STORY: [null, 'EPIC', 'FEATURE'],
  TASK: [null, 'STORY'],
  BUG: [null, 'STORY', 'EPIC', 'FEATURE'],
  SUBTASK: ['STORY', 'TASK', 'BUG'],
};

export function canHaveParent(type: WorkItemType, parent: WorkItemType | null): boolean {
  return ALLOWED_PARENTS[type].includes(parent);
}

export function allowedParents(type: WorkItemType): readonly (WorkItemType | null)[] {
  return ALLOWED_PARENTS[type];
}

/**
 * True when making `parentId` the parent of `id` would create a cycle. `parentOf` maps each
 * existing item to its parent.
 */
export function createsCycle(
  id: string,
  parentId: string | null,
  parentOf: ReadonlyMap<string, string | null>,
): boolean {
  let cur = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id || seen.has(cur)) return true;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return false;
}

/** `WEB-42`. */
export function workItemKey(projectKey: string, number: number): string {
  return `${projectKey}-${String(number)}`;
}

/** Board columns: at least one per category, unique names, positions in order. */
export function validateBoardColumns(
  columns: readonly { name: string; category: BoardCategory }[],
): string[] {
  const issues: string[] = [];
  for (const c of ['TODO', 'IN_PROGRESS', 'DONE'] as const)
    if (!columns.some((x) => x.category === c))
      issues.push(`Add a column for '${CATEGORY_LABEL[c]}'`);
  const names = columns.map((c) => c.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) issues.push('Column names must be unique');
  return issues;
}

/** Progress by category, counting items (or story points when `byPoints`). */
export function progressByCategory(
  items: readonly { category: BoardCategory; points?: DecimalInput | null }[],
  byPoints = false,
): { todo: Decimal; inProgress: Decimal; done: Decimal; total: Decimal; percentDone: Decimal } {
  const w = (i: (typeof items)[number]) => (byPoints ? toDecimal(i.points ?? 0) : new Decimal(1));
  const sum = (c: BoardCategory) =>
    items.filter((i) => i.category === c).reduce((a, i) => a.plus(w(i)), D0);
  const todo = sum('TODO');
  const inProgress = sum('IN_PROGRESS');
  const done = sum('DONE');
  const total = todo.plus(inProgress).plus(done);
  return {
    todo,
    inProgress,
    done,
    total,
    percentDone: total.isZero() ? D0 : done.dividedBy(total).times(100).toDecimalPlaces(2),
  };
}

// ------------------------------------------------------------------------------ sprints

export type SprintStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED';

export function canMoveSprint(from: SprintStatus, to: SprintStatus): boolean {
  return (from === 'PLANNED' && to === 'ACTIVE') || (from === 'ACTIVE' && to === 'COMPLETED');
}

/** Committed vs completed story points when a sprint closes. */
export function sprintVelocity(
  items: readonly { category: BoardCategory; points?: DecimalInput | null }[],
): { committed: Decimal; completed: Decimal } {
  const pts = (i: (typeof items)[number]) => toDecimal(i.points ?? 0);
  return {
    committed: items.reduce((a, i) => a.plus(pts(i)), D0),
    completed: items.filter((i) => i.category === 'DONE').reduce((a, i) => a.plus(pts(i)), D0),
  };
}

// ------------------------------------------------------------------------------ timesheets

/** The Monday (ISO week start) of the week containing `date` (YYYY-MM-DD, UTC calendar). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

export function weekDays(start: string): string[] {
  const d = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

export interface TimeEntryInput {
  date: string;
  hours: DecimalInput;
}

/**
 * Problems with a week of entries: dates outside the week, hours not in quarter steps or outside
 * 0.25–24, more than `maxPerDay` (24) hours on a day.
 */
export function validateTimesheet(
  week: string,
  entries: readonly TimeEntryInput[],
  maxPerDay: DecimalInput = 24,
): string[] {
  const days = new Set(weekDays(week));
  const issues: string[] = [];
  const perDay = new Map<string, Decimal>();
  const max = toDecimal(maxPerDay);
  entries.forEach((e, i) => {
    const h = toDecimal(e.hours);
    if (!days.has(e.date))
      issues.push(`Entry ${String(i + 1)}: ${e.date} is not in the week of ${week}`);
    if (h.lt(0.25) || h.gt(24) || !h.times(4).isInteger())
      issues.push(`Entry ${String(i + 1)}: hours must be 0.25–24 in quarter hours`);
    perDay.set(e.date, (perDay.get(e.date) ?? D0).plus(h));
  });
  for (const [date, total] of perDay)
    if (total.gt(max))
      issues.push(`${date}: ${total.toString()} hours is more than ${max.toString()} in a day`);
  return issues;
}

export function totalHours(entries: readonly { hours: DecimalInput }[]): Decimal {
  return entries.reduce((a, e) => a.plus(toDecimal(e.hours)), D0);
}

export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export function canMoveTimesheet(from: TimesheetStatus, to: TimesheetStatus): boolean {
  const moves: Record<TimesheetStatus, TimesheetStatus[]> = {
    DRAFT: ['SUBMITTED'],
    SUBMITTED: ['APPROVED', 'REJECTED', 'DRAFT'],
    REJECTED: ['DRAFT', 'SUBMITTED'],
    APPROVED: [],
  };
  return moves[from].includes(to);
}

// ------------------------------------------------------------------------------ billing

/** Billing rate of a person on a project: their override, else the project default. */
export function billingRate(
  memberRate: DecimalInput | null | undefined,
  projectRate: DecimalInput | null | undefined,
): Decimal | null {
  if (memberRate !== null && memberRate !== undefined) return toDecimal(memberRate);
  if (projectRate !== null && projectRate !== undefined) return toDecimal(projectRate);
  return null;
}

export interface InvoiceLineInput {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  /** Tax rate in percent (from the organization's configured rates), or null for none. */
  taxPercent?: DecimalInput | null;
}

export interface InvoiceLineAmounts {
  amount: Decimal;
  tax: Decimal;
  total: Decimal;
}

/** Line amount = quantity × unit price, tax = amount × rate; each rounded half-up to 2 places. */
export function invoiceLine(line: InvoiceLineInput): InvoiceLineAmounts {
  const amount = roundMoney(toDecimal(line.quantity).times(toDecimal(line.unitPrice)));
  const tax =
    line.taxPercent === null || line.taxPercent === undefined
      ? D0
      : roundMoney(amount.times(toDecimal(line.taxPercent)).dividedBy(100));
  return { amount, tax, total: amount.plus(tax) };
}

export function invoiceTotals(lines: readonly InvoiceLineInput[]): {
  subtotal: Decimal;
  tax: Decimal;
  total: Decimal;
  lines: InvoiceLineAmounts[];
} {
  const computed = lines.map(invoiceLine);
  const subtotal = computed.reduce((a, l) => a.plus(l.amount), D0);
  const tax = computed.reduce((a, l) => a.plus(l.tax), D0);
  return { subtotal, tax, total: subtotal.plus(tax), lines: computed };
}

/** Balance after payments, and whether the invoice is fully paid. Overpayment is an error. */
export function invoiceBalance(
  total: DecimalInput,
  payments: readonly DecimalInput[],
): { paid: Decimal; balance: Decimal; settled: boolean; overpaid: boolean } {
  const paid = payments.reduce<Decimal>((a, p) => a.plus(toDecimal(p)), D0);
  const balance = toDecimal(total).minus(paid);
  return { paid, balance, settled: balance.isZero(), overpaid: balance.lt(0) };
}

/** `INV-2026-0001`: prefix, year and a zero-padded sequence. */
export function invoiceNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${String(year)}-${String(sequence).padStart(4, '0')}`;
}

/** Due date = issue date + payment terms (days). */
export function dueDate(issuedOn: string, termsDays: number): string {
  const d = new Date(`${issuedOn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + termsDays);
  return d.toISOString().slice(0, 10);
}

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';

export function canMoveInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return (
    (from === 'DRAFT' && (to === 'ISSUED' || to === 'VOID')) ||
    (from === 'ISSUED' && (to === 'PAID' || to === 'VOID'))
  );
}

/** Budget use: spent / budget in percent (null without a budget). */
export function budgetUse(
  spent: DecimalInput,
  budget: DecimalInput | null | undefined,
): Decimal | null {
  if (budget === null || budget === undefined) return null;
  const b = toDecimal(budget);
  if (b.isZero()) return null;
  return toDecimal(spent).dividedBy(b).times(100).toDecimalPlaces(2);
}
