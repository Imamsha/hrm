/**
 * Helpdesk, separation and compliance rules (pure; ADR-019). SLAs, notice periods and
 * obligations are organization configuration — nothing here assumes a legal deadline.
 */
import { Decimal } from './money.js';

// ------------------------------------------------------------------------------ helpdesk

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_REQUESTER' | 'RESOLVED' | 'CLOSED';

const TICKET_MOVES: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_ON_REQUESTER', 'RESOLVED', 'OPEN'],
  WAITING_ON_REQUESTER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};

export function canMoveTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_MOVES[from].includes(to);
}

/** Due times from SLA hours (continuous clock). */
export function slaDue(
  createdAt: Date,
  policy: { firstResponseHours?: number | null; resolutionHours?: number | null } | null,
) {
  const add = (h: number | null | undefined) =>
    h ? new Date(createdAt.getTime() + h * 3_600_000) : null;
  return {
    firstResponseDue: add(policy?.firstResponseHours),
    resolutionDue: add(policy?.resolutionHours),
  };
}

export interface SlaState {
  responseBreached: boolean;
  resolutionBreached: boolean;
}

/** A target is breached when it was missed, or is still open past its due time. */
export function slaState(
  t: {
    firstResponseDue: Date | null;
    resolutionDue: Date | null;
    firstRespondedAt: Date | null;
    resolvedAt: Date | null;
  },
  now: Date,
): SlaState {
  const missed = (due: Date | null, doneAt: Date | null) =>
    !!due && (doneAt ? doneAt.getTime() > due.getTime() : now.getTime() > due.getTime());
  return {
    responseBreached: missed(t.firstResponseDue, t.firstRespondedAt),
    resolutionBreached: missed(t.resolutionDue, t.resolvedAt),
  };
}

export function ticketNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${String(year)}-${String(sequence).padStart(4, '0')}`;
}

// ------------------------------------------------------------------------------ separation

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The last working day the notice period gives: the day before `noticeDays` have passed since
 * the resignation date. Without a configured notice period there is none.
 */
export function noticeLastDay(
  resignedOn: string,
  noticeDays: number | null | undefined,
): string | null {
  if (noticeDays === null || noticeDays === undefined) return null;
  return addDays(resignedOn, Math.max(0, noticeDays - 1));
}

/** Notice days waived when the agreed last day is earlier than the notice period gives. */
export function waivedNoticeDays(noticeLast: string | null, agreedLast: string): number {
  if (!noticeLast || agreedLast >= noticeLast) return 0;
  return Math.round(
    (Date.parse(`${noticeLast}T00:00:00Z`) - Date.parse(`${agreedLast}T00:00:00Z`)) / 86_400_000,
  );
}

export type ClearanceStatus = 'PENDING' | 'CLEARED' | 'WAIVED';

export function clearanceComplete(items: readonly { status: ClearanceStatus }[]): boolean {
  return items.every((i) => i.status !== 'PENDING');
}

/** Attrition % for a period: separations ÷ average of opening and closing headcount × 100. */
export function attritionRate(
  separations: number,
  openingHeadcount: number,
  closingHeadcount: number,
): Decimal | null {
  const avg = new Decimal(openingHeadcount).plus(closingHeadcount).dividedBy(2);
  if (avg.isZero()) return null;
  return new Decimal(separations).dividedBy(avg).times(100).toDecimalPlaces(2);
}

/** Averages of rating answers, hidden below the minimum number of answers. */
export function ratingAverage(
  values: readonly number[],
  minimum: number,
): { count: number; average: string | null } {
  if (values.length < minimum) return { count: values.length, average: null };
  return {
    count: values.length,
    average: values
      .reduce((a, v) => a.plus(v), new Decimal(0))
      .dividedBy(values.length)
      .toFixed(2),
  };
}

// ------------------------------------------------------------------------------ compliance

export type Recurrence = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';
const MONTHS: Record<Recurrence, number> = {
  NONE: 0,
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

/**
 * The next due date of a recurring obligation, keeping the day of month of the first due date
 * (clamped to the month's last day, e.g. 31 Jan → 28/29 Feb → 31 Mar).
 */
export function nextOccurrence(
  firstDue: string,
  previousDue: string,
  recurrence: Recurrence,
): string | null {
  const step = MONTHS[recurrence];
  if (!step) return null;
  const anchorDay = Number(firstDue.slice(8, 10));
  const [y, m] = [Number(previousDue.slice(0, 4)), Number(previousDue.slice(5, 7))];
  const total = y * 12 + (m - 1) + step;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny)}-${String(nm).padStart(2, '0')}-${String(Math.min(anchorDay, last)).padStart(2, '0')}`;
}

export type DueState = 'OVERDUE' | 'DUE_SOON' | 'LATER';

export function dueState(due: string, today: string, soonDays: number): DueState {
  if (due < today) return 'OVERDUE';
  return due <= addDays(today, soonDays) ? 'DUE_SOON' : 'LATER';
}
