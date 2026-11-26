import { Injectable } from '@nestjs/common';
import { delegationsOverlap, type WorkflowProcess, type WorkflowStep } from '@hrm/business-rules';
import {
  type ApprovalInstanceItem,
  type ApprovalTaskItem,
  type DelegationItem,
  PERMISSIONS,
  type WorkflowDefinitionItem,
} from '@hrm/shared-types';
import type {
  approvalDecisionSchema,
  delegationSchema,
  workflowDefinitionSchema,
  workflowStatusSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { isoDate, todayIso, toDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { empSelect, myEmployeeId, ref, requireMe } from '../talent/talent-common.js';
import { WorkflowEngine } from './workflow-engine.service.js';
import { WorkflowRegistry } from './workflow-registry.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;

/** Workflow definitions, delegations, approval history and the shared inbox (ADR-018). */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly engine: WorkflowEngine,
    private readonly registry: WorkflowRegistry,
  ) {}

  // ---------------------------------------------------------------------------- definitions

  private async toDefinition(
    tx: TenantTransaction,
    rows: {
      id: string;
      process: WorkflowProcess;
      name: string;
      status: 'ACTIVE' | 'INACTIVE';
      steps: Prisma.JsonValue;
      createdAt: Date;
      _count: { instances: number };
    }[],
  ): Promise<WorkflowDefinitionItem[]> {
    const ids = rows.flatMap((r) =>
      (r.steps as unknown as WorkflowStep[]).flatMap((s) => [
        ...(s.approver.type === 'EMPLOYEE' ? [s.approver.employeeId] : []),
        ...(s.escalateTo?.type === 'EMPLOYEE' ? [s.escalateTo.employeeId] : []),
      ]),
    );
    const people = await tx.employee.findMany({ where: { id: { in: ids } }, select: empSelect });
    const person = (id: string) => {
      const p = people.find((x) => x.id === id);
      return p ? ref(p) : null;
    };
    return rows.map((r) => ({
      id: r.id,
      process: r.process,
      name: r.name,
      status: r.status,
      instances: r._count.instances,
      createdAt: r.createdAt.toISOString(),
      steps: (r.steps as unknown as WorkflowStep[]).map((s) => ({
        name: s.name,
        approver:
          s.approver.type === 'EMPLOYEE'
            ? { ...s.approver, employee: person(s.approver.employeeId) }
            : s.approver,
        minMeasure: s.minMeasure ?? null,
        slaHours: s.slaHours ?? null,
        escalateTo:
          s.escalateTo?.type === 'EMPLOYEE'
            ? { ...s.escalateTo, employee: person(s.escalateTo.employeeId) }
            : (s.escalateTo ?? null),
      })),
    }));
  }

  definitions(): Promise<WorkflowDefinitionItem[]> {
    return this.prisma.withTenant(async (tx) =>
      this.toDefinition(
        tx,
        await tx.workflowDefinition.findMany({
          orderBy: [{ process: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            process: true,
            name: true,
            status: true,
            steps: true,
            createdAt: true,
            _count: { select: { instances: true } },
          },
        }),
      ),
    );
  }

  /** Named people and roles in the steps must exist; a role step names a role of this organization. */
  private async checkRefs(tx: TenantTransaction, steps: WorkflowStep[]): Promise<void> {
    for (const [i, s] of steps.entries()) {
      const ids = [
        ...(s.approver.type === 'EMPLOYEE' ? [s.approver.employeeId] : []),
        ...(s.escalateTo?.type === 'EMPLOYEE' ? [s.escalateTo.employeeId] : []),
      ];
      for (const id of ids)
        if (!(await tx.employee.count({ where: { id, status: { not: 'SEPARATED' } } })))
          throw AppException.badRequest(
            `Step ${String(i + 1)}: the employee does not exist or has left`,
            'steps',
          );
      if (
        s.approver.type === 'ROLE' &&
        !(await tx.role.count({ where: { key: s.approver.roleKey } }))
      )
        throw AppException.badRequest(
          `Step ${String(i + 1)}: the role ${s.approver.roleKey} does not exist`,
          'steps',
        );
    }
  }

  /** Definitions are created inactive; editing means creating a new one (running approvals keep their snapshot). */
  create(
    principal: AuthPrincipal,
    input: In<typeof workflowDefinitionSchema>,
  ): Promise<WorkflowDefinitionItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        await this.checkRefs(tx, input.steps);
        const d = await tx.workflowDefinition.create({
          data: {
            organizationId: principal.organizationId ?? '',
            process: input.process,
            name: input.name,
            steps: input.steps,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'workflow.definition_created',
          entityType: 'workflow_definition',
          entityId: d.id,
          metadata: { process: input.process },
        });
      })
      .then(() => this.definitions());
  }

  /** Activating replaces the active definition of the same process. */
  setStatus(id: string, input: In<typeof workflowStatusSchema>): Promise<WorkflowDefinitionItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const d = await tx.workflowDefinition.findFirst({
          where: { id },
          select: { process: true, status: true },
        });
        if (!d) throw AppException.notFound('Workflow');
        if (input.status === 'ACTIVE')
          await tx.workflowDefinition.updateMany({
            where: { process: d.process, status: 'ACTIVE', id: { not: id } },
            data: { status: 'INACTIVE' },
          });
        await tx.workflowDefinition.update({ where: { id }, data: { status: input.status } });
        await this.audit.record(tx, {
          action: `workflow.definition_${input.status === 'ACTIVE' ? 'activated' : 'deactivated'}`,
          entityType: 'workflow_definition',
          entityId: id,
          metadata: { process: d.process },
        });
      })
      .then(() => this.definitions());
  }

  // ---------------------------------------------------------------------------- inbox & history

  inbox(principal: AuthPrincipal): Promise<ApprovalTaskItem[]> {
    return this.prisma.withTenant((tx) => this.engine.inbox(tx, principal));
  }

  /** Decides from the inbox through the module's own decision logic. */
  async decide(
    principal: AuthPrincipal,
    taskId: string,
    input: In<typeof approvalDecisionSchema>,
  ): Promise<ApprovalTaskItem[]> {
    const t = await this.prisma.withTenant((tx) =>
      tx.workflowTask.findFirst({
        where: { id: taskId, status: 'PENDING' },
        select: { instance: { select: { process: true, subjectId: true } } },
      }),
    );
    if (!t) throw AppException.notFound('Approval');
    const h = this.registry.get(t.instance.process);
    if (!h) throw AppException.conflict('This kind of request cannot be decided here');
    await h.decide(principal, t.instance.subjectId, input.decision, input.note ?? null);
    return this.inbox(principal);
  }

  /** The approval trail of a request: the requester, its deciders and workflow readers. */
  history(
    principal: AuthPrincipal,
    process: WorkflowProcess,
    subjectId: string,
  ): Promise<ApprovalInstanceItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const rows = await tx.workflowInstance.findMany({
        where: { process, subjectId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          process: true,
          subjectId: true,
          status: true,
          snapshot: true,
          measure: true,
          createdAt: true,
          requesterEmployeeId: true,
          requester: { select: empSelect },
          definition: { select: { name: true } },
          tasks: { orderBy: { stepIndex: 'asc' } },
        },
      });
      const involved = rows.some(
        (r) =>
          r.requesterEmployeeId === me ||
          r.tasks.some((t) =>
            me ? t.assigneeIds.includes(me) || t.decidedByEmployeeId === me : false,
          ),
      );
      if (rows.length && !involved && !can(principal, P.WORKFLOWS_INSTANCE_READ, {}))
        throw AppException.notFound('Approval');
      const ids = rows.flatMap((r) =>
        r.tasks.flatMap((t) =>
          [...t.assigneeIds, t.onBehalfOfEmployeeId, t.escalatedFromEmployeeId].filter(
            (x): x is string => !!x,
          ),
        ),
      );
      const people = await tx.employee.findMany({ where: { id: { in: ids } }, select: empSelect });
      const person = (id: string | null) => {
        const p = id ? people.find((x) => x.id === id) : undefined;
        return p ? ref(p) : null;
      };
      const names = await userNames(
        tx,
        rows.flatMap((r) => r.tasks.map((t) => t.decidedByUserId)),
      );
      return rows.map((r) => {
        const snapshot = r.snapshot as unknown as WorkflowStep[];
        return {
          id: r.id,
          process: r.process,
          subjectId: r.subjectId,
          definitionName: r.definition.name,
          status: r.status,
          requester: ref(r.requester),
          createdAt: r.createdAt.toISOString(),
          steps: snapshot.map((s, index) => {
            const t = r.tasks.find((x) => x.stepIndex === index);
            return {
              number: index + 1,
              name: s.name,
              status: t?.status ?? 'WAITING',
              assignees: (t?.assigneeIds ?? [])
                .map((id) => person(id))
                .filter((x): x is NonNullable<typeof x> => !!x),
              onBehalfOf: person(t?.onBehalfOfEmployeeId ?? null),
              escalatedFrom: person(t?.escalatedFromEmployeeId ?? null),
              decidedBy: t?.decidedByUserId ? (names.get(t.decidedByUserId) ?? null) : null,
              decidedAt: t?.decidedAt?.toISOString() ?? null,
              note: t?.note ?? null,
              skippedReason:
                t?.skippedReason ??
                (t
                  ? null
                  : s.minMeasure && Number(r.measure) < Number(s.minMeasure)
                    ? 'below the threshold'
                    : null),
              dueAt: t?.dueAt?.toISOString() ?? null,
            };
          }),
        };
      });
    });
  }

  // ---------------------------------------------------------------------------- delegations

  private async delegationItems(
    tx: TenantTransaction,
    where: Prisma.ApprovalDelegationWhereInput,
  ): Promise<DelegationItem[]> {
    const rows = await tx.approvalDelegation.findMany({
      where: { revokedAt: null, ...where },
      orderBy: { fromDate: 'desc' },
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        processes: true,
        note: true,
        delegator: { select: empSelect },
        delegate: { select: empSelect },
      },
    });
    const today = todayIso();
    return rows.map((r) => ({
      id: r.id,
      delegator: ref(r.delegator),
      delegate: ref(r.delegate),
      from: isoDate(r.fromDate),
      to: isoDate(r.toDate),
      processes: r.processes,
      note: r.note,
      active: isoDate(r.fromDate) <= today && today <= isoDate(r.toDate),
    }));
  }

  myDelegations(
    principal: AuthPrincipal,
  ): Promise<{ given: DelegationItem[]; received: DelegationItem[] }> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      return {
        given: await this.delegationItems(tx, { delegatorEmployeeId: me }),
        received: await this.delegationItems(tx, {
          delegateEmployeeId: me,
          toDate: { gte: toDate(todayIso()) },
        }),
      };
    });
  }

  delegate(
    principal: AuthPrincipal,
    input: In<typeof delegationSchema>,
  ): Promise<{ given: DelegationItem[]; received: DelegationItem[] }> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        if (input.delegateEmployeeId === me)
          throw AppException.badRequest('Choose someone else', 'delegateEmployeeId');
        if (input.to < todayIso())
          throw AppException.badRequest('The delegation has already ended', 'to');
        const d = await tx.employee.findFirst({
          where: { id: input.delegateEmployeeId, status: { not: 'SEPARATED' } },
          select: { id: true },
        });
        if (!d)
          throw AppException.badRequest(
            'The delegate does not exist or has left',
            'delegateEmployeeId',
          );
        const existing = await this.delegationItems(tx, { delegatorEmployeeId: me });
        const next = {
          delegatorId: me,
          delegateId: input.delegateEmployeeId,
          from: input.from,
          to: input.to,
          processes: input.processes,
        };
        if (
          existing.some((e) =>
            delegationsOverlap(next, {
              delegatorId: me,
              delegateId: e.delegate.id,
              from: e.from,
              to: e.to,
              processes: e.processes,
            }),
          )
        )
          throw AppException.conflict('You already delegate these approvals in that period');
        const row = await tx.approvalDelegation.create({
          data: {
            organizationId: principal.organizationId ?? '',
            delegatorEmployeeId: me,
            delegateEmployeeId: input.delegateEmployeeId,
            fromDate: toDate(input.from),
            toDate: toDate(input.to),
            processes: input.processes,
            note: input.note ?? null,
          },
          select: { id: true },
        });
        // Steps already waiting for the delegator move to the delegate when the delegation is in force today.
        if (input.from <= todayIso())
          await this.reassignWaiting(tx, me, input.delegateEmployeeId, input.processes);
        await this.audit.record(tx, {
          action: 'workflow.delegation_created',
          entityType: 'approval_delegation',
          entityId: row.id,
          metadata: { ...input },
        });
      })
      .then(() => this.myDelegations(principal));
  }

  private async reassignWaiting(
    tx: TenantTransaction,
    from: string,
    to: string,
    processes: WorkflowProcess[],
  ): Promise<void> {
    const tasks = await tx.workflowTask.findMany({
      where: {
        status: 'PENDING',
        assigneeIds: { equals: [from] },
        instance: {
          status: 'PENDING',
          requesterEmployeeId: { not: to },
          ...(processes.length ? { process: { in: processes } } : {}),
        },
      },
      select: { id: true },
    });
    for (const t of tasks)
      await tx.workflowTask.update({
        where: { id: t.id },
        data: { assigneeIds: [to], onBehalfOfEmployeeId: from },
      });
  }

  revoke(
    principal: AuthPrincipal,
    id: string,
  ): Promise<{ given: DelegationItem[]; received: DelegationItem[] }> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        const d = await tx.approvalDelegation.findFirst({
          where: { id, delegatorEmployeeId: me, revokedAt: null },
          select: { delegateEmployeeId: true },
        });
        if (!d) throw AppException.notFound('Delegation');
        await tx.approvalDelegation.update({ where: { id }, data: { revokedAt: new Date() } });
        // Waiting steps return to the delegator.
        const tasks = await tx.workflowTask.findMany({
          where: {
            status: 'PENDING',
            onBehalfOfEmployeeId: me,
            assigneeIds: { equals: [d.delegateEmployeeId] },
          },
          select: { id: true },
        });
        for (const t of tasks)
          await tx.workflowTask.update({
            where: { id: t.id },
            data: { assigneeIds: [me], onBehalfOfEmployeeId: null },
          });
        await this.audit.record(tx, {
          action: 'workflow.delegation_revoked',
          entityType: 'approval_delegation',
          entityId: id,
        });
      })
      .then(() => this.myDelegations(principal));
  }

  // ---------------------------------------------------------------------------- escalation

  /** Runs the escalation sweep for one tenant (called by the scheduled job). */
  escalate(organizationId: string): Promise<number> {
    return this.prisma.withTenant((tx) => this.engine.escalateOverdue(tx), { organizationId });
  }

  async tenantsWithOverdue(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string }[]
    >`SELECT app.tenants_with_overdue_workflow_tasks()::text AS id`;
    return rows.map((r) => r.id);
  }
}
