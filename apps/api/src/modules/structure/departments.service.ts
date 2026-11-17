import { Injectable } from '@nestjs/common';
import type { DepartmentItem, PaginatedResult } from '@hrm/shared-types';
import type { StructureListQuery } from '@hrm/validation';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { AccessService } from '../access/access.service.js';
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

const META = { label: 'department', type: 'department' };
const include = {
  company: { select: refSelect },
  parent: { select: refSelect },
  costCenter: { select: refSelect },
  _count: { select: { children: true, teams: true } },
} satisfies Prisma.DepartmentInclude;
type Row = Prisma.DepartmentGetPayload<{ include: typeof include }>;

function toItem(r: Row): DepartmentItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    company: { id: r.company.id, code: r.company.code, name: r.company.name },
    parent: toRef(r.parent),
    costCenter: toRef(r.costCenter),
    counts: { children: r._count.children, teams: r._count.teams },
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface DepartmentInput {
  code?: string;
  name?: string;
  parentId?: string | null | undefined;
  costCenterId?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

/** All descendants of a department (within the current tenant), bounded by the depth limit. */
export async function descendantIds(
  tx: TenantTransaction,
  rootIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  let frontier = rootIds;
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const children = await tx.department.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !result.has(id));
    for (const id of frontier) result.add(id);
  }
  return result;
}

/** Friendly validation of a parent change; the database trigger enforces the same rules. */
async function assertParent(
  tx: TenantTransaction,
  companyId: string,
  parentId: string | null | undefined,
  selfId?: string,
): Promise<void> {
  if (!parentId) return;
  const parent = await tx.department.findFirst({
    where: { id: parentId },
    select: { companyId: true },
  });
  if (!parent) throw AppException.badRequest('Parent department not found', 'parentId');
  if (parent.companyId !== companyId) {
    throw AppException.badRequest(
      'A sub-department must belong to the same company as its parent',
      'parentId',
    );
  }
  if (selfId && (parentId === selfId || (await descendantIds(tx, [selfId])).has(parentId))) {
    throw AppException.badRequest(
      'A department cannot be moved under itself or one of its sub-departments',
      'parentId',
    );
  }
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** Department-scoped grants cache their covered subtree; any tree change must invalidate it. */
  private async afterTreeChange<T>(
    principalOrgId: string | null | undefined,
    result: T,
  ): Promise<T> {
    if (principalOrgId) await this.access.invalidateOrganization(principalOrgId);
    return result;
  }

  list(query: StructureListQuery): Promise<PaginatedResult<DepartmentItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.DepartmentWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...(query.parentId === 'root'
          ? { parentId: null }
          : query.parentId
            ? { parentId: query.parentId }
            : {}),
        ...codeNameSearch(query.search),
      };
      const orderBy = sortOf<Prisma.DepartmentOrderByWithRelationInput>(
        query,
        { ...codeNameSorts, company: (d) => ({ company: { name: d } }) },
        'name',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.department.findMany({ where, include, orderBy: [orderBy, { id: 'asc' }], ...args }),
        count: () => tx.department.count({ where }),
        map: toItem,
      });
    });
  }

  get(id: string): Promise<DepartmentItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.department.findFirst({ where: { id }, include });
      return row ? toItem(row) : notFound('Department');
    });
  }

  async create(
    principal: AuthPrincipal,
    input: DepartmentInput & { companyId: string; code: string; name: string },
  ) {
    const created = await this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'company', input.companyId, 'companyId');
      await assertRef(tx, 'costCenter', input.costCenterId, 'costCenterId');
      await assertParent(tx, input.companyId, input.parentId);
      const row = await auditedCreate(
        tx,
        this.audit,
        META,
        () =>
          tx.department.create({
            data: {
              organizationId: principal.organizationId ?? '',
              companyId: input.companyId,
              code: input.code,
              name: input.name,
              parentId: input.parentId ?? null,
              costCenterId: input.costCenterId ?? null,
            },
            include,
          }),
        (r) => ({ code: r.code, name: r.name, companyId: r.companyId, parentId: r.parentId }),
      );
      return toItem(row);
    });
    return this.afterTreeChange(principal.organizationId, created);
  }

  async update(
    principal: AuthPrincipal,
    id: string,
    input: DepartmentInput,
  ): Promise<DepartmentItem> {
    const updated = await this.prisma.withTenant(async (tx) => {
      const before = await tx.department.findFirst({ where: { id } });
      if (before) await assertParent(tx, before.companyId, input.parentId, id);
      await assertRef(tx, 'costCenter', input.costCenterId, 'costCenterId');
      const data = definedOnly(input);
      const row = await auditedUpdate(tx, this.audit, { ...META, id }, before, data, () =>
        tx.department.update({ where: { id }, data, include }),
      );
      return toItem(row);
    });
    return this.afterTreeChange(principal.organizationId, updated);
  }

  async remove(principal: AuthPrincipal, id: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.department.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...META, id }, existing, () =>
        tx.department.delete({ where: { id } }),
      );
    });
    await this.afterTreeChange(principal.organizationId, undefined);
  }
}
