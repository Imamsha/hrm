import { Injectable } from '@nestjs/common';
import { onboardingProgress, taskDueDate } from '@hrm/business-rules';
import {
  type OnboardingPlanItem,
  type OnboardingTaskItem,
  type OnboardingTemplateItem,
  PERMISSIONS,
} from '@hrm/shared-types';
import type { onboardingTemplateSchema, updateOnboardingTemplateSchema } from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import {
  EmployeeDocumentsService,
  type UploadedFileLike,
} from '../employees/employee-documents.service.js';
import { employeeRefSelect, toEmployeeRef } from '../employees/employee-mapper.js';
import { currentRecord, isoDate, todayIso } from '../employees/employee-scope.js';
import { mapWriteError } from '../structure/structure.util.js';

const P = PERMISSIONS;
type TemplateInput = z.output<typeof onboardingTemplateSchema>;

const templateInclude = {
  tasks: { orderBy: { sortOrder: 'asc' } },
  _count: { select: { plans: true } },
} satisfies Prisma.OnboardingTemplateInclude;

function toTemplate(
  t: Prisma.OnboardingTemplateGetPayload<{ include: typeof templateInclude }>,
): OnboardingTemplateItem {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    isDefault: t.isDefault,
    planCount: t._count.plans,
    tasks: t.tasks.map((k) => ({
      id: k.id,
      title: k.title,
      description: k.description,
      assignee: k.assignee,
      dueOffsetDays: k.dueOffsetDays,
      documentCategory: k.documentCategory,
      sortOrder: k.sortOrder,
    })),
  };
}

const planSelect = {
  id: true,
  joiningDate: true,
  status: true,
  createdAt: true,
  employeeId: true,
  employee: { select: { ...employeeRefSelect, membership: { select: { userId: true } } } },
  template: { select: { id: true, name: true } },
  tasks: {
    orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      assignee: true,
      dueDate: true,
      documentCategory: true,
      status: true,
      completedAt: true,
      completedByUserId: true,
      assigneeEmployeeId: true,
      assigneeEmployee: { select: employeeRefSelect },
    },
  },
} satisfies Prisma.OnboardingPlanSelect;
type PlanRow = Prisma.OnboardingPlanGetPayload<{ select: typeof planSelect }>;

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: EmployeeDocumentsService,
  ) {}

  // ------------------------------------------------------------------ templates

  listTemplates(): Promise<OnboardingTemplateItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.onboardingTemplate.findMany({ orderBy: { name: 'asc' }, include: templateInclude })
      ).map(toTemplate),
    );
  }

  createTemplate(principal: AuthPrincipal, input: TemplateInput): Promise<OnboardingTemplateItem> {
    return this.prisma.withTenant(async (tx) => {
      const organizationId = principal.organizationId ?? '';
      if (input.isDefault)
        await tx.onboardingTemplate.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      const row = await tx.onboardingTemplate
        .create({
          data: {
            organizationId,
            name: input.name,
            description: input.description ?? null,
            isDefault: input.isDefault,
            tasks: {
              create: input.tasks.map((t, i) => ({
                ...t,
                documentCategory: t.documentCategory ?? null,
                description: t.description ?? null,
                sortOrder: i,
              })),
            },
          },
          include: templateInclude,
        })
        .catch((err: unknown) =>
          mapWriteError(err, { entity: 'onboarding template', uniqueField: 'name' }),
        );
      await this.audit.record(tx, {
        action: 'onboarding_template.created',
        entityType: 'onboarding_template',
        entityId: row.id,
      });
      return toTemplate(row);
    });
  }

  updateTemplate(
    id: string,
    input: z.output<typeof updateOnboardingTemplateSchema>,
  ): Promise<OnboardingTemplateItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.onboardingTemplate.findFirst({
        where: { id },
        select: { organizationId: true },
      });
      if (!before) throw AppException.notFound('Onboarding template');
      if (input.isDefault)
        await tx.onboardingTemplate.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      if (input.tasks) {
        // Template tasks are replaced; existing plans keep their own copies.
        await tx.onboardingTemplateTask.deleteMany({ where: { templateId: id } });
        await tx.onboardingTemplateTask.createMany({
          data: input.tasks.map((t, i) => ({
            organizationId: before.organizationId,
            templateId: id,
            ...t,
            documentCategory: t.documentCategory ?? null,
            description: t.description ?? null,
            sortOrder: i,
          })),
        });
      }
      const row = await tx.onboardingTemplate
        .update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          },
          include: templateInclude,
        })
        .catch((err: unknown) =>
          mapWriteError(err, { entity: 'onboarding template', uniqueField: 'name' }),
        );
      await this.audit.record(tx, {
        action: 'onboarding_template.updated',
        entityType: 'onboarding_template',
        entityId: id,
      });
      return toTemplate(row);
    });
  }

  // ------------------------------------------------------------------ plans

  start(
    principal: AuthPrincipal,
    employeeId: string,
    templateId: string,
  ): Promise<OnboardingPlanItem> {
    return this.prisma.withTenant(async (tx) => {
      const planId = await this.startInTx(tx, principal, employeeId, templateId);
      return this.plan(tx, principal, planId);
    });
  }

  /**
   * Creates a plan from a template: every task is copied with its due date relative to the
   * joining date and its assignee resolved (EMPLOYEE → the joiner, MANAGER → their current
   * manager; HR and IT tasks stay with those teams).
   */
  async startInTx(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    employeeId: string,
    templateId: string,
  ): Promise<string> {
    const organizationId = principal.organizationId ?? '';
    const template = await tx.onboardingTemplate.findFirst({
      where: { id: templateId },
      include: templateInclude,
    });
    if (!template) throw AppException.badRequest('Onboarding template not found', 'templateId');
    const e = await tx.employee.findFirst({
      where: { id: employeeId },
      select: {
        dateOfJoining: true,
        status: true,
        employmentRecords: {
          orderBy: { effectiveFrom: 'desc' },
          take: 3,
          select: { effectiveFrom: true, effectiveTo: true, changeType: true, managerId: true },
        },
      },
    });
    if (!e) throw AppException.badRequest('Employee not found', 'employeeId');
    if (e.status === 'SEPARATED')
      throw AppException.badRequest('The employee has left', 'employeeId');
    const managerId = currentRecord(e.employmentRecords, todayIso())?.managerId ?? null;
    const joiningDate = isoDate(e.dateOfJoining);
    const plan = await tx.onboardingPlan
      .create({
        data: {
          organizationId,
          employeeId,
          templateId,
          joiningDate: e.dateOfJoining,
          createdByUserId: principal.userId,
          tasks: {
            // organization_id comes from the composite relation to the plan.
            create: template.tasks.map((t) => ({
              title: t.title,
              description: t.description,
              assignee: t.assignee,
              assigneeEmployeeId:
                t.assignee === 'EMPLOYEE'
                  ? employeeId
                  : t.assignee === 'MANAGER'
                    ? managerId
                    : null,
              dueDate: new Date(`${taskDueDate(joiningDate, t.dueOffsetDays)}T00:00:00.000Z`),
              documentCategory: t.documentCategory,
              sortOrder: t.sortOrder,
            })),
          },
        },
        select: { id: true },
      })
      .catch((err: unknown) => {
        if ((err as { code?: string }).code === 'P2002')
          throw AppException.conflict('This employee already has an onboarding plan in progress');
        throw err;
      });
    await this.audit.record(tx, {
      action: 'onboarding.started',
      entityType: 'onboarding_plan',
      entityId: plan.id,
      metadata: { employeeId, template: template.name, tasks: template.tasks.length },
    });
    return plan.id;
  }

  listPlans(principal: AuthPrincipal, status?: string): Promise<OnboardingPlanItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.onboardingPlan.findMany({
        where: status ? { status: status as 'IN_PROGRESS' } : {},
        orderBy: { joiningDate: 'desc' },
        select: planSelect,
        take: 200,
      });
      const me = await this.me(tx, principal);
      return Promise.all(rows.map((r) => this.toPlan(tx, principal, r, me)));
    });
  }

  getPlan(principal: AuthPrincipal, id: string): Promise<OnboardingPlanItem> {
    return this.prisma.withTenant((tx) => this.plan(tx, principal, id));
  }

  /** The caller's own onboarding plan (self-service). */
  myPlan(principal: AuthPrincipal): Promise<OnboardingPlanItem | null> {
    return this.prisma.withTenant(async (tx) => {
      const me = await this.me(tx, principal);
      if (!me) return null;
      const row = await tx.onboardingPlan.findFirst({
        where: { employeeId: me, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        select: planSelect,
      });
      return row ? this.toPlan(tx, principal, row, me) : null;
    });
  }

  /** Open tasks assigned to the caller across plans (their own, or as a manager). */
  myTasks(
    principal: AuthPrincipal,
  ): Promise<(OnboardingTaskItem & { planId: string; employee: string })[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await this.me(tx, principal);
      if (!me) return [];
      const rows = await tx.onboardingTask.findMany({
        where: { assigneeEmployeeId: me, status: 'PENDING', plan: { status: 'IN_PROGRESS' } },
        orderBy: { dueDate: 'asc' },
        select: {
          ...planSelect.tasks.select,
          planId: true,
          plan: { select: { employee: { select: employeeRefSelect } } },
        },
        take: 200,
      });
      const names = await this.completedNames(
        tx,
        rows.map((r) => r.completedByUserId),
      );
      return rows.map((t) => ({
        ...this.toTask(t, names, true),
        planId: t.planId,
        employee: toEmployeeRef(t.plan.employee)?.displayName ?? '',
      }));
    });
  }

  setTaskStatus(
    principal: AuthPrincipal,
    taskId: string,
    status: 'DONE' | 'SKIPPED' | 'PENDING',
  ): Promise<OnboardingPlanItem> {
    return this.prisma.withTenant(async (tx) => {
      const t = await tx.onboardingTask.findFirst({
        where: { id: taskId },
        select: {
          planId: true,
          assigneeEmployeeId: true,
          documentCategory: true,
          plan: { select: { employeeId: true, status: true } },
        },
      });
      if (!t) throw AppException.notFound('Onboarding task');
      const me = await this.me(tx, principal);
      const hr = can(principal, P.ONBOARDING_PLAN_MANAGE);
      if (!hr && !(me && t.assigneeEmployeeId === me)) {
        // Same visibility as the plan: readers, the joiner, and anyone with a task in it.
        const involved =
          me !== null &&
          (t.plan.employeeId === me ||
            (await tx.onboardingTask.count({
              where: { planId: t.planId, assigneeEmployeeId: me },
            })) > 0);
        if (!can(principal, P.ONBOARDING_PLAN_READ) && !involved)
          throw AppException.notFound('Onboarding task');
        throw AppException.forbidden('This task is assigned to someone else');
      }
      if (t.plan.status !== 'IN_PROGRESS')
        throw AppException.conflict('The onboarding plan is not in progress');
      if (status === 'SKIPPED' && !hr) throw AppException.forbidden('Only HR can skip a task');
      if (status === 'DONE' && t.documentCategory) {
        const has = await tx.employeeDocument.count({
          where: { employeeId: t.plan.employeeId, category: t.documentCategory },
        });
        if (!has) throw AppException.conflict('Upload the required document to complete this task');
      }
      await tx.onboardingTask.update({
        where: { id: taskId },
        data:
          status === 'PENDING'
            ? { status, completedAt: null, completedByUserId: null }
            : { status, completedAt: new Date(), completedByUserId: principal.userId },
      });
      await this.closeIfDone(tx, t.planId);
      await this.audit.record(tx, {
        action: 'onboarding.task_updated',
        entityType: 'onboarding_task',
        entityId: taskId,
        metadata: { status },
      });
      return this.plan(tx, principal, t.planId);
    });
  }

  /** The joiner uploads the document a task asks for; the task completes with it. */
  async uploadTaskDocument(
    principal: AuthPrincipal,
    taskId: string,
    file: UploadedFileLike | undefined,
  ): Promise<OnboardingPlanItem> {
    const task = await this.prisma.withTenant(async (tx) => {
      const me = await this.me(tx, principal);
      const t = await tx.onboardingTask.findFirst({
        where: { id: taskId },
        select: {
          title: true,
          documentCategory: true,
          assigneeEmployeeId: true,
          plan: { select: { employeeId: true, status: true } },
        },
      });
      if (!t || !me || t.plan.employeeId !== me) throw AppException.notFound('Onboarding task');
      if (!t.documentCategory)
        throw AppException.badRequest('This task does not ask for a document', 'file');
      if (t.plan.status !== 'IN_PROGRESS')
        throw AppException.conflict('The onboarding plan is not in progress');
      return t;
    });
    await this.documents.upload(
      principal,
      task.plan.employeeId,
      file,
      { category: task.documentCategory, title: task.title },
      true,
    );
    return this.setTaskStatusAsAssignee(principal, taskId);
  }

  private setTaskStatusAsAssignee(principal: AuthPrincipal, taskId: string) {
    return this.prisma.withTenant(async (tx) => {
      const t = await tx.onboardingTask.findFirst({
        where: { id: taskId },
        select: { planId: true },
      });
      if (!t) throw AppException.notFound('Onboarding task');
      await tx.onboardingTask.update({
        where: { id: taskId },
        data: { status: 'DONE', completedAt: new Date(), completedByUserId: principal.userId },
      });
      await this.closeIfDone(tx, t.planId);
      await this.audit.record(tx, {
        action: 'onboarding.task_updated',
        entityType: 'onboarding_task',
        entityId: taskId,
        metadata: { status: 'DONE', document: true },
      });
      return this.plan(tx, principal, t.planId);
    });
  }

  cancelPlan(principal: AuthPrincipal, id: string): Promise<OnboardingPlanItem> {
    return this.prisma.withTenant(async (tx) => {
      const p = await tx.onboardingPlan.findFirst({ where: { id }, select: { status: true } });
      if (!p) throw AppException.notFound('Onboarding plan');
      if (p.status !== 'IN_PROGRESS')
        throw AppException.conflict('Only plans in progress can be cancelled');
      await tx.onboardingPlan.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        action: 'onboarding.cancelled',
        entityType: 'onboarding_plan',
        entityId: id,
      });
      return this.plan(tx, principal, id);
    });
  }

  // ------------------------------------------------------------------ internals

  private async closeIfDone(tx: TenantTransaction, planId: string) {
    const tasks = await tx.onboardingTask.findMany({ where: { planId }, select: { status: true } });
    const p = onboardingProgress(tasks);
    await tx.onboardingPlan.update({
      where: { id: planId },
      data: { status: p.complete ? 'COMPLETED' : 'IN_PROGRESS' },
    });
  }

  private async me(tx: TenantTransaction, principal: AuthPrincipal): Promise<string | null> {
    if (!principal.membershipId) return null;
    return (
      (
        await tx.employee.findFirst({
          where: { membershipId: principal.membershipId },
          select: { id: true },
        })
      )?.id ?? null
    );
  }

  private async plan(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<OnboardingPlanItem> {
    const row = await tx.onboardingPlan.findFirst({ where: { id }, select: planSelect });
    if (!row) throw AppException.notFound('Onboarding plan');
    const me = await this.me(tx, principal);
    const visible =
      can(principal, P.ONBOARDING_PLAN_READ) ||
      row.employeeId === me ||
      row.tasks.some((t) => me && t.assigneeEmployeeId === me);
    if (!visible) throw AppException.notFound('Onboarding plan');
    return this.toPlan(tx, principal, row, me);
  }

  private async completedNames(tx: TenantTransaction, ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return new Map<string, string>();
    const rows = await tx.membership.findMany({
      where: { userId: { in: wanted } },
      select: { userId: true, user: { select: { fullName: true } } },
    });
    return new Map(rows.map((r) => [r.userId, r.user.fullName]));
  }

  private toTask(
    t: PlanRow['tasks'][number],
    names: Map<string, string>,
    canComplete: boolean,
  ): OnboardingTaskItem {
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      assignee: t.assignee,
      assigneeEmployee: toEmployeeRef(t.assigneeEmployee),
      dueDate: isoDate(t.dueDate),
      documentCategory: t.documentCategory,
      status: t.status,
      completedAt: t.completedAt?.toISOString() ?? null,
      completedBy: t.completedByUserId ? (names.get(t.completedByUserId) ?? null) : null,
      canComplete,
    };
  }

  private async toPlan(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    r: PlanRow,
    me: string | null,
  ): Promise<OnboardingPlanItem> {
    const names = await this.completedNames(
      tx,
      r.tasks.map((t) => t.completedByUserId),
    );
    const hr = can(principal, P.ONBOARDING_PLAN_MANAGE);
    const progress = onboardingProgress(r.tasks);
    return {
      id: r.id,
      employee: toEmployeeRef(r.employee) as OnboardingPlanItem['employee'],
      template: r.template,
      joiningDate: isoDate(r.joiningDate),
      status: r.status,
      progress: { total: progress.total, closed: progress.closed, percent: progress.percent },
      tasks: r.tasks.map((t) =>
        this.toTask(
          t,
          names,
          r.status === 'IN_PROGRESS' && (hr || (me !== null && t.assigneeEmployeeId === me)),
        ),
      ),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
