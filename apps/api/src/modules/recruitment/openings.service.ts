import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { openingSlug } from '@hrm/business-rules';
import type {
  OpeningItem,
  PaginatedResult,
  PublicCareers,
  PublicOpening,
  RequisitionItem,
} from '@hrm/shared-types';
import type {
  createOpeningSchema,
  createRequisitionSchema,
  recruitmentListQuerySchema,
  requisitionDecisionSchema,
  updateOpeningSchema,
  updateRequisitionSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import { toDate, todayIso } from '../employees/employee-scope.js';
import { definedOnly, mapWriteError } from '../structure/structure.util.js';
import {
  money,
  openingSelect,
  pipelineCounts,
  requisitionSelect,
  toOpening,
  toRequisition,
  userNames,
} from './recruitment-mappers.js';

type ListQuery = z.output<typeof recruitmentListQuerySchema>;

/** Validates that optional structure references exist, are active and belong to the company. */
async function assertStructure(
  tx: TenantTransaction,
  v: {
    companyId?: string;
    departmentId?: string | null;
    branchId?: string | null;
    designationId?: string | null;
  },
) {
  if (v.companyId) {
    const c = await tx.company.findFirst({ where: { id: v.companyId }, select: { status: true } });
    if (!c || c.status !== 'ACTIVE')
      throw AppException.badRequest('Company not found or inactive', 'companyId');
  }
  if (v.departmentId) {
    const d = await tx.department.findFirst({
      where: { id: v.departmentId },
      select: { companyId: true },
    });
    if (!d) throw AppException.badRequest('Department not found', 'departmentId');
    if (v.companyId && d.companyId !== v.companyId)
      throw AppException.badRequest('The department belongs to another company', 'departmentId');
  }
  if (v.branchId) {
    const b = await tx.branch.findFirst({ where: { id: v.branchId }, select: { companyId: true } });
    if (!b) throw AppException.badRequest('Branch not found', 'branchId');
    if (v.companyId && b.companyId !== v.companyId)
      throw AppException.badRequest('The branch belongs to another company', 'branchId');
  }
  if (
    v.designationId &&
    !(await tx.designation.findFirst({ where: { id: v.designationId }, select: { id: true } }))
  )
    throw AppException.badRequest('Designation not found', 'designationId');
}

@Injectable()
export class OpeningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ requisitions

  listRequisitions(q: ListQuery): Promise<PaginatedResult<RequisitionItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.JobRequisitionWhereInput = {
        ...(q.status ? { status: q.status as 'DRAFT' } : {}),
        ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.jobRequisition.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: requisitionSelect,
          ...skipTake(q),
        }),
        tx.jobRequisition.count({ where }),
      ]);
      const names = await userNames(
        tx,
        rows.flatMap((r) => [r.requestedByUserId, r.decidedByUserId]),
      );
      return paginate(
        rows.map((r) => toRequisition(r, names)),
        total,
        q,
      );
    });
  }

  getRequisition(id: string): Promise<RequisitionItem> {
    return this.prisma.withTenant((tx) => this.requisition(tx, id));
  }

  private async requisition(tx: TenantTransaction, id: string): Promise<RequisitionItem> {
    const r = await tx.jobRequisition.findFirst({ where: { id }, select: requisitionSelect });
    if (!r) throw AppException.notFound('Requisition');
    return toRequisition(r, await userNames(tx, [r.requestedByUserId, r.decidedByUserId]));
  }

  createRequisition(
    principal: AuthPrincipal,
    input: z.output<typeof createRequisitionSchema>,
  ): Promise<RequisitionItem> {
    return this.prisma.withTenant(async (tx) => {
      await assertStructure(tx, input);
      const row = await tx.jobRequisition.create({
        data: {
          organizationId: principal.organizationId ?? '',
          title: input.title,
          companyId: input.companyId,
          departmentId: input.departmentId ?? null,
          branchId: input.branchId ?? null,
          designationId: input.designationId ?? null,
          employmentType: input.employmentType,
          headcount: input.headcount,
          targetDate: input.targetDate ? toDate(input.targetDate) : null,
          justification: input.justification ?? null,
          budgetMin: input.budgetMin,
          budgetMax: input.budgetMax,
          currency: input.currency,
          requestedByUserId: principal.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'requisition.created',
        entityType: 'job_requisition',
        entityId: row.id,
        metadata: { title: input.title },
      });
      return this.requisition(tx, row.id);
    });
  }

  updateRequisition(
    id: string,
    input: z.output<typeof updateRequisitionSchema>,
  ): Promise<RequisitionItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.jobRequisition.findFirst({ where: { id } });
      if (!before) throw AppException.notFound('Requisition');
      if (before.status !== 'DRAFT' && before.status !== 'REJECTED')
        throw AppException.conflict('Only draft or rejected requisitions can be edited');
      await assertStructure(tx, { ...input, companyId: input.companyId ?? before.companyId });
      const data = definedOnly({
        ...input,
        targetDate:
          input.targetDate === undefined
            ? undefined
            : input.targetDate
              ? toDate(input.targetDate)
              : null,
      });
      const min = input.budgetMin === undefined ? before.budgetMin?.toString() : input.budgetMin;
      const max = input.budgetMax === undefined ? before.budgetMax?.toString() : input.budgetMax;
      if (min && max && Number(max) < Number(min))
        throw AppException.badRequest('The maximum cannot be below the minimum', 'budgetMax');
      await tx.jobRequisition.update({ where: { id }, data: { ...data, status: 'DRAFT' } });
      await this.audit.record(tx, {
        action: 'requisition.updated',
        entityType: 'job_requisition',
        entityId: id,
        changes: diffChanges(before, data),
      });
      return this.requisition(tx, id);
    });
  }

  /** Requester submits a draft for approval. */
  submitRequisition(id: string): Promise<RequisitionItem> {
    return this.transition(id, ['DRAFT', 'REJECTED'], 'SUBMITTED', 'requisition.submitted');
  }

  cancelRequisition(id: string): Promise<RequisitionItem> {
    return this.transition(
      id,
      ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'],
      'CANCELLED',
      'requisition.cancelled',
    );
  }

  decideRequisition(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof requisitionDecisionSchema>,
  ): Promise<RequisitionItem> {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.jobRequisition.findFirst({
        where: { id },
        select: { status: true, requestedByUserId: true },
      });
      if (!r) throw AppException.notFound('Requisition');
      if (r.status !== 'SUBMITTED')
        throw AppException.conflict('Only submitted requisitions can be decided');
      if (r.requestedByUserId === principal.userId)
        throw AppException.forbidden('You cannot approve your own requisition');
      await tx.jobRequisition.update({
        where: { id },
        data: {
          status: input.decision,
          decidedByUserId: principal.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
      });
      await this.audit.record(tx, {
        action: input.decision === 'APPROVED' ? 'requisition.approved' : 'requisition.rejected',
        entityType: 'job_requisition',
        entityId: id,
        metadata: { note: input.note ?? null },
      });
      return this.requisition(tx, id);
    });
  }

  private transition(id: string, from: string[], to: 'SUBMITTED' | 'CANCELLED', action: string) {
    return this.prisma.withTenant(async (tx) => {
      const r = await tx.jobRequisition.findFirst({ where: { id }, select: { status: true } });
      if (!r) throw AppException.notFound('Requisition');
      if (!from.includes(r.status))
        throw AppException.conflict(
          `A ${r.status.toLowerCase()} requisition cannot be ${to.toLowerCase()}`,
        );
      await tx.jobRequisition.update({ where: { id }, data: { status: to } });
      await this.audit.record(tx, { action, entityType: 'job_requisition', entityId: id });
      return this.requisition(tx, id);
    });
  }

  // ------------------------------------------------------------------ openings

  listOpenings(q: ListQuery): Promise<PaginatedResult<OpeningItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.JobOpeningWhereInput = {
        ...(q.status ? { status: q.status as 'DRAFT' } : {}),
        ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.jobOpening.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: openingSelect,
          ...skipTake(q),
        }),
        tx.jobOpening.count({ where }),
      ]);
      const counts = await pipelineCounts(
        tx,
        rows.map((r) => r.id),
      );
      return paginate(
        rows.map((r) => toOpening(r, counts.get(r.id) as never)),
        total,
        q,
      );
    });
  }

  getOpening(id: string): Promise<OpeningItem> {
    return this.prisma.withTenant((tx) => this.opening(tx, id));
  }

  async opening(tx: TenantTransaction, id: string): Promise<OpeningItem> {
    const o = await tx.jobOpening.findFirst({ where: { id }, select: openingSelect });
    if (!o) throw AppException.notFound('Job opening');
    return toOpening(o, (await pipelineCounts(tx, [o.id])).get(o.id) as never);
  }

  createOpening(
    principal: AuthPrincipal,
    input: z.output<typeof createOpeningSchema>,
  ): Promise<OpeningItem> {
    return this.prisma.withTenant(async (tx) => {
      await assertStructure(tx, input);
      if (input.requisitionId) {
        const r = await tx.jobRequisition.findFirst({
          where: { id: input.requisitionId },
          select: { status: true },
        });
        if (!r) throw AppException.badRequest('Requisition not found', 'requisitionId');
        if (r.status !== 'APPROVED')
          throw AppException.badRequest(
            'Only approved requisitions can be opened',
            'requisitionId',
          );
      }
      if (
        input.hiringManagerId &&
        !(await tx.employee.findFirst({
          where: { id: input.hiringManagerId, status: { not: 'SEPARATED' } },
        }))
      )
        throw AppException.badRequest('Hiring manager not found', 'hiringManagerId');
      const row = await tx.jobOpening
        .create({
          data: {
            organizationId: principal.organizationId ?? '',
            title: input.title,
            slug: openingSlug(input.title, randomBytes(3).toString('hex')),
            requisitionId: input.requisitionId ?? null,
            companyId: input.companyId,
            departmentId: input.departmentId ?? null,
            branchId: input.branchId ?? null,
            location: input.location ?? null,
            employmentType: input.employmentType,
            description: input.description,
            requirements: input.requirements ?? null,
            experienceMinYears: input.experienceMinYears ?? null,
            experienceMaxYears: input.experienceMaxYears ?? null,
            salaryMin: input.salaryMin,
            salaryMax: input.salaryMax,
            currency: input.currency,
            showSalary: input.showSalary,
            positions: input.positions,
            hiringManagerId: input.hiringManagerId ?? null,
            closesOn: input.closesOn ? toDate(input.closesOn) : null,
          },
          select: { id: true },
        })
        .catch((err: unknown) => mapWriteError(err, { entity: 'job opening' }));
      await this.audit.record(tx, {
        action: 'opening.created',
        entityType: 'job_opening',
        entityId: row.id,
        metadata: { title: input.title },
      });
      return this.opening(tx, row.id);
    });
  }

  updateOpening(id: string, input: z.output<typeof updateOpeningSchema>): Promise<OpeningItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.jobOpening.findFirst({ where: { id } });
      if (!before) throw AppException.notFound('Job opening');
      if (before.status === 'CLOSED')
        throw AppException.conflict('Reopen the opening before editing it');
      await assertStructure(tx, { ...input, companyId: input.companyId ?? before.companyId });
      const data = definedOnly({
        ...input,
        closesOn:
          input.closesOn === undefined ? undefined : input.closesOn ? toDate(input.closesOn) : null,
      });
      await tx.jobOpening
        .update({ where: { id }, data })
        .catch((err: unknown) => mapWriteError(err, { entity: 'job opening' }));
      await this.audit.record(tx, {
        action: 'opening.updated',
        entityType: 'job_opening',
        entityId: id,
        metadata: { fields: Object.keys(data) },
      });
      return this.opening(tx, id);
    });
  }

  setOpeningStatus(
    id: string,
    status: 'DRAFT' | 'PUBLISHED' | 'ON_HOLD' | 'CLOSED',
  ): Promise<OpeningItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.jobOpening.findFirst({
        where: { id },
        select: { status: true, publishedAt: true },
      });
      if (!before) throw AppException.notFound('Job opening');
      await tx.jobOpening.update({
        where: { id },
        data: {
          status,
          ...(status === 'PUBLISHED' && !before.publishedAt ? { publishedAt: new Date() } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'opening.status_changed',
        entityType: 'job_opening',
        entityId: id,
        changes: { status: { from: before.status, to: status } },
      });
      return this.opening(tx, id);
    });
  }

  // ------------------------------------------------------------------ public career portal

  /** Published, not-expired openings of an organization (public, no internal fields). */
  async careers(organizationSlug: string): Promise<PublicCareers> {
    const organizationId = await this.portalTenant(organizationSlug);
    return this.prisma.withTenant(
      async (tx) => {
        const org = await tx.organization.findFirst({ select: { name: true, slug: true } });
        const rows = await tx.jobOpening.findMany({
          where: publicWhere(),
          orderBy: { publishedAt: 'desc' },
          select: openingSelect,
          take: 200,
        });
        return {
          organization: { name: org?.name ?? '', slug: org?.slug ?? organizationSlug },
          openings: rows.map(toPublic),
        };
      },
      { organizationId },
    );
  }

  async publicOpening(
    organizationSlug: string,
    slug: string,
  ): Promise<PublicOpening & { id: string }> {
    const organizationId = await this.portalTenant(organizationSlug);
    return this.prisma.withTenant(
      async (tx) => {
        const o = await tx.jobOpening.findFirst({
          where: { ...publicWhere(), slug },
          select: openingSelect,
        });
        if (!o) throw AppException.notFound('Job opening');
        return { ...toPublic(o), id: o.id };
      },
      { organizationId },
    );
  }

  async portalTenant(slug: string): Promise<string> {
    if (!/^[a-z0-9-]{1,63}$/.test(slug)) throw AppException.notFound('Organization');
    const rows = await this.prisma.$queryRaw<
      { id: string | null }[]
    >`SELECT app.career_portal_tenant(${slug})::text AS id`;
    const id = rows[0]?.id;
    if (!id) throw AppException.notFound('Organization');
    return id;
  }
}

function publicWhere(): Prisma.JobOpeningWhereInput {
  return {
    status: 'PUBLISHED',
    OR: [{ closesOn: null }, { closesOn: { gte: toDate(todayIso()) } }],
  };
}

function toPublic(o: Prisma.JobOpeningGetPayload<{ select: typeof openingSelect }>): PublicOpening {
  return {
    slug: o.slug,
    title: o.title,
    company: o.company.name,
    location: o.location ?? o.branch?.name ?? null,
    employmentType: o.employmentType,
    description: o.description,
    requirements: o.requirements,
    experienceMinYears: o.experienceMinYears,
    experienceMaxYears: o.experienceMaxYears,
    salary: o.showSalary ? money(o.salaryMin, o.salaryMax, o.currency) : null,
    publishedAt: (o.publishedAt ?? o.createdAt).toISOString(),
    closesOn: o.closesOn ? o.closesOn.toISOString().slice(0, 10) : null,
  };
}
