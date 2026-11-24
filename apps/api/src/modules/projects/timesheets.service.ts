import { Injectable } from '@nestjs/common';
import {
  billingRate,
  canMoveTimesheet,
  Decimal,
  totalHours,
  weekStart as weekOf,
} from '@hrm/business-rules';
import { PERMISSIONS, type TimeReportItem, type TimesheetItem } from '@hrm/shared-types';
import type {
  timeReportQuerySchema,
  timesheetDecisionSchema,
  timesheetListQuerySchema,
  timesheetSchema,
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
import { isoDate, toDate } from '../employees/employee-scope.js';
import { managerOf } from '../talent/talent-common.js';
import {
  clientRef,
  clientRefSelect,
  empSelect,
  myEmployeeId,
  ref,
  requireMe,
} from './projects-common.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;

const sheetSelect = {
  id: true,
  employeeId: true,
  weekStart: true,
  status: true,
  submittedAt: true,
  approverEmployeeId: true,
  decisionNote: true,
  employee: { select: empSelect },
  approver: { select: empSelect },
  entries: {
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      date: true,
      hours: true,
      billable: true,
      note: true,
      invoiceLineId: true,
      project: { select: { id: true, key: true, name: true } },
      workItem: { select: { id: true, number: true, title: true } },
    },
  },
} satisfies Prisma.TimesheetSelect;
type SheetRow = Prisma.TimesheetGetPayload<{ select: typeof sheetSelect }>;

/** Weekly timesheets, approval by the reporting manager, and time reports (ADR-017). */
@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toItem(
    s: SheetRow,
    viewer: { me: string | null; principal: AuthPrincipal },
  ): TimesheetItem {
    const own = s.employeeId === viewer.me;
    const hours = totalHours(s.entries.map((e) => ({ hours: e.hours.toString() })));
    const billable = totalHours(
      s.entries.filter((e) => e.billable).map((e) => ({ hours: e.hours.toString() })),
    );
    return {
      id: s.id,
      employee: ref(s.employee),
      weekStart: isoDate(s.weekStart),
      status: s.status,
      totalHours: hours.toString(),
      billableHours: billable.toString(),
      submittedAt: s.submittedAt?.toISOString() ?? null,
      approver: s.approver ? ref(s.approver) : null,
      decisionNote: s.decisionNote,
      entries: s.entries.map((e) => ({
        id: e.id,
        date: isoDate(e.date),
        project: e.project,
        workItem: e.workItem
          ? {
              id: e.workItem.id,
              key: `${e.project.key}-${String(e.workItem.number)}`,
              title: e.workItem.title,
            }
          : null,
        hours: new Decimal(e.hours.toString()).toString(),
        billable: e.billable,
        note: e.note,
        invoiced: e.invoiceLineId !== null,
      })),
      can: {
        edit: own && (s.status === 'DRAFT' || s.status === 'REJECTED'),
        submit: own && (s.status === 'DRAFT' || s.status === 'REJECTED') && s.entries.length > 0,
        decide: !own && s.status === 'SUBMITTED' && this.isApprover(s, viewer),
      },
    };
  }

  private isApprover(
    s: { approverEmployeeId: string | null; employeeId: string },
    v: { me: string | null; principal: AuthPrincipal },
  ): boolean {
    if (s.employeeId === v.me) return false;
    if (s.approverEmployeeId) return s.approverEmployeeId === v.me;
    return can(v.principal, P.PROJECTS_TIMESHEET_APPROVE, {});
  }

  /** The caller's week; an empty draft (id null) when nothing is saved yet. */
  mine(principal: AuthPrincipal, date: string): Promise<TimesheetItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const week = weekOf(date);
      const s = await tx.timesheet.findFirst({
        where: { employeeId: me, weekStart: toDate(week) },
        select: sheetSelect,
      });
      if (s) return this.toItem(s, { me, principal });
      const e = await tx.employee.findFirstOrThrow({ where: { id: me }, select: empSelect });
      return {
        id: null,
        employee: ref(e),
        weekStart: week,
        status: 'DRAFT',
        totalHours: '0',
        billableHours: '0',
        submittedAt: null,
        approver: null,
        decisionNote: null,
        entries: [],
        can: { edit: true, submit: false, decide: false },
      };
    });
  }

  /** Replaces the entries of the caller's draft (or rejected) week. */
  save(principal: AuthPrincipal, input: In<typeof timesheetSchema>): Promise<TimesheetItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const org = principal.organizationId ?? '';
      const week = toDate(input.weekStart);
      let s = await tx.timesheet.findFirst({
        where: { employeeId: me, weekStart: week },
        select: { id: true, status: true },
      });
      if (s && s.status !== 'DRAFT' && s.status !== 'REJECTED')
        throw AppException.conflict('This week is submitted; recall it to make changes');
      const projectIds = [...new Set(input.entries.map((e) => e.projectId))];
      const projects = await tx.project.findMany({
        where: { id: { in: projectIds } },
        select: {
          id: true,
          key: true,
          status: true,
          billingType: true,
          members: { where: { employeeId: me }, select: { role: true } },
        },
      });
      for (const [i, e] of input.entries.entries()) {
        const p = projects.find((x) => x.id === e.projectId);
        const role = p?.members[0]?.role;
        if (!p || !role || role === 'VIEWER')
          throw AppException.badRequest(
            `Entry ${String(i + 1)}: you are not a member of this project`,
            'entries',
          );
        if (p.status === 'COMPLETED' || p.status === 'CANCELLED')
          throw AppException.badRequest(
            `Entry ${String(i + 1)}: ${p.key} is closed for time`,
            'entries',
          );
        if (e.workItemId) {
          const w = await tx.workItem.findFirst({
            where: { id: e.workItemId, projectId: p.id },
            select: { id: true },
          });
          if (!w)
            throw AppException.badRequest(
              `Entry ${String(i + 1)}: the work item is not in ${p.key}`,
              'entries',
            );
        }
      }
      if (!s)
        s = await tx.timesheet.create({
          data: { organizationId: org, employeeId: me, weekStart: week },
          select: { id: true, status: true },
        });
      const sheetId = s.id;
      await tx.timeEntry.deleteMany({ where: { timesheetId: sheetId } });
      if (input.entries.length)
        await tx.timeEntry.createMany({
          data: input.entries.map((e) => {
            const p = projects.find((x) => x.id === e.projectId);
            return {
              organizationId: org,
              timesheetId: sheetId,
              employeeId: me,
              projectId: e.projectId,
              workItemId: e.workItemId ?? null,
              date: toDate(e.date),
              hours: e.hours,
              // Time on non-billable projects is never billable.
              billable: p?.billingType === 'NON_BILLABLE' ? false : e.billable,
              note: e.note ?? null,
            };
          }),
        });
      return this.toItem(
        await tx.timesheet.findFirstOrThrow({ where: { id: sheetId }, select: sheetSelect }),
        { me, principal },
      );
    });
  }

  submit(principal: AuthPrincipal, id: string): Promise<TimesheetItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const s = await tx.timesheet.findFirst({
        where: { id, employeeId: me },
        select: { status: true, _count: { select: { entries: true } } },
      });
      if (!s) throw AppException.notFound('Timesheet');
      if (!canMoveTimesheet(s.status, 'SUBMITTED'))
        throw AppException.conflict('This week is already submitted');
      if (!s._count.entries) throw AppException.badRequest('Add time before submitting');
      const manager = await managerOf(tx, me);
      await tx.timesheet.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          approverEmployeeId: manager && manager !== me ? manager : null,
          decidedAt: null,
          decidedByUserId: null,
          decisionNote: null,
        },
      });
      await this.audit.record(tx, {
        action: 'projects.timesheet.submitted',
        entityType: 'timesheet',
        entityId: id,
      });
      return this.toItem(
        await tx.timesheet.findFirstOrThrow({ where: { id }, select: sheetSelect }),
        { me, principal },
      );
    });
  }

  /** The employee takes a submitted week back to draft before it is decided. */
  recall(principal: AuthPrincipal, id: string): Promise<TimesheetItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const s = await tx.timesheet.findFirst({
        where: { id, employeeId: me },
        select: { status: true },
      });
      if (!s) throw AppException.notFound('Timesheet');
      if (s.status !== 'SUBMITTED')
        throw AppException.conflict('Only a submitted week can be recalled');
      await tx.timesheet.update({
        where: { id },
        data: { status: 'DRAFT', submittedAt: null, approverEmployeeId: null },
      });
      return this.toItem(
        await tx.timesheet.findFirstOrThrow({ where: { id }, select: sheetSelect }),
        { me, principal },
      );
    });
  }

  list(principal: AuthPrincipal, q: In<typeof timesheetListQuerySchema>): Promise<TimesheetItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      let where: Prisma.TimesheetWhereInput;
      if (q.scope === 'all') {
        if (!can(principal, P.PROJECTS_TIMESHEET_READ, {})) throw AppException.forbidden();
        where = {
          ...(q.status ? { status: q.status as never } : {}),
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        };
      } else {
        const approverOr: Prisma.TimesheetWhereInput[] = [];
        if (me) approverOr.push({ approverEmployeeId: me });
        if (can(principal, P.PROJECTS_TIMESHEET_APPROVE, {}))
          approverOr.push({ approverEmployeeId: null });
        if (!approverOr.length) return [];
        where = { status: 'SUBMITTED', OR: approverOr, ...(me ? { employeeId: { not: me } } : {}) };
      }
      if (q.weekStart) where.weekStart = toDate(weekOf(q.weekStart));
      const rows = await tx.timesheet.findMany({
        where,
        orderBy: [{ weekStart: 'desc' }],
        select: sheetSelect,
        take: 300,
      });
      return rows.map((s) => this.toItem(s, { me, principal }));
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<TimesheetItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const s = await tx.timesheet.findFirst({ where: { id }, select: sheetSelect });
      if (!s) throw AppException.notFound('Timesheet');
      const allowed =
        s.employeeId === me ||
        s.approverEmployeeId === me ||
        can(principal, P.PROJECTS_TIMESHEET_READ, {}) ||
        (s.approverEmployeeId === null && can(principal, P.PROJECTS_TIMESHEET_APPROVE, {}));
      if (!allowed) throw AppException.notFound('Timesheet');
      return this.toItem(s, { me, principal });
    });
  }

  decide(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof timesheetDecisionSchema>,
  ): Promise<TimesheetItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const s = await tx.timesheet.findFirst({
        where: { id },
        select: { status: true, employeeId: true, approverEmployeeId: true },
      });
      if (!s) throw AppException.notFound('Timesheet');
      if (s.employeeId === me) throw AppException.forbidden('Nobody approves their own timesheet');
      if (!this.isApprover(s, { me, principal }))
        throw AppException.forbidden('You are not the approver of this timesheet');
      if (!canMoveTimesheet(s.status, input.decision))
        throw AppException.conflict('Only a submitted timesheet can be decided');
      await tx.timesheet.update({
        where: { id },
        data: {
          status: input.decision,
          decidedAt: new Date(),
          decidedByUserId: principal.userId,
          decisionNote: input.note ?? null,
        },
      });
      await this.audit.record(tx, {
        action: `projects.timesheet.${input.decision.toLowerCase()}`,
        entityType: 'timesheet',
        entityId: id,
      });
      return this.toItem(
        await tx.timesheet.findFirstOrThrow({ where: { id }, select: sheetSelect }),
        { me, principal },
      );
    });
  }

  /** Approved time by project and person, with billable value at the applicable rate. */
  report(principal: AuthPrincipal, q: In<typeof timeReportQuerySchema>): Promise<TimeReportItem> {
    if (
      !can(principal, P.PROJECTS_TIMESHEET_READ, {}) &&
      !can(principal, P.PROJECTS_BILLING_MANAGE, {})
    )
      throw AppException.forbidden();
    return this.prisma.withTenant(async (tx) => this.reportIn(tx, q));
  }

  private async reportIn(
    tx: TenantTransaction,
    q: In<typeof timeReportQuerySchema>,
  ): Promise<TimeReportItem> {
    const entries = await tx.timeEntry.findMany({
      where: {
        date: { gte: toDate(q.from), lte: toDate(q.to) },
        timesheet: { status: 'APPROVED' },
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.clientId ? { project: { clientId: q.clientId } } : {}),
      },
      select: {
        hours: true,
        billable: true,
        employeeId: true,
        project: {
          select: {
            id: true,
            key: true,
            name: true,
            hourlyRate: true,
            client: { select: clientRefSelect },
            members: { select: { employeeId: true, billingRate: true } },
          },
        },
      },
    });
    const employees = await tx.employee.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.employeeId))] } },
      select: empSelect,
    });
    const groups = new Map<
      string,
      TimeReportItem['rows'][number] & { amountDec: Decimal | null }
    >();
    for (const e of entries) {
      const k = `${e.project.id}:${e.employeeId}`;
      const emp = employees.find((x) => x.id === e.employeeId);
      if (!emp) continue;
      const g = groups.get(k) ?? {
        project: { id: e.project.id, key: e.project.key, name: e.project.name },
        client: clientRef(e.project.client),
        employee: ref(emp),
        hours: '0',
        billableHours: '0',
        amount: null,
        amountDec: null,
      };
      g.hours = new Decimal(g.hours).plus(e.hours.toString()).toString();
      if (e.billable) {
        g.billableHours = new Decimal(g.billableHours).plus(e.hours.toString()).toString();
        const rate = billingRate(
          e.project.members.find((m) => m.employeeId === e.employeeId)?.billingRate?.toString() ??
            null,
          e.project.hourlyRate?.toString() ?? null,
        );
        if (rate)
          g.amountDec = (g.amountDec ?? new Decimal(0)).plus(rate.times(e.hours.toString()));
      }
      groups.set(k, g);
    }
    const rows = [...groups.values()]
      .map(({ amountDec, ...r }) => ({ ...r, amount: amountDec ? amountDec.toFixed(2) : null }))
      .sort(
        (a, b) =>
          a.project.key.localeCompare(b.project.key) ||
          a.employee.displayName.localeCompare(b.employee.displayName),
      );
    return {
      rows,
      totals: {
        hours: rows.reduce((a, r) => a.plus(r.hours), new Decimal(0)).toString(),
        billableHours: rows.reduce((a, r) => a.plus(r.billableHours), new Decimal(0)).toString(),
      },
    };
  }
}
