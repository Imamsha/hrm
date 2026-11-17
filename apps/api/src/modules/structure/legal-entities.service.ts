import { Injectable } from '@nestjs/common';
import type { LegalEntityItem, PaginatedResult } from '@hrm/shared-types';
import type { StructureListQuery } from '@hrm/validation';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedCreate, auditedDelete, auditedUpdate } from './audited-writes.js';
import { assertRef, notFound, pagedList, sortOf } from './structure-base.js';
import { definedOnly, refSelect, toRef } from './structure.util.js';

const META = { label: 'legal entity', type: 'legal_entity' };
const include = {
  company: { select: refSelect },
  registeredLocation: { select: refSelect },
} satisfies Prisma.LegalEntityInclude;
type Row = Prisma.LegalEntityGetPayload<{ include: typeof include }>;

function toItem(r: Row): LegalEntityItem {
  return {
    id: r.id,
    code: r.code,
    legalName: r.legalName,
    countryCode: r.countryCode,
    company: { id: r.company.id, code: r.company.code, name: r.company.name },
    pan: r.pan,
    tan: r.tan,
    gstin: r.gstin,
    cin: r.cin,
    registrationNumber: r.registrationNumber,
    registeredLocation: toRef(r.registeredLocation),
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface LegalEntityInput {
  code?: string;
  legalName?: string;
  countryCode?: string;
  pan?: string | null | undefined;
  tan?: string | null | undefined;
  gstin?: string | null | undefined;
  cin?: string | null | undefined;
  registrationNumber?: string | null | undefined;
  registeredLocationId?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

/** Indian identifiers apply only to Indian entities. */
function assertIdentifiersMatchCountry(country: string, input: LegalEntityInput): void {
  if (country !== 'IN' && (input.pan || input.tan || input.gstin || input.cin)) {
    throw AppException.badRequest(
      'PAN, TAN, GSTIN and CIN apply only to entities in India',
      'countryCode',
    );
  }
}

@Injectable()
export class LegalEntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: StructureListQuery): Promise<PaginatedResult<LegalEntityItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.LegalEntityWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.companyId ? { companyId: query.companyId } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { legalName: { contains: query.search, mode: 'insensitive' } },
                { pan: { contains: query.search.toUpperCase() } },
                { gstin: { contains: query.search.toUpperCase() } },
              ],
            }
          : {}),
      };
      const orderBy = sortOf<Prisma.LegalEntityOrderByWithRelationInput>(
        query,
        {
          code: (d) => ({ code: d }),
          legalName: (d) => ({ legalName: d }),
          name: (d) => ({ legalName: d }),
          status: (d) => ({ status: d }),
          createdAt: (d) => ({ createdAt: d }),
        },
        'legalName',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.legalEntity.findMany({ where, include, orderBy: [orderBy, { id: 'asc' }], ...args }),
        count: () => tx.legalEntity.count({ where }),
        map: toItem,
      });
    });
  }

  get(id: string): Promise<LegalEntityItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.legalEntity.findFirst({ where: { id }, include });
      return row ? toItem(row) : notFound('Legal entity');
    });
  }

  create(
    principal: AuthPrincipal,
    input: LegalEntityInput & { companyId: string; code: string; legalName: string },
  ): Promise<LegalEntityItem> {
    assertIdentifiersMatchCountry(input.countryCode ?? 'IN', input);
    return this.prisma.withTenant(async (tx) => {
      await assertRef(tx, 'company', input.companyId, 'companyId');
      await assertRef(tx, 'location', input.registeredLocationId, 'registeredLocationId');
      const row = await auditedCreate(
        tx,
        this.audit,
        META,
        () =>
          tx.legalEntity.create({
            data: {
              organizationId: principal.organizationId ?? '',
              companyId: input.companyId,
              code: input.code,
              legalName: input.legalName,
              countryCode: input.countryCode ?? 'IN',
              pan: input.pan ?? null,
              tan: input.tan ?? null,
              gstin: input.gstin ?? null,
              cin: input.cin ?? null,
              registrationNumber: input.registrationNumber ?? null,
              registeredLocationId: input.registeredLocationId ?? null,
            },
            include,
          }),
        (r) => ({ code: r.code, legalName: r.legalName, companyId: r.companyId }),
      );
      return toItem(row);
    });
  }

  update(id: string, input: LegalEntityInput): Promise<LegalEntityItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.legalEntity.findFirst({ where: { id } });
      if (before) {
        const merged = { ...before, ...definedOnly(input) };
        assertIdentifiersMatchCountry(merged.countryCode, merged);
        if (merged.pan && merged.gstin && merged.gstin.slice(2, 12) !== merged.pan) {
          throw AppException.badRequest('GSTIN must contain the PAN (characters 3–12)', 'gstin');
        }
      }
      await assertRef(tx, 'location', input.registeredLocationId, 'registeredLocationId');
      const data = definedOnly(input);
      const row = await auditedUpdate(tx, this.audit, { ...META, id }, before, data, () =>
        tx.legalEntity.update({ where: { id }, data, include }),
      );
      return toItem(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.legalEntity.findFirst({
        where: { id },
        select: { code: true, legalName: true },
      });
      await auditedDelete(tx, this.audit, { ...META, id }, existing, () =>
        tx.legalEntity.delete({ where: { id } }),
      );
    });
  }
}
