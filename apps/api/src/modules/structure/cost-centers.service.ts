import { Injectable } from '@nestjs/common';
import type { CostCenterItem, PaginatedResult } from '@hrm/shared-types';
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
import { definedOnly, refSelect, toRef } from './structure.util.js';

const META = { label: 'cost center', type: 'cost_center' };
const include = { company: { select: refSelect } } satisfies Prisma.CostCenterInclude;
type Row = Prisma.CostCenterGetPayload<{ include: typeof include }>;

function toItem(r: Row): CostCenterItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    company: toRef(r.company),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface CostCenterInput {
  code?: string;
  name?: string;
  companyId?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

@Injectable()
export class CostCentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: StructureListQuery): Promise<PaginatedResult<CostCenterItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.CostCenterWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...codeNameSearch(query.search),
      };
      const orderBy = sortOf<Prisma.CostCenterOrderByWithRelationInput>(
        query,
        codeNameSorts,
        'code',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.costCenter.findMany({ where, include, orderBy: [orderBy, { id: 'asc' }], ...args }),
        count: () => tx.costCenter.count({ where }),
        map: toItem,
      });
    });
  }

  get(id: string): Promise<CostCenterItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.costCenter.findFirst({ where: { id }, include });
      return row ? toItem(row) : notFound('Cost center');
    });
  }

  create(principal: AuthPrincipal, input: CostCenterInput & { code: string; name: string }) {
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'company', input.companyId, 'companyId');
      const row = await auditedCreate(
        tx,
        this.audit,
        META,
        () =>
          tx.costCenter.create({
            data: {
              organizationId: principal.organizationId ?? '',
              code: input.code,
              name: input.name,
              companyId: input.companyId ?? null,
            },
            include,
          }),
        (r) => ({ code: r.code, name: r.name }),
      );
      return toItem(row);
    });
  }

  update(id: string, input: CostCenterInput): Promise<CostCenterItem> {
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'company', input.companyId, 'companyId');
      const data = definedOnly(input);
      const before = await tx.costCenter.findFirst({ where: { id } });
      const row = await auditedUpdate(tx, this.audit, { ...META, id }, before, data, () =>
        tx.costCenter.update({ where: { id }, data, include }),
      );
      return toItem(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.costCenter.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...META, id }, existing, () =>
        tx.costCenter.delete({ where: { id } }),
      );
    });
  }
}
