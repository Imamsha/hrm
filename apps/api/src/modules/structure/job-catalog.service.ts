import { Injectable } from '@nestjs/common';
import type { DesignationItem, JobGradeItem, PaginatedResult } from '@hrm/shared-types';
import type { StructureListQuery } from '@hrm/validation';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import {
  auditedCreate,
  auditedDelete,
  auditedUpdate,
  codeNameSearch,
  codeNameSorts,
} from './audited-writes.js';
import { assertRef, notFound, pagedList, sortOf } from './structure-base.js';
import { definedOnly } from './structure.util.js';

const GRADE = { label: 'job grade', type: 'job_grade', uniqueField: 'code' };
const DESIGNATION = { label: 'designation', type: 'designation' };

const gradeInclude = {
  _count: { select: { designations: true } },
} satisfies Prisma.JobGradeInclude;
type GradeRow = Prisma.JobGradeGetPayload<{ include: typeof gradeInclude }>;

function gradeItem(r: GradeRow): JobGradeItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    rank: r.rank,
    description: r.description,
    designationCount: r._count.designations,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const designationInclude = {
  jobGrade: { select: { id: true, code: true, name: true, rank: true } },
} satisfies Prisma.DesignationInclude;
type DesignationRow = Prisma.DesignationGetPayload<{ include: typeof designationInclude }>;

function designationItem(r: DesignationRow): DesignationItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    jobGrade: r.jobGrade,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface JobGradeInput {
  code?: string;
  name?: string;
  rank?: number;
  description?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

export interface DesignationInput {
  code?: string;
  name?: string;
  description?: string | null | undefined;
  jobGradeId?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

@Injectable()
export class JobCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ job grades

  listGrades(query: StructureListQuery): Promise<PaginatedResult<JobGradeItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.JobGradeWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...codeNameSearch(query.search),
      };
      const orderBy = sortOf<Prisma.JobGradeOrderByWithRelationInput>(
        query,
        { ...codeNameSorts, rank: (d) => ({ rank: d }) },
        'rank',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.jobGrade.findMany({
            where,
            include: gradeInclude,
            orderBy: [orderBy, { id: 'asc' }],
            ...args,
          }),
        count: () => tx.jobGrade.count({ where }),
        map: gradeItem,
      });
    });
  }

  createGrade(
    principal: AuthPrincipal,
    input: JobGradeInput & { code: string; name: string; rank: number },
  ) {
    return this.prisma.withTenant(async (tx) =>
      gradeItem(
        await auditedCreate(
          tx,
          this.audit,
          GRADE,
          () =>
            tx.jobGrade.create({
              data: {
                organizationId: principal.organizationId ?? '',
                code: input.code,
                name: input.name,
                rank: input.rank,
                description: input.description ?? null,
              },
              include: gradeInclude,
            }),
          (r) => ({ code: r.code, rank: r.rank }),
        ),
      ),
    );
  }

  updateGrade(id: string, input: JobGradeInput): Promise<JobGradeItem> {
    return this.prisma.withTenant(async (tx) => {
      const data = definedOnly(input);
      const before = await tx.jobGrade.findFirst({ where: { id } });
      return gradeItem(
        await auditedUpdate(tx, this.audit, { ...GRADE, id }, before, data, () =>
          tx.jobGrade.update({ where: { id }, data, include: gradeInclude }),
        ),
      );
    });
  }

  removeGrade(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.jobGrade.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...GRADE, id }, existing, () =>
        tx.jobGrade.delete({ where: { id } }),
      );
    });
  }

  // ------------------------------------------------------------------ designations

  listDesignations(query: StructureListQuery): Promise<PaginatedResult<DesignationItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.DesignationWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.jobGradeId ? { jobGradeId: query.jobGradeId } : {}),
        ...codeNameSearch(query.search),
      };
      const orderBy = sortOf<Prisma.DesignationOrderByWithRelationInput>(
        query,
        { ...codeNameSorts, grade: (d) => ({ jobGrade: { rank: d } }) },
        'name',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.designation.findMany({
            where,
            include: designationInclude,
            orderBy: [orderBy, { id: 'asc' }],
            ...args,
          }),
        count: () => tx.designation.count({ where }),
        map: designationItem,
      });
    });
  }

  getDesignation(id: string): Promise<DesignationItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.designation.findFirst({ where: { id }, include: designationInclude });
      return row ? designationItem(row) : notFound('Designation');
    });
  }

  createDesignation(
    principal: AuthPrincipal,
    input: DesignationInput & { code: string; name: string },
  ) {
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'jobGrade', input.jobGradeId, 'jobGradeId');
      return designationItem(
        await auditedCreate(
          tx,
          this.audit,
          DESIGNATION,
          () =>
            tx.designation.create({
              data: {
                organizationId: principal.organizationId ?? '',
                code: input.code,
                name: input.name,
                description: input.description ?? null,
                jobGradeId: input.jobGradeId ?? null,
              },
              include: designationInclude,
            }),
          (r) => ({ code: r.code, name: r.name }),
        ),
      );
    });
  }

  updateDesignation(id: string, input: DesignationInput): Promise<DesignationItem> {
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'jobGrade', input.jobGradeId, 'jobGradeId');
      const data = definedOnly(input);
      const before = await tx.designation.findFirst({ where: { id } });
      return designationItem(
        await auditedUpdate(tx, this.audit, { ...DESIGNATION, id }, before, data, () =>
          tx.designation.update({ where: { id }, data, include: designationInclude }),
        ),
      );
    });
  }

  removeDesignation(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.designation.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...DESIGNATION, id }, existing, () =>
        tx.designation.delete({ where: { id } }),
      );
    });
  }
}
