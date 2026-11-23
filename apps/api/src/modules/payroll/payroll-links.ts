/**
 * Phase 08 → payroll: finance-approved expense claims paid through payroll and settled trip
 * balances become one-time lines of the employee's run; finalizing the run completes them.
 */
import { Decimal } from '@hrm/business-rules';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { isoDate } from '../employees/employee-scope.js';

export interface LinkedAdjustment {
  id: string;
  code: string;
  name: string;
  category: 'EARNING' | 'DEDUCTION';
  amount: string;
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
  ptWage: boolean;
}

/**
 * Re-links claims and trip balances to a run being (re)calculated and returns the lines per
 * employee. Claims of trips with an advance are excluded (they settle with the trip).
 */
export async function linkToRun(
  tx: TenantTransaction,
  runId: string,
  employeeIds: string[],
): Promise<Map<string, LinkedAdjustment[]>> {
  await tx.expenseClaim.updateMany({
    where: { payrollRunId: runId, status: 'FINANCE_APPROVED' },
    data: { payrollRunId: null },
  });
  await tx.travelRequest.updateMany({
    where: { recoveryPayrollRunId: runId, recoveredAt: null },
    data: { recoveryPayrollRunId: null },
  });
  const out = new Map<string, LinkedAdjustment[]>();
  if (!employeeIds.length) return out;
  const push = (employeeId: string, a: LinkedAdjustment) => {
    out.set(employeeId, [...(out.get(employeeId) ?? []), a]);
  };

  const claims = await tx.expenseClaim.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'FINANCE_APPROVED',
      payoutMethod: 'PAYROLL',
      payrollRunId: null,
      OR: [{ tripId: null }, { trip: { advances: { none: {} } } }],
    },
    select: {
      id: true,
      employeeId: true,
      items: { select: { approvedAmount: true, category: { select: { taxable: true } } } },
    },
  });
  const totals = new Map<string, { taxable: Decimal; exempt: Decimal; ids: string[] }>();
  for (const c of claims) {
    const t = totals.get(c.employeeId) ?? {
      taxable: new Decimal(0),
      exempt: new Decimal(0),
      ids: [],
    };
    for (const it of c.items) {
      const amount = new Decimal((it.approvedAmount ?? 0).toString());
      if (it.category.taxable) t.taxable = t.taxable.plus(amount);
      else t.exempt = t.exempt.plus(amount);
    }
    t.ids.push(c.id);
    totals.set(c.employeeId, t);
  }
  for (const [employeeId, t] of totals) {
    const base = { category: 'EARNING' as const, pfWage: false, esiWage: false, ptWage: false };
    if (t.exempt.greaterThan(0))
      push(employeeId, {
        ...base,
        id: `claims:${t.ids.join(',')}`,
        code: 'EXP_REIMB',
        name: 'Expense reimbursement',
        amount: t.exempt.toFixed(2),
        taxable: false,
      });
    if (t.taxable.greaterThan(0))
      push(employeeId, {
        ...base,
        id: `claims:${t.ids.join(',')}:taxable`,
        code: 'EXP_REIMB_TX',
        name: 'Expense reimbursement (taxable)',
        amount: t.taxable.toFixed(2),
        taxable: true,
      });
  }
  if (claims.length)
    await tx.expenseClaim.updateMany({
      where: { id: { in: claims.map((c) => c.id) } },
      data: { payrollRunId: runId },
    });

  const trips = await tx.travelRequest.findMany({
    where: {
      employeeId: { in: employeeIds },
      status: 'SETTLED',
      recoveryMethod: 'PAYROLL',
      recoveredAt: null,
      recoveryPayrollRunId: null,
    },
    select: { id: true, employeeId: true, settlementBalance: true },
  });
  for (const t of trips) {
    const balance = new Decimal((t.settlementBalance ?? 0).toString());
    if (balance.isZero()) continue;
    push(t.employeeId, {
      id: `trip:${t.id}`,
      code: balance.isPositive() ? 'TRAVEL_SETTLE' : 'TRAVEL_RECOVERY',
      name: balance.isPositive() ? 'Travel settlement' : 'Travel advance recovery',
      category: balance.isPositive() ? 'EARNING' : 'DEDUCTION',
      amount: balance.abs().toFixed(2),
      taxable: false,
      pfWage: false,
      esiWage: false,
      ptWage: false,
    });
  }
  if (trips.length)
    await tx.travelRequest.updateMany({
      where: { id: { in: trips.map((t) => t.id) } },
      data: { recoveryPayrollRunId: runId },
    });
  return out;
}

/** Finalizing a run reimburses its claims and completes its trip recoveries. */
export async function completeLinks(
  tx: TenantTransaction,
  runId: string,
  organizationId: string,
  actorUserId: string,
): Promise<void> {
  const run = await tx.payrollRun.findFirst({
    where: { id: runId },
    select: { year: true, month: true, periodEnd: true },
  });
  if (!run) return;
  const reference = `Payroll ${String(run.year)}-${String(run.month).padStart(2, '0')}`;
  const claims = await tx.expenseClaim.findMany({
    where: { payrollRunId: runId, status: 'FINANCE_APPROVED' },
    select: { id: true },
  });
  for (const c of claims) {
    await tx.expenseClaim.update({
      where: { id: c.id },
      data: {
        status: 'REIMBURSED',
        reimbursedAt: new Date(),
        paidOn: run.periodEnd,
        paidReference: reference,
      },
    });
    await tx.expenseClaimEvent.create({
      data: {
        organizationId,
        claimId: c.id,
        fromStatus: 'FINANCE_APPROVED',
        toStatus: 'REIMBURSED',
        note: `${reference} (${isoDate(run.periodEnd)})`,
        actorUserId,
      },
    });
  }
  await tx.travelRequest.updateMany({
    where: { recoveryPayrollRunId: runId, recoveredAt: null },
    data: { recoveredAt: new Date(), recoveryReference: reference },
  });
}

/** A cancelled run releases its claims and trip balances for the next run. */
export async function releaseLinks(tx: TenantTransaction, runId: string): Promise<void> {
  await tx.expenseClaim.updateMany({
    where: { payrollRunId: runId, status: 'FINANCE_APPROVED' },
    data: { payrollRunId: null },
  });
  await tx.travelRequest.updateMany({
    where: { recoveryPayrollRunId: runId, recoveredAt: null },
    data: { recoveryPayrollRunId: null },
  });
}
