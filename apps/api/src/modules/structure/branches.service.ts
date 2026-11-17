import { Injectable } from '@nestjs/common';
import type { BranchItem, PaginatedResult } from '@hrm/shared-types';
import type { StructureListQuery } from '@hrm/validation';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
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
import { definedOnly, refSelect, toRef } from './structure.util.js';

const META = { label: 'branch', type: 'branch' };
const include = {
  company: { select: refSelect },
  legalEntity: { select: { id: true, code: true, legalName: true } },
  location: { select: refSelect },
  workWeek: { select: { id: true, name: true } },
  holidayCalendar: { select: { id: true, name: true } },
} satisfies Prisma.BranchInclude;
type Row = Prisma.BranchGetPayload<{ include: typeof include }>;

function toItem(r: Row): BranchItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    timezone: r.timezone,
    company: { id: r.company.id, code: r.company.code, name: r.company.name },
    legalEntity: r.legalEntity
      ? { id: r.legalEntity.id, code: r.legalEntity.code, name: r.legalEntity.legalName }
      : null,
    location: toRef(r.location),
    workWeek: r.workWeek,
    holidayCalendar: r.holidayCalendar,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface BranchInput {
  code?: string;
  name?: string;
  legalEntityId?: string | null | undefined;
  locationId?: string | null | undefined;
  timezone?: string | null | undefined;
  workWeekId?: string | null | undefined;
  holidayCalendarId?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

async function assertBranchRefs(
  tx: TenantTransaction,
  companyId: string,
  input: BranchInput,
): Promise<void> {
  await assertRef(tx, 'location', input.locationId, 'locationId');
  await assertRef(tx, 'workWeek', input.workWeekId, 'workWeekId');
  await assertRef(tx, 'holidayCalendar', input.holidayCalendarId, 'holidayCalendarId');
  if (input.legalEntityId) {
    const le = await tx.legalEntity.findFirst({
      where: { id: input.legalEntityId },
      select: { companyId: true },
    });
    if (!le) throw AppException.badRequest('Legal entity not found', 'legalEntityId');
    if (le.companyId !== companyId) {
      throw AppException.badRequest(
        "The legal entity must belong to the branch's company",
        'legalEntityId',
      );
    }
  }
}

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: StructureListQuery): Promise<PaginatedResult<BranchItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.BranchWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...codeNameSearch(query.search),
      };
      const orderBy = sortOf<Prisma.BranchOrderByWithRelationInput>(
        query,
        { ...codeNameSorts, company: (d) => ({ company: { name: d } }) },
        'name',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.branch.findMany({ where, include, orderBy: [orderBy, { id: 'asc' }], ...args }),
        count: () => tx.branch.count({ where }),
        map: toItem,
      });
    });
  }

  get(id: string): Promise<BranchItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.branch.findFirst({ where: { id }, include });
      return row ? toItem(row) : notFound('Branch');
    });
  }

  create(
    principal: AuthPrincipal,
    input: BranchInput & { companyId: string; code: string; name: string },
  ) {
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'company', input.companyId, 'companyId');
      await assertBranchRefs(tx, input.companyId, input);
      const row = await auditedCreate(
        tx,
        this.audit,
        META,
        () =>
          tx.branch.create({
            data: {
              organizationId: principal.organizationId ?? '',
              companyId: input.companyId,
              code: input.code,
              name: input.name,
              legalEntityId: input.legalEntityId ?? null,
              locationId: input.locationId ?? null,
              timezone: input.timezone ?? null,
              workWeekId: input.workWeekId ?? null,
              holidayCalendarId: input.holidayCalendarId ?? null,
            },
            include,
          }),
        (r) => ({ code: r.code, name: r.name, companyId: r.companyId }),
      );
      return toItem(row);
    });
  }

  update(id: string, input: BranchInput): Promise<BranchItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.branch.findFirst({ where: { id } });
      if (before) await assertBranchRefs(tx, before.companyId, input);
      const data = definedOnly(input);
      const row = await auditedUpdate(tx, this.audit, { ...META, id }, before, data, () =>
        tx.branch.update({ where: { id }, data, include }),
      );
      return toItem(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.branch.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...META, id }, existing, () =>
        tx.branch.delete({ where: { id } }),
      );
    });
  }
}
