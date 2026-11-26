import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { dueState, nextOccurrence } from '@hrm/business-rules';
import {
  type ComplianceDashboardItem,
  type ComplianceTaskItem,
  type ExpiryItem,
  type ObligationItem,
  PERMISSIONS,
} from '@hrm/shared-types';
import { DOCUMENT_MAX_BYTES } from '@hrm/validation';
import type {
  completeComplianceTaskSchema,
  obligationSchema,
  updateObligationSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { uuidv7 } from '../../common/ids.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import {
  safeFileName,
  sniffContentType,
  type UploadedFileLike,
} from '../employees/employee-documents.service.js';
import { isoDate, todayIso, toDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { audienceEmployees, empSelect, myEmployeeId, ref } from '../talent/talent-common.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;
const SOON_DAYS = 30;

const taskSelect = {
  id: true,
  dueOn: true,
  status: true,
  completedAt: true,
  completedByUserId: true,
  note: true,
  evidenceName: true,
  evidenceSize: true,
  obligation: {
    select: {
      id: true,
      title: true,
      category: true,
      ownerEmployeeId: true,
      owner: { select: empSelect },
    },
  },
} satisfies Prisma.ComplianceTaskSelect;
type TaskRow = Prisma.ComplianceTaskGetPayload<{ select: typeof taskSelect }>;

/** Compliance calendar, expiry tracker and dashboard (ADR-019). Nothing is pre-loaded. */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------------------- obligations

  obligations(): Promise<ObligationItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.complianceObligation.findMany({
        orderBy: [{ status: 'asc' }, { title: 'asc' }],
        select: {
          id: true,
          title: true,
          category: true,
          description: true,
          firstDueOn: true,
          recurrence: true,
          status: true,
          owner: { select: empSelect },
          tasks: {
            where: { status: 'OPEN' },
            orderBy: { dueOn: 'asc' },
            take: 1,
            select: { dueOn: true },
          },
        },
      });
      return rows.map((o) => ({
        id: o.id,
        title: o.title,
        category: o.category,
        description: o.description,
        owner: ref(o.owner),
        firstDueOn: isoDate(o.firstDueOn),
        recurrence: o.recurrence,
        status: o.status,
        nextDueOn: o.tasks[0] ? isoDate(o.tasks[0].dueOn) : null,
      }));
    });
  }

  createObligation(
    principal: AuthPrincipal,
    input: In<typeof obligationSchema>,
  ): Promise<ObligationItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const owner = await tx.employee.findFirst({
          where: { id: input.ownerEmployeeId, status: { not: 'SEPARATED' } },
          select: { id: true },
        });
        if (!owner)
          throw AppException.badRequest('The owner does not exist or has left', 'ownerEmployeeId');
        const org = principal.organizationId ?? '';
        const o = await tx.complianceObligation.create({
          data: {
            organizationId: org,
            title: input.title,
            category: input.category,
            description: input.description ?? null,
            ownerEmployeeId: input.ownerEmployeeId,
            firstDueOn: toDate(input.firstDueOn),
            recurrence: input.recurrence,
          },
          select: { id: true },
        });
        await tx.complianceTask.create({
          data: { organizationId: org, obligationId: o.id, dueOn: toDate(input.firstDueOn) },
        });
        await this.audit.record(tx, {
          action: 'compliance.obligation.created',
          entityType: 'compliance_obligation',
          entityId: o.id,
          metadata: { recurrence: input.recurrence },
        });
      })
      .then(() => this.obligations());
  }

  updateObligation(
    id: string,
    input: In<typeof updateObligationSchema>,
  ): Promise<ObligationItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const o = await tx.complianceObligation.findFirst({ where: { id }, select: { id: true } });
        if (!o) throw AppException.notFound('Obligation');
        await tx.complianceObligation.update({
          where: { id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.ownerEmployeeId !== undefined
              ? { ownerEmployeeId: input.ownerEmployeeId }
              : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        });
        await this.audit.record(tx, {
          action: 'compliance.obligation.updated',
          entityType: 'compliance_obligation',
          entityId: id,
        });
      })
      .then(() => this.obligations());
  }

  // ---------------------------------------------------------------------------- tasks

  private toTask(
    t: TaskRow,
    names: Map<string, string>,
    principal: AuthPrincipal,
    me: string | null,
    today: string,
  ): ComplianceTaskItem {
    const due = isoDate(t.dueOn);
    return {
      id: t.id,
      obligation: {
        id: t.obligation.id,
        title: t.obligation.title,
        category: t.obligation.category,
      },
      owner: ref(t.obligation.owner),
      dueOn: due,
      status: t.status,
      state: t.status === 'COMPLETED' ? 'DONE' : dueState(due, today, SOON_DAYS),
      completedAt: t.completedAt?.toISOString() ?? null,
      completedBy: t.completedByUserId ? (names.get(t.completedByUserId) ?? null) : null,
      note: t.note,
      evidence: t.evidenceName ? { fileName: t.evidenceName, size: t.evidenceSize ?? 0 } : null,
      canComplete:
        t.status === 'OPEN' &&
        (t.obligation.ownerEmployeeId === me || can(principal, P.COMPLIANCE_CALENDAR_MANAGE, {})),
    };
  }

  /** The caller's tasks, or all tasks for calendar managers. */
  tasks(
    principal: AuthPrincipal,
    scope: 'mine' | 'all',
    status?: 'OPEN' | 'COMPLETED',
  ): Promise<ComplianceTaskItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      if (
        scope === 'all' &&
        !can(principal, P.COMPLIANCE_CALENDAR_MANAGE, {}) &&
        !can(principal, P.COMPLIANCE_DASHBOARD_READ, {})
      )
        throw AppException.forbidden();
      const rows = await tx.complianceTask.findMany({
        where: {
          ...(scope === 'mine'
            ? { obligation: { ownerEmployeeId: me ?? '00000000-0000-0000-0000-000000000000' } }
            : {}),
          ...(status ? { status } : {}),
        },
        orderBy: [{ status: 'asc' }, { dueOn: 'asc' }],
        select: taskSelect,
        take: 500,
      });
      const names = await userNames(
        tx,
        rows.map((r) => r.completedByUserId),
      );
      const today = todayIso();
      return rows.map((r) => this.toTask(r, names, principal, me, today));
    });
  }

  /** Completes a task (owner or calendar manager); a recurring obligation gets its next task. */
  async complete(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof completeComplianceTaskSchema>,
    file: UploadedFileLike | undefined,
  ): Promise<ComplianceTaskItem[]> {
    let evidence: { key: string; name: string; size: number; sha256: string } | null = null;
    if (file?.buffer.length) {
      if (file.size > DOCUMENT_MAX_BYTES)
        throw AppException.badRequest('The file is too large', 'file');
      const type = sniffContentType(file.buffer);
      if (!type) throw AppException.badRequest('Evidence must be a PDF or an image', 'file');
      const key = StorageService.tenantKey(principal.organizationId ?? '', 'compliance', uuidv7());
      await this.storage.client.send(
        new PutObjectCommand({
          Bucket: this.storage.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: type,
          ContentLength: file.size,
        }),
      );
      evidence = {
        key,
        name: safeFileName(file.originalname),
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      };
    }
    await this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const t = await tx.complianceTask.findFirst({
        where: { id },
        select: {
          status: true,
          dueOn: true,
          obligationId: true,
          obligation: {
            select: {
              ownerEmployeeId: true,
              firstDueOn: true,
              recurrence: true,
              status: true,
              organizationId: true,
            },
          },
        },
      });
      if (!t) throw AppException.notFound('Compliance task');
      if (t.status !== 'OPEN') throw AppException.conflict('The task is already completed');
      if (t.obligation.ownerEmployeeId !== me && !can(principal, P.COMPLIANCE_CALENDAR_MANAGE, {}))
        throw AppException.forbidden('Only the owner completes this task');
      await tx.complianceTask.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedByUserId: principal.userId,
          note: input.note,
          ...(evidence
            ? {
                evidenceKey: evidence.key,
                evidenceName: evidence.name,
                evidenceSize: evidence.size,
              }
            : {}),
        },
      });
      const next =
        t.obligation.status === 'ACTIVE'
          ? nextOccurrence(
              isoDate(t.obligation.firstDueOn),
              isoDate(t.dueOn),
              t.obligation.recurrence,
            )
          : null;
      if (next)
        await tx.complianceTask.upsert({
          where: { obligationId_dueOn: { obligationId: t.obligationId, dueOn: toDate(next) } },
          create: {
            organizationId: t.obligation.organizationId,
            obligationId: t.obligationId,
            dueOn: toDate(next),
          },
          update: {},
        });
      await this.audit.record(tx, {
        action: 'compliance.task.completed',
        entityType: 'compliance_task',
        entityId: id,
        metadata: { next, evidenceSha256: evidence?.sha256 ?? null },
      });
    });
    return this.tasks(principal, can(principal, P.COMPLIANCE_CALENDAR_MANAGE, {}) ? 'all' : 'mine');
  }

  async openEvidence(
    principal: AuthPrincipal,
    id: string,
  ): Promise<{ stream: Readable; fileName: string; size: number }> {
    const t = await this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const x = await tx.complianceTask.findFirst({
        where: { id },
        select: {
          evidenceKey: true,
          evidenceName: true,
          evidenceSize: true,
          obligation: { select: { ownerEmployeeId: true } },
        },
      });
      if (!x?.evidenceKey) throw AppException.notFound('Evidence');
      if (
        x.obligation.ownerEmployeeId !== me &&
        !can(principal, P.COMPLIANCE_CALENDAR_MANAGE, {}) &&
        !can(principal, P.COMPLIANCE_DASHBOARD_READ, {})
      )
        throw AppException.notFound('Evidence');
      return x;
    });
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: t.evidenceKey ?? '' }),
    );
    if (!obj.Body) throw AppException.notFound('Evidence');
    return {
      stream: obj.Body as Readable,
      fileName: t.evidenceName ?? 'evidence',
      size: t.evidenceSize ?? 0,
    };
  }

  // ---------------------------------------------------------------------------- expiry & dashboard

  private async expiringIn(tx: TenantTransaction, days: number): Promise<ExpiryItem[]> {
    const today = todayIso();
    const until = new Date(`${today}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + days);
    const state = (d: string): ExpiryItem['state'] => (d < today ? 'OVERDUE' : 'DUE_SOON');
    const out: ExpiryItem[] = [];
    const certs = await tx.employeeCertification.findMany({
      where: { expiresOn: { lte: until }, employee: { status: { not: 'SEPARATED' } } },
      select: { name: true, expiresOn: true, employee: { select: { ...empSelect } } },
    });
    for (const c of certs)
      if (c.expiresOn)
        out.push({
          kind: 'CERTIFICATION',
          title: c.name,
          subject: ref(c.employee).displayName,
          date: isoDate(c.expiresOn),
          state: state(isoDate(c.expiresOn)),
          link: `/people/employees/${c.employee.id}`,
        });
    const licences = await tx.softwareLicense.findMany({
      where: { expiresOn: { lte: until } },
      select: { id: true, name: true, expiresOn: true },
    });
    for (const l of licences)
      if (l.expiresOn)
        out.push({
          kind: 'LICENCE',
          title: l.name,
          subject: 'Software licence',
          date: isoDate(l.expiresOn),
          state: state(isoDate(l.expiresOn)),
          link: '/assets/licenses',
        });
    const contracts = await tx.employmentRecord.findMany({
      where: {
        employmentType: { in: ['CONTRACT', 'CONSULTANT', 'INTERN'] },
        effectiveTo: { not: null, lte: until, gte: new Date(`${today}T00:00:00Z`) },
        employee: { status: { not: 'SEPARATED' } },
      },
      select: { effectiveTo: true, employmentType: true, employee: { select: empSelect } },
    });
    for (const c of contracts)
      if (c.effectiveTo)
        out.push({
          kind: 'CONTRACT',
          title: `${c.employmentType.toLowerCase()} engagement ends`,
          subject: ref(c.employee).displayName,
          date: isoDate(c.effectiveTo),
          state: 'DUE_SOON',
          link: `/people/employees/${c.employee.id}`,
        });
    const tasks = await tx.complianceTask.findMany({
      where: { status: 'OPEN', dueOn: { lte: until } },
      select: {
        dueOn: true,
        obligation: { select: { title: true, owner: { select: empSelect } } },
      },
    });
    for (const t of tasks)
      out.push({
        kind: 'COMPLIANCE_TASK',
        title: t.obligation.title,
        subject: ref(t.obligation.owner).displayName,
        date: isoDate(t.dueOn),
        state: state(isoDate(t.dueOn)),
        link: '/compliance',
      });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  expiring(days: number): Promise<ExpiryItem[]> {
    return this.prisma.withTenant((tx) => this.expiringIn(tx, days));
  }

  dashboard(principal: AuthPrincipal): Promise<ComplianceDashboardItem> {
    return this.prisma.withTenant(async (tx) => {
      const today = todayIso();
      const soon = new Date(`${today}T00:00:00Z`);
      soon.setUTCDate(soon.getUTCDate() + SOON_DAYS);
      const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      const [overdue, dueSoon, completedThisMonth] = await Promise.all([
        tx.complianceTask.count({ where: { status: 'OPEN', dueOn: { lt: toDate(today) } } }),
        tx.complianceTask.count({
          where: { status: 'OPEN', dueOn: { gte: toDate(today), lte: soon } },
        }),
        tx.complianceTask.count({
          where: { status: 'COMPLETED', completedAt: { gte: monthStart } },
        }),
      ]);
      const docs = await tx.libraryDocument.findMany({
        where: { status: 'PUBLISHED', requiresAcknowledgement: true },
        select: {
          id: true,
          title: true,
          currentVersion: true,
          audienceCompanyId: true,
          audienceDepartmentId: true,
        },
      });
      const acknowledgements = [];
      for (const d of docs) {
        const people = await audienceEmployees(tx, {
          companyId: d.audienceCompanyId,
          departmentId: d.audienceDepartmentId,
        });
        acknowledgements.push({
          documentId: d.id,
          title: d.title,
          version: d.currentVersion,
          audience: people.length,
          acknowledged: await tx.libraryAcknowledgement.count({
            where: {
              documentId: d.id,
              version: d.currentVersion,
              employeeId: { in: people.map((p) => p.id) },
            },
          }),
        });
      }
      let recentAudit: ComplianceDashboardItem['recentAudit'] = null;
      if (can(principal, P.AUDIT_LOG_READ, {})) {
        const rows = await tx.auditLog.findMany({
          orderBy: { occurredAt: 'desc' },
          take: 15,
          select: { action: true, entityType: true, actorId: true, occurredAt: true },
        });
        const names = await userNames(
          tx,
          rows.map((r) => r.actorId),
        );
        recentAudit = rows.map((r) => ({
          action: r.action,
          entityType: r.entityType,
          actor: r.actorId ? (names.get(r.actorId) ?? null) : null,
          at: r.occurredAt.toISOString(),
        }));
      }
      return {
        tasks: { overdue, dueSoon, completedThisMonth },
        expiring: await this.expiringIn(tx, SOON_DAYS),
        acknowledgements,
        recentAudit,
      };
    });
  }
}
