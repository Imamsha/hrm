import { Injectable } from '@nestjs/common';
import type { CompanyItem, PaginatedResult } from '@hrm/shared-types';
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
import { notFound, pagedList, sortOf } from './structure-base.js';
import { definedOnly } from './structure.util.js';

const META = { label: 'company', type: 'company' };
const include = {
  _count: { select: { legalEntities: true, branches: true, departments: true } },
} satisfies Prisma.CompanyInclude;
type Row = Prisma.CompanyGetPayload<{ include: typeof include }>;

function toItem(r: Row): CompanyItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    countryCode: r.countryCode,
    defaultCurrency: r.defaultCurrency,
    timezone: r.timezone,
    status: r.status,
    counts: {
      legalEntities: r._count.legalEntities,
      branches: r._count.branches,
      departments: r._count.departments,
    },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface CompanyInput {
  code?: string;
  name?: string;
  countryCode?: string;
  defaultCurrency?: string | null | undefined;
  timezone?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: StructureListQuery): Promise<PaginatedResult<CompanyItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.CompanyWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...codeNameSearch(query.search),
      };
      const orderBy = sortOf<Prisma.CompanyOrderByWithRelationInput>(query, codeNameSorts, 'name');
      return pagedList({
        query,
        findMany: (args) =>
          tx.company.findMany({ where, include, orderBy: [orderBy, { id: 'asc' }], ...args }),
        count: () => tx.company.count({ where }),
        map: toItem,
      });
    });
  }

  get(id: string): Promise<CompanyItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.company.findFirst({ where: { id }, include });
      return row ? toItem(row) : notFound('Company');
    });
  }

  create(
    principal: AuthPrincipal,
    input: CompanyInput & { code: string; name: string },
  ): Promise<CompanyItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await auditedCreate(
        tx,
        this.audit,
        META,
        () =>
          tx.company.create({
            data: {
              organizationId: principal.organizationId ?? '',
              code: input.code,
              name: input.name,
              countryCode: input.countryCode ?? 'IN',
              defaultCurrency: input.defaultCurrency ?? null,
              timezone: input.timezone ?? null,
            },
            include,
          }),
        (r) => ({ code: r.code, name: r.name }),
      );
      return toItem(row);
    });
  }

  update(id: string, input: CompanyInput): Promise<CompanyItem> {
    return this.prisma.withTenant(async (tx) => {
      const data = definedOnly(input);
      const before = await tx.company.findFirst({ where: { id } });
      const row = await auditedUpdate(tx, this.audit, { ...META, id }, before, data, () =>
        tx.company.update({ where: { id }, data, include }),
      );
      return toItem(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.company.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...META, id }, existing, () =>
        tx.company.delete({ where: { id } }),
      );
    });
  }
}
