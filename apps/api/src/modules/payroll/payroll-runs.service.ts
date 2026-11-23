import { Injectable } from '@nestjs/common';
import { Decimal } from '@hrm/business-rules';
import {
  type PaginatedResult,
  PERMISSIONS,
  type PayLineItem,
  type PayrollAdjustmentItem,
  type PayrollResultItem,
  type PayrollRunItem,
  type PayslipItem,
  type PayslipSummary,
} from '@hrm/shared-types';
import type {
  createPayrollRunSchema,
  payrollAdjustmentSchema,
  payrollRunListQuerySchema,
  runDecisionSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { FieldEncryption } from '../../infrastructure/security/field-encryption.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { displayName, isoDate, toDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { selfEmployeeId } from '../time/time-context.js';
import { calculateEmployee } from './payroll-calc.js';
import { monthBounds, money, moneyOrNull } from './payroll-common.js';
import { settingsOf } from './payroll-config.service.js';

type RunQuery = z.output<typeof payrollRunListQuerySchema>;

const runSelect = {
  id: true,
  year: true,
  month: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  employeeCount: true,
  problemCount: true,
  totalGross: true,
  totalDeductions: true,
  totalNet: true,
  totalEmployerCost: true,
  note: true,
  createdByUserId: true,
  calculatedByUserId: true,
  calculatedAt: true,
  approvedByUserId: true,
  approvedAt: true,
  finalizedByUserId: true,
  finalizedAt: true,
  createdAt: true,
  company: { select: { id: true, code: true, name: true } },
} satisfies Prisma.PayrollRunSelect;
type RunRow = Prisma.PayrollRunGetPayload<{ select: typeof runSelect }>;

const resultSelect = {
  id: true,
  payableDays: true,
  periodDays: true,
  lossOfPayDays: true,
  gross: true,
  totalDeductions: true,
  netPay: true,
  employerCost: true,
  problems: true,
  annualTaxProjection: true,
  taxTrace: true,
  snapshot: true,
  employee: {
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      middleName: true,
      lastName: true,
      preferredName: true,
    },
  },
  lines: {
    orderBy: { sortOrder: 'asc' },
    select: {
      code: true,
      name: true,
      category: true,
      source: true,
      amount: true,
      forYear: true,
      forMonth: true,
    },
  },
} satisfies Prisma.PayrollResultSelect;
type ResultRow = Prisma.PayrollResultGetPayload<{ select: typeof resultSelect }>;

function toResult(r: ResultRow): PayrollResultItem {
  return {
    id: r.id,
    employee: {
      id: r.employee.id,
      employeeNumber: r.employee.employeeNumber,
      displayName: displayName(r.employee),
    },
    payableDays: String(r.payableDays),
    periodDays: String(r.periodDays),
    lossOfPayDays: String(r.lossOfPayDays),
    gross: money(r.gross),
    totalDeductions: money(r.totalDeductions),
    netPay: money(r.netPay),
    employerCost: money(r.employerCost),
    problems: r.problems as unknown as PayrollResultItem['problems'],
    lines: r.lines.map((l): PayLineItem => ({
      code: l.code,
      name: l.name,
      category: l.category,
      source: l.source,
      amount: money(l.amount),
      forYear: l.forYear,
      forMonth: l.forMonth,
    })),
  };
}

const CATEGORY_ORDER = { EARNING: 0, DEDUCTION: 1, EMPLOYER_CONTRIBUTION: 2 } as const;
const SOURCE_ORDER = {
  STRUCTURE: 0,
  ARREARS: 1,
  ADJUSTMENT: 2,
  SETTLEMENT: 3,
  STATUTORY: 4,
} as const;

@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: FieldEncryption,
  ) {}

  private async toRun(
    tx: TenantTransaction,
    r: RunRow,
    principal: AuthPrincipal,
  ): Promise<PayrollRunItem> {
    const names = await userNames(tx, [
      r.createdByUserId,
      r.calculatedByUserId,
      r.approvedByUserId,
      r.finalizedByUserId,
    ]);
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return {
      id: r.id,
      company: r.company,
      year: r.year,
      month: r.month,
      periodStart: isoDate(r.periodStart),
      periodEnd: isoDate(r.periodEnd),
      status: r.status,
      employeeCount: r.employeeCount,
      problemCount: r.problemCount,
      totals: {
        gross: money(r.totalGross),
        deductions: money(r.totalDeductions),
        net: money(r.totalNet),
        employerCost: money(r.totalEmployerCost),
      },
      note: r.note,
      createdBy: name(r.createdByUserId),
      calculatedBy: name(r.calculatedByUserId),
      calculatedAt: r.calculatedAt?.toISOString() ?? null,
      approvedBy: name(r.approvedByUserId),
      approvedAt: r.approvedAt?.toISOString() ?? null,
      finalizedBy: name(r.finalizedByUserId),
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      canApprove:
        r.status === 'CALCULATED' &&
        r.calculatedByUserId !== principal.userId &&
        can(principal, PERMISSIONS.PAYROLL_RUN_APPROVE, {}),
    };
  }

  private async runIn(
    tx: TenantTransaction,
    id: string,
    principal: AuthPrincipal,
  ): Promise<PayrollRunItem> {
    const r = await tx.payrollRun.findFirst({ where: { id }, select: runSelect });
    if (!r) throw AppException.notFound('Payroll run');
    return this.toRun(tx, r, principal);
  }

  list(principal: AuthPrincipal, q: RunQuery): Promise<PaginatedResult<PayrollRunItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.PayrollRunWhereInput = {
        ...(q.status ? { status: q.status as RunRow['status'] } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.year ? { year: q.year } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.payrollRun.findMany({
          where,
          orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
          select: runSelect,
          ...skipTake(q),
        }),
        tx.payrollRun.count({ where }),
      ]);
      return paginate(await Promise.all(rows.map((r) => this.toRun(tx, r, principal))), total, q);
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<PayrollRunItem> {
    return this.prisma.withTenant(async (tx) => this.runIn(tx, id, principal));
  }

  create(
    principal: AuthPrincipal,
    input: z.output<typeof createPayrollRunSchema>,
  ): Promise<PayrollRunItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const company = await tx.company.findFirst({
        where: { id: input.companyId },
        select: { status: true },
      });
      if (!company) throw AppException.badRequest('The company does not exist', 'companyId');
      const { start, end } = monthBounds(input.year, input.month);
      try {
        const r = await tx.payrollRun.create({
          data: {
            organizationId,
            companyId: input.companyId,
            year: input.year,
            month: input.month,
            periodStart: toDate(start),
            periodEnd: toDate(end),
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'payroll.run.created',
          entityType: 'payroll_run',
          entityId: r.id,
          metadata: { ...input },
        });
        return await this.runIn(tx, r.id, principal);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002')
          throw AppException.conflictOn(
            'A payroll run for this company and month already exists',
            'month',
          );
        throw err;
      }
    });
  }

  /** (Re)calculates every employee of the run. Allowed while DRAFT or CALCULATED. */
  calculate(principal: AuthPrincipal, id: string): Promise<PayrollRunItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM payroll_runs WHERE id = ${id}::uuid FOR UPDATE`;
        const run = await tx.payrollRun.findFirst({
          where: { id },
          select: {
            status: true,
            companyId: true,
            year: true,
            month: true,
            periodStart: true,
            periodEnd: true,
          },
        });
        if (!run) throw AppException.notFound('Payroll run');
        if (run.status !== 'DRAFT' && run.status !== 'CALCULATED')
          throw AppException.conflict(`A ${run.status.toLowerCase()} run cannot be recalculated`);
        const start = isoDate(run.periodStart);
        const end = isoDate(run.periodEnd);

        // Employees employed in the period whose job record (at their last day in it) is with this company.
        const candidates = await tx.employee.findMany({
          where: {
            dateOfJoining: { lte: run.periodEnd },
            OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: run.periodStart } }],
            employmentRecords: {
              some: {
                companyId: run.companyId,
                effectiveFrom: { lte: run.periodEnd },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodStart } }],
              },
            },
            // Final months are paid by the full & final settlement.
            settlements: {
              none: { status: { not: 'CANCELLED' }, lastWorkingDate: { lte: run.periodEnd } },
            },
          },
          select: {
            id: true,
            lastWorkingDate: true,
            employmentRecords: {
              where: { effectiveFrom: { lte: run.periodEnd } },
              orderBy: { effectiveFrom: 'desc' },
              select: { companyId: true, effectiveFrom: true, effectiveTo: true },
            },
          },
        });
        const employees = candidates.filter((c) => {
          const anchor =
            c.lastWorkingDate && isoDate(c.lastWorkingDate) < end
              ? isoDate(c.lastWorkingDate)
              : end;
          const rec = c.employmentRecords.find(
            (r) =>
              isoDate(r.effectiveFrom) <= anchor &&
              (!r.effectiveTo || isoDate(r.effectiveTo) >= anchor),
          );
          return rec?.companyId === run.companyId;
        });

        const old = await tx.payrollResult.findMany({ where: { runId: id }, select: { id: true } });
        if (old.length) {
          await tx.payrollResultLine.deleteMany({
            where: { resultId: { in: old.map((o) => o.id) } },
          });
          await tx.payrollResult.deleteMany({ where: { runId: id } });
        }
        const settings = await settingsOf(tx);
        const adjustments = await tx.payrollAdjustment.findMany({ where: { runId: id } });
        let gross = new Decimal(0);
        let deductions = new Decimal(0);
        let net = new Decimal(0);
        let employer = new Decimal(0);
        let withProblems = 0;
        for (const emp of employees) {
          const mine = adjustments
            .filter((a) => a.employeeId === emp.id)
            .map((a) => ({
              id: a.id,
              code: a.code,
              name: a.name,
              category: a.category as 'EARNING' | 'DEDUCTION',
              amount: String(a.amount),
              taxable: a.taxable,
              pfWage: a.pfWage,
              esiWage: a.esiWage,
              ptWage: a.ptWage,
            }));
          const c = await calculateEmployee(tx, emp.id, {
            year: run.year,
            month: run.month,
            settings,
            adjustments: mine,
          });
          const r = c.result;
          if (c.problems.length) withProblems += 1;
          const zero = new Decimal(0);
          const result = await tx.payrollResult.create({
            data: {
              organizationId,
              runId: id,
              employeeId: emp.id,
              payableDays: c.payable.toFixed(2),
              periodDays: c.denominator.isZero() ? '1' : c.denominator.toFixed(2),
              lossOfPayDays: c.lop.toFixed(2),
              gross: (r?.gross ?? zero).toFixed(2),
              totalDeductions: (r?.totalDeductions ?? zero).toFixed(2),
              netPay: (r?.netPay ?? zero).toFixed(2),
              employerCost: (r?.employerCost ?? zero).toFixed(2),
              taxableGross: c.taxableGross.toFixed(2),
              pfWages: (r?.wages.pf ?? zero).toFixed(2),
              esiWages: (r?.wages.esi ?? zero).toFixed(2),
              ptWages: (r?.wages.pt ?? zero).toFixed(2),
              esiCovered: c.esiCovered,
              annualTaxProjection: r?.tax ? r.tax.annualTax.toFixed(2) : null,
              snapshot: c.snapshot as Prisma.InputJsonValue,
              taxTrace: r?.tax ? (r.tax.trace as unknown as Prisma.InputJsonValue) : undefined,
              problems: c.problems as unknown as Prisma.InputJsonValue,
            },
            select: { id: true },
          });
          if (r) {
            let arrearsIndex = 0;
            const lines = r.lines.map((l) => {
              const arrears = l.source === 'ARREARS' ? c.arrears[arrearsIndex++] : undefined;
              const order = c.componentOrder.get(l.code.replace(/^ARR_/, '')) ?? 500;
              return {
                organizationId,
                resultId: result.id,
                code: l.code,
                name: l.name,
                category: l.category,
                source: l.source,
                amount: l.amount.toFixed(2),
                taxable: l.taxable,
                forYear: arrears?.forYear ?? null,
                forMonth: arrears?.forMonth ?? null,
                sortOrder:
                  CATEGORY_ORDER[l.category] * 10000 +
                  SOURCE_ORDER[l.source] * 1000 +
                  Math.min(order, 999),
              };
            });
            if (lines.length) await tx.payrollResultLine.createMany({ data: lines });
            gross = gross.plus(r.gross);
            deductions = deductions.plus(r.totalDeductions);
            net = net.plus(r.netPay);
            employer = employer.plus(r.employerCost);
          }
        }
        await tx.payrollRun.update({
          where: { id },
          data: {
            status: 'CALCULATED',
            employeeCount: employees.length,
            problemCount: withProblems,
            totalGross: gross.toFixed(2),
            totalDeductions: deductions.toFixed(2),
            totalNet: net.toFixed(2),
            totalEmployerCost: employer.toFixed(2),
            calculatedByUserId: principal.userId,
            calculatedAt: new Date(),
          },
        });
        await this.audit.record(tx, {
          action: 'payroll.run.calculated',
          entityType: 'payroll_run',
          entityId: id,
          metadata: {
            period: `${start}..${end}`,
            employees: employees.length,
            problems: withProblems,
          },
        });
        return this.runIn(tx, id, principal);
      },
      { timeoutMs: 300_000 },
    );
  }

  results(id: string, filter: { problemsOnly?: boolean }): Promise<PayrollResultItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.payrollResult.findMany({
        where: { runId: id, ...(filter.problemsOnly ? { NOT: { problems: { equals: [] } } } : {}) },
        orderBy: { employee: { employeeNumber: 'asc' } },
        select: resultSelect,
      });
      return rows.map(toResult);
    });
  }

  // ------------------------------------------------------------------------ adjustments

  adjustments(runId: string): Promise<PayrollAdjustmentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.payrollAdjustment.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          amount: true,
          taxable: true,
          note: true,
          createdAt: true,
          employee: {
            select: {
              id: true,
              employeeNumber: true,
              firstName: true,
              middleName: true,
              lastName: true,
              preferredName: true,
            },
          },
        },
      });
      return rows.map((a) => ({
        id: a.id,
        employee: {
          id: a.employee.id,
          employeeNumber: a.employee.employeeNumber,
          displayName: displayName(a.employee),
        },
        code: a.code,
        name: a.name,
        category: a.category as 'EARNING' | 'DEDUCTION',
        amount: money(a.amount),
        taxable: a.taxable,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
      }));
    });
  }

  addAdjustment(
    principal: AuthPrincipal,
    runId: string,
    input: z.output<typeof payrollAdjustmentSchema>,
  ): Promise<PayrollAdjustmentItem[]> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id: runId }, select: { status: true } });
      if (!run) throw AppException.notFound('Payroll run');
      if (run.status !== 'DRAFT' && run.status !== 'CALCULATED')
        throw AppException.conflict('Adjustments can be changed only before approval');
      const e = await tx.employee.findFirst({
        where: { id: input.employeeId },
        select: { id: true },
      });
      if (!e) throw AppException.badRequest('The employee does not exist', 'employeeId');
      const a = await tx.payrollAdjustment.create({
        data: {
          organizationId,
          runId,
          ...input,
          note: input.note ?? null,
          createdByUserId: principal.userId,
        },
        select: { id: true },
      });
      // A changed input invalidates the calculation.
      if (run.status === 'CALCULATED')
        await tx.payrollRun.update({ where: { id: runId }, data: { status: 'DRAFT' } });
      await this.audit.record(tx, {
        action: 'payroll.adjustment.created',
        entityType: 'payroll_adjustment',
        entityId: a.id,
        metadata: {
          runId,
          employeeId: input.employeeId,
          code: input.code,
          category: input.category,
        },
      });
      return this.adjustments(runId);
    });
  }

  deleteAdjustment(runId: string, adjustmentId: string): Promise<PayrollAdjustmentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const a = await tx.payrollAdjustment.findFirst({
        where: { id: adjustmentId, runId },
        select: { id: true, run: { select: { status: true } } },
      });
      if (!a) throw AppException.notFound('Adjustment');
      if (a.run.status !== 'DRAFT' && a.run.status !== 'CALCULATED')
        throw AppException.conflict('Adjustments can be changed only before approval');
      await tx.payrollAdjustment.delete({ where: { id: adjustmentId } });
      if (a.run.status === 'CALCULATED')
        await tx.payrollRun.update({ where: { id: runId }, data: { status: 'DRAFT' } });
      await this.audit.record(tx, {
        action: 'payroll.adjustment.deleted',
        entityType: 'payroll_adjustment',
        entityId: adjustmentId,
        metadata: { runId },
      });
      return this.adjustments(runId);
    });
  }

  // ------------------------------------------------------------------------ lifecycle

  /** Approval by someone other than the calculator; refused while any employee has problems. */
  decide(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof runDecisionSchema>,
  ): Promise<PayrollRunItem> {
    return this.prisma.withTenant(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id },
        select: { status: true, calculatedByUserId: true, problemCount: true },
      });
      if (!run) throw AppException.notFound('Payroll run');
      if (run.status !== 'CALCULATED')
        throw AppException.conflict('Only a calculated run can be approved or rejected');
      if (run.calculatedByUserId === principal.userId)
        throw AppException.forbidden(
          'A run must be approved by someone other than the person who calculated it',
        );
      if (input.decision === 'APPROVED' && run.problemCount > 0)
        throw AppException.conflict(
          `${String(run.problemCount)} employee(s) have problems; resolve them and recalculate first`,
        );
      await tx.payrollRun.update({
        where: { id },
        data:
          input.decision === 'APPROVED'
            ? {
                status: 'APPROVED',
                approvedByUserId: principal.userId,
                approvedAt: new Date(),
                note: input.note ?? null,
              }
            : { status: 'DRAFT', note: input.note ?? null },
      });
      await this.audit.record(tx, {
        action: input.decision === 'APPROVED' ? 'payroll.run.approved' : 'payroll.run.rejected',
        entityType: 'payroll_run',
        entityId: id,
        metadata: { note: input.note ?? null },
      });
      return this.runIn(tx, id, principal);
    });
  }

  /** APPROVED → FINALIZED: results become immutable payslips. */
  finalize(principal: AuthPrincipal, id: string): Promise<PayrollRunItem> {
    return this.prisma.withTenant(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id },
        select: { status: true, companyId: true, year: true, month: true },
      });
      if (!run) throw AppException.notFound('Payroll run');
      if (run.status !== 'APPROVED')
        throw AppException.conflict('Only an approved run can be finalized');
      // Months are finalized in order so year-to-date figures and arrears stay consistent.
      const earlierOpen = await tx.payrollRun.count({
        where: {
          companyId: run.companyId,
          status: { in: ['DRAFT', 'CALCULATED', 'APPROVED'] },
          OR: [{ year: { lt: run.year } }, { year: run.year, month: { lt: run.month } }],
        },
      });
      if (earlierOpen)
        throw AppException.conflict(
          'Finalize or cancel the earlier open runs of this company first',
        );
      await tx.payrollRun.update({
        where: { id },
        data: { status: 'FINALIZED', finalizedByUserId: principal.userId, finalizedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'payroll.run.finalized',
        entityType: 'payroll_run',
        entityId: id,
      });
      return this.runIn(tx, id, principal);
    });
  }

  cancel(principal: AuthPrincipal, id: string): Promise<PayrollRunItem> {
    return this.prisma.withTenant(async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id }, select: { status: true } });
      if (!run) throw AppException.notFound('Payroll run');
      if (run.status === 'FINALIZED' || run.status === 'CANCELLED')
        throw AppException.conflict(`A ${run.status.toLowerCase()} run cannot be cancelled`);
      await tx.payrollRun.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        action: 'payroll.run.cancelled',
        entityType: 'payroll_run',
        entityId: id,
      });
      return this.runIn(tx, id, principal);
    });
  }

  // ------------------------------------------------------------------------ payslips

  private async payslipIn(
    tx: TenantTransaction,
    where: Prisma.PayrollResultWhereInput,
  ): Promise<PayslipItem> {
    const r = await tx.payrollResult.findFirst({
      where: { ...where, run: { status: 'FINALIZED' } },
      select: {
        ...resultSelect,
        runId: true,
        run: {
          select: {
            year: true,
            month: true,
            finalizedAt: true,
            periodEnd: true,
            company: { select: { name: true } },
          },
        },
        employee: {
          select: {
            ...resultSelect.employee.select,
            bankAccounts: {
              where: { isPrimary: true },
              select: { bankName: true, accountLast4: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!r) throw AppException.notFound('Payslip');
    const bank = r.employee.bankAccounts[0];
    const snap = r.snapshot as { tax?: { regime?: 'OLD' | 'NEW' | null } };
    // The legal entity of the employee's job record at the end of the period.
    const record = await tx.employmentRecord.findFirst({
      where: {
        employeeId: r.employee.id,
        effectiveFrom: { lte: r.run.periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: r.run.periodEnd } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { legalEntity: { select: { legalName: true } } },
    });
    return {
      ...toResult(r),
      runId: r.runId,
      year: r.run.year,
      month: r.run.month,
      company: {
        name: r.run.company.name,
        legalName: record?.legalEntity?.legalName ?? null,
      },
      finalizedAt: r.run.finalizedAt?.toISOString() ?? '',
      taxRegime: snap.tax?.regime ?? null,
      annualTaxProjection: moneyOrNull(r.annualTaxProjection),
      taxTrace: (r.taxTrace as PayslipItem['taxTrace']) ?? null,
      bankAccount: bank ? { bankName: bank.bankName, last4: bank.accountLast4 } : null,
    };
  }

  payslip(resultId: string): Promise<PayslipItem> {
    return this.prisma.withTenant(async (tx) => this.payslipIn(tx, { id: resultId }));
  }

  myPayslips(principal: AuthPrincipal): Promise<PayslipSummary[]> {
    return this.prisma.withTenant(async (tx) => {
      const employeeId = await selfEmployeeId(tx, principal);
      const rows = await tx.payrollResult.findMany({
        where: { employeeId, run: { status: 'FINALIZED' } },
        orderBy: [{ run: { year: 'desc' } }, { run: { month: 'desc' } }],
        select: {
          id: true,
          gross: true,
          netPay: true,
          run: {
            select: {
              year: true,
              month: true,
              finalizedAt: true,
              company: { select: { name: true } },
            },
          },
        },
      });
      return rows.map((r) => ({
        resultId: r.id,
        year: r.run.year,
        month: r.run.month,
        company: r.run.company.name,
        gross: money(r.gross),
        netPay: money(r.netPay),
        finalizedAt: r.run.finalizedAt?.toISOString() ?? '',
      }));
    });
  }

  myPayslip(principal: AuthPrincipal, resultId: string): Promise<PayslipItem> {
    return this.prisma.withTenant(async (tx) =>
      this.payslipIn(tx, { id: resultId, employeeId: await selfEmployeeId(tx, principal) }),
    );
  }

  // ------------------------------------------------------------------------ bank file

  /**
   * Generic CSV of net pay for a finalized run (bank-specific formats are integrations). Account
   * numbers are decrypted only here and the export is audited.
   */
  bankFile(id: string): Promise<{ filename: string; content: string }> {
    return this.prisma.withTenant(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { id },
        select: { status: true, year: true, month: true, company: { select: { code: true } } },
      });
      if (!run) throw AppException.notFound('Payroll run');
      if (run.status !== 'FINALIZED')
        throw AppException.conflict('Bank files are available only for finalized runs');
      const rows = await tx.payrollResult.findMany({
        where: { runId: id, netPay: { gt: 0 } },
        orderBy: { employee: { employeeNumber: 'asc' } },
        select: {
          netPay: true,
          employee: {
            select: {
              employeeNumber: true,
              firstName: true,
              middleName: true,
              lastName: true,
              preferredName: true,
              bankAccounts: {
                where: { isPrimary: true },
                take: 1,
                select: {
                  id: true,
                  accountHolderName: true,
                  bankName: true,
                  ifsc: true,
                  accountType: true,
                  accountNumberEncrypted: true,
                },
              },
            },
          },
        },
      });
      const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const reference = `SALARY ${String(run.year)}-${String(run.month).padStart(2, '0')}`;
      const lines = [
        'employee_number,employee_name,account_holder,bank_name,ifsc,account_type,account_number,amount,reference,status',
      ];
      let missing = 0;
      for (const r of rows) {
        const b = r.employee.bankAccounts[0];
        if (!b) missing += 1;
        const account = b
          ? this.crypto.decrypt(
              b.accountNumberEncrypted,
              `employee_bank_accounts.account_number:${b.id}`,
            )
          : '';
        lines.push(
          [
            r.employee.employeeNumber,
            displayName(r.employee),
            b?.accountHolderName ?? '',
            b?.bankName ?? '',
            b?.ifsc ?? '',
            b?.accountType ?? '',
            account,
            money(r.netPay),
            reference,
            b ? 'OK' : 'NO_PRIMARY_BANK_ACCOUNT',
          ]
            .map((v) => cell(v))
            .join(','),
        );
      }
      await this.audit.record(tx, {
        action: 'payroll.bank_file.exported',
        entityType: 'payroll_run',
        entityId: id,
        metadata: { rows: rows.length, missingAccounts: missing },
      });
      return {
        filename: `salary-${run.company.code}-${String(run.year)}-${String(run.month).padStart(2, '0')}.csv`,
        content: lines.join('\r\n') + '\r\n',
      };
    });
  }
}
