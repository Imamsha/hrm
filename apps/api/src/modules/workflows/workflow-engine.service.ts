import { Injectable } from '@nestjs/common';
import {
  applicableSteps,
  type Delegation,
  delegateFor,
  dueAt,
  escalationTarget,
  type WorkflowProcess,
  type WorkflowStep,
  resolveApprover,
} from '@hrm/business-rules';
import type { ApprovalTaskItem } from '@hrm/shared-types';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { inForceWhere, todayIso } from '../employees/employee-scope.js';
import { empSelect, myEmployeeId, ref } from '../talent/talent-common.js';
import { WorkflowRegistry } from './workflow-registry.js';

export type Outcome = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Runs approval chains (ADR-018). Modules call `start` when a request is submitted and `decide`
 * from their own decision endpoints; without an active definition both return null and the
 * module keeps its built-in rule. All calls run in the caller's tenant transaction.
 */
@Injectable()
export class WorkflowEngine {
  constructor(
    private readonly audit: AuditService,
    private readonly registry: WorkflowRegistry,
  ) {}

  // ---------------------------------------------------------------------------- resolution

  /** [reporting manager, their manager, …] of an employee, up to six levels. */
  async managerChain(tx: TenantTransaction, employeeId: string): Promise<string[]> {
    const chain: string[] = [];
    let cur = employeeId;
    for (let i = 0; i < 6; i++) {
      const r = await tx.employmentRecord.findFirst({
        where: { employeeId: cur, ...inForceWhere(todayIso()) },
        orderBy: { effectiveFrom: 'desc' },
        select: { managerId: true },
      });
      const m = r?.managerId;
      if (!m || chain.includes(m) || m === employeeId) break;
      chain.push(m);
      cur = m;
    }
    return chain;
  }

  private async roleHolders(
    tx: TenantTransaction,
    roleKeys: string[],
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (!roleKeys.length) return map;
    const rows = await tx.membershipRole.findMany({
      where: {
        role: { key: { in: roleKeys } },
        membership: { status: 'ACTIVE', employee: { status: { not: 'SEPARATED' } } },
      },
      select: {
        role: { select: { key: true } },
        membership: { select: { employee: { select: { id: true } } } },
      },
    });
    for (const r of rows) {
      const id = r.membership.employee?.id;
      if (!id) continue;
      map.set(r.role.key, [...(map.get(r.role.key) ?? []), id]);
    }
    return map;
  }

  private async delegations(tx: TenantTransaction, delegatorIds: string[]): Promise<Delegation[]> {
    if (!delegatorIds.length) return [];
    const today = new Date(`${todayIso()}T00:00:00Z`);
    const rows = await tx.approvalDelegation.findMany({
      where: {
        delegatorEmployeeId: { in: delegatorIds },
        revokedAt: null,
        fromDate: { lte: today },
        toDate: { gte: today },
      },
      select: {
        delegatorEmployeeId: true,
        delegateEmployeeId: true,
        fromDate: true,
        toDate: true,
        processes: true,
      },
    });
    return rows.map((r) => ({
      delegatorId: r.delegatorEmployeeId,
      delegateId: r.delegateEmployeeId,
      from: r.fromDate.toISOString().slice(0, 10),
      to: r.toDate.toISOString().slice(0, 10),
      processes: r.processes,
    }));
  }

  /**
   * Creates the task of the next applicable step after `afterIndex`, skipping steps nobody can
   * decide. Returns false when no step is left.
   */
  private async advance(
    tx: TenantTransaction,
    instance: {
      id: string;
      organizationId: string;
      process: WorkflowProcess;
      requesterEmployeeId: string;
      measure: string;
      snapshot: WorkflowStep[];
    },
    afterIndex: number,
  ): Promise<boolean> {
    const steps = applicableSteps(instance.snapshot, instance.measure);
    const remaining = steps.filter((s) => s.index > afterIndex);
    if (!remaining.length) return false;
    const chain = await this.managerChain(tx, instance.requesterEmployeeId);
    const roles = await this.roleHolders(
      tx,
      remaining.flatMap((s) => (s.step.approver.type === 'ROLE' ? [s.step.approver.roleKey] : [])),
    );
    const employeeIds = remaining.flatMap((s) =>
      s.step.approver.type === 'EMPLOYEE' ? [s.step.approver.employeeId] : [],
    );
    const active = new Set(
      (
        await tx.employee.findMany({
          where: { id: { in: employeeIds }, status: { not: 'SEPARATED' } },
          select: { id: true },
        })
      ).map((e) => e.id),
    );
    for (const s of remaining) {
      const number = steps.findIndex((x) => x.index === s.index) + 1;
      const r = resolveApprover(s.step.approver, {
        requesterId: instance.requesterEmployeeId,
        managerChain: chain,
        roleHolders: (k) => roles.get(k) ?? [],
        isActive: (id) => active.has(id),
      });
      if ('skipped' in r) {
        await tx.workflowTask.create({
          data: {
            organizationId: instance.organizationId,
            instanceId: instance.id,
            stepIndex: s.index,
            stepNumber: number,
            stepName: s.step.name,
            status: 'SKIPPED',
            assigneeIds: [],
            skippedReason: r.skipped,
          },
        });
        continue;
      }
      // A single assignee who has delegated hands the task to the delegate.
      let assignees = r.assignees;
      let onBehalfOf: string | null = null;
      if (assignees.length === 1 && assignees[0]) {
        const d = delegateFor(
          assignees[0],
          instance.process,
          todayIso(),
          await this.delegations(tx, assignees),
          instance.requesterEmployeeId,
        );
        assignees = [d.actorId];
        onBehalfOf = d.onBehalfOf;
      }
      await tx.workflowTask.create({
        data: {
          organizationId: instance.organizationId,
          instanceId: instance.id,
          stepIndex: s.index,
          stepNumber: number,
          stepName: s.step.name,
          assigneeIds: assignees,
          onBehalfOfEmployeeId: onBehalfOf,
          dueAt: dueAt(new Date(), s.step.slaHours),
        },
      });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------- lifecycle

  /**
   * Starts the approval of a submitted request. Returns null when the organization has no
   * active workflow for the process, or when no step has anyone to decide it (the module then
   * keeps its built-in rule, so nothing is approved without a decision).
   */
  async start(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    input: {
      process: WorkflowProcess;
      subjectId: string;
      requesterEmployeeId: string;
      measure: string;
    },
  ): Promise<{ instanceId: string } | null> {
    const def = await tx.workflowDefinition.findFirst({
      where: { process: input.process, status: 'ACTIVE' },
      select: { id: true, organizationId: true, steps: true },
    });
    if (!def) return null;
    const snapshot = def.steps as unknown as WorkflowStep[];
    const inst = await tx.workflowInstance.create({
      data: {
        organizationId: def.organizationId,
        definitionId: def.id,
        process: input.process,
        subjectId: input.subjectId,
        requesterEmployeeId: input.requesterEmployeeId,
        measure: input.measure,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, organizationId: true },
    });
    const started = await this.advance(
      tx,
      {
        ...inst,
        process: input.process,
        requesterEmployeeId: input.requesterEmployeeId,
        measure: input.measure,
        snapshot,
      },
      -1,
    );
    if (!started) {
      // Nobody could decide any step: fall back to the module's own approver.
      await tx.workflowInstance.update({
        where: { id: inst.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'workflow.fallback',
        entityType: 'workflow_instance',
        entityId: inst.id,
        metadata: { process: input.process, subjectId: input.subjectId },
      });
      return null;
    }
    await this.audit.record(tx, {
      action: 'workflow.started',
      entityType: 'workflow_instance',
      entityId: inst.id,
      metadata: { process: input.process, subjectId: input.subjectId, by: principal.userId },
    });
    return { instanceId: inst.id };
  }

  private async pending(tx: TenantTransaction, process: WorkflowProcess, subjectId: string) {
    const inst = await tx.workflowInstance.findFirst({
      where: { process, subjectId, status: 'PENDING' },
      select: {
        id: true,
        organizationId: true,
        process: true,
        requesterEmployeeId: true,
        measure: true,
        snapshot: true,
      },
    });
    if (!inst) return null;
    const task = await tx.workflowTask.findFirst({
      where: { instanceId: inst.id, status: 'PENDING' },
      select: { id: true, stepIndex: true, assigneeIds: true },
    });
    return { inst, task };
  }

  /** null = no running workflow for this request (the module's own rule applies). */
  async canDecide(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    process: WorkflowProcess,
    subjectId: string,
  ): Promise<boolean | null> {
    const p = await this.pending(tx, process, subjectId);
    if (!p) return null;
    const me = await myEmployeeId(tx, principal);
    return !!me && !!p.task && p.task.assigneeIds.includes(me) && me !== p.inst.requesterEmployeeId;
  }

  async hasPending(
    tx: TenantTransaction,
    process: WorkflowProcess,
    subjectId: string,
  ): Promise<boolean> {
    return (await this.pending(tx, process, subjectId)) !== null;
  }

  /**
   * Records the caller's decision on the current step. Returns the request's outcome:
   * PENDING while more steps remain, or the final decision. null when no workflow is running.
   */
  async decide(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    process: WorkflowProcess,
    subjectId: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string | null,
  ): Promise<Outcome | null> {
    const p = await this.pending(tx, process, subjectId);
    if (!p) return null;
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${p.inst.id}::uuid FOR UPDATE`;
    const me = await myEmployeeId(tx, principal);
    if (!p.task || !me || !p.task.assigneeIds.includes(me) || me === p.inst.requesterEmployeeId)
      throw AppException.forbidden('This step is waiting for someone else');
    if (decision === 'REJECTED' && !note) throw AppException.badRequest('Give a reason', 'note');
    await tx.workflowTask.update({
      where: { id: p.task.id },
      data: {
        status: decision,
        decidedByUserId: principal.userId,
        decidedByEmployeeId: me,
        decidedAt: new Date(),
        note,
      },
    });
    let outcome: Outcome = decision;
    if (decision === 'APPROVED') {
      const more = await this.advance(
        tx,
        {
          ...p.inst,
          measure: p.inst.measure.toString(),
          snapshot: p.inst.snapshot as unknown as WorkflowStep[],
        },
        p.task.stepIndex,
      );
      if (more) outcome = 'PENDING';
    }
    if (outcome !== 'PENDING')
      await tx.workflowInstance.update({
        where: { id: p.inst.id },
        data: { status: outcome, completedAt: new Date() },
      });
    await this.audit.record(tx, {
      action: `workflow.step_${decision.toLowerCase()}`,
      entityType: 'workflow_instance',
      entityId: p.inst.id,
      metadata: { process, subjectId, outcome },
    });
    return outcome;
  }

  /** The request was withdrawn or recalled: close its approval. */
  async cancel(tx: TenantTransaction, process: WorkflowProcess, subjectId: string): Promise<void> {
    const p = await this.pending(tx, process, subjectId);
    if (!p) return;
    if (p.task)
      await tx.workflowTask.update({ where: { id: p.task.id }, data: { status: 'CANCELLED' } });
    await tx.workflowInstance.update({
      where: { id: p.inst.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  /** Which of these requests have a running workflow. */
  async withPending(
    tx: TenantTransaction,
    process: WorkflowProcess,
    subjectIds: string[],
  ): Promise<Set<string>> {
    if (!subjectIds.length) return new Set();
    const rows = await tx.workflowInstance.findMany({
      where: { process, status: 'PENDING', subjectId: { in: subjectIds } },
      select: { subjectId: true },
    });
    return new Set(rows.map((r) => r.subjectId));
  }

  /** Whether the employee was asked to decide (or decided) any step of the request. */
  async isInvolved(
    tx: TenantTransaction,
    process: WorkflowProcess,
    subjectId: string,
    employeeId: string,
  ): Promise<boolean> {
    const n = await tx.workflowTask.count({
      where: {
        instance: { process, subjectId },
        OR: [
          { assigneeIds: { has: employeeId } },
          { decidedByEmployeeId: employeeId },
          { onBehalfOfEmployeeId: employeeId },
        ],
      },
    });
    return n > 0;
  }

  /** Subject ids of a process whose current step waits for this employee. */
  async subjectsWaitingFor(
    tx: TenantTransaction,
    process: WorkflowProcess,
    employeeId: string,
  ): Promise<string[]> {
    const rows = await tx.workflowTask.findMany({
      where: {
        status: 'PENDING',
        assigneeIds: { has: employeeId },
        instance: { process, status: 'PENDING' },
      },
      select: { instance: { select: { subjectId: true, requesterEmployeeId: true } } },
    });
    return rows
      .filter((r) => r.instance.requesterEmployeeId !== employeeId)
      .map((r) => r.instance.subjectId);
  }

  // ---------------------------------------------------------------------------- inbox

  async inbox(tx: TenantTransaction, principal: AuthPrincipal): Promise<ApprovalTaskItem[]> {
    const me = await myEmployeeId(tx, principal);
    if (!me) return [];
    const rows = await tx.workflowTask.findMany({
      where: {
        status: 'PENDING',
        assigneeIds: { has: me },
        instance: { status: 'PENDING', requesterEmployeeId: { not: me } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        stepName: true,
        stepNumber: true,
        dueAt: true,
        createdAt: true,
        onBehalfOfEmployeeId: true,
        escalatedFromEmployeeId: true,
        instance: {
          select: {
            id: true,
            process: true,
            subjectId: true,
            measure: true,
            snapshot: true,
            requester: { select: empSelect },
          },
        },
      },
    });
    const people = await tx.employee.findMany({
      where: {
        id: {
          in: rows.flatMap((r) =>
            [r.onBehalfOfEmployeeId, r.escalatedFromEmployeeId].filter((x): x is string => !!x),
          ),
        },
      },
      select: empSelect,
    });
    const person = (id: string | null) => {
      const p = id ? people.find((x) => x.id === id) : undefined;
      return p ? ref(p) : null;
    };
    const summaries = new Map<string, string>();
    for (const process of new Set(rows.map((r) => r.instance.process))) {
      const h = this.registry.get(process);
      const ids = rows
        .filter((r) => r.instance.process === process)
        .map((r) => r.instance.subjectId);
      if (h) for (const [k, v] of await h.summaries(tx, ids)) summaries.set(k, v);
    }
    const now = Date.now();
    return rows.map((r) => {
      const steps = applicableSteps(
        r.instance.snapshot as unknown as WorkflowStep[],
        r.instance.measure.toString(),
      );
      return {
        id: r.id,
        instanceId: r.instance.id,
        process: r.instance.process,
        subjectId: r.instance.subjectId,
        summary: summaries.get(r.instance.subjectId) ?? r.instance.process.toLowerCase(),
        link: this.registry.get(r.instance.process)?.link(r.instance.subjectId) ?? '/',
        requester: ref(r.instance.requester),
        stepName: r.stepName,
        stepNumber: r.stepNumber,
        stepCount: steps.length,
        dueAt: r.dueAt?.toISOString() ?? null,
        overdue: !!r.dueAt && r.dueAt.getTime() < now,
        onBehalfOf: person(r.onBehalfOfEmployeeId),
        escalatedFrom: person(r.escalatedFromEmployeeId),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------- escalation

  /** Reassigns overdue tasks of the current tenant to their escalation target. */
  async escalateOverdue(tx: TenantTransaction, now = new Date()): Promise<number> {
    const overdue = await tx.workflowTask.findMany({
      where: {
        status: 'PENDING',
        dueAt: { lt: now },
        escalatedFromEmployeeId: null,
        instance: { status: 'PENDING' },
      },
      select: {
        id: true,
        organizationId: true,
        instanceId: true,
        stepIndex: true,
        stepNumber: true,
        stepName: true,
        assigneeIds: true,
        instance: { select: { requesterEmployeeId: true, snapshot: true } },
      },
    });
    let n = 0;
    for (const t of overdue) {
      const step = (t.instance.snapshot as unknown as WorkflowStep[])[t.stepIndex];
      const from = t.assigneeIds[0] ?? null;
      const manager = from ? ((await this.managerChain(tx, from))[0] ?? null) : null;
      const target = escalationTarget(step?.escalateTo, manager, t.instance.requesterEmployeeId);
      if (!target || t.assigneeIds.includes(target)) continue;
      // The still-pending step moves to the target once; escalation never decides anything.
      await tx.workflowTask.update({
        where: { id: t.id },
        data: {
          assigneeIds: [target],
          escalatedFromEmployeeId: from,
          onBehalfOfEmployeeId: null,
          dueAt: null,
        },
      });
      await this.audit.record(tx, {
        action: 'workflow.escalated',
        entityType: 'workflow_instance',
        entityId: t.instanceId,
        metadata: { step: t.stepNumber, from, to: target },
      });
      n++;
    }
    return n;
  }
}
