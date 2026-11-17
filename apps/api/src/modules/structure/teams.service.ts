import { Injectable } from '@nestjs/common';
import type { PaginatedResult, TeamItem } from '@hrm/shared-types';
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
import { definedOnly, refSelect } from './structure.util.js';

const META = { label: 'team', type: 'team' };
const include = { department: { select: refSelect } } satisfies Prisma.TeamInclude;
type Row = Prisma.TeamGetPayload<{ include: typeof include }>;

function toItem(r: Row): TeamItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    department: { id: r.department.id, code: r.department.code, name: r.department.name },
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface TeamInput {
  code?: string;
  name?: string;
  departmentId?: string;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: StructureListQuery): Promise<PaginatedResult<TeamItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.TeamWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...codeNameSearch(query.search),
      };
      const orderBy = sortOf<Prisma.TeamOrderByWithRelationInput>(
        query,
        { ...codeNameSorts, department: (d) => ({ department: { name: d } }) },
        'name',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.team.findMany({ where, include, orderBy: [orderBy, { id: 'asc' }], ...args }),
        count: () => tx.team.count({ where }),
        map: toItem,
      });
    });
  }

  get(id: string): Promise<TeamItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.team.findFirst({ where: { id }, include });
      return row ? toItem(row) : notFound('Team');
    });
  }

  create(
    principal: AuthPrincipal,
    input: TeamInput & { departmentId: string; code: string; name: string },
  ) {
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'department', input.departmentId, 'departmentId');
      const row = await auditedCreate(
        tx,
        this.audit,
        META,
        () =>
          tx.team.create({
            data: {
              organizationId: principal.organizationId ?? '',
              departmentId: input.departmentId,
              code: input.code,
              name: input.name,
            },
            include,
          }),
        (r) => ({ code: r.code, name: r.name, departmentId: r.departmentId }),
      );
      return toItem(row);
    });
  }

  update(id: string, input: TeamInput): Promise<TeamItem> {
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'department', input.departmentId, 'departmentId');
      const data = definedOnly(input);
      const before = await tx.team.findFirst({ where: { id } });
      const row = await auditedUpdate(tx, this.audit, { ...META, id }, before, data, () =>
        tx.team.update({ where: { id }, data, include }),
      );
      return toItem(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.team.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...META, id }, existing, () =>
        tx.team.delete({ where: { id } }),
      );
    });
  }
}
