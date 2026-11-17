import { Injectable } from '@nestjs/common';
import type { LocationItem, PaginatedResult } from '@hrm/shared-types';
import type { StructureListQuery } from '@hrm/validation';
import type { Location, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedCreate, auditedDelete, auditedUpdate, codeNameSorts } from './audited-writes.js';
import { notFound, pagedList, sortOf } from './structure-base.js';
import { definedOnly } from './structure.util.js';

const META = { label: 'location', type: 'location' };

function toItem(r: Location): LocationItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    countryCode: r.countryCode,
    timezone: r.timezone,
    // Decimal → fixed string; coordinates are never handled as floats.
    latitude: r.latitude?.toFixed(6) ?? null,
    longitude: r.longitude?.toFixed(6) ?? null,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export interface LocationInput {
  code?: string;
  name?: string;
  addressLine1?: string;
  addressLine2?: string | null | undefined;
  city?: string;
  state?: string | null | undefined;
  postalCode?: string | null | undefined;
  countryCode?: string;
  timezone?: string | null | undefined;
  latitude?: string | null | undefined;
  longitude?: string | null | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(query: StructureListQuery): Promise<PaginatedResult<LocationItem>> {
    return this.prisma.withTenant((tx) => {
      const where: Prisma.LocationWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
                { city: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const orderBy = sortOf<Prisma.LocationOrderByWithRelationInput>(
        query,
        { ...codeNameSorts, city: (d) => ({ city: d }) },
        'name',
      );
      return pagedList({
        query,
        findMany: (args) =>
          tx.location.findMany({ where, orderBy: [orderBy, { id: 'asc' }], ...args }),
        count: () => tx.location.count({ where }),
        map: toItem,
      });
    });
  }

  get(id: string): Promise<LocationItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.location.findFirst({ where: { id } });
      return row ? toItem(row) : notFound('Location');
    });
  }

  create(
    principal: AuthPrincipal,
    input: LocationInput & { code: string; name: string; addressLine1: string; city: string },
  ): Promise<LocationItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await auditedCreate(
        tx,
        this.audit,
        META,
        () =>
          tx.location.create({
            data: {
              organizationId: principal.organizationId ?? '',
              code: input.code,
              name: input.name,
              addressLine1: input.addressLine1,
              addressLine2: input.addressLine2 ?? null,
              city: input.city,
              state: input.state ?? null,
              postalCode: input.postalCode ?? null,
              countryCode: input.countryCode ?? 'IN',
              timezone: input.timezone ?? null,
              latitude: input.latitude ?? null,
              longitude: input.longitude ?? null,
            },
          }),
        (r) => ({ code: r.code, name: r.name, city: r.city }),
      );
      return toItem(row);
    });
  }

  update(id: string, input: LocationInput): Promise<LocationItem> {
    return this.prisma.withTenant(async (tx) => {
      const data = definedOnly(input);
      const before = await tx.location.findFirst({ where: { id } });
      const row = await auditedUpdate(tx, this.audit, { ...META, id }, before, data, () =>
        tx.location.update({ where: { id }, data }),
      );
      return toItem(row);
    });
  }

  remove(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.location.findFirst({
        where: { id },
        select: { code: true, name: true },
      });
      await auditedDelete(tx, this.audit, { ...META, id }, existing, () =>
        tx.location.delete({ where: { id } }),
      );
    });
  }
}
