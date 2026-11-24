import { Injectable } from '@nestjs/common';
import {
  billingRate,
  budgetUse,
  canHaveParent,
  canMoveSprint,
  Decimal,
  sprintVelocity,
  workItemKey,
} from '@hrm/business-rules';
import {
  type BoardData,
  type CommentItem,
  PERMISSIONS,
  type ProjectDetails,
  type ProjectItem,
  type SprintItem,
  type WorkItemDetails,
  type WorkItemItem,
} from '@hrm/shared-types';
import type {
  boardColumnsSchema,
  commentSchema,
  completeSprintSchema,
  projectListQuerySchema,
  projectMemberSchema,
  projectSchema,
  sprintSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  updateWorkItemSchema,
  workItemListQuerySchema,
  workItemSchema,
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
import { isoDate, isoOrNull, toDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { mapWriteError } from '../structure/structure.util.js';
import {
  clientRef,
  clientRefSelect,
  dec,
  empSelect,
  money,
  myEmployeeId,
  progressOf,
  type ProjectAccess,
  projectAccess,
  readableProjectIds,
  ref,
  requireManage,
  requireWrite,
} from './projects-common.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;

const DEFAULT_COLUMNS = [
  { name: 'To do', category: 'TODO' as const },
  { name: 'In progress', category: 'IN_PROGRESS' as const },
  { name: 'Done', category: 'DONE' as const },
];

export const workItemSelect = {
  id: true,
  number: true,
  type: true,
  title: true,
  priority: true,
  column: { select: { id: true, name: true, category: true } },
  assignee: { select: empSelect },
  parent: { select: { id: true, number: true, title: true, type: true } },
  sprintId: true,
  storyPoints: true,
  estimateHours: true,
  dueDate: true,
  labels: true,
  severity: true,
  clientVisible: true,
  fromClient: true,
  rank: true,
  updatedAt: true,
  _count: { select: { children: true } },
} satisfies Prisma.WorkItemSelect;
type WorkItemRow = Prisma.WorkItemGetPayload<{ select: typeof workItemSelect }>;

export const toWorkItem = (key: string, w: WorkItemRow): WorkItemItem => ({
  id: w.id,
  key: workItemKey(key, w.number),
  type: w.type,
  title: w.title,
  priority: w.priority,
  column: w.column,
  assignee: w.assignee ? ref(w.assignee) : null,
  parent: w.parent
    ? {
        id: w.parent.id,
        key: workItemKey(key, w.parent.number),
        title: w.parent.title,
        type: w.parent.type,
      }
    : null,
  sprintId: w.sprintId,
  storyPoints: dec(w.storyPoints, 1),
  estimateHours: dec(w.estimateHours),
  dueDate: isoOrNull(w.dueDate),
  labels: w.labels,
  severity: w.severity,
  clientVisible: w.clientVisible,
  fromClient: w.fromClient,
  rank: w.rank,
  children: w._count.children,
  updatedAt: w.updatedAt.toISOString(),
});

/** Projects, members, board columns, sprints and work items (ADR-017). */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------- projects

  list(principal: AuthPrincipal, q: In<typeof projectListQuerySchema>): Promise<ProjectItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const ids = await readableProjectIds(tx, principal);
      const me = await myEmployeeId(tx, principal);
      const mineOnly = q.mine ?? false;
      const rows = await tx.project.findMany({
        where: {
          ...(ids ? { id: { in: ids } } : {}),
          ...(q.status ? { status: q.status as never } : {}),
          ...(q.clientId ? { clientId: q.clientId } : {}),
          ...(q.search
            ? {
                OR: [
                  { name: { contains: q.search, mode: 'insensitive' } },
                  { key: { contains: q.search.toUpperCase() } },
                ],
              }
            : {}),
          ...(mineOnly ? { members: { some: { employeeId: { in: me ? [me] : [] } } } } : {}),
        },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          billingType: true,
          status: true,
          startDate: true,
          endDate: true,
          portalEnabled: true,
          client: { select: clientRefSelect },
          members: { where: { employeeId: { in: me ? [me] : [] } }, select: { role: true } },
        },
      });
      const progress = await progressOf(
        tx,
        rows.map((r) => r.id),
      );
      const manageAll = can(principal, P.PROJECTS_PROJECT_MANAGE, {});
      return rows.map((r) => {
        const myRole = r.members[0]?.role ?? null;
        return {
          id: r.id,
          key: r.key,
          name: r.name,
          description: r.description,
          client: clientRef(r.client),
          billingType: r.billingType,
          status: r.status,
          startDate: isoOrNull(r.startDate),
          endDate: isoOrNull(r.endDate),
          portalEnabled: r.portalEnabled,
          progress: progress.get(r.id) ?? {
            todo: '0',
            inProgress: '0',
            done: '0',
            percentDone: '0',
          },
          myRole,
          canManage: manageAll || myRole === 'MANAGER',
        };
      });
    });
  }

  create(principal: AuthPrincipal, input: In<typeof projectSchema>): Promise<ProjectDetails> {
    return this.prisma.withTenant(async (tx) => {
      const org = principal.organizationId ?? '';
      if (input.clientId) {
        const c = await tx.client.findFirst({
          where: { id: input.clientId },
          select: { status: true },
        });
        if (!c) throw AppException.badRequest('The client does not exist', 'clientId');
        if (c.status !== 'ACTIVE')
          throw AppException.badRequest('The client is inactive', 'clientId');
      }
      let id: string;
      try {
        const p = await tx.project.create({
          data: {
            organizationId: org,
            key: input.key,
            name: input.name,
            description: input.description ?? null,
            clientId: input.clientId ?? null,
            billingType: input.billingType,
            hourlyRate: input.hourlyRate ?? null,
            budgetAmount: input.budgetAmount ?? null,
            budgetHours: input.budgetHours ?? null,
            startDate: input.startDate ? toDate(input.startDate) : null,
            endDate: input.endDate ? toDate(input.endDate) : null,
            portalEnabled: input.portalEnabled,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        id = p.id;
      } catch (err) {
        mapWriteError(err, { entity: 'project', uniqueField: 'key' });
      }
      await tx.boardColumn.createMany({
        data: DEFAULT_COLUMNS.map((c, position) => ({
          organizationId: org,
          projectId: id,
          position,
          ...c,
        })),
      });
      // The creator, when an employee, manages the project.
      const me = await myEmployeeId(tx, principal);
      if (me)
        await tx.projectMember.create({
          data: { organizationId: org, projectId: id, employeeId: me, role: 'MANAGER' },
        });
      await this.audit.record(tx, {
        action: 'projects.project.created',
        entityType: 'project',
        entityId: id,
      });
      return this.details(tx, principal, id);
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<ProjectDetails> {
    return this.prisma.withTenant((tx) => this.details(tx, principal, id));
  }

  private async details(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<ProjectDetails> {
    const a = await projectAccess(tx, principal, id);
    const p = await tx.project.findFirstOrThrow({
      where: { id },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        billingType: true,
        status: true,
        startDate: true,
        endDate: true,
        portalEnabled: true,
        hourlyRate: true,
        budgetAmount: true,
        budgetHours: true,
        client: { select: clientRefSelect },
        members: {
          select: {
            id: true,
            role: true,
            billingRate: true,
            allocationPercent: true,
            employee: { select: empSelect },
          },
          orderBy: { createdAt: 'asc' },
        },
        columns: {
          orderBy: { position: 'asc' },
          select: { id: true, name: true, category: true, position: true, wipLimit: true },
        },
      },
    });
    const sprints = await this.sprintItems(tx, id);
    const progress = (await progressOf(tx, [id])).get(id) ?? {
      todo: '0',
      inProgress: '0',
      done: '0',
      percentDone: '0',
    };
    let finance: ProjectDetails['finance'] = null;
    if (a.manage) {
      const entries = await tx.timeEntry.findMany({
        where: { projectId: id },
        select: {
          hours: true,
          billable: true,
          employeeId: true,
          timesheet: { select: { status: true } },
        },
      });
      const rates = new Map(p.members.map((m) => [m.employee.id, m.billingRate]));
      let hours = new Decimal(0);
      let amount = new Decimal(0);
      for (const e of entries) {
        hours = hours.plus(e.hours.toString());
        if (e.billable && e.timesheet.status === 'APPROVED') {
          const rate = billingRate(
            rates.get(e.employeeId)?.toString() ?? null,
            p.hourlyRate?.toString() ?? null,
          );
          if (rate) amount = amount.plus(rate.times(e.hours.toString()));
        }
      }
      finance = {
        hourlyRate: money(p.hourlyRate),
        budgetAmount: money(p.budgetAmount),
        budgetHours: dec(p.budgetHours),
        hoursLogged: hours.toString(),
        billableAmount: amount.toFixed(2),
        hoursPercent: budgetUse(hours, p.budgetHours?.toString())?.toString() ?? null,
        amountPercent: budgetUse(amount, p.budgetAmount?.toString())?.toString() ?? null,
      };
    }
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      client: clientRef(p.client),
      billingType: p.billingType,
      status: p.status,
      startDate: isoOrNull(p.startDate),
      endDate: isoOrNull(p.endDate),
      portalEnabled: p.portalEnabled,
      progress,
      myRole: a.role,
      canManage: a.manage,
      members: p.members.map((m) => ({
        id: m.id,
        employee: ref(m.employee),
        role: m.role,
        billingRate: a.manage ? money(m.billingRate) : null,
        allocationPercent: dec(m.allocationPercent),
      })),
      columns: p.columns,
      sprints,
      finance,
    };
  }

  update(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof updateProjectSchema>,
  ): Promise<ProjectDetails> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      const data: Prisma.ProjectUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;
      if (input.hourlyRate !== undefined) data.hourlyRate = input.hourlyRate;
      if (input.budgetAmount !== undefined) data.budgetAmount = input.budgetAmount;
      if (input.budgetHours !== undefined) data.budgetHours = input.budgetHours;
      if (input.startDate !== undefined)
        data.startDate = input.startDate ? toDate(input.startDate) : null;
      if (input.endDate !== undefined) data.endDate = input.endDate ? toDate(input.endDate) : null;
      if (input.portalEnabled !== undefined) data.portalEnabled = input.portalEnabled;
      if (input.status !== undefined) data.status = input.status;
      try {
        await tx.project.update({ where: { id }, data });
      } catch (err) {
        mapWriteError(err, { entity: 'project' });
      }
      await this.audit.record(tx, {
        action: 'projects.project.updated',
        entityType: 'project',
        entityId: id,
      });
      return this.details(tx, principal, id);
    });
  }

  // ---------------------------------------------------------------------------- members

  addMember(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof projectMemberSchema>,
  ): Promise<ProjectDetails> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      const e = await tx.employee.findFirst({
        where: { id: input.employeeId },
        select: { status: true },
      });
      if (!e) throw AppException.badRequest('The employee does not exist', 'employeeId');
      if (e.status === 'SEPARATED')
        throw AppException.badRequest('The employee has left', 'employeeId');
      try {
        await tx.projectMember.create({
          data: {
            organizationId: principal.organizationId ?? '',
            projectId: id,
            employeeId: input.employeeId,
            role: input.role,
            billingRate: input.billingRate ?? null,
            allocationPercent: input.allocationPercent ?? null,
          },
        });
      } catch (err) {
        mapWriteError(err, { entity: 'project member', uniqueField: 'employeeId' });
      }
      await this.audit.record(tx, {
        action: 'projects.member.added',
        entityType: 'project',
        entityId: id,
        metadata: { employeeId: input.employeeId, role: input.role },
      });
      return this.details(tx, principal, id);
    });
  }

  updateMember(
    principal: AuthPrincipal,
    id: string,
    memberId: string,
    input: In<typeof updateProjectMemberSchema>,
  ): Promise<ProjectDetails> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      const m = await tx.projectMember.findFirst({
        where: { id: memberId, projectId: id },
        select: { id: true },
      });
      if (!m) throw AppException.notFound('Project member');
      await tx.projectMember.update({
        where: { id: memberId },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.billingRate !== undefined ? { billingRate: input.billingRate } : {}),
          ...(input.allocationPercent !== undefined
            ? { allocationPercent: input.allocationPercent }
            : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'projects.member.updated',
        entityType: 'project',
        entityId: id,
        metadata: { memberId },
      });
      return this.details(tx, principal, id);
    });
  }

  /** Removes a member; their open items become unassigned. Logged time stays. */
  removeMember(principal: AuthPrincipal, id: string, memberId: string): Promise<ProjectDetails> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      const m = await tx.projectMember.findFirst({
        where: { id: memberId, projectId: id },
        select: { employeeId: true },
      });
      if (!m) throw AppException.notFound('Project member');
      await tx.workItem.updateMany({
        where: {
          projectId: id,
          assigneeEmployeeId: m.employeeId,
          column: { category: { not: 'DONE' } },
        },
        data: { assigneeEmployeeId: null },
      });
      await tx.projectMember.delete({ where: { id: memberId } });
      await this.audit.record(tx, {
        action: 'projects.member.removed',
        entityType: 'project',
        entityId: id,
        metadata: { employeeId: m.employeeId },
      });
      return this.details(tx, principal, id);
    });
  }

  // ---------------------------------------------------------------------------- columns

  /** Replaces the board columns: listed ids are kept (renamed/reordered), others removed if empty. */
  setColumns(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof boardColumnsSchema>,
  ): Promise<ProjectDetails> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      const existing = await tx.boardColumn.findMany({
        where: { projectId: id },
        select: { id: true, _count: { select: { workItems: true } } },
      });
      const keep = new Set(input.columns.map((c) => c.id).filter((x): x is string => !!x));
      for (const k of keep)
        if (!existing.some((e) => e.id === k))
          throw AppException.badRequest('A column does not belong to this project', 'columns');
      for (const e of existing)
        if (!keep.has(e.id) && e._count.workItems > 0)
          throw AppException.conflict('Move the items out of a column before removing it');
      await tx.boardColumn.deleteMany({ where: { projectId: id, id: { notIn: [...keep] } } });
      for (const [position, c] of input.columns.entries()) {
        const data = { name: c.name, category: c.category, position, wipLimit: c.wipLimit ?? null };
        if (c.id) await tx.boardColumn.update({ where: { id: c.id }, data });
        else
          await tx.boardColumn.create({
            data: { organizationId: principal.organizationId ?? '', projectId: id, ...data },
          });
      }
      await this.audit.record(tx, {
        action: 'projects.columns.updated',
        entityType: 'project',
        entityId: id,
      });
      return this.details(tx, principal, id);
    });
  }

  // ---------------------------------------------------------------------------- sprints

  private async sprintItems(tx: TenantTransaction, projectId: string): Promise<SprintItem[]> {
    const rows = await tx.sprint.findMany({
      where: { projectId },
      orderBy: [{ startDate: 'asc' }],
      select: {
        id: true,
        name: true,
        goal: true,
        startDate: true,
        endDate: true,
        status: true,
        committedPoints: true,
        completedPoints: true,
        workItems: { select: { storyPoints: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal,
      startDate: isoDate(s.startDate),
      endDate: isoDate(s.endDate),
      status: s.status,
      committedPoints: dec(s.committedPoints, 1),
      completedPoints: dec(s.completedPoints, 1),
      items: s.workItems.length,
      points: s.workItems
        .reduce((a, w) => a.plus(w.storyPoints?.toString() ?? 0), new Decimal(0))
        .toString(),
    }));
  }

  createSprint(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof sprintSchema>,
  ): Promise<SprintItem[]> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      await tx.sprint.create({
        data: {
          organizationId: principal.organizationId ?? '',
          projectId: id,
          name: input.name,
          goal: input.goal ?? null,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
        },
      });
      return this.sprintItems(tx, id);
    });
  }

  startSprint(principal: AuthPrincipal, id: string, sprintId: string): Promise<SprintItem[]> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      const s = await tx.sprint.findFirst({
        where: { id: sprintId, projectId: id },
        select: { status: true },
      });
      if (!s) throw AppException.notFound('Sprint');
      if (!canMoveSprint(s.status, 'ACTIVE'))
        throw AppException.conflict('Only a planned sprint can start');
      if (await tx.sprint.count({ where: { projectId: id, status: 'ACTIVE' } }))
        throw AppException.conflict('Complete the active sprint first');
      await tx.sprint.update({
        where: { id: sprintId },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'projects.sprint.started',
        entityType: 'sprint',
        entityId: sprintId,
      });
      return this.sprintItems(tx, id);
    });
  }

  /** Records velocity; unfinished items go to a planned sprint or back to the backlog. */
  completeSprint(
    principal: AuthPrincipal,
    id: string,
    sprintId: string,
    input: In<typeof completeSprintSchema>,
  ): Promise<SprintItem[]> {
    return this.prisma.withTenant(async (tx) => {
      requireManage(await projectAccess(tx, principal, id));
      const s = await tx.sprint.findFirst({
        where: { id: sprintId, projectId: id },
        select: { status: true },
      });
      if (!s) throw AppException.notFound('Sprint');
      if (!canMoveSprint(s.status, 'COMPLETED'))
        throw AppException.conflict('Only the active sprint can be completed');
      const target = input.moveToSprintId ?? null;
      if (target) {
        const t = await tx.sprint.findFirst({
          where: { id: target, projectId: id, status: 'PLANNED' },
          select: { id: true },
        });
        if (!t)
          throw AppException.badRequest(
            'Choose a planned sprint of this project',
            'moveToSprintId',
          );
      }
      const items = await tx.workItem.findMany({
        where: { sprintId },
        select: { id: true, storyPoints: true, column: { select: { category: true } } },
      });
      const v = sprintVelocity(
        items.map((i) => ({
          category: i.column.category,
          points: i.storyPoints?.toString() ?? null,
        })),
      );
      const unfinished = items.filter((i) => i.column.category !== 'DONE').map((i) => i.id);
      await tx.workItem.updateMany({
        where: { id: { in: unfinished } },
        data: { sprintId: target },
      });
      await tx.workItemEvent.createMany({
        data: unfinished.map((workItemId) => ({
          organizationId: principal.organizationId ?? '',
          workItemId,
          field: 'sprint',
          fromValue: 'completed sprint',
          toValue: target ? 'next sprint' : 'backlog',
          actorUserId: principal.userId,
        })),
      });
      await tx.sprint.update({
        where: { id: sprintId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          committedPoints: v.committed.toString(),
          completedPoints: v.completed.toString(),
        },
      });
      await this.audit.record(tx, {
        action: 'projects.sprint.completed',
        entityType: 'sprint',
        entityId: sprintId,
        metadata: {
          committed: v.committed.toString(),
          completed: v.completed.toString(),
          carried: unfinished.length,
        },
      });
      return this.sprintItems(tx, id);
    });
  }

  // ---------------------------------------------------------------------------- work items

  listItems(
    principal: AuthPrincipal,
    id: string,
    q: In<typeof workItemListQuerySchema>,
  ): Promise<WorkItemItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const a = await projectAccess(tx, principal, id);
      const rows = await tx.workItem.findMany({
        where: {
          projectId: id,
          ...(q.type ? { type: q.type as never } : {}),
          ...(q.sprintId === 'backlog'
            ? { sprintId: null }
            : q.sprintId
              ? { sprintId: q.sprintId }
              : {}),
          ...(q.assigneeId ? { assigneeEmployeeId: q.assigneeId } : {}),
          ...(q.columnId ? { columnId: q.columnId } : {}),
          ...(q.parentId ? { parentId: q.parentId } : {}),
          ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
        },
        orderBy: [{ rank: 'asc' }, { number: 'asc' }],
        select: workItemSelect,
        take: 1000,
      });
      return rows.map((w) => toWorkItem(a.key, w));
    });
  }

  board(principal: AuthPrincipal, id: string, sprintId?: string): Promise<BoardData> {
    return this.prisma.withTenant(async (tx) => {
      const a = await projectAccess(tx, principal, id);
      const sprints = await this.sprintItems(tx, id);
      const sprint =
        (sprintId
          ? sprints.find((s) => s.id === sprintId)
          : sprints.find((s) => s.status === 'ACTIVE')) ?? null;
      const columns = await tx.boardColumn.findMany({
        where: { projectId: id },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, category: true, position: true, wipLimit: true },
      });
      const items = await tx.workItem.findMany({
        where: {
          projectId: id,
          type: { notIn: ['EPIC', 'FEATURE'] },
          sprintId: sprint ? sprint.id : null,
        },
        orderBy: [{ rank: 'asc' }, { number: 'asc' }],
        select: workItemSelect,
      });
      return {
        sprint,
        columns: columns.map((c) => ({
          ...c,
          items: items.filter((w) => w.column.id === c.id).map((w) => toWorkItem(a.key, w)),
        })),
      };
    });
  }

  private async validateRefs(
    tx: TenantTransaction,
    projectId: string,
    type: WorkItemItem['type'],
    refs: {
      parentId?: string | null;
      assigneeId?: string | null;
      sprintId?: string | null;
      columnId?: string | null;
    },
  ): Promise<void> {
    if (refs.parentId !== undefined) {
      const parent = refs.parentId
        ? await tx.workItem.findFirst({
            where: { id: refs.parentId, projectId },
            select: { type: true },
          })
        : null;
      if (refs.parentId && !parent)
        throw AppException.badRequest('The parent is not in this project', 'parentId');
      if (!canHaveParent(type, parent?.type ?? null))
        throw AppException.badRequest(
          parent
            ? `A ${type.toLowerCase()} cannot sit under a ${parent.type.toLowerCase()}`
            : `A ${type.toLowerCase()} needs a parent`,
          'parentId',
        );
    }
    if (refs.assigneeId) {
      const m = await tx.projectMember.findFirst({
        where: { projectId, employeeId: refs.assigneeId },
        select: { role: true },
      });
      if (!m || m.role === 'VIEWER')
        throw AppException.badRequest('Assign to a member of the project', 'assigneeId');
    }
    if (refs.sprintId) {
      const s = await tx.sprint.findFirst({
        where: { id: refs.sprintId, projectId },
        select: { status: true },
      });
      if (!s) throw AppException.badRequest('The sprint is not in this project', 'sprintId');
      if (s.status === 'COMPLETED')
        throw AppException.badRequest('The sprint is completed', 'sprintId');
    }
    if (refs.columnId) {
      const c = await tx.boardColumn.findFirst({
        where: { id: refs.columnId, projectId },
        select: { id: true },
      });
      if (!c) throw AppException.badRequest('The column is not in this project', 'columnId');
    }
  }

  /** Allocates the next number under a row lock on the project. */
  async allocateNumber(tx: TenantTransaction, projectId: string): Promise<number> {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`;
    const p = await tx.project.update({
      where: { id: projectId },
      data: { nextItemNumber: { increment: 1 } },
      select: { nextItemNumber: true },
    });
    return p.nextItemNumber - 1;
  }

  async firstColumn(tx: TenantTransaction, projectId: string): Promise<string> {
    const c = await tx.boardColumn.findFirst({
      where: { projectId, category: 'TODO' },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!c) throw AppException.conflict('The project has no to-do column');
    return c.id;
  }

  createItem(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof workItemSchema>,
  ): Promise<WorkItemDetails> {
    return this.prisma.withTenant(async (tx) => {
      const a = await projectAccess(tx, principal, id);
      requireWrite(a);
      await this.validateRefs(tx, id, input.type, {
        parentId: input.parentId ?? null,
        assigneeId: input.assigneeId ?? null,
        sprintId: input.sprintId ?? null,
        columnId: input.columnId ?? null,
      });
      const number = await this.allocateNumber(tx, id);
      const columnId = input.columnId ?? (await this.firstColumn(tx, id));
      let itemId: string;
      try {
        const w = await tx.workItem.create({
          data: {
            organizationId: principal.organizationId ?? '',
            projectId: id,
            number,
            type: input.type,
            title: input.title,
            description: input.description ?? null,
            parentId: input.parentId ?? null,
            columnId,
            priority: input.priority,
            assigneeEmployeeId: input.assigneeId ?? null,
            reporterUserId: principal.userId,
            sprintId: input.sprintId ?? null,
            storyPoints: input.storyPoints ?? null,
            estimateHours: input.estimateHours ?? null,
            dueDate: input.dueDate ? toDate(input.dueDate) : null,
            labels: input.labels,
            severity: input.severity ?? null,
            stepsToReproduce: input.stepsToReproduce ?? null,
            environment: input.environment ?? null,
            clientVisible: input.clientVisible,
            rank: number,
          },
          select: { id: true },
        });
        itemId = w.id;
      } catch (err) {
        mapWriteError(err, { entity: 'work item' });
      }
      await tx.workItemEvent.create({
        data: {
          organizationId: principal.organizationId ?? '',
          workItemId: itemId,
          field: 'created',
          fromValue: null,
          toValue: input.type.toLowerCase(),
          actorUserId: principal.userId,
        },
      });
      return this.itemDetails(tx, a, itemId);
    });
  }

  getItem(principal: AuthPrincipal, id: string, itemId: string): Promise<WorkItemDetails> {
    return this.prisma.withTenant(async (tx) =>
      this.itemDetails(tx, await projectAccess(tx, principal, id), itemId),
    );
  }

  private async itemDetails(
    tx: TenantTransaction,
    a: ProjectAccess,
    itemId: string,
  ): Promise<WorkItemDetails> {
    const w = await tx.workItem.findFirst({
      where: { id: itemId, projectId: a.projectId },
      select: {
        ...workItemSelect,
        description: true,
        stepsToReproduce: true,
        environment: true,
        reporterUserId: true,
        project: { select: { id: true, key: true, name: true } },
        children: { select: workItemSelect, orderBy: { number: 'asc' } },
        comments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            body: true,
            clientVisible: true,
            fromClient: true,
            authorUserId: true,
            createdAt: true,
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: {
            field: true,
            fromValue: true,
            toValue: true,
            actorUserId: true,
            createdAt: true,
          },
        },
        timeEntries: { select: { hours: true } },
      },
    });
    if (!w) throw AppException.notFound('Work item');
    const names = await userNames(tx, [
      w.reporterUserId,
      ...w.comments.map((c) => c.authorUserId),
      ...w.events.map((e) => e.actorUserId),
    ]);
    const comments: CommentItem[] = w.comments.map((c) => ({
      id: c.id,
      body: c.body,
      clientVisible: c.clientVisible,
      fromClient: c.fromClient,
      author: c.authorUserId ? (names.get(c.authorUserId) ?? null) : null,
      createdAt: c.createdAt.toISOString(),
    }));
    return {
      ...toWorkItem(a.key, w),
      project: w.project,
      description: w.description,
      stepsToReproduce: w.stepsToReproduce,
      environment: w.environment,
      reporter: w.reporterUserId ? (names.get(w.reporterUserId) ?? null) : null,
      loggedHours: w.timeEntries
        .reduce((s, e) => s.plus(e.hours.toString()), new Decimal(0))
        .toString(),
      childItems: w.children.map((c) => toWorkItem(a.key, c)),
      comments,
      history: w.events.map((e) => ({
        field: e.field,
        from: e.fromValue,
        to: e.toValue,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
        at: e.createdAt.toISOString(),
      })),
    };
  }

  updateItem(
    principal: AuthPrincipal,
    id: string,
    itemId: string,
    input: In<typeof updateWorkItemSchema>,
  ): Promise<WorkItemDetails> {
    return this.prisma.withTenant(async (tx) => {
      const a = await projectAccess(tx, principal, id);
      requireWrite(a);
      const cur = await tx.workItem.findFirst({
        where: { id: itemId, projectId: id },
        select: {
          type: true,
          title: true,
          priority: true,
          parentId: true,
          column: { select: { id: true, name: true } },
          assignee: { select: empSelect },
          sprint: { select: { id: true, name: true } },
        },
      });
      if (!cur) throw AppException.notFound('Work item');
      await this.validateRefs(tx, id, cur.type, {
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        assigneeId: input.assigneeId ?? null,
        sprintId: input.sprintId ?? null,
        columnId: input.columnId ?? null,
      });
      if (cur.type !== 'BUG' && (input.severity || input.stepsToReproduce || input.environment))
        throw AppException.badRequest('Severity, steps and environment are for bugs', 'severity');
      if (cur.type === 'BUG' && input.severity === null)
        throw AppException.badRequest('A bug needs a severity', 'severity');

      const data: Prisma.WorkItemUncheckedUpdateInput = {};
      const events: { field: string; fromValue: string | null; toValue: string | null }[] = [];
      if (input.title !== undefined && input.title !== cur.title) {
        data.title = input.title;
        events.push({ field: 'title', fromValue: cur.title, toValue: input.title });
      }
      if (input.description !== undefined) data.description = input.description;
      if (input.parentId !== undefined && input.parentId !== cur.parentId) {
        data.parentId = input.parentId;
        events.push({ field: 'parent', fromValue: null, toValue: null });
      }
      if (input.columnId !== undefined && input.columnId !== cur.column.id) {
        const to = await tx.boardColumn.findFirstOrThrow({
          where: { id: input.columnId },
          select: { name: true },
        });
        data.columnId = input.columnId;
        events.push({ field: 'status', fromValue: cur.column.name, toValue: to.name });
      }
      if (input.priority !== undefined && input.priority !== cur.priority) {
        data.priority = input.priority;
        events.push({
          field: 'priority',
          fromValue: cur.priority.toLowerCase(),
          toValue: input.priority.toLowerCase(),
        });
      }
      if (input.assigneeId !== undefined && input.assigneeId !== (cur.assignee?.id ?? null)) {
        const to = input.assigneeId
          ? await tx.employee.findFirstOrThrow({
              where: { id: input.assigneeId },
              select: empSelect,
            })
          : null;
        data.assigneeEmployeeId = input.assigneeId;
        events.push({
          field: 'assignee',
          fromValue: cur.assignee ? ref(cur.assignee).displayName : null,
          toValue: to ? ref(to).displayName : null,
        });
      }
      if (input.sprintId !== undefined && input.sprintId !== (cur.sprint?.id ?? null)) {
        const to = input.sprintId
          ? await tx.sprint.findFirstOrThrow({
              where: { id: input.sprintId },
              select: { name: true },
            })
          : null;
        data.sprintId = input.sprintId;
        events.push({
          field: 'sprint',
          fromValue: cur.sprint?.name ?? 'backlog',
          toValue: to?.name ?? 'backlog',
        });
      }
      if (input.storyPoints !== undefined) data.storyPoints = input.storyPoints;
      if (input.estimateHours !== undefined) data.estimateHours = input.estimateHours;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate ? toDate(input.dueDate) : null;
      if (input.labels !== undefined) data.labels = input.labels;
      if (input.severity !== undefined) data.severity = input.severity;
      if (input.stepsToReproduce !== undefined) data.stepsToReproduce = input.stepsToReproduce;
      if (input.environment !== undefined) data.environment = input.environment;
      if (input.clientVisible !== undefined) data.clientVisible = input.clientVisible;
      if (input.rank !== undefined) data.rank = input.rank;
      try {
        await tx.workItem.update({ where: { id: itemId }, data });
      } catch (err) {
        mapWriteError(err, { entity: 'work item' });
      }
      if (events.length)
        await tx.workItemEvent.createMany({
          data: events.map((e) => ({
            organizationId: principal.organizationId ?? '',
            workItemId: itemId,
            actorUserId: principal.userId,
            ...e,
          })),
        });
      return this.itemDetails(tx, a, itemId);
    });
  }

  addComment(
    principal: AuthPrincipal,
    id: string,
    itemId: string,
    input: In<typeof commentSchema>,
  ): Promise<WorkItemDetails> {
    return this.prisma.withTenant(async (tx) => {
      const a = await projectAccess(tx, principal, id);
      requireWrite(a);
      const w = await tx.workItem.findFirst({
        where: { id: itemId, projectId: id },
        select: { clientVisible: true },
      });
      if (!w) throw AppException.notFound('Work item');
      if (input.clientVisible && !w.clientVisible)
        throw AppException.badRequest(
          'Share the item with the client before sharing comments',
          'clientVisible',
        );
      await tx.workItemComment.create({
        data: {
          organizationId: principal.organizationId ?? '',
          workItemId: itemId,
          body: input.body,
          clientVisible: input.clientVisible,
          authorUserId: principal.userId,
        },
      });
      return this.itemDetails(tx, a, itemId);
    });
  }

  /** Open items assigned to the caller across their projects. */
  myWork(
    principal: AuthPrincipal,
  ): Promise<(WorkItemItem & { project: { id: string; key: string; name: string } })[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      if (!me) return [];
      const rows = await tx.workItem.findMany({
        where: { assigneeEmployeeId: me, column: { category: { not: 'DONE' } } },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { updatedAt: 'desc' }],
        select: { ...workItemSelect, project: { select: { id: true, key: true, name: true } } },
        take: 200,
      });
      return rows.map((w) => ({ ...toWorkItem(w.project.key, w), project: w.project }));
    });
  }
}
