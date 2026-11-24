import { Injectable } from '@nestjs/common';
import { type ClientItem, PERMISSIONS } from '@hrm/shared-types';
import type {
  clientContactSchema,
  clientSchema,
  portalUserSchema,
  updateClientSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { mapWriteError } from '../structure/structure.util.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;

const clientSelect = {
  id: true,
  code: true,
  name: true,
  currency: true,
  paymentTermsDays: true,
  billingAddress: true,
  taxNumber: true,
  email: true,
  notes: true,
  status: true,
  contacts: {
    select: { id: true, name: true, email: true, phone: true, role: true },
    orderBy: { createdAt: 'asc' as const },
  },
  portalUsers: {
    select: {
      membershipId: true,
      membership: { select: { user: { select: { fullName: true, email: true } } } },
    },
  },
  _count: { select: { projects: true } },
} as const;

type ClientRow = {
  id: string;
  code: string;
  name: string;
  currency: string;
  paymentTermsDays: number;
  billingAddress: string | null;
  taxNumber: string | null;
  email: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  contacts: ClientItem['contacts'];
  portalUsers: {
    membershipId: string;
    membership: { user: { fullName: string; email: string } };
  }[];
  _count: { projects: number };
};

const toItem = (c: ClientRow): ClientItem => ({
  id: c.id,
  code: c.code,
  name: c.name,
  currency: c.currency,
  paymentTermsDays: c.paymentTermsDays,
  billingAddress: c.billingAddress,
  taxNumber: c.taxNumber,
  email: c.email,
  notes: c.notes,
  status: c.status,
  projects: c._count.projects,
  contacts: c.contacts,
  portalUsers: c.portalUsers.map((u) => ({
    membershipId: u.membershipId,
    name: u.membership.user.fullName,
    email: u.membership.user.email,
  })),
});

/** Clients, their contacts and portal users (ADR-017). */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private canSee(principal: AuthPrincipal): boolean {
    return [
      P.PROJECTS_CLIENT_MANAGE,
      P.PROJECTS_BILLING_MANAGE,
      P.PROJECTS_PROJECT_READ,
      P.PROJECTS_PROJECT_MANAGE,
    ].some((p) => can(principal, p, {}));
  }

  list(principal: AuthPrincipal): Promise<ClientItem[]> {
    if (!this.canSee(principal)) throw AppException.forbidden();
    const manage = can(principal, P.PROJECTS_CLIENT_MANAGE, {});
    return this.prisma.withTenant(async (tx) => {
      const rows: ClientRow[] = await tx.client.findMany({
        select: clientSelect,
        orderBy: { name: 'asc' },
      });
      // Only client managers see contacts and portal logins.
      return rows.map(toItem).map((c) => (manage ? c : { ...c, contacts: [], portalUsers: [] }));
    });
  }

  private async one(tx: TenantTransaction, id: string): Promise<ClientItem> {
    const c: ClientRow | null = await tx.client.findFirst({ where: { id }, select: clientSelect });
    if (!c) throw AppException.notFound('Client');
    return toItem(c);
  }

  create(principal: AuthPrincipal, input: In<typeof clientSchema>): Promise<ClientItem> {
    return this.prisma.withTenant(async (tx) => {
      try {
        const c = await tx.client.create({
          data: {
            organizationId: principal.organizationId ?? '',
            code: input.code,
            name: input.name,
            currency: input.currency,
            paymentTermsDays: input.paymentTermsDays,
            billingAddress: input.billingAddress ?? null,
            taxNumber: input.taxNumber ?? null,
            email: input.email ?? null,
            notes: input.notes ?? null,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'projects.client.created',
          entityType: 'client',
          entityId: c.id,
        });
        return await this.one(tx, c.id);
      } catch (err) {
        mapWriteError(err, { entity: 'client', uniqueField: 'code' });
      }
    });
  }

  update(id: string, input: In<typeof updateClientSchema>): Promise<ClientItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.one(tx, id);
      await tx.client.update({ where: { id }, data: input });
      await this.audit.record(tx, {
        action: 'projects.client.updated',
        entityType: 'client',
        entityId: id,
      });
      return this.one(tx, id);
    });
  }

  addContact(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof clientContactSchema>,
  ): Promise<ClientItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.one(tx, id);
      await tx.clientContact.create({
        data: {
          organizationId: principal.organizationId ?? '',
          clientId: id,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          role: input.role ?? null,
        },
      });
      return this.one(tx, id);
    });
  }

  removeContact(id: string, contactId: string): Promise<ClientItem> {
    return this.prisma.withTenant(async (tx) => {
      const n = await tx.clientContact.deleteMany({ where: { id: contactId, clientId: id } });
      if (!n.count) throw AppException.notFound('Contact');
      return this.one(tx, id);
    });
  }

  /**
   * Gives a member the portal of this client. The member must hold the `client` role and no
   * other, so a staff login never becomes a portal login by mistake.
   */
  addPortalUser(id: string, input: In<typeof portalUserSchema>): Promise<ClientItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.one(tx, id);
      const m = await tx.membership.findFirst({
        where: { id: input.membershipId, status: 'ACTIVE' },
        select: {
          id: true,
          organizationId: true,
          roles: { select: { role: { select: { key: true } } } },
          employee: { select: { id: true } },
        },
      });
      if (!m) throw AppException.badRequest('The member does not exist', 'membershipId');
      const keys = m.roles.map((r) => r.role.key);
      if (!keys.includes('client') || keys.length !== 1 || m.employee)
        throw AppException.badRequest(
          'Only members with just the Client role (and no employee record) can use the portal',
          'membershipId',
        );
      try {
        await tx.clientPortalUser.create({
          data: { organizationId: m.organizationId, clientId: id, membershipId: m.id },
        });
      } catch (err) {
        mapWriteError(err, { entity: 'portal user', uniqueField: 'membershipId' });
      }
      await this.audit.record(tx, {
        action: 'projects.portal_user.added',
        entityType: 'client',
        entityId: id,
        metadata: { membershipId: m.id },
      });
      return this.one(tx, id);
    });
  }

  removePortalUser(id: string, membershipId: string): Promise<ClientItem> {
    return this.prisma.withTenant(async (tx) => {
      const n = await tx.clientPortalUser.deleteMany({ where: { clientId: id, membershipId } });
      if (!n.count) throw AppException.notFound('Portal user');
      await this.audit.record(tx, {
        action: 'projects.portal_user.removed',
        entityType: 'client',
        entityId: id,
        metadata: { membershipId },
      });
      return this.one(tx, id);
    });
  }
}
