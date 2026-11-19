import {
  accrualCredits,
  carryForward,
  Decimal,
  leaveYearOf,
  leaveYearRange,
} from '@hrm/business-rules';
import type { LeaveBalanceItem } from '@hrm/shared-types';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { toDate, todayIso } from '../employees/employee-scope.js';

export type LeaveTypeRow = Prisma.LeaveTypeGetPayload<object>;

/** Does a leave type apply to this employee (employment type, probation)? */
export function applies(
  t: LeaveTypeRow,
  employee: { employmentType: string | null; probationStatus: string },
): string | null {
  if (t.employmentTypes.length > 0 && !t.employmentTypes.includes(employee.employmentType as never))
    return 'This leave type does not apply to your employment type';
  if (!t.allowDuringProbation && employee.probationStatus === 'ON_PROBATION')
    return 'This leave type is not available during probation';
  return null;
}

/**
 * Brings an employee's ledger for a leave type up to date: accrual credits due so far and the
 * carry-forward/lapse of every completed leave year since joining. Idempotent (partial unique
 * indexes + ON CONFLICT DO NOTHING), so concurrent callers converge on the same ledger.
 */
export async function ensureLedger(
  tx: TenantTransaction,
  organizationId: string,
  employee: { id: string; dateOfJoining: string },
  type: LeaveTypeRow,
  targetYear: number,
  startMonth: number,
): Promise<void> {
  if (!type.tracksBalance) return;
  const today = todayIso();
  const currentYear = leaveYearOf(today, startMonth);
  const joinYear = leaveYearOf(employee.dateOfJoining, startMonth);
  const lastYear = Math.min(targetYear, currentYear);
  for (let y = joinYear; y <= lastYear; y++) {
    const range = leaveYearRange(y, startMonth);
    const asOf = y < currentYear ? range.to : today;
    const credits = accrualCredits(
      {
        method: type.accrualMethod,
        annualQuota: type.annualQuota.toString(),
        prorateOnJoining: type.prorateOnJoining,
      },
      y,
      startMonth,
      employee.dateOfJoining,
      asOf,
    );
    if (credits.length) {
      await tx.leaveLedgerEntry.createMany({
        data: credits.map((c) => ({
          organizationId,
          employeeId: employee.id,
          leaveTypeId: type.id,
          year: y,
          entryType: 'ACCRUAL' as const,
          period: c.period,
          days: c.days,
          effectiveDate: toDate(c.effectiveDate),
        })),
        skipDuplicates: true,
      });
    }
    // Completed years close with carry-forward / lapse into the next year.
    if (y < currentYear) {
      await rollover(tx, organizationId, employee.id, type, y, startMonth);
    }
  }
}

async function rollover(
  tx: TenantTransaction,
  organizationId: string,
  employeeId: string,
  type: LeaveTypeRow,
  year: number,
  startMonth: number,
): Promise<void> {
  const done = await tx.leaveLedgerEntry.findFirst({
    where: { employeeId, leaveTypeId: type.id, year, entryType: 'LAPSE' },
    select: { id: true },
  });
  if (done) return;
  const closing = await sumDays(tx, employeeId, type.id, year);
  const { carry, lapse } = carryForward(
    closing,
    type.carryForwardMax ? type.carryForwardMax.toString() : null,
  );
  const range = leaveYearRange(year, startMonth);
  const next = leaveYearRange(year + 1, startMonth);
  await tx.leaveLedgerEntry.createMany({
    data: [
      {
        organizationId,
        employeeId,
        leaveTypeId: type.id,
        year,
        entryType: 'LAPSE',
        days: new Decimal(lapse).neg().toFixed(2),
        effectiveDate: toDate(range.to),
        note: `Year-end: ${lapse} lapsed, ${carry} carried forward`,
      },
      {
        organizationId,
        employeeId,
        leaveTypeId: type.id,
        year: year + 1,
        entryType: 'CARRY_FORWARD',
        days: carry,
        effectiveDate: toDate(next.from),
        note: `Carried forward from ${String(year)}`,
      },
    ],
    skipDuplicates: true,
  });
}

async function sumDays(
  tx: TenantTransaction,
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<string> {
  const agg = await tx.leaveLedgerEntry.aggregate({
    where: { employeeId, leaveTypeId, year },
    _sum: { days: true },
  });
  return (agg._sum.days ?? new Decimal(0)).toString();
}

/** Balance view of one leave type for a year (ledger must be up to date). */
export async function balanceOf(
  tx: TenantTransaction,
  employeeId: string,
  type: LeaveTypeRow,
  year: number,
  startMonth: number,
): Promise<LeaveBalanceItem> {
  const rows = await tx.leaveLedgerEntry.groupBy({
    by: ['entryType'],
    where: { employeeId, leaveTypeId: type.id, year },
    _sum: { days: true },
  });
  const sum = (...types: string[]) =>
    rows
      .filter((r) => types.includes(r.entryType))
      .reduce((s, r) => s.add(r._sum.days ?? 0), new Decimal(0));
  const range = leaveYearRange(year, startMonth);
  const pendingAgg = await tx.leaveRequest.aggregate({
    where: {
      employeeId,
      leaveTypeId: type.id,
      status: 'PENDING',
      startDate: { gte: toDate(range.from), lte: toDate(range.to) },
    },
    _sum: { days: true },
  });
  const pending = new Decimal(pendingAgg._sum.days ?? 0);
  const balance = sum(
    'OPENING',
    'CARRY_FORWARD',
    'ACCRUAL',
    'ADJUSTMENT',
    'USAGE',
    'REVERSAL',
    'LAPSE',
  );
  return {
    leaveType: {
      id: type.id,
      code: type.code,
      name: type.name,
      isPaid: type.isPaid,
      tracksBalance: type.tracksBalance,
    },
    year,
    opening: sum('OPENING', 'CARRY_FORWARD').toFixed(2),
    accrued: sum('ACCRUAL').toFixed(2),
    adjusted: sum('ADJUSTMENT', 'LAPSE').toFixed(2),
    used: sum('USAGE', 'REVERSAL').neg().toFixed(2),
    pending: pending.toFixed(2),
    balance: balance.toFixed(2),
    available: balance.sub(pending).toFixed(2),
  };
}
