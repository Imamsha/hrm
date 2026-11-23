import { Injectable } from '@nestjs/common';
import {
  computeGratuity,
  Decimal,
  type GratuityConfig,
  leaveEncashment,
  noticePay,
  serviceYears,
  sumLines,
} from '@hrm/business-rules';
import { type PayLineItem, PERMISSIONS, type SettlementItem } from '@hrm/shared-types';
import type { runDecisionSchema, settlementSchema } from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { displayName, isoDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { calculateEmployee } from './payroll-calc.js';
import {
  activeRuleSet,
  loadStructures,
  money,
  salariesUpTo,
  salaryBreakdown,
  salaryOn,
} from './payroll-common.js';
import { settingsOf } from './payroll-config.service.js';
import { employerRules } from './payroll-employees.service.js';

type SettlementInput = z.output<typeof settlementSchema>;

const select = {
  id: true,
  lastWorkingDate: true,
  status: true,
  inputs: true,
  lines: true,
  gratuity: true,
  leaveEncashment: true,
  noticePay: true,
  totalEarnings: true,
  totalDeductions: true,
  netPayable: true,
  problems: true,
  note: true,
  calculatedByUserId: true,
  approvedByUserId: true,
  finalizedAt: true,
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
} satisfies Prisma.PayrollSettlementSelect;

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async itemIn(
    tx: TenantTransaction,
    id: string,
    principal: AuthPrincipal,
  ): Promise<SettlementItem> {
    const s = await tx.payrollSettlement.findFirst({ where: { id }, select });
    if (!s) throw AppException.notFound('Settlement');
    const names = await userNames(tx, [s.calculatedByUserId, s.approvedByUserId]);
    return {
      id: s.id,
      employee: {
        id: s.employee.id,
        employeeNumber: s.employee.employeeNumber,
        displayName: displayName(s.employee),
      },
      lastWorkingDate: isoDate(s.lastWorkingDate),
      status: s.status,
      gratuity: money(s.gratuity),
      leaveEncashment: money(s.leaveEncashment),
      noticePay: money(s.noticePay),
      totalEarnings: money(s.totalEarnings),
      totalDeductions: money(s.totalDeductions),
      netPayable: money(s.netPayable),
      lines: s.lines as unknown as PayLineItem[],
      problems: s.problems as unknown as SettlementItem['problems'],
      inputs: s.inputs as Record<string, unknown>,
      note: s.note,
      calculatedBy: s.calculatedByUserId ? (names.get(s.calculatedByUserId) ?? null) : null,
      approvedBy: s.approvedByUserId ? (names.get(s.approvedByUserId) ?? null) : null,
      finalizedAt: s.finalizedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      canApprove:
        s.status === 'CALCULATED' &&
        s.calculatedByUserId !== principal.userId &&
        can(principal, PERMISSIONS.PAYROLL_RUN_APPROVE, {}),
    };
  }

  list(principal: AuthPrincipal, status?: string): Promise<SettlementItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.payrollSettlement.findMany({
        where: status ? { status: status as 'DRAFT' } : {},
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return Promise.all(rows.map((r) => this.itemIn(tx, r.id, principal)));
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<SettlementItem> {
    return this.prisma.withTenant(async (tx) => this.itemIn(tx, id, principal));
  }

  create(principal: AuthPrincipal, input: SettlementInput): Promise<SettlementItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(
      async (tx) => {
        const e = await tx.employee.findFirst({
          where: { id: input.employeeId },
          select: { lastWorkingDate: true },
        });
        if (!e) throw AppException.badRequest('The employee does not exist', 'employeeId');
        if (!e.lastWorkingDate)
          throw AppException.badRequest(
            'Record the employee’s separation and last working day first',
            'employeeId',
          );
        try {
          const s = await tx.payrollSettlement.create({
            data: {
              organizationId,
              employeeId: input.employeeId,
              lastWorkingDate: e.lastWorkingDate,
              inputs: input,
              note: input.note ?? null,
            },
            select: { id: true },
          });
          await this.compute(tx, principal, s.id);
          await this.audit.record(tx, {
            action: 'payroll.settlement.created',
            entityType: 'payroll_settlement',
            entityId: s.id,
            metadata: { employeeId: input.employeeId },
          });
          return await this.itemIn(tx, s.id, principal);
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflictOn('This employee already has a settlement', 'employeeId');
          throw err;
        }
      },
      { timeoutMs: 60_000 },
    );
  }

  recalculate(
    principal: AuthPrincipal,
    id: string,
    input: SettlementInput,
  ): Promise<SettlementItem> {
    return this.prisma.withTenant(
      async (tx) => {
        const s = await tx.payrollSettlement.findFirst({
          where: { id },
          select: { status: true, employeeId: true },
        });
        if (!s) throw AppException.notFound('Settlement');
        if (s.status !== 'DRAFT' && s.status !== 'CALCULATED')
          throw AppException.conflict(
            'Only a settlement that is not yet approved can be recalculated',
          );
        if (s.employeeId !== input.employeeId)
          throw AppException.badRequest('The employee cannot change', 'employeeId');
        await tx.payrollSettlement.update({
          where: { id },
          data: { inputs: input, note: input.note ?? null },
        });
        await this.compute(tx, principal, id);
        await this.audit.record(tx, {
          action: 'payroll.settlement.recalculated',
          entityType: 'payroll_settlement',
          entityId: id,
        });
        return this.itemIn(tx, id, principal);
      },
      { timeoutMs: 60_000 },
    );
  }

  /** Final month's salary (unless a finalized run paid it) plus encashment, notice pay, gratuity and adjustments. */
  private async compute(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<void> {
    const s = await tx.payrollSettlement.findFirst({
      where: { id },
      select: { employeeId: true, lastWorkingDate: true, inputs: true },
    });
    if (!s) throw AppException.notFound('Settlement');
    const input = s.inputs as unknown as SettlementInput;
    const lwd = isoDate(s.lastWorkingDate);
    const [year, month] = lwd.split('-').map(Number) as [number, number];
    const e = await tx.employee.findFirst({
      where: { id: s.employeeId },
      select: { dateOfJoining: true, dateOfBirth: true, payrollProfile: true },
    });
    if (!e) throw AppException.notFound('Employee');
    const problems: { code: string; message: string }[] = [];

    // Salary on the last working day: basis of encashment, notice pay and gratuity.
    const salaries = (await salariesUpTo(tx, [s.employeeId], lwd)).get(s.employeeId) ?? [];
    const salary = salaryOn(salaries, lwd);
    const structures = await loadStructures(
      tx,
      salaries.map((x) => x.structureId),
    );
    const structure = salary ? structures.get(salary.structureId) : undefined;
    const lines =
      salary && structure
        ? salaryBreakdown(
            salary,
            structure,
            await employerRules(tx, e.payrollProfile, e.dateOfBirth, lwd),
          ).lines
        : [];
    if (!salary)
      problems.push({ code: 'NO_SALARY', message: 'No salary is set on the last working day' });
    const basis = (codes: string[]) => sumLines(lines, (l) => codes.includes(l.code));

    const extras: {
      code: string;
      name: string;
      category: 'EARNING' | 'DEDUCTION';
      amount: string;
      taxable: boolean;
    }[] = [];
    let encashment = new Decimal(0);
    if (new Decimal(input.leaveEncashmentDays).greaterThan(0)) {
      if (!input.encashmentComponentCodes.length)
        problems.push({
          code: 'ENCASHMENT_BASIS_MISSING',
          message: 'Choose the components leave encashment is based on',
        });
      else {
        encashment = leaveEncashment({
          days: input.leaveEncashmentDays,
          monthlyBasis: basis(input.encashmentComponentCodes),
          divisor: input.encashmentDivisor,
        });
        extras.push({
          code: 'LEAVE_ENCASH',
          name: 'Leave encashment',
          category: 'EARNING',
          amount: encashment.toFixed(2),
          taxable: input.encashmentTaxable,
        });
      }
    }
    const notice = noticePay({
      requiredDays: input.noticeRequiredDays,
      servedDays: input.noticeServedDays,
      monthlyBasis: basis(
        input.encashmentComponentCodes.length
          ? input.encashmentComponentCodes
          : lines.filter((l) => l.kind === 'EARNING').map((l) => l.code),
      ),
      divisor: input.noticeDivisor,
      waivedByEmployer: input.noticeWaivedByEmployer,
    });
    if (!notice.isZero())
      extras.push({
        code: notice.isNegative() ? 'NOTICE_RECOVERY' : 'NOTICE_PAY',
        name: notice.isNegative() ? 'Notice period recovery' : 'Notice pay',
        category: notice.isNegative() ? 'DEDUCTION' : 'EARNING',
        amount: notice.abs().toFixed(2),
        taxable: true,
      });
    let gratuity = new Decimal(0);
    if (input.includeGratuity) {
      const rule = await activeRuleSet<GratuityConfig & { wageComponentCodes: string[] }>(
        tx,
        'GRATUITY',
        lwd,
      );
      if (!rule)
        problems.push({
          code: 'GRATUITY_RULE_MISSING',
          message: 'No active gratuity rule set covers the last working day',
        });
      else {
        const years = serviceYears(isoDate(e.dateOfJoining), lwd, rule.config.roundUpMonths);
        const g = computeGratuity({
          monthlyWages: basis(rule.config.wageComponentCodes),
          years,
          config: rule.config,
          waiveMinimum: input.waiveGratuityMinimum,
        });
        gratuity = g.amount;
        if (g.eligible && !gratuity.isZero())
          extras.push({
            code: 'GRATUITY',
            name: `Gratuity (${String(years)} years)`,
            category: 'EARNING',
            amount: gratuity.toFixed(2),
            taxable: input.gratuityTaxable,
          });
      }
    }
    for (const a of input.adjustments)
      extras.push({
        code: a.code,
        name: a.name,
        category: a.category,
        amount: a.amount,
        taxable: a.category === 'EARNING',
      });

    // Is the final month already paid by a finalized run?
    const paid = await tx.payrollResult.count({
      where: { employeeId: s.employeeId, run: { status: 'FINALIZED', year, month } },
    });
    const monthStart = `${lwd.slice(0, 8)}01`;
    if (monthStart > isoDate(e.dateOfJoining)) {
      const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
      const prevPaid = await tx.payrollResult.count({
        where: { employeeId: s.employeeId, run: { status: 'FINALIZED', ...prev } },
      });
      if (!prevPaid)
        problems.push({
          code: 'EARLIER_MONTH_UNPAID',
          message:
            'The month before the last working month has no finalized payroll for this employee',
        });
    }
    const settings = await settingsOf(tx);
    const calc = await calculateEmployee(tx, s.employeeId, {
      year,
      month,
      settings,
      adjustments: extras.map((x, i) => ({
        id: `settlement-${String(i)}`,
        ...x,
        pfWage: false,
        esiWage: false,
        ptWage: false,
      })),
    });
    // When a run already paid the final month, only the settlement items are paid now (no salary twice).
    let resultLines = calc.result?.lines ?? [];
    if (paid) resultLines = resultLines.filter((l) => l.source === 'ADJUSTMENT');
    for (const p of calc.problems) if (!paid || !['NO_SALARY'].includes(p.code)) problems.push(p);

    const lineItems: PayLineItem[] = resultLines.map((l) => ({
      code: l.code,
      name: l.name,
      category: l.category,
      source: l.source === 'ADJUSTMENT' ? 'SETTLEMENT' : l.source,
      amount: l.amount.toFixed(2),
      forYear: null,
      forMonth: null,
    }));
    const earnings = resultLines
      .filter((l) => l.category === 'EARNING')
      .reduce((a, l) => a.plus(l.amount), new Decimal(0));
    const deductions = resultLines
      .filter((l) => l.category === 'DEDUCTION')
      .reduce((a, l) => a.plus(l.amount), new Decimal(0));
    await tx.payrollSettlement.update({
      where: { id },
      data: {
        status: 'CALCULATED',
        lines: lineItems as unknown as Prisma.InputJsonValue,
        gratuity: gratuity.toFixed(2),
        leaveEncashment: encashment.toFixed(2),
        noticePay: notice.toFixed(2),
        totalEarnings: earnings.toFixed(2),
        totalDeductions: deductions.toFixed(2),
        netPayable: earnings.minus(deductions).toFixed(2),
        problems: problems,
        calculatedByUserId: principal.userId,
        calculatedAt: new Date(),
      },
    });
  }

  decide(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof runDecisionSchema>,
  ): Promise<SettlementItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await tx.payrollSettlement.findFirst({
        where: { id },
        select: { status: true, calculatedByUserId: true, problems: true },
      });
      if (!s) throw AppException.notFound('Settlement');
      if (s.status !== 'CALCULATED')
        throw AppException.conflict('Only a calculated settlement can be approved or rejected');
      if (s.calculatedByUserId === principal.userId)
        throw AppException.forbidden(
          'A settlement must be approved by someone other than the person who calculated it',
        );
      if (input.decision === 'APPROVED' && (s.problems as unknown[]).length)
        throw AppException.conflict('Resolve the settlement problems and recalculate first');
      await tx.payrollSettlement.update({
        where: { id },
        data:
          input.decision === 'APPROVED'
            ? { status: 'APPROVED', approvedByUserId: principal.userId, approvedAt: new Date() }
            : { status: 'DRAFT' },
      });
      await this.audit.record(tx, {
        action: `payroll.settlement.${input.decision === 'APPROVED' ? 'approved' : 'rejected'}`,
        entityType: 'payroll_settlement',
        entityId: id,
        metadata: { note: input.note ?? null },
      });
      return this.itemIn(tx, id, principal);
    });
  }

  finalize(principal: AuthPrincipal, id: string): Promise<SettlementItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await tx.payrollSettlement.findFirst({ where: { id }, select: { status: true } });
      if (!s) throw AppException.notFound('Settlement');
      if (s.status !== 'APPROVED')
        throw AppException.conflict('Only an approved settlement can be finalized');
      await tx.payrollSettlement.update({
        where: { id },
        data: { status: 'FINALIZED', finalizedByUserId: principal.userId, finalizedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'payroll.settlement.finalized',
        entityType: 'payroll_settlement',
        entityId: id,
      });
      return this.itemIn(tx, id, principal);
    });
  }

  cancel(principal: AuthPrincipal, id: string): Promise<SettlementItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await tx.payrollSettlement.findFirst({ where: { id }, select: { status: true } });
      if (!s) throw AppException.notFound('Settlement');
      if (s.status === 'FINALIZED' || s.status === 'CANCELLED')
        throw AppException.conflict(`A ${s.status.toLowerCase()} settlement cannot be cancelled`);
      await tx.payrollSettlement.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        action: 'payroll.settlement.cancelled',
        entityType: 'payroll_settlement',
        entityId: id,
      });
      return this.itemIn(tx, id, principal);
    });
  }
}
