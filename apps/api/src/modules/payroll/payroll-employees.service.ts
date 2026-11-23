import { Injectable } from '@nestjs/common';
import type { EpfConfig, EsiConfig } from '@hrm/business-rules';
import type {
  EmployeePayrollItem,
  EmployeeSalaryItem,
  PayrollProfileItem,
  TaxDeclarationItem,
} from '@hrm/shared-types';
import type {
  employeeSalarySchema,
  payrollProfileSchema,
  taxDeclarationSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import { displayName, isoDate, toDate, todayIso } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { selfEmployeeId } from '../time/time-context.js';
import { settingsOf } from './payroll-config.service.js';
import {
  activeRuleSet,
  ageOn,
  loadStructures,
  money,
  salaryBreakdown,
  type SalaryRow,
  toSalaryLines,
} from './payroll-common.js';

const profileSelect = {
  pfApplicable: true,
  voluntaryPfFullWages: true,
  epsEligible: true,
  esiApplicable: true,
  esiNumber: true,
  ptStateCode: true,
  metroCity: true,
  taxApplicable: true,
} satisfies Prisma.EmployeePayrollProfileSelect;

@Injectable()
export class PayrollEmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get(employeeId: string): Promise<EmployeePayrollItem> {
    return this.prisma.withTenant(async (tx) => this.itemOf(tx, employeeId));
  }

  mySalary(principal: AuthPrincipal): Promise<EmployeePayrollItem> {
    return this.prisma.withTenant(async (tx) =>
      this.itemOf(tx, await selfEmployeeId(tx, principal)),
    );
  }

  private async itemOf(tx: TenantTransaction, employeeId: string): Promise<EmployeePayrollItem> {
    const e = await tx.employee.findFirst({
      where: { id: employeeId },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        middleName: true,
        lastName: true,
        preferredName: true,
        dateOfBirth: true,
        payrollProfile: { select: profileSelect },
        salaries: {
          orderBy: { effectiveFrom: 'desc' },
          select: {
            id: true,
            structureId: true,
            annualCtc: true,
            effectiveFrom: true,
            reason: true,
            note: true,
            createdByUserId: true,
            createdAt: true,
          },
        },
      },
    });
    if (!e) throw AppException.notFound('Employee');
    const structures = await loadStructures(
      tx,
      e.salaries.map((s) => s.structureId),
    );
    const names = await userNames(
      tx,
      e.salaries.map((s) => s.createdByUserId),
    );
    const salaries: EmployeeSalaryItem[] = [];
    for (const s of e.salaries) {
      const structure = structures.get(s.structureId);
      if (!structure) continue;
      const on = isoDate(s.effectiveFrom);
      const row: SalaryRow = {
        id: s.id,
        employeeId,
        structureId: s.structureId,
        annualCtc: String(s.annualCtc),
        effectiveFrom: on,
      };
      const employer = await employerRules(tx, e.payrollProfile, e.dateOfBirth, on);
      const b = salaryBreakdown(row, structure, employer);
      salaries.push({
        id: s.id,
        structure: { id: structure.id, name: structure.name },
        annualCtc: money(s.annualCtc),
        effectiveFrom: on,
        reason: s.reason,
        note: s.note,
        createdBy: s.createdByUserId ? (names.get(s.createdByUserId) ?? null) : null,
        createdAt: s.createdAt.toISOString(),
        breakdown: {
          monthlyCtc: money(b.monthlyCtc),
          lines: toSalaryLines(b.lines),
          problems: b.problems,
        },
      });
    }
    const today = todayIso();
    return {
      employee: { id: e.id, employeeNumber: e.employeeNumber, displayName: displayName(e) },
      profile: e.payrollProfile,
      salaries,
      current: salaries.find((s) => s.effectiveFrom <= today) ?? null,
    };
  }

  addSalary(
    principal: AuthPrincipal,
    employeeId: string,
    input: z.output<typeof employeeSalarySchema>,
  ): Promise<EmployeePayrollItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const e = await tx.employee.findFirst({
        where: { id: employeeId },
        select: { dateOfJoining: true, status: true },
      });
      if (!e) throw AppException.notFound('Employee');
      if (input.effectiveFrom < isoDate(e.dateOfJoining))
        throw AppException.badRequest(
          'A salary cannot start before the joining date',
          'effectiveFrom',
        );
      const structure = await tx.salaryStructure.findFirst({
        where: { id: input.structureId },
        select: { status: true },
      });
      if (!structure)
        throw AppException.badRequest('The salary structure does not exist', 'structureId');
      if (structure.status !== 'ACTIVE')
        throw AppException.badRequest('The salary structure is inactive', 'structureId');
      try {
        const s = await tx.employeeSalary.create({
          data: {
            organizationId,
            employeeId,
            structureId: input.structureId,
            annualCtc: input.annualCtc,
            effectiveFrom: toDate(input.effectiveFrom),
            reason: input.reason,
            note: input.note ?? null,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        // The CTC is deliberately not written to the audit log.
        await this.audit.record(tx, {
          action: 'payroll.salary.created',
          entityType: 'employee_salary',
          entityId: s.id,
          metadata: { employeeId, effectiveFrom: input.effectiveFrom, reason: input.reason },
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'P2002')
          throw AppException.conflictOn('A salary already starts on this date', 'effectiveFrom');
        throw err;
      }
      return this.itemOf(tx, employeeId);
    });
  }

  /** A salary can be removed only while no finalized payroll has used it. */
  deleteSalary(employeeId: string, salaryId: string): Promise<EmployeePayrollItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await tx.employeeSalary.findFirst({
        where: { id: salaryId, employeeId },
        select: { id: true },
      });
      if (!s) throw AppException.notFound('Salary');
      const used = await tx.payrollResult.count({
        where: {
          employeeId,
          run: { status: 'FINALIZED' },
          snapshot: { path: ['salaryIds'], array_contains: [salaryId] },
        },
      });
      if (used > 0)
        throw AppException.conflict(
          'This salary was used by a finalized payroll; add a correction instead',
        );
      await tx.employeeSalary.delete({ where: { id: salaryId } });
      await this.audit.record(tx, {
        action: 'payroll.salary.deleted',
        entityType: 'employee_salary',
        entityId: salaryId,
        metadata: { employeeId },
      });
      return this.itemOf(tx, employeeId);
    });
  }

  putProfile(
    principal: AuthPrincipal,
    employeeId: string,
    input: z.output<typeof payrollProfileSchema>,
  ): Promise<PayrollProfileItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const e = await tx.employee.findFirst({
        where: { id: employeeId },
        select: { payrollProfile: { select: profileSelect } },
      });
      if (!e) throw AppException.notFound('Employee');
      const data = {
        ...input,
        esiNumber: input.esiNumber ?? null,
        ptStateCode: input.ptStateCode ?? null,
      };
      const p = await tx.employeePayrollProfile.upsert({
        where: { employeeId },
        create: { organizationId, employeeId, ...data },
        update: data,
        select: profileSelect,
      });
      await this.audit.record(tx, {
        action: 'payroll.profile.updated',
        entityType: 'employee_payroll_profile',
        entityId: employeeId,
        changes: diffChanges(e.payrollProfile ?? {}, data),
      });
      return p;
    });
  }

  // ------------------------------------------------------------------------ declarations

  declaration(employeeId: string, financialYear: string): Promise<TaxDeclarationItem | null> {
    return this.prisma.withTenant(async (tx) => declarationOf(tx, employeeId, financialYear));
  }

  myDeclaration(
    principal: AuthPrincipal,
    financialYear: string,
  ): Promise<TaxDeclarationItem | null> {
    return this.prisma.withTenant(async (tx) =>
      declarationOf(tx, await selfEmployeeId(tx, principal), financialYear),
    );
  }

  putDeclaration(
    principal: AuthPrincipal,
    employeeId: string,
    input: z.output<typeof taxDeclarationSchema>,
  ): Promise<TaxDeclarationItem> {
    return this.prisma.withTenant(async (tx) =>
      this.saveDeclaration(tx, principal, employeeId, input),
    );
  }

  putMyDeclaration(
    principal: AuthPrincipal,
    input: z.output<typeof taxDeclarationSchema>,
  ): Promise<TaxDeclarationItem> {
    return this.prisma.withTenant(async (tx) =>
      this.saveDeclaration(tx, principal, await selfEmployeeId(tx, principal), input),
    );
  }

  private async saveDeclaration(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    employeeId: string,
    input: z.output<typeof taxDeclarationSchema>,
  ): Promise<TaxDeclarationItem> {
    const organizationId = principal.organizationId ?? '';
    const e = await tx.employee.findFirst({ where: { id: employeeId }, select: { id: true } });
    if (!e) throw AppException.notFound('Employee');
    const data = {
      regime: input.regime,
      rentPaidAnnual: input.rentPaidAnnual,
      deductions: input.deductions as Prisma.InputJsonValue,
      updatedByUserId: principal.userId,
    };
    await tx.taxDeclaration.upsert({
      where: { employeeId_financialYear: { employeeId, financialYear: input.financialYear } },
      create: { organizationId, employeeId, financialYear: input.financialYear, ...data },
      update: data,
    });
    // Amounts are personal financial data: only the fact of the change is audited.
    await this.audit.record(tx, {
      action: 'payroll.declaration.updated',
      entityType: 'tax_declaration',
      entityId: employeeId,
      metadata: { financialYear: input.financialYear, regime: input.regime },
    });
    const saved = await declarationOf(tx, employeeId, input.financialYear);
    if (!saved) throw AppException.notFound('Declaration');
    return saved;
  }
}

async function declarationOf(
  tx: TenantTransaction,
  employeeId: string,
  financialYear: string,
): Promise<TaxDeclarationItem | null> {
  const d = await tx.taxDeclaration.findFirst({
    where: { employeeId, financialYear },
    select: {
      financialYear: true,
      regime: true,
      rentPaidAnnual: true,
      deductions: true,
      updatedAt: true,
    },
  });
  if (!d) {
    const settings = await settingsOf(tx);
    return settings.defaultTaxRegime
      ? {
          financialYear,
          regime: settings.defaultTaxRegime,
          rentPaidAnnual: '0.00',
          deductions: {},
          updatedAt: null,
        }
      : null;
  }
  return {
    financialYear: d.financialYear,
    regime: d.regime,
    rentPaidAnnual: money(d.rentPaidAnnual),
    deductions: Object.fromEntries(
      Object.entries(d.deductions as Record<string, string>).map(([k, v]) => [k, money(v)]),
    ),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Employer EPF/ESI rules in force on a date for an employee (null when not applicable). */
export async function employerRules(
  tx: TenantTransaction,
  profile: { pfApplicable: boolean; epsEligible: boolean; esiApplicable: boolean } | null,
  dateOfBirth: Date | null,
  on: string,
): Promise<{
  epf: { config: EpfConfig; epsEligible: boolean } | null;
  esi: { config: EsiConfig } | null;
}> {
  const epfRule = profile?.pfApplicable
    ? await activeRuleSet<EpfConfig & { epsMaxAgeYears?: number | null }>(tx, 'EPF', on)
    : null;
  const esiRule = profile?.esiApplicable ? await activeRuleSet<EsiConfig>(tx, 'ESI', on) : null;
  const age = ageOn(dateOfBirth, on);
  const epsEligible =
    (profile?.epsEligible ?? false) &&
    !(epfRule?.config.epsMaxAgeYears && age !== null && age >= epfRule.config.epsMaxAgeYears);
  return {
    epf: epfRule ? { config: epfRule.config, epsEligible } : null,
    esi: esiRule ? { config: esiRule.config } : null,
  };
}
