import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  attritionRate,
  clearanceComplete,
  noticeLastDay,
  ratingAverage,
  waivedNoticeDays,
} from '@hrm/business-rules';
import {
  type ClearanceItem,
  type ExitAnalyticsItem,
  type ExitQuestionItem,
  PERMISSIONS,
  type ResignationItem,
  type SeparationCaseDetails,
  type SeparationCaseItem,
} from '@hrm/shared-types';
import type {
  clearanceDecisionSchema,
  clearanceTemplateSchema,
  exitAnswersSchema,
  exitQuestionsSchema,
  resignationDecisionSchema,
  resignationSchema,
  separationCaseSchema,
  separationSettingsSchema,
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
import { EmploymentService } from '../employees/employment.service.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { empSelect, managerOf, myEmployeeId, ref, requireMe } from '../talent/talent-common.js';
import { WorkflowEngine } from '../workflows/workflow-engine.service.js';
import { WorkflowRegistry } from '../workflows/workflow-registry.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;
type TemplateItem = In<typeof clearanceTemplateSchema>['items'][number];

const resignationSelect = {
  id: true,
  employeeId: true,
  reasonCategory: true,
  note: true,
  submittedOn: true,
  requestedLastDay: true,
  noticeLastDay: true,
  agreedLastDay: true,
  waivedNoticeDays: true,
  status: true,
  decisionNote: true,
  approverEmployeeId: true,
  employee: { select: empSelect },
  case: { select: { id: true } },
} satisfies Prisma.ResignationSelect;
type ResignationRow = Prisma.ResignationGetPayload<{ select: typeof resignationSelect }>;

const caseSelect = {
  id: true,
  employeeId: true,
  separationType: true,
  reasonCategory: true,
  lastWorkingDay: true,
  status: true,
  note: true,
  createdAt: true,
  employee: { select: empSelect },
  items: { orderBy: { createdAt: 'asc' as const } },
  interview: { select: { id: true } },
} satisfies Prisma.SeparationCaseSelect;
type CaseRow = Prisma.SeparationCaseGetPayload<{ select: typeof caseSelect }>;

/** Resignations, separation cases, clearance, exit interviews and exit analytics (ADR-019). */
@Injectable()
export class SeparationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employment: EmploymentService,
    private readonly engine: WorkflowEngine,
    private readonly registry: WorkflowRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      process: 'RESIGNATION',
      link: () => '/separation/resignations',
      summaries: async (tx, ids) => {
        const rows = await tx.resignation.findMany({
          where: { id: { in: ids } },
          select: { id: true, requestedLastDay: true, employee: { select: empSelect } },
        });
        return new Map(
          rows.map((r) => [
            r.id,
            `Resignation of ${ref(r.employee).displayName}, last day ${isoDate(r.requestedLastDay)}`,
          ]),
        );
      },
      decide: (principal, id, decision, note) =>
        this.decideResignation(principal, id, { decision, note }),
    });
  }

  // ---------------------------------------------------------------------------- settings

  private async settingsIn(tx: TenantTransaction, org: string) {
    return (
      (await tx.separationSettings.findFirst()) ??
      (await tx.separationSettings.create({ data: { organizationId: org } }))
    );
  }

  async settings(principal: AuthPrincipal): Promise<{
    noticeDays: number | null;
    clearanceTemplate: TemplateItem[];
    exitQuestions: ExitQuestionItem[];
  }> {
    const s = await this.prisma.withTenant((tx) =>
      this.settingsIn(tx, principal.organizationId ?? ''),
    );
    return {
      noticeDays: s.noticeDays,
      clearanceTemplate: s.clearanceTemplate as unknown as TemplateItem[],
      exitQuestions: s.exitQuestions as unknown as ExitQuestionItem[],
    };
  }

  async updateSettings(
    principal: AuthPrincipal,
    input: Partial<
      In<typeof separationSettingsSchema> &
        In<typeof clearanceTemplateSchema> &
        In<typeof exitQuestionsSchema>
    >,
  ) {
    await this.prisma.withTenant(async (tx) => {
      const org = principal.organizationId ?? '';
      await this.settingsIn(tx, org);
      if (input.items)
        for (const i of input.items)
          if (i.ownerRoleKey && !(await tx.role.count({ where: { key: i.ownerRoleKey } })))
            throw AppException.badRequest(`The role ${i.ownerRoleKey} does not exist`, 'items');
      await tx.separationSettings.update({
        where: { organizationId: org },
        data: {
          ...(input.noticeDays !== undefined ? { noticeDays: input.noticeDays } : {}),
          ...(input.items ? { clearanceTemplate: input.items } : {}),
          ...(input.questions ? { exitQuestions: input.questions } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'separation.settings.updated',
        entityType: 'separation_settings',
        metadata: { keys: Object.keys(input) },
      });
    });
    return this.settings(principal);
  }

  // ---------------------------------------------------------------------------- resignations

  private async approverFor(tx: TenantTransaction, employeeId: string): Promise<string | null> {
    const m = await managerOf(tx, employeeId);
    return m && m !== employeeId ? m : null;
  }

  private async toResignation(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    r: ResignationRow,
    me: string | null,
  ): Promise<ResignationItem> {
    const approver = r.approverEmployeeId
      ? await tx.employee.findFirst({ where: { id: r.approverEmployeeId }, select: empSelect })
      : null;
    return {
      id: r.id,
      employee: ref(r.employee),
      reasonCategory: r.reasonCategory,
      note: r.note,
      submittedOn: isoDate(r.submittedOn),
      requestedLastDay: isoDate(r.requestedLastDay),
      noticeLastDay: r.noticeLastDay ? isoDate(r.noticeLastDay) : null,
      agreedLastDay: r.agreedLastDay ? isoDate(r.agreedLastDay) : null,
      waivedNoticeDays: r.waivedNoticeDays,
      status: r.status,
      decisionNote: r.decisionNote,
      approver: approver ? ref(approver) : null,
      caseId: r.case?.id ?? null,
      can: {
        decide: r.status === 'PENDING' && (await this.canDecide(tx, principal, r, me)),
        withdraw: r.status === 'PENDING' && r.employeeId === me,
      },
    };
  }

  private async canDecide(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    r: { id: string; employeeId: string; approverEmployeeId: string | null },
    me: string | null,
  ): Promise<boolean> {
    if (r.employeeId === me) return false;
    const wf = await this.engine.canDecide(tx, principal, 'RESIGNATION', r.id);
    if (wf !== null) return wf;
    if (r.approverEmployeeId) return r.approverEmployeeId === me;
    return can(principal, P.SEPARATION_CASE_MANAGE, {});
  }

  resign(principal: AuthPrincipal, input: In<typeof resignationSchema>): Promise<ResignationItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const e = await tx.employee.findFirstOrThrow({ where: { id: me }, select: { status: true } });
      if (e.status !== 'ACTIVE')
        throw AppException.conflict('A separation is already recorded for you');
      const today = todayIso();
      if (input.requestedLastDay < today)
        throw AppException.badRequest('The last day cannot be in the past', 'requestedLastDay');
      const s = await this.settingsIn(tx, principal.organizationId ?? '');
      const notice = noticeLastDay(today, s.noticeDays);
      const waived = waivedNoticeDays(notice, input.requestedLastDay);
      let r: { id: string };
      try {
        r = await tx.resignation.create({
          data: {
            organizationId: principal.organizationId ?? '',
            employeeId: me,
            reasonCategory: input.reasonCategory,
            note: input.note ?? null,
            submittedOn: toDate(today),
            requestedLastDay: toDate(input.requestedLastDay),
            noticeLastDay: notice ? toDate(notice) : null,
            waivedNoticeDays: waived,
            approverEmployeeId: await this.approverFor(tx, me),
          },
          select: { id: true },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002')
          throw AppException.conflict('You already have a resignation waiting for a decision');
        throw err;
      }
      await this.engine.start(tx, principal, {
        process: 'RESIGNATION',
        subjectId: r.id,
        requesterEmployeeId: me,
        measure: String(waived),
      });
      await this.audit.record(tx, {
        action: 'separation.resignation.submitted',
        entityType: 'resignation',
        entityId: r.id,
      });
      return this.toResignation(
        tx,
        principal,
        await tx.resignation.findFirstOrThrow({ where: { id: r.id }, select: resignationSelect }),
        me,
      );
    });
  }

  resignations(
    principal: AuthPrincipal,
    scope: 'mine' | 'approvals' | 'all',
  ): Promise<ResignationItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      let where: Prisma.ResignationWhereInput;
      if (scope === 'mine') where = { employeeId: me ?? '00000000-0000-0000-0000-000000000000' };
      else if (scope === 'all') {
        if (!can(principal, P.SEPARATION_CASE_MANAGE, {})) throw AppException.forbidden();
        where = {};
      } else {
        const legacy = (
          await tx.resignation.findMany({
            where: {
              status: 'PENDING',
              OR: [
                ...(me ? [{ approverEmployeeId: me }] : []),
                ...(can(principal, P.SEPARATION_CASE_MANAGE, {})
                  ? [{ approverEmployeeId: null }]
                  : []),
              ],
              ...(me ? { employeeId: { not: me } } : {}),
            },
            select: { id: true },
          })
        ).map((x) => x.id);
        const running = await this.engine.withPending(tx, 'RESIGNATION', legacy);
        const waiting = me ? await this.engine.subjectsWaitingFor(tx, 'RESIGNATION', me) : [];
        where = {
          id: { in: [...new Set([...legacy.filter((x) => !running.has(x)), ...waiting])] },
        };
      }
      const rows = await tx.resignation.findMany({
        where,
        orderBy: { submittedOn: 'desc' },
        select: resignationSelect,
        take: 300,
      });
      return Promise.all(rows.map((r) => this.toResignation(tx, principal, r, me)));
    });
  }

  /** Approval sets the agreed last day, puts the employee on notice and opens the case. */
  decideResignation(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof resignationDecisionSchema>,
  ): Promise<ResignationItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const r = await tx.resignation.findFirst({ where: { id }, select: resignationSelect });
      if (!r) throw AppException.notFound('Resignation');
      if (r.status !== 'PENDING')
        throw AppException.conflict('This resignation has already been decided');
      if (r.employeeId === me)
        throw AppException.forbidden('You cannot decide your own resignation');
      const outcome = await this.engine.decide(
        tx,
        principal,
        'RESIGNATION',
        id,
        input.decision,
        input.note ?? null,
      );
      if (outcome === 'PENDING') {
        await this.audit.record(tx, {
          action: 'separation.resignation.step_approved',
          entityType: 'resignation',
          entityId: id,
        });
        return this.toResignation(tx, principal, r, me);
      }
      if (outcome === null && !(await this.canDecide(tx, principal, r, me)))
        throw AppException.forbidden('You are not the approver of this resignation');
      const decision = outcome ?? input.decision;
      if (decision === 'REJECTED') {
        await tx.resignation.update({
          where: { id },
          data: {
            status: 'REJECTED',
            decidedByUserId: principal.userId,
            decidedAt: new Date(),
            decisionNote: input.note ?? null,
          },
        });
      } else {
        const agreed = input.agreedLastDay ?? isoDate(r.requestedLastDay);
        if (agreed < isoDate(r.submittedOn))
          throw AppException.badRequest(
            'The last day cannot be before the resignation',
            'agreedLastDay',
          );
        const waived = waivedNoticeDays(r.noticeLastDay ? isoDate(r.noticeLastDay) : null, agreed);
        await tx.resignation.update({
          where: { id },
          data: {
            status: 'APPROVED',
            agreedLastDay: toDate(agreed),
            waivedNoticeDays: waived,
            decidedByUserId: principal.userId,
            decidedAt: new Date(),
            decisionNote: input.note ?? null,
          },
        });
        const e = await tx.employee.findFirstOrThrow({
          where: { id: r.employeeId },
          select: { status: true },
        });
        if (e.status !== 'ACTIVE')
          throw AppException.conflict('A separation is already recorded for this employee');
        await tx.employee.update({
          where: { id: r.employeeId },
          data: {
            status: 'ON_NOTICE',
            separationType: 'RESIGNATION',
            resignationDate: r.submittedOn,
            lastWorkingDate: toDate(agreed),
            separationReason: r.note,
          },
        });
        await this.audit.record(tx, {
          action: 'employee.separation_started',
          entityType: 'employee',
          entityId: r.employeeId,
          metadata: { separationType: 'RESIGNATION', lastWorkingDate: agreed, via: 'resignation' },
        });
        await this.openCase(tx, principal, {
          employeeId: r.employeeId,
          resignationId: id,
          separationType: 'RESIGNATION',
          reasonCategory: r.reasonCategory,
          lastWorkingDay: agreed,
          note: r.note,
        });
      }
      await this.audit.record(tx, {
        action: `separation.resignation.${decision.toLowerCase()}`,
        entityType: 'resignation',
        entityId: id,
      });
      return this.toResignation(
        tx,
        principal,
        await tx.resignation.findFirstOrThrow({ where: { id }, select: resignationSelect }),
        me,
      );
    });
  }

  withdrawResignation(principal: AuthPrincipal, id: string): Promise<ResignationItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const r = await tx.resignation.findFirst({
        where: { id, employeeId: me },
        select: { status: true },
      });
      if (!r) throw AppException.notFound('Resignation');
      if (r.status !== 'PENDING')
        throw AppException.conflict('Only a resignation waiting for a decision can be withdrawn');
      await this.engine.cancel(tx, 'RESIGNATION', id);
      await tx.resignation.update({
        where: { id },
        data: { status: 'WITHDRAWN', decidedAt: new Date(), decidedByUserId: principal.userId },
      });
      await this.audit.record(tx, {
        action: 'separation.resignation.withdrawn',
        entityType: 'resignation',
        entityId: id,
      });
      return this.toResignation(
        tx,
        principal,
        await tx.resignation.findFirstOrThrow({ where: { id }, select: resignationSelect }),
        me,
      );
    });
  }

  // ---------------------------------------------------------------------------- cases

  /** Creates the case and its clearance checklist (template, assets, licences, knowledge transfer). */
  private async openCase(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    input: {
      employeeId: string;
      resignationId: string | null;
      separationType: 'RESIGNATION' | 'TERMINATION' | 'RETIREMENT' | 'CONTRACT_END' | 'OTHER';
      reasonCategory: In<typeof resignationSchema>['reasonCategory'];
      lastWorkingDay: string;
      note: string | null;
    },
  ): Promise<string> {
    const org = principal.organizationId ?? '';
    let id: string;
    try {
      id = (
        await tx.separationCase.create({
          data: {
            organizationId: org,
            employeeId: input.employeeId,
            resignationId: input.resignationId,
            separationType: input.separationType,
            reasonCategory: input.reasonCategory,
            lastWorkingDay: toDate(input.lastWorkingDay),
            note: input.note,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        })
      ).id;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002')
        throw AppException.conflict('A separation is already in progress for this employee');
      throw err;
    }
    const s = await this.settingsIn(tx, org);
    const items: Prisma.ClearanceItemCreateManyInput[] = (
      s.clearanceTemplate as unknown as TemplateItem[]
    ).map((t) => ({
      organizationId: org,
      caseId: id,
      kind: 'TEMPLATE' as const,
      title: t.title,
      ownerRoleKey: t.ownerRoleKey ?? null,
      ownerEmployeeId: t.ownerEmployeeId ?? null,
    }));
    const allocations = await tx.assetAllocation.findMany({
      where: { employeeId: input.employeeId, returnedOn: null },
      select: { id: true, asset: { select: { tag: true, name: true } } },
    });
    for (const a of allocations)
      items.push({
        organizationId: org,
        caseId: id,
        kind: 'ASSET',
        title: `Return asset ${a.asset.tag} (${a.asset.name})`,
        ownerRoleKey: null,
        assetAllocationId: a.id,
      });
    const seats = await tx.licenseAssignment.findMany({
      where: { employeeId: input.employeeId, revokedOn: null },
      select: { id: true, license: { select: { name: true } } },
    });
    for (const l of seats)
      items.push({
        organizationId: org,
        caseId: id,
        kind: 'LICENSE',
        title: `Revoke licence seat: ${l.license.name}`,
        licenseAssignmentId: l.id,
      });
    const manager = await managerOf(tx, input.employeeId);
    if (manager)
      items.push({
        organizationId: org,
        caseId: id,
        kind: 'KNOWLEDGE_TRANSFER',
        title: 'Knowledge transfer and handover',
        ownerEmployeeId: manager,
      });
    if (items.length) await tx.clearanceItem.createMany({ data: items });
    await this.audit.record(tx, {
      action: 'separation.case.opened',
      entityType: 'separation_case',
      entityId: id,
      metadata: { items: items.length },
    });
    return id;
  }

  /** HR opens a case for a termination, retirement or contract end (or an employee already on notice). */
  async startCase(
    principal: AuthPrincipal,
    input: In<typeof separationCaseSchema>,
  ): Promise<SeparationCaseDetails> {
    const e = await this.prisma.withTenant((tx) =>
      tx.employee.findFirst({
        where: { id: input.employeeId },
        select: { status: true, lastWorkingDate: true },
      }),
    );
    if (!e) throw AppException.badRequest('The employee does not exist', 'employeeId');
    if (e.status === 'SEPARATED') throw AppException.conflict('The employee has already left');
    if (e.status === 'ACTIVE')
      await this.employment.startSeparation(principal, input.employeeId, {
        separationType: input.separationType,
        resignationDate: todayIso(),
        lastWorkingDate: input.lastWorkingDay,
        reason: input.note ?? null,
      });
    const id = await this.prisma.withTenant((tx) =>
      this.openCase(tx, principal, {
        employeeId: input.employeeId,
        resignationId: null,
        separationType: input.separationType,
        reasonCategory: input.reasonCategory,
        lastWorkingDay:
          e.status === 'ON_NOTICE' && e.lastWorkingDate
            ? isoDate(e.lastWorkingDate)
            : input.lastWorkingDay,
        note: input.note ?? null,
      }),
    );
    return this.getCase(principal, id);
  }

  /** Asset and licence items clear themselves once the asset is back or the seat revoked. */
  private async syncAutomatic(tx: TenantTransaction, caseId: string): Promise<void> {
    const pending = await tx.clearanceItem.findMany({
      where: { caseId, status: 'PENDING', kind: { in: ['ASSET', 'LICENSE'] } },
    });
    for (const i of pending) {
      let doneOn: string | null = null;
      if (i.assetAllocationId) {
        const a = await tx.assetAllocation.findFirst({
          where: { id: i.assetAllocationId },
          select: { returnedOn: true },
        });
        if (a?.returnedOn) doneOn = isoDate(a.returnedOn);
      }
      if (i.licenseAssignmentId) {
        const l = await tx.licenseAssignment.findFirst({
          where: { id: i.licenseAssignmentId },
          select: { revokedOn: true },
        });
        if (l?.revokedOn) doneOn = l.revokedOn.toISOString().slice(0, 10);
      }
      if (doneOn)
        await tx.clearanceItem.update({
          where: { id: i.id },
          data: {
            status: 'CLEARED',
            decidedAt: new Date(),
            note: i.kind === 'ASSET' ? `Returned on ${doneOn}` : `Revoked on ${doneOn}`,
          },
        });
    }
  }

  private async canClear(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    item: { kind: string; ownerRoleKey: string | null; ownerEmployeeId: string | null },
    me: string | null,
  ): Promise<boolean> {
    if (can(principal, P.SEPARATION_CASE_MANAGE, {})) return true;
    if (item.kind === 'ASSET' || item.kind === 'LICENSE') return false;
    if (item.ownerEmployeeId) return item.ownerEmployeeId === me;
    if (item.ownerRoleKey && principal.membershipId)
      return (
        (await tx.membershipRole.count({
          where: { membershipId: principal.membershipId, role: { key: item.ownerRoleKey } },
        })) > 0
      );
    return false;
  }

  private async visibleCase(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<{ c: CaseRow; me: string | null }> {
    const me = await myEmployeeId(tx, principal);
    const c = await tx.separationCase.findFirst({ where: { id }, select: caseSelect });
    if (!c) throw AppException.notFound('Separation');
    const roleKeys = principal.membershipId
      ? (
          await tx.membershipRole.findMany({
            where: { membershipId: principal.membershipId },
            select: { role: { select: { key: true } } },
          })
        ).map((r) => r.role.key)
      : [];
    const owner = c.items.some(
      (i) =>
        (i.ownerEmployeeId && i.ownerEmployeeId === me) ||
        (i.ownerRoleKey && roleKeys.includes(i.ownerRoleKey)),
    );
    if (!can(principal, P.SEPARATION_CASE_MANAGE, {}) && c.employeeId !== me && !owner)
      throw AppException.notFound('Separation');
    return { c, me };
  }

  private toCaseItem(c: CaseRow): SeparationCaseItem {
    return {
      id: c.id,
      employee: ref(c.employee),
      separationType: c.separationType,
      reasonCategory: c.reasonCategory,
      lastWorkingDay: isoDate(c.lastWorkingDay),
      status: c.status,
      clearance: {
        total: c.items.length,
        pending: c.items.filter((i) => i.status === 'PENDING').length,
      },
      interviewDone: !!c.interview,
      createdAt: c.createdAt.toISOString(),
    };
  }

  cases(principal: AuthPrincipal, status?: string): Promise<SeparationCaseItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const manage = can(principal, P.SEPARATION_CASE_MANAGE, {});
      const roleKeys = principal.membershipId
        ? (
            await tx.membershipRole.findMany({
              where: { membershipId: principal.membershipId },
              select: { role: { select: { key: true } } },
            })
          ).map((r) => r.role.key)
        : [];
      const rows = await tx.separationCase.findMany({
        where: {
          ...(status ? { status: status as CaseRow['status'] } : {}),
          ...(manage
            ? {}
            : {
                OR: [
                  { employeeId: me ?? '00000000-0000-0000-0000-000000000000' },
                  {
                    items: {
                      some: {
                        OR: [
                          { ownerEmployeeId: me ?? '00000000-0000-0000-0000-000000000000' },
                          { ownerRoleKey: { in: roleKeys } },
                        ],
                      },
                    },
                  },
                ],
              }),
        },
        orderBy: { lastWorkingDay: 'asc' },
        select: caseSelect,
        take: 300,
      });
      return rows.map((r) => this.toCaseItem(r));
    });
  }

  getCase(principal: AuthPrincipal, id: string): Promise<SeparationCaseDetails> {
    return this.prisma.withTenant(async (tx) => {
      await this.syncAutomatic(tx, id);
      return this.caseDetails(tx, principal, id);
    });
  }

  private async caseDetails(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<SeparationCaseDetails> {
    const { c, me } = await this.visibleCase(tx, principal, id);
    const manage = can(principal, P.SEPARATION_CASE_MANAGE, {});
    const names = await userNames(
      tx,
      c.items.map((i) => i.decidedByUserId),
    );
    const owners = await tx.employee.findMany({
      where: { id: { in: c.items.map((i) => i.ownerEmployeeId).filter((x): x is string => !!x) } },
      select: empSelect,
    });
    const items: ClearanceItem[] = [];
    for (const i of c.items) {
      const owner = i.ownerEmployeeId ? owners.find((o) => o.id === i.ownerEmployeeId) : undefined;
      items.push({
        id: i.id,
        title: i.title,
        kind: i.kind,
        owner: owner
          ? ref(owner).displayName
          : i.ownerRoleKey
            ? `role ${i.ownerRoleKey}`
            : i.kind === 'ASSET'
              ? 'Assets team'
              : 'IT / licences',
        status: i.status,
        note: i.note,
        decidedBy: i.decidedByUserId
          ? (names.get(i.decidedByUserId) ?? null)
          : i.status !== 'PENDING'
            ? 'system'
            : null,
        decidedAt: i.decidedAt?.toISOString() ?? null,
        canDecide:
          i.status === 'PENDING' &&
          c.status === 'IN_PROGRESS' &&
          (await this.canClear(tx, principal, i, me)),
      });
    }
    const settlement = manage
      ? await tx.payrollSettlement.findFirst({
          where: { employeeId: c.employeeId },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, netPayable: true },
        })
      : null;
    const letters = await tx.generatedDocument.findMany({
      where: {
        employeeId: c.employeeId,
        category: { in: ['EXPERIENCE_LETTER', 'RELIEVING_LETTER'] },
      },
      select: { id: true, title: true, status: true },
    });
    return {
      ...this.toCaseItem(c),
      note: c.note,
      items,
      settlement: settlement
        ? {
            id: settlement.id,
            status: settlement.status,
            netPayable: settlement.netPayable.toFixed(2),
          }
        : null,
      letters: manage || c.employeeId === me ? letters : [],
      can: {
        complete: manage && c.status === 'IN_PROGRESS' && clearanceComplete(items),
        cancel: manage && c.status === 'IN_PROGRESS',
        interview: c.status === 'IN_PROGRESS' && !c.interview && (c.employeeId === me || manage),
        readInterview: can(principal, P.SEPARATION_INTERVIEW_READ, {}),
      },
    };
  }

  decideItem(
    principal: AuthPrincipal,
    id: string,
    itemId: string,
    input: In<typeof clearanceDecisionSchema>,
  ): Promise<SeparationCaseDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { c, me } = await this.visibleCase(tx, principal, id);
      if (c.status !== 'IN_PROGRESS') throw AppException.conflict('The separation is closed');
      const item = c.items.find((i) => i.id === itemId);
      if (!item) throw AppException.notFound('Clearance item');
      if (item.status !== 'PENDING') throw AppException.conflict('This item is already decided');
      if (!(await this.canClear(tx, principal, item, me)))
        throw AppException.forbidden('This item belongs to someone else');
      if ((item.kind === 'ASSET' || item.kind === 'LICENSE') && input.status === 'CLEARED')
        throw AppException.badRequest(
          'Return the asset or revoke the seat; it clears itself. HR can waive it with a note.',
          'status',
        );
      await tx.clearanceItem.update({
        where: { id: itemId },
        data: {
          status: input.status,
          note: input.note ?? null,
          decidedByUserId: principal.userId,
          decidedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        action: `separation.clearance.${input.status.toLowerCase()}`,
        entityType: 'separation_case',
        entityId: id,
        metadata: { itemId },
      });
      return this.caseDetails(tx, principal, id);
    });
  }

  /** Completes the employee's separation (closes employment, suspends the login) once cleared. */
  async complete(principal: AuthPrincipal, id: string): Promise<SeparationCaseDetails> {
    const c = await this.prisma.withTenant(async (tx) => {
      await this.syncAutomatic(tx, id);
      const x = await tx.separationCase.findFirst({
        where: { id },
        select: { status: true, employeeId: true, items: { select: { status: true } } },
      });
      if (!x) throw AppException.notFound('Separation');
      if (x.status !== 'IN_PROGRESS') throw AppException.conflict('The separation is closed');
      if (!clearanceComplete(x.items))
        throw AppException.conflict('Clear or waive every clearance item first');
      return x;
    });
    await this.employment.completeSeparation(principal, c.employeeId);
    await this.prisma.withTenant(async (tx) => {
      await tx.separationCase.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'separation.case.completed',
        entityType: 'separation_case',
        entityId: id,
      });
    });
    return this.getCase(principal, id);
  }

  /** Cancels the case and withdraws the notice (the employee stays). */
  async cancel(principal: AuthPrincipal, id: string): Promise<SeparationCaseDetails> {
    const c = await this.prisma.withTenant((tx) =>
      tx.separationCase.findFirst({ where: { id }, select: { status: true, employeeId: true } }),
    );
    if (!c) throw AppException.notFound('Separation');
    if (c.status !== 'IN_PROGRESS') throw AppException.conflict('The separation is closed');
    await this.employment.withdrawSeparation(principal, c.employeeId);
    await this.prisma.withTenant(async (tx) => {
      await tx.separationCase.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        action: 'separation.case.cancelled',
        entityType: 'separation_case',
        entityId: id,
      });
    });
    return this.getCase(principal, id);
  }

  // ---------------------------------------------------------------------------- exit interview

  async interviewQuestions(
    principal: AuthPrincipal,
    id: string,
  ): Promise<{ questions: ExitQuestionItem[]; answers: Record<string, unknown> | null }> {
    return this.prisma.withTenant(async (tx) => {
      const { c, me } = await this.visibleCase(tx, principal, id);
      const interview = await tx.exitInterview.findFirst({ where: { caseId: id } });
      if (interview) {
        if (!can(principal, P.SEPARATION_INTERVIEW_READ, {}))
          return { questions: interview.questions as unknown as ExitQuestionItem[], answers: null };
        return {
          questions: interview.questions as unknown as ExitQuestionItem[],
          answers: interview.answers as Record<string, unknown>,
        };
      }
      if (c.employeeId !== me && !can(principal, P.SEPARATION_CASE_MANAGE, {}))
        throw AppException.forbidden();
      const s = await this.settingsIn(tx, principal.organizationId ?? '');
      return { questions: s.exitQuestions as unknown as ExitQuestionItem[], answers: null };
    });
  }

  submitInterview(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof exitAnswersSchema>,
  ): Promise<SeparationCaseDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { c, me } = await this.visibleCase(tx, principal, id);
      const byEmployee = c.employeeId === me;
      if (!byEmployee && !can(principal, P.SEPARATION_CASE_MANAGE, {}))
        throw AppException.forbidden();
      if (c.status !== 'IN_PROGRESS') throw AppException.conflict('The separation is closed');
      const s = await this.settingsIn(tx, principal.organizationId ?? '');
      const questions = s.exitQuestions as unknown as ExitQuestionItem[];
      if (!questions.length)
        throw AppException.conflict('No exit interview questions are configured');
      for (const q of questions) {
        const a = input.answers[q.id];
        if (a === undefined || a === null || a === '') continue;
        if (q.type === 'RATING' && (typeof a !== 'number' || a < 1 || a > 5))
          throw AppException.badRequest(`${q.text}: rate 1 to 5`, 'answers');
        if (q.type === 'CHOICE' && (typeof a !== 'string' || !(q.options ?? []).includes(a)))
          throw AppException.badRequest(`${q.text}: choose an option`, 'answers');
      }
      const answers = Object.fromEntries(questions.map((q) => [q.id, input.answers[q.id] ?? null]));
      try {
        await tx.exitInterview.create({
          data: {
            organizationId: principal.organizationId ?? '',
            caseId: id,
            questions: questions as unknown as Prisma.InputJsonValue,
            answers,
            recordedByUserId: principal.userId,
            byEmployee,
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002')
          throw AppException.conflict('The exit interview is already recorded');
        throw err;
      }
      await this.audit.record(tx, {
        action: 'separation.interview.recorded',
        entityType: 'separation_case',
        entityId: id,
        metadata: { byEmployee },
      });
      return this.caseDetails(tx, principal, id);
    });
  }

  // ---------------------------------------------------------------------------- analytics

  analytics(from: string, to: string): Promise<ExitAnalyticsItem> {
    return this.prisma.withTenant(async (tx) => {
      const left = await tx.employee.findMany({
        where: { status: 'SEPARATED', lastWorkingDate: { gte: toDate(from), lte: toDate(to) } },
        select: {
          id: true,
          lastWorkingDate: true,
          separationType: true,
          separationCases: {
            where: { status: 'COMPLETED' },
            select: { id: true, reasonCategory: true },
          },
        },
      });
      const headcountOn = (day: string) =>
        tx.employee.count({
          where: {
            dateOfJoining: { lte: toDate(day) },
            OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: toDate(day) } }],
          },
        });
      const [opening, closing] = await Promise.all([headcountOn(from), headcountOn(to)]);
      const count = <K extends string>(keys: K[]) => {
        const m = new Map<K, number>();
        for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
        return [...m].map(([key, n]) => ({ key, n }));
      };
      const depts = await tx.employmentRecord.findMany({
        where: { employeeId: { in: left.map((l) => l.id) } },
        orderBy: { effectiveFrom: 'desc' },
        select: { employeeId: true, department: { select: { name: true } } },
      });
      const deptOf = (id: string) =>
        depts.find((d) => d.employeeId === id)?.department?.name ?? 'No department';
      const settings = await tx.separationSettings.findFirst();
      const questions = ((settings?.exitQuestions ?? []) as unknown as ExitQuestionItem[]).filter(
        (q) => q.type === 'RATING',
      );
      const interviews = await tx.exitInterview.findMany({
        where: { case: { employeeId: { in: left.map((l) => l.id) } } },
        select: { answers: true },
      });
      return {
        from,
        to,
        separations: left.length,
        attritionPercent: attritionRate(left.length, opening, closing)?.toString() ?? null,
        byMonth: count(
          left.map((l) => (l.lastWorkingDate ? isoDate(l.lastWorkingDate).slice(0, 7) : 'unknown')),
        )
          .map(({ key, n }) => ({ month: key, count: n }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        byType: count(left.map((l) => l.separationType ?? 'OTHER')).map(({ key, n }) => ({
          type: key,
          count: n,
        })),
        byReason: count(left.map((l) => l.separationCases[0]?.reasonCategory ?? 'OTHER')).map(
          ({ key, n }) => ({ reason: key, count: n }),
        ),
        byDepartment: count(left.map((l) => deptOf(l.id))).map(({ key, n }) => ({
          department: key,
          count: n,
        })),
        ratings: questions.map((q) => {
          const values = interviews
            .map((i) => (i.answers as Record<string, unknown>)[q.id])
            .filter((v): v is number => typeof v === 'number');
          return { questionId: q.id, text: q.text, ...ratingAverage(values, 5) };
        }),
      };
    });
  }
}
