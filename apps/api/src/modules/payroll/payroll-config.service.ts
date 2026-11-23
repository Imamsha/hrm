import { Injectable } from '@nestjs/common';
import type {
  ComponentCalcItem,
  PayrollSettingsItem,
  SalaryComponentItem,
  SalaryStructureItem,
  StatutoryRuleSetItem,
} from '@hrm/shared-types';
import type {
  payrollSettingsSchema,
  salaryComponentSchema,
  salaryStructureSchema,
  statutoryRuleSetSchema,
  updateSalaryComponentSchema,
  updateSalaryStructureSchema,
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
import { isoDate, isoOrNull, toDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { definedOnly, mapWriteError } from '../structure/structure.util.js';

type RuleSetInput = z.output<typeof statutoryRuleSetSchema>;

const ruleSelect = {
  id: true,
  type: true,
  name: true,
  stateCode: true,
  regime: true,
  effectiveFrom: true,
  effectiveTo: true,
  status: true,
  sourceReference: true,
  notes: true,
  config: true,
  createdByUserId: true,
  activatedByUserId: true,
  activatedAt: true,
  createdAt: true,
} satisfies Prisma.StatutoryRuleSetSelect;
type RuleRow = Prisma.StatutoryRuleSetGetPayload<{ select: typeof ruleSelect }>;

function toRuleSet(r: RuleRow, names: Map<string, string>): StatutoryRuleSetItem {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    stateCode: r.stateCode,
    regime: r.regime,
    effectiveFrom: isoDate(r.effectiveFrom),
    effectiveTo: isoOrNull(r.effectiveTo),
    status: r.status,
    sourceReference: r.sourceReference,
    notes: r.notes,
    config: r.config as Record<string, unknown>,
    createdBy: r.createdByUserId ? (names.get(r.createdByUserId) ?? null) : null,
    activatedBy: r.activatedByUserId ? (names.get(r.activatedByUserId) ?? null) : null,
    activatedAt: r.activatedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Scope columns derived from the validated config (never trusted separately from the client). */
function scopeOf(input: RuleSetInput): { stateCode: string | null; regime: 'OLD' | 'NEW' | null } {
  if (input.type === 'PT') return { stateCode: input.config.stateCode, regime: null };
  if (input.type === 'INCOME_TAX') return { stateCode: null, regime: input.config.regime };
  return { stateCode: null, regime: null };
}

function sqlState(err: unknown): string | undefined {
  const e = err as {
    code?: string;
    meta?: { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } };
  };
  return (
    e.meta?.driverAdapterError?.cause?.originalCode ??
    e.meta?.driverAdapterError?.cause?.code ??
    e.code
  );
}

const componentSelect = {
  id: true,
  code: true,
  name: true,
  kind: true,
  taxable: true,
  pfWage: true,
  esiWage: true,
  ptWage: true,
  prorate: true,
  payslipOrder: true,
  description: true,
  status: true,
} satisfies Prisma.SalaryComponentSelect;

@Injectable()
export class PayrollConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------------------ settings

  getSettings(): Promise<PayrollSettingsItem> {
    return this.prisma.withTenant(async (tx) => settingsOf(tx));
  }

  putSettings(principal: AuthPrincipal, input: z.output<typeof payrollSettingsSchema>) {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const before = await settingsOf(tx);
      const data = {
        payableDaysMethod: input.payableDaysMethod,
        fixedDays: input.payableDaysMethod === 'FIXED_DAYS' ? (input.fixedDays ?? null) : null,
        absentIsLossOfPay: input.absentIsLossOfPay,
        hraComponentCode: input.hraComponentCode ?? null,
        basicComponentCodes: input.basicComponentCodes,
        defaultTaxRegime: input.defaultTaxRegime ?? null,
      };
      await tx.payrollSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
      });
      await this.audit.record(tx, {
        action: 'payroll.settings.updated',
        entityType: 'payroll_settings',
        entityId: organizationId,
        changes: diffChanges(before as unknown as Record<string, unknown>, data),
      });
      return settingsOf(tx);
    });
  }

  // ------------------------------------------------------------------------------ rule sets

  listRuleSets(filter: { type?: string; status?: string }): Promise<StatutoryRuleSetItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.statutoryRuleSet.findMany({
        where: {
          ...(filter.type ? { type: filter.type as RuleRow['type'] } : {}),
          ...(filter.status ? { status: filter.status as RuleRow['status'] } : {}),
        },
        orderBy: [
          { type: 'asc' },
          { stateCode: 'asc' },
          { regime: 'asc' },
          { effectiveFrom: 'desc' },
        ],
        select: ruleSelect,
      });
      const names = await userNames(
        tx,
        rows.flatMap((r) => [r.createdByUserId, r.activatedByUserId]),
      );
      return rows.map((r) => toRuleSet(r, names));
    });
  }

  getRuleSet(id: string): Promise<StatutoryRuleSetItem> {
    return this.prisma.withTenant(async (tx) => this.ruleSetIn(tx, id));
  }

  private async ruleSetIn(tx: TenantTransaction, id: string): Promise<StatutoryRuleSetItem> {
    const r = await tx.statutoryRuleSet.findFirst({ where: { id }, select: ruleSelect });
    if (!r) throw AppException.notFound('Rule set');
    return toRuleSet(r, await userNames(tx, [r.createdByUserId, r.activatedByUserId]));
  }

  /** New rule sets are always DRAFT; activation is a separate, audited step. */
  createRuleSet(principal: AuthPrincipal, input: RuleSetInput): Promise<StatutoryRuleSetItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.statutoryRuleSet.create({
        data: {
          organizationId,
          type: input.type,
          name: input.name,
          ...scopeOf(input),
          effectiveFrom: toDate(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
          sourceReference: input.sourceReference,
          notes: input.notes ?? null,
          config: input.config,
          createdByUserId: principal.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'payroll.rule_set.created',
        entityType: 'statutory_rule_set',
        entityId: r.id,
        metadata: {
          type: input.type,
          name: input.name,
          effectiveFrom: input.effectiveFrom,
          sourceReference: input.sourceReference,
        },
      });
      return this.ruleSetIn(tx, r.id);
    });
  }

  /** Replaces a DRAFT (the database also refuses edits to active or retired rule sets). */
  updateRuleSet(
    principal: AuthPrincipal,
    id: string,
    input: RuleSetInput,
  ): Promise<StatutoryRuleSetItem> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.statutoryRuleSet.findFirst({
        where: { id },
        select: { status: true, type: true },
      });
      if (!r) throw AppException.notFound('Rule set');
      if (r.status !== 'DRAFT')
        throw AppException.conflict('Only a draft can be edited; create a new version instead');
      if (r.type !== input.type)
        throw AppException.badRequest('The rule type cannot change', 'type');
      await tx.statutoryRuleSet.update({
        where: { id },
        data: {
          name: input.name,
          ...scopeOf(input),
          effectiveFrom: toDate(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
          sourceReference: input.sourceReference,
          notes: input.notes ?? null,
          config: input.config,
        },
      });
      await this.audit.record(tx, {
        action: 'payroll.rule_set.updated',
        entityType: 'statutory_rule_set',
        entityId: id,
        metadata: { by: principal.userId },
      });
      return this.ruleSetIn(tx, id);
    });
  }

  deleteRuleSet(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.statutoryRuleSet.findFirst({
        where: { id },
        select: { status: true, name: true },
      });
      if (!r) throw AppException.notFound('Rule set');
      if (r.status !== 'DRAFT')
        throw AppException.conflict(
          'Only a draft can be deleted; retire an active rule set instead',
        );
      await tx.statutoryRuleSet.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'payroll.rule_set.deleted',
        entityType: 'statutory_rule_set',
        entityId: id,
        metadata: { name: r.name },
      });
    });
  }

  /**
   * DRAFT → ACTIVE (the config is frozen from now on; overlapping active rule sets of the same
   * type and scope are refused by the database) or ACTIVE → RETIRED.
   */
  setRuleSetStatus(
    principal: AuthPrincipal,
    id: string,
    status: 'ACTIVE' | 'RETIRED',
  ): Promise<StatutoryRuleSetItem> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.statutoryRuleSet.findFirst({
        where: { id },
        select: { status: true, name: true },
      });
      if (!r) throw AppException.notFound('Rule set');
      const allowed =
        (r.status === 'DRAFT' && status === 'ACTIVE') ||
        (r.status === 'ACTIVE' && status === 'RETIRED');
      if (!allowed)
        throw AppException.conflict(
          `A ${r.status.toLowerCase()} rule set cannot become ${status.toLowerCase()}`,
        );
      try {
        await tx.statutoryRuleSet.update({
          where: { id },
          data:
            status === 'ACTIVE'
              ? { status, activatedByUserId: principal.userId, activatedAt: new Date() }
              : { status },
        });
      } catch (err) {
        if (sqlState(err) === '23P01')
          throw AppException.conflict(
            'Another active rule set of this type and scope overlaps these dates; close or retire it first',
          );
        throw err;
      }
      await this.audit.record(tx, {
        action: status === 'ACTIVE' ? 'payroll.rule_set.activated' : 'payroll.rule_set.retired',
        entityType: 'statutory_rule_set',
        entityId: id,
        metadata: { name: r.name },
      });
      return this.ruleSetIn(tx, id);
    });
  }

  /** Sets the end date of an ACTIVE rule set (to hand over to a new version). */
  closeRuleSet(id: string, effectiveTo: string): Promise<StatutoryRuleSetItem> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.statutoryRuleSet.findFirst({
        where: { id },
        select: { status: true, effectiveFrom: true },
      });
      if (!r) throw AppException.notFound('Rule set');
      if (r.status !== 'ACTIVE')
        throw AppException.conflict('Only an active rule set can be closed');
      if (effectiveTo < isoDate(r.effectiveFrom))
        throw AppException.badRequest(
          'The end date cannot be before the start date',
          'effectiveTo',
        );
      await tx.statutoryRuleSet.update({
        where: { id },
        data: { effectiveTo: toDate(effectiveTo) },
      });
      await this.audit.record(tx, {
        action: 'payroll.rule_set.closed',
        entityType: 'statutory_rule_set',
        entityId: id,
        metadata: { effectiveTo },
      });
      return this.ruleSetIn(tx, id);
    });
  }

  // ------------------------------------------------------------------------------ components

  listComponents(): Promise<SalaryComponentItem[]> {
    return this.prisma.withTenant(async (tx) =>
      tx.salaryComponent.findMany({
        orderBy: [{ payslipOrder: 'asc' }, { code: 'asc' }],
        select: componentSelect,
      }),
    );
  }

  createComponent(
    principal: AuthPrincipal,
    input: z.output<typeof salaryComponentSchema>,
  ): Promise<SalaryComponentItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      try {
        const c = await tx.salaryComponent.create({
          data: { organizationId, ...input, description: input.description ?? null },
          select: componentSelect,
        });
        await this.audit.record(tx, {
          action: 'payroll.component.created',
          entityType: 'salary_component',
          entityId: c.id,
          metadata: { code: c.code },
        });
        return c;
      } catch (err) {
        mapWriteError(err, { entity: 'component', uniqueField: 'code' });
      }
    });
  }

  updateComponent(
    id: string,
    input: z.output<typeof updateSalaryComponentSchema>,
  ): Promise<SalaryComponentItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.salaryComponent.findFirst({ where: { id }, select: componentSelect });
      if (!before) throw AppException.notFound('Component');
      const data = definedOnly(input);
      const c = await tx.salaryComponent.update({ where: { id }, data, select: componentSelect });
      await this.audit.record(tx, {
        action: 'payroll.component.updated',
        entityType: 'salary_component',
        entityId: id,
        changes: diffChanges(before, data),
      });
      return c;
    });
  }

  // ------------------------------------------------------------------------------ structures

  listStructures(): Promise<SalaryStructureItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const ids = await tx.salaryStructure.findMany({
        orderBy: { name: 'asc' },
        select: { id: true },
      });
      return Promise.all(ids.map((s) => structureIn(tx, s.id)));
    });
  }

  getStructure(id: string): Promise<SalaryStructureItem> {
    return this.prisma.withTenant(async (tx) => structureIn(tx, id));
  }

  /** Structure lines are immutable after creation (create a new structure to change them). */
  createStructure(
    principal: AuthPrincipal,
    input: z.output<typeof salaryStructureSchema>,
  ): Promise<SalaryStructureItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const components = await tx.salaryComponent.findMany({
        where: { id: { in: input.components.map((c) => c.componentId) } },
        select: { id: true, code: true, status: true },
      });
      const byId = new Map(components.map((c) => [c.id, c]));
      const byCode = new Map(components.map((c) => [c.code, c]));
      input.components.forEach((c, i) => {
        const comp = byId.get(c.componentId);
        if (!comp)
          throw AppException.badRequest(
            'A selected component does not exist',
            `components.${String(i)}.componentId`,
          );
        if (comp.status !== 'ACTIVE')
          throw AppException.badRequest(
            `${comp.code} is inactive`,
            `components.${String(i)}.componentId`,
          );
        if (c.calc.type === 'PERCENT_OF_COMPONENT' && !byCode.has(c.calc.componentCode))
          throw AppException.badRequest(
            `${c.calc.componentCode} must also be part of the structure`,
            `components.${String(i)}.calc`,
          );
      });
      try {
        const s = await tx.salaryStructure.create({
          data: {
            organizationId,
            name: input.name,
            description: input.description ?? null,
            employerStatutoryInCtc: input.employerStatutoryInCtc,
          },
          select: { id: true },
        });
        await tx.salaryStructureComponent.createMany({
          data: input.components.map((c, i) => ({
            organizationId,
            structureId: s.id,
            componentId: c.componentId,
            calcType: c.calc.type,
            percent:
              c.calc.type === 'PERCENT_OF_CTC' || c.calc.type === 'PERCENT_OF_COMPONENT'
                ? c.calc.percent
                : null,
            monthlyAmount: c.calc.type === 'FIXED' ? c.calc.monthlyAmount : null,
            baseComponentId:
              c.calc.type === 'PERCENT_OF_COMPONENT'
                ? (byCode.get(c.calc.componentCode)?.id ?? null)
                : null,
            sortOrder: i,
          })),
        });
        await this.audit.record(tx, {
          action: 'payroll.structure.created',
          entityType: 'salary_structure',
          entityId: s.id,
          metadata: { name: input.name },
        });
        return await structureIn(tx, s.id);
      } catch (err) {
        if (err instanceof AppException) throw err;
        mapWriteError(err, { entity: 'structure', uniqueField: 'name' });
      }
    });
  }

  updateStructure(
    id: string,
    input: z.output<typeof updateSalaryStructureSchema>,
  ): Promise<SalaryStructureItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.salaryStructure.findFirst({
        where: { id },
        select: { name: true, description: true, status: true },
      });
      if (!before) throw AppException.notFound('Structure');
      const data = definedOnly(input);
      try {
        await tx.salaryStructure.update({ where: { id }, data });
      } catch (err) {
        mapWriteError(err, { entity: 'structure', uniqueField: 'name' });
      }
      await this.audit.record(tx, {
        action: 'payroll.structure.updated',
        entityType: 'salary_structure',
        entityId: id,
        changes: diffChanges(before, data),
      });
      return structureIn(tx, id);
    });
  }
}

export async function settingsOf(tx: TenantTransaction): Promise<PayrollSettingsItem> {
  const s = await tx.payrollSettings.findFirst({});
  return {
    payableDaysMethod: s?.payableDaysMethod ?? 'CALENDAR_DAYS',
    fixedDays: s?.fixedDays ?? null,
    absentIsLossOfPay: s?.absentIsLossOfPay ?? true,
    hraComponentCode: s?.hraComponentCode ?? null,
    basicComponentCodes: s?.basicComponentCodes ?? [],
    defaultTaxRegime: s?.defaultTaxRegime ?? null,
  };
}

async function structureIn(tx: TenantTransaction, id: string): Promise<SalaryStructureItem> {
  const s = await tx.salaryStructure.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      employerStatutoryInCtc: true,
      status: true,
      _count: { select: { salaries: true } },
      components: {
        orderBy: { sortOrder: 'asc' },
        select: {
          componentId: true,
          calcType: true,
          percent: true,
          monthlyAmount: true,
          baseComponent: { select: { code: true } },
          component: { select: { code: true, name: true, kind: true } },
        },
      },
    },
  });
  if (!s) throw AppException.notFound('Structure');
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    employerStatutoryInCtc: s.employerStatutoryInCtc,
    status: s.status,
    employeeCount: s._count.salaries,
    components: s.components.map((c) => {
      let calc: ComponentCalcItem;
      if (c.calcType === 'FIXED')
        calc = { type: 'FIXED', monthlyAmount: String(c.monthlyAmount ?? 0) };
      else if (c.calcType === 'PERCENT_OF_CTC')
        calc = { type: 'PERCENT_OF_CTC', percent: String(c.percent ?? 0) };
      else if (c.calcType === 'PERCENT_OF_COMPONENT')
        calc = {
          type: 'PERCENT_OF_COMPONENT',
          percent: String(c.percent ?? 0),
          componentCode: c.baseComponent?.code ?? '',
        };
      else calc = { type: 'BALANCING' };
      return {
        componentId: c.componentId,
        code: c.component.code,
        name: c.component.name,
        kind: c.component.kind,
        calc,
      };
    }),
  };
}
