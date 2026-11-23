import { Injectable } from '@nestjs/common';
import { Decimal, straightLineBookValue } from '@hrm/business-rules';
import type {
  AssetCategoryItem,
  AssetDetails,
  AssetItem,
  MyAssetsItem,
  PaginatedResult,
  SoftwareLicenseItem,
} from '@hrm/shared-types';
import type {
  assetAllocationSchema,
  assetCategorySchema,
  assetListQuerySchema,
  assetReturnSchema,
  assetSchema,
  assetStatusSchema,
  maintenanceSchema,
  softwareLicenseSchema,
  updateAssetSchema,
  updateSoftwareLicenseSchema,
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
import { AuditService } from '../audit/audit.service.js';
import { displayName, isoDate, isoOrNull, toDate, todayIso } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { mapWriteError } from '../structure/structure.util.js';
import { selfEmployeeId } from '../time/time-context.js';

const money = (v: { toString(): string } | null | undefined) =>
  v === null || v === undefined ? null : new Decimal(v.toString()).toFixed(2);
const empSelect = {
  id: true,
  employeeNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  preferredName: true,
} as const;
type Emp = {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
};
const ref = (e: Emp) => ({
  id: e.id,
  employeeNumber: e.employeeNumber,
  displayName: displayName(e),
});

const assetSelect = {
  id: true,
  tag: true,
  name: true,
  serialNumber: true,
  manufacturer: true,
  model: true,
  vendor: true,
  purchaseDate: true,
  purchaseCost: true,
  warrantyEnd: true,
  status: true,
  notes: true,
  category: {
    select: { id: true, code: true, name: true, usefulLifeMonths: true, salvagePercent: true },
  },
  location: { select: { id: true, code: true, name: true } },
  allocations: {
    where: { returnedOn: null },
    take: 1,
    select: {
      id: true,
      allocatedOn: true,
      acknowledgedAt: true,
      expectedReturnOn: true,
      employee: { select: empSelect },
    },
  },
} satisfies Prisma.AssetSelect;
type AssetRow = Prisma.AssetGetPayload<{ select: typeof assetSelect }>;

function toAsset(a: AssetRow): AssetItem {
  let bookValue: string | null = null;
  const life = a.category.usefulLifeMonths;
  if (life && a.purchaseCost !== null && a.purchaseDate) {
    const cost = new Decimal(a.purchaseCost.toString());
    const salvage = cost
      .times(new Decimal((a.category.salvagePercent ?? 0).toString()))
      .dividedBy(100);
    bookValue = straightLineBookValue({
      cost,
      salvage,
      usefulLifeMonths: life,
      purchaseDate: isoDate(a.purchaseDate),
      asOf: todayIso(),
    }).bookValue.toFixed(2);
  }
  const open = a.allocations[0];
  return {
    id: a.id,
    tag: a.tag,
    name: a.name,
    category: { id: a.category.id, code: a.category.code, name: a.category.name },
    serialNumber: a.serialNumber,
    manufacturer: a.manufacturer,
    model: a.model,
    vendor: a.vendor,
    purchaseDate: isoOrNull(a.purchaseDate),
    purchaseCost: money(a.purchaseCost),
    warrantyEnd: isoOrNull(a.warrantyEnd),
    location: a.location,
    status: a.status,
    notes: a.notes,
    holder: open ? ref(open.employee) : null,
    bookValue,
  };
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async event(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    assetId: string,
    type: string,
    note: string | null,
    employeeId: string | null = null,
  ) {
    await tx.assetEvent.create({
      data: {
        organizationId: principal.organizationId ?? '',
        assetId,
        type,
        note,
        employeeId,
        actorUserId: principal.userId,
      },
    });
  }

  // ------------------------------------------------------------------------------ categories

  categories(): Promise<AssetCategoryItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.assetCategory.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { assets: true } } },
      });
      return rows.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        usefulLifeMonths: c.usefulLifeMonths,
        salvagePercent: c.salvagePercent ? c.salvagePercent.toString() : null,
        status: c.status,
        assetCount: c._count.assets,
      }));
    });
  }

  createCategory(
    principal: AuthPrincipal,
    input: z.output<typeof assetCategorySchema>,
  ): Promise<AssetCategoryItem[]> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma
      .withTenant(async (tx) => {
        try {
          const c = await tx.assetCategory.create({
            data: {
              organizationId,
              code: input.code,
              name: input.name,
              usefulLifeMonths: input.usefulLifeMonths ?? null,
              salvagePercent: input.salvagePercent,
            },
            select: { id: true },
          });
          await this.audit.record(tx, {
            action: 'assets.category.created',
            entityType: 'asset_category',
            entityId: c.id,
            metadata: { code: input.code },
          });
        } catch (err) {
          mapWriteError(err, { entity: 'category', uniqueField: 'code' });
        }
      })
      .then(() => this.categories());
  }

  // ------------------------------------------------------------------------------ assets

  list(q: z.output<typeof assetListQuerySchema>): Promise<PaginatedResult<AssetItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.AssetWhereInput = {
        ...(q.status ? { status: q.status as AssetRow['status'] } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.employeeId
          ? { allocations: { some: { employeeId: q.employeeId, returnedOn: null } } }
          : {}),
        ...(q.search
          ? {
              OR: [
                { tag: { contains: q.search, mode: 'insensitive' } },
                { name: { contains: q.search, mode: 'insensitive' } },
                { serialNumber: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.asset.findMany({ where, orderBy: { tag: 'asc' }, select: assetSelect, ...skipTake(q) }),
        tx.asset.count({ where }),
      ]);
      return paginate(rows.map(toAsset), total, q);
    });
  }

  get(id: string): Promise<AssetDetails> {
    return this.prisma.withTenant(async (tx) => this.detailsIn(tx, id));
  }

  private async detailsIn(tx: TenantTransaction, id: string): Promise<AssetDetails> {
    const a = await tx.asset.findFirst({ where: { id }, select: assetSelect });
    if (!a) throw AppException.notFound('Asset');
    const [allocations, maintenance, events] = await Promise.all([
      tx.assetAllocation.findMany({
        where: { assetId: id },
        orderBy: { allocatedOn: 'desc' },
        include: { employee: { select: empSelect } },
      }),
      tx.assetMaintenance.findMany({ where: { assetId: id }, orderBy: { startedOn: 'desc' } }),
      tx.assetEvent.findMany({ where: { assetId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    const eventEmployees = await tx.employee.findMany({
      where: { id: { in: events.map((e) => e.employeeId).filter((x): x is string => !!x) } },
      select: empSelect,
    });
    const byId = new Map(eventEmployees.map((e) => [e.id, e]));
    const names = await userNames(
      tx,
      events.map((e) => e.actorUserId),
    );
    return {
      ...toAsset(a),
      allocations: allocations.map((x) => ({
        id: x.id,
        employee: ref(x.employee),
        allocatedOn: isoDate(x.allocatedOn),
        expectedReturnOn: isoOrNull(x.expectedReturnOn),
        conditionNote: x.conditionNote,
        acknowledgedAt: x.acknowledgedAt?.toISOString() ?? null,
        returnedOn: isoOrNull(x.returnedOn),
        returnCondition: x.returnCondition,
        returnNote: x.returnNote,
      })),
      maintenance: maintenance.map((m) => ({
        id: m.id,
        startedOn: isoDate(m.startedOn),
        completedOn: isoOrNull(m.completedOn),
        vendor: m.vendor,
        cost: money(m.cost),
        description: m.description,
      })),
      events: events.map((e) => {
        const emp = e.employeeId ? byId.get(e.employeeId) : undefined;
        return {
          type: e.type,
          note: e.note,
          employee: emp ? ref(emp) : null,
          actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
          at: e.createdAt.toISOString(),
        };
      }),
    };
  }

  create(principal: AuthPrincipal, input: z.output<typeof assetSchema>): Promise<AssetDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const cat = await tx.assetCategory.findFirst({
        where: { id: input.categoryId },
        select: { status: true },
      });
      if (!cat) throw AppException.badRequest('The category does not exist', 'categoryId');
      try {
        const a = await tx.asset.create({
          data: {
            organizationId,
            tag: input.tag,
            name: input.name,
            categoryId: input.categoryId,
            serialNumber: input.serialNumber ?? null,
            manufacturer: input.manufacturer ?? null,
            model: input.model ?? null,
            vendor: input.vendor ?? null,
            purchaseDate: input.purchaseDate ? toDate(input.purchaseDate) : null,
            purchaseCost: input.purchaseCost,
            warrantyEnd: input.warrantyEnd ? toDate(input.warrantyEnd) : null,
            locationId: input.locationId,
            notes: input.notes ?? null,
          },
          select: { id: true },
        });
        await this.event(tx, principal, a.id, 'REGISTERED', null);
        await this.audit.record(tx, {
          action: 'assets.asset.created',
          entityType: 'asset',
          entityId: a.id,
          metadata: { tag: input.tag },
        });
        return await this.detailsIn(tx, a.id);
      } catch (err) {
        if (err instanceof AppException) throw err;
        mapWriteError(err, { entity: 'asset', uniqueField: 'tag' });
      }
    });
  }

  update(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof updateAssetSchema>,
  ): Promise<AssetDetails> {
    return this.prisma.withTenant(async (tx) => {
      const a = await tx.asset.findFirst({ where: { id }, select: { id: true } });
      if (!a) throw AppException.notFound('Asset');
      const data: Prisma.AssetUncheckedUpdateInput = Object.fromEntries(
        Object.entries({
          ...input,
          purchaseDate:
            input.purchaseDate === undefined
              ? undefined
              : input.purchaseDate
                ? toDate(input.purchaseDate)
                : null,
          warrantyEnd:
            input.warrantyEnd === undefined
              ? undefined
              : input.warrantyEnd
                ? toDate(input.warrantyEnd)
                : null,
        }).filter(([, v]) => v !== undefined),
      );
      await tx.asset.update({ where: { id }, data });
      await this.event(tx, principal, id, 'UPDATED', null);
      await this.audit.record(tx, {
        action: 'assets.asset.updated',
        entityType: 'asset',
        entityId: id,
        metadata: { fields: Object.keys(data) },
      });
      return this.detailsIn(tx, id);
    });
  }

  /** Stock/repair/retire/lost for an asset that is not allocated. */
  setStatus(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof assetStatusSchema>,
  ): Promise<AssetDetails> {
    return this.prisma.withTenant(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.asset.findFirst({ where: { id }, select: { status: true } });
      if (!a) throw AppException.notFound('Asset');
      if (a.status === 'ALLOCATED') throw AppException.conflict('Record the return first');
      if (a.status === 'RETIRED') throw AppException.conflict('A retired asset cannot change');
      await tx.asset.update({ where: { id }, data: { status: input.status } });
      await this.event(tx, principal, id, `STATUS_${input.status}`, input.note);
      await this.audit.record(tx, {
        action: 'assets.asset.status',
        entityType: 'asset',
        entityId: id,
        metadata: { from: a.status, to: input.status },
      });
      return this.detailsIn(tx, id);
    });
  }

  allocate(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof assetAllocationSchema>,
  ): Promise<AssetDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
      const a = await tx.asset.findFirst({ where: { id }, select: { status: true } });
      if (!a) throw AppException.notFound('Asset');
      if (a.status !== 'IN_STOCK')
        throw AppException.conflict(
          `Only an asset in stock can be allocated (this one is ${a.status.toLowerCase().replace('_', ' ')})`,
        );
      const e = await tx.employee.findFirst({
        where: { id: input.employeeId },
        select: { status: true, dateOfJoining: true },
      });
      if (!e) throw AppException.badRequest('The employee does not exist', 'employeeId');
      if (e.status === 'SEPARATED')
        throw AppException.badRequest('The employee has left', 'employeeId');
      if (input.expectedReturnOn && input.expectedReturnOn < input.allocatedOn)
        throw AppException.badRequest(
          'The return date cannot be before the allocation',
          'expectedReturnOn',
        );
      await tx.assetAllocation.create({
        data: {
          organizationId,
          assetId: id,
          employeeId: input.employeeId,
          allocatedOn: toDate(input.allocatedOn),
          expectedReturnOn: input.expectedReturnOn ? toDate(input.expectedReturnOn) : null,
          conditionNote: input.conditionNote ?? null,
          allocatedByUserId: principal.userId,
        },
      });
      await tx.asset.update({ where: { id }, data: { status: 'ALLOCATED' } });
      await this.event(
        tx,
        principal,
        id,
        'ALLOCATED',
        input.conditionNote ?? null,
        input.employeeId,
      );
      await this.audit.record(tx, {
        action: 'assets.asset.allocated',
        entityType: 'asset',
        entityId: id,
        metadata: { employeeId: input.employeeId },
      });
      return this.detailsIn(tx, id);
    });
  }

  returnAsset(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof assetReturnSchema>,
  ): Promise<AssetDetails> {
    return this.prisma.withTenant(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assets WHERE id = ${id}::uuid FOR UPDATE`;
      const open = await tx.assetAllocation.findFirst({
        where: { assetId: id, returnedOn: null },
        select: { id: true, allocatedOn: true, employeeId: true },
      });
      if (!open) throw AppException.conflict('The asset is not allocated');
      if (input.returnedOn < isoDate(open.allocatedOn))
        throw AppException.badRequest('The return cannot be before the allocation', 'returnedOn');
      const toStatus = input.condition === 'LOST' ? 'LOST' : input.toStatus;
      await tx.assetAllocation.update({
        where: { id: open.id },
        data: {
          returnedOn: toDate(input.returnedOn),
          returnCondition: input.condition,
          returnNote: input.note ?? null,
          returnedByUserId: principal.userId,
        },
      });
      await tx.asset.update({ where: { id }, data: { status: toStatus } });
      await this.event(
        tx,
        principal,
        id,
        'RETURNED',
        [input.condition.toLowerCase(), input.note].filter(Boolean).join(' — '),
        open.employeeId,
      );
      await this.audit.record(tx, {
        action: 'assets.asset.returned',
        entityType: 'asset',
        entityId: id,
        metadata: { employeeId: open.employeeId, condition: input.condition, toStatus },
      });
      return this.detailsIn(tx, id);
    });
  }

  addMaintenance(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof maintenanceSchema>,
  ): Promise<AssetDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const a = await tx.asset.findFirst({ where: { id }, select: { id: true } });
      if (!a) throw AppException.notFound('Asset');
      await tx.assetMaintenance.create({
        data: {
          organizationId,
          assetId: id,
          startedOn: toDate(input.startedOn),
          completedOn: input.completedOn ? toDate(input.completedOn) : null,
          vendor: input.vendor ?? null,
          cost: input.cost,
          description: input.description,
          createdByUserId: principal.userId,
        },
      });
      await this.event(tx, principal, id, 'MAINTENANCE', input.description);
      return this.detailsIn(tx, id);
    });
  }

  // ------------------------------------------------------------------------------ self-service

  mine(principal: AuthPrincipal): Promise<MyAssetsItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await selfEmployeeId(tx, principal);
      const [allocations, seats] = await Promise.all([
        tx.assetAllocation.findMany({
          where: { employeeId: me, returnedOn: null },
          orderBy: { allocatedOn: 'desc' },
          select: {
            id: true,
            allocatedOn: true,
            acknowledgedAt: true,
            expectedReturnOn: true,
            asset: { select: assetSelect },
          },
        }),
        tx.licenseAssignment.findMany({
          where: { employeeId: me, revokedOn: null },
          select: { assignedOn: true, license: { select: { id: true, name: true, vendor: true } } },
        }),
      ]);
      return {
        assets: allocations.map((x) => ({
          ...toAsset(x.asset),
          allocationId: x.id,
          allocatedOn: isoDate(x.allocatedOn),
          acknowledgedAt: x.acknowledgedAt?.toISOString() ?? null,
          expectedReturnOn: isoOrNull(x.expectedReturnOn),
        })),
        licenses: seats.map((s) => ({ ...s.license, assignedOn: s.assignedOn.toISOString() })),
      };
    });
  }

  acknowledge(principal: AuthPrincipal, allocationId: string): Promise<MyAssetsItem> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await selfEmployeeId(tx, principal);
        const a = await tx.assetAllocation.findFirst({
          where: { id: allocationId, employeeId: me, returnedOn: null },
          select: { assetId: true, acknowledgedAt: true },
        });
        if (!a) throw AppException.notFound('Allocation');
        if (a.acknowledgedAt) return;
        await tx.assetAllocation.update({
          where: { id: allocationId },
          data: { acknowledgedAt: new Date() },
        });
        await this.event(tx, principal, a.assetId, 'ACKNOWLEDGED', null, me);
      })
      .then(() => this.mine(principal));
  }

  // ------------------------------------------------------------------------------ licences

  licenses(): Promise<SoftwareLicenseItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.softwareLicense.findMany({
        orderBy: { name: 'asc' },
        include: {
          assignments: {
            where: { revokedOn: null },
            orderBy: { assignedOn: 'asc' },
            include: { employee: { select: empSelect } },
          },
        },
      });
      return rows.map((l) => ({
        id: l.id,
        name: l.name,
        vendor: l.vendor,
        seats: l.seats,
        usedSeats: l.assignments.length,
        expiresOn: isoOrNull(l.expiresOn),
        cost: money(l.cost),
        notes: l.notes,
        status: l.status,
        assignees: l.assignments.map((a) => ({
          assignmentId: a.id,
          employee: ref(a.employee),
          assignedOn: a.assignedOn.toISOString(),
        })),
      }));
    });
  }

  createLicense(
    principal: AuthPrincipal,
    input: z.output<typeof softwareLicenseSchema>,
  ): Promise<SoftwareLicenseItem[]> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma
      .withTenant(async (tx) => {
        try {
          const l = await tx.softwareLicense.create({
            data: {
              organizationId,
              name: input.name,
              vendor: input.vendor ?? null,
              seats: input.seats,
              expiresOn: input.expiresOn ? toDate(input.expiresOn) : null,
              cost: input.cost,
              notes: input.notes ?? null,
            },
            select: { id: true },
          });
          await this.audit.record(tx, {
            action: 'assets.license.created',
            entityType: 'software_license',
            entityId: l.id,
            metadata: { name: input.name, seats: input.seats },
          });
        } catch (err) {
          mapWriteError(err, { entity: 'licence', uniqueField: 'name' });
        }
      })
      .then(() => this.licenses());
  }

  updateLicense(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof updateSoftwareLicenseSchema>,
  ): Promise<SoftwareLicenseItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        await tx.$queryRaw`SELECT id FROM software_licenses WHERE id = ${id}::uuid FOR UPDATE`;
        const used = await tx.licenseAssignment.count({
          where: { licenseId: id, revokedOn: null },
        });
        if (input.seats !== undefined && input.seats < used)
          throw AppException.badRequest(
            `${String(used)} seats are assigned; revoke some first`,
            'seats',
          );
        const data = Object.fromEntries(
          Object.entries({
            ...input,
            expiresOn:
              input.expiresOn === undefined
                ? undefined
                : input.expiresOn
                  ? toDate(input.expiresOn)
                  : null,
          }).filter(([, v]) => v !== undefined),
        );
        await tx.softwareLicense.update({ where: { id }, data });
        await this.audit.record(tx, {
          action: 'assets.license.updated',
          entityType: 'software_license',
          entityId: id,
          metadata: { by: principal.userId, fields: Object.keys(data) },
        });
      })
      .then(() => this.licenses());
  }

  /** Assigns a seat under a row lock so concurrent assignments cannot exceed the seat count. */
  assignSeat(
    principal: AuthPrincipal,
    id: string,
    employeeId: string,
  ): Promise<SoftwareLicenseItem[]> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma
      .withTenant(async (tx) => {
        await tx.$queryRaw`SELECT id FROM software_licenses WHERE id = ${id}::uuid FOR UPDATE`;
        const l = await tx.softwareLicense.findFirst({
          where: { id },
          select: { seats: true, status: true, expiresOn: true },
        });
        if (!l) throw AppException.notFound('Licence');
        if (l.status !== 'ACTIVE') throw AppException.conflict('The licence is inactive');
        if (l.expiresOn && isoDate(l.expiresOn) < todayIso())
          throw AppException.conflict('The licence has expired');
        const used = await tx.licenseAssignment.count({
          where: { licenseId: id, revokedOn: null },
        });
        if (used >= l.seats) throw AppException.conflict('All seats are in use');
        const e = await tx.employee.findFirst({
          where: { id: employeeId },
          select: { status: true },
        });
        if (!e) throw AppException.badRequest('The employee does not exist', 'employeeId');
        try {
          await tx.licenseAssignment.create({
            data: { organizationId, licenseId: id, employeeId, assignedByUserId: principal.userId },
          });
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflictOn('This employee already has a seat', 'employeeId');
          throw err;
        }
        await this.audit.record(tx, {
          action: 'assets.license.assigned',
          entityType: 'software_license',
          entityId: id,
          metadata: { employeeId },
        });
      })
      .then(() => this.licenses());
  }

  revokeSeat(
    principal: AuthPrincipal,
    id: string,
    assignmentId: string,
  ): Promise<SoftwareLicenseItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const a = await tx.licenseAssignment.findFirst({
          where: { id: assignmentId, licenseId: id, revokedOn: null },
          select: { employeeId: true },
        });
        if (!a) throw AppException.notFound('Seat');
        await tx.licenseAssignment.update({
          where: { id: assignmentId },
          data: { revokedOn: new Date(), revokedByUserId: principal.userId },
        });
        await this.audit.record(tx, {
          action: 'assets.license.revoked',
          entityType: 'software_license',
          entityId: id,
          metadata: { employeeId: a.employeeId },
        });
      })
      .then(() => this.licenses());
  }
}
