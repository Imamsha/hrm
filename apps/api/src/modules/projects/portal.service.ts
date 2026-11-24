import { Injectable } from '@nestjs/common';
import { workItemKey } from '@hrm/business-rules';
import type {
  InvoiceDetails,
  PortalSummary,
  PortalWorkItem,
  PortalWorkItemDetails,
} from '@hrm/shared-types';
import type { portalCommentSchema, portalRequestSchema } from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { isoOrNull } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { BillingService, toInvoiceItem } from './billing.service.js';
import { clientRefSelect, progressOf } from './projects-common.js';
import { ProjectsService } from './projects.service.js';

type In<S extends z.ZodType> = z.output<S>;

const portalItemSelect = {
  id: true,
  number: true,
  type: true,
  title: true,
  priority: true,
  severity: true,
  fromClient: true,
  updatedAt: true,
  column: { select: { name: true, category: true } },
  project: { select: { id: true, key: true, name: true } },
} satisfies Prisma.WorkItemSelect;
type PortalRow = Prisma.WorkItemGetPayload<{ select: typeof portalItemSelect }>;

const toPortalItem = (w: PortalRow): PortalWorkItem => ({
  id: w.id,
  key: workItemKey(w.project.key, w.number),
  type: w.type,
  title: w.title,
  status: w.column.name,
  category: w.column.category,
  priority: w.priority,
  severity: w.severity,
  fromClient: w.fromClient,
  updatedAt: w.updatedAt.toISOString(),
});

/**
 * The client portal (ADR-017). Every query is limited to the caller's client (via
 * `client_portal_users`), portal-enabled projects, client-visible items and comments, and
 * issued invoices. Rates, people's hours, timesheets and drafts are never returned.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projects: ProjectsService,
    private readonly billing: BillingService,
  ) {}

  private async clientOf(tx: TenantTransaction, principal: AuthPrincipal): Promise<string> {
    if (!principal.membershipId) throw AppException.forbidden('No client portal access');
    const link = await tx.clientPortalUser.findFirst({
      where: { membershipId: principal.membershipId, client: { status: 'ACTIVE' } },
      select: { clientId: true },
    });
    if (!link) throw AppException.forbidden('No client portal access');
    return link.clientId;
  }

  private portalProjects = (clientId: string): Prisma.ProjectWhereInput => ({
    clientId,
    portalEnabled: true,
  });

  summary(principal: AuthPrincipal): Promise<PortalSummary> {
    return this.prisma.withTenant(async (tx) => {
      const clientId = await this.clientOf(tx, principal);
      const client = await tx.client.findFirstOrThrow({
        where: { id: clientId },
        select: clientRefSelect,
      });
      const projects = await tx.project.findMany({
        where: this.portalProjects(clientId),
        orderBy: { name: 'asc' },
        select: { id: true, key: true, name: true, status: true, startDate: true, endDate: true },
      });
      const progress = await progressOf(
        tx,
        projects.map((p) => p.id),
        true,
      );
      const bugs = await tx.workItem.groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projects.map((p) => p.id) },
          type: 'BUG',
          clientVisible: true,
          column: { category: { not: 'DONE' } },
        },
        _count: { _all: true },
      });
      const invoices = await tx.invoice.findMany({
        where: { clientId, status: { in: ['ISSUED', 'PAID'] } },
        orderBy: { issuedOn: 'desc' },
        select: {
          id: true,
          number: true,
          currency: true,
          status: true,
          issuedOn: true,
          dueOn: true,
          subtotal: true,
          taxTotal: true,
          total: true,
          paidTotal: true,
          createdAt: true,
          client: { select: clientRefSelect },
        },
      });
      return {
        client,
        projects: projects.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          status: p.status,
          startDate: isoOrNull(p.startDate),
          endDate: isoOrNull(p.endDate),
          progress: progress.get(p.id) ?? {
            todo: '0',
            inProgress: '0',
            done: '0',
            percentDone: '0',
          },
          openBugs: bugs.find((b) => b.projectId === p.id)?._count._all ?? 0,
        })),
        invoices: invoices.map((i) => toInvoiceItem(i)),
      };
    });
  }

  items(principal: AuthPrincipal, projectId: string): Promise<PortalWorkItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const clientId = await this.clientOf(tx, principal);
      const p = await tx.project.findFirst({
        where: { id: projectId, ...this.portalProjects(clientId) },
        select: { id: true },
      });
      if (!p) throw AppException.notFound('Project');
      const rows = await tx.workItem.findMany({
        where: { projectId, clientVisible: true },
        orderBy: [{ updatedAt: 'desc' }],
        select: portalItemSelect,
        take: 500,
      });
      return rows.map(toPortalItem);
    });
  }

  private async itemIn(
    tx: TenantTransaction,
    clientId: string,
    itemId: string,
  ): Promise<PortalWorkItemDetails> {
    const w = await tx.workItem.findFirst({
      where: { id: itemId, clientVisible: true, project: this.portalProjects(clientId) },
      select: {
        ...portalItemSelect,
        description: true,
        stepsToReproduce: true,
        comments: {
          where: { clientVisible: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, fromClient: true, authorUserId: true, createdAt: true },
        },
      },
    });
    if (!w) throw AppException.notFound('Work item');
    const names = await userNames(
      tx,
      w.comments.map((c) => c.authorUserId),
    );
    return {
      ...toPortalItem(w),
      project: w.project,
      description: w.description,
      stepsToReproduce: w.stepsToReproduce,
      comments: w.comments.map((c) => ({
        id: c.id,
        body: c.body,
        fromClient: c.fromClient,
        author:
          (c.authorUserId ? names.get(c.authorUserId) : undefined) ??
          (c.fromClient ? 'Client' : 'Project team'),
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  item(principal: AuthPrincipal, itemId: string): Promise<PortalWorkItemDetails> {
    return this.prisma.withTenant(async (tx) =>
      this.itemIn(tx, await this.clientOf(tx, principal), itemId),
    );
  }

  /** A bug or request raised by the client: client-visible, in the project's first column. */
  request(
    principal: AuthPrincipal,
    input: In<typeof portalRequestSchema>,
  ): Promise<PortalWorkItemDetails> {
    return this.prisma.withTenant(async (tx) => {
      const clientId = await this.clientOf(tx, principal);
      const p = await tx.project.findFirst({
        where: { id: input.projectId, ...this.portalProjects(clientId) },
        select: { id: true, status: true },
      });
      if (!p) throw AppException.badRequest('Choose one of your projects', 'projectId');
      if (p.status === 'COMPLETED' || p.status === 'CANCELLED')
        throw AppException.badRequest('The project is closed', 'projectId');
      if (input.type === 'BUG' && !input.severity)
        throw AppException.badRequest('Choose the severity', 'severity');
      const number = await this.projects.allocateNumber(tx, p.id);
      const w = await tx.workItem.create({
        data: {
          organizationId: principal.organizationId ?? '',
          projectId: p.id,
          number,
          type: input.type,
          title: input.title,
          description: input.description,
          columnId: await this.projects.firstColumn(tx, p.id),
          priority: 'MEDIUM',
          reporterUserId: principal.userId,
          fromClient: true,
          clientVisible: true,
          severity: input.type === 'BUG' ? (input.severity ?? null) : null,
          stepsToReproduce: input.type === 'BUG' ? (input.stepsToReproduce ?? null) : null,
          rank: number,
        },
        select: { id: true },
      });
      await tx.workItemEvent.create({
        data: {
          organizationId: principal.organizationId ?? '',
          workItemId: w.id,
          field: 'created',
          toValue: `${input.type.toLowerCase()} from the client portal`,
          actorUserId: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'projects.portal.request_created',
        entityType: 'work_item',
        entityId: w.id,
      });
      return this.itemIn(tx, clientId, w.id);
    });
  }

  comment(
    principal: AuthPrincipal,
    itemId: string,
    input: In<typeof portalCommentSchema>,
  ): Promise<PortalWorkItemDetails> {
    return this.prisma.withTenant(async (tx) => {
      const clientId = await this.clientOf(tx, principal);
      await this.itemIn(tx, clientId, itemId);
      await tx.workItemComment.create({
        data: {
          organizationId: principal.organizationId ?? '',
          workItemId: itemId,
          body: input.body,
          clientVisible: true,
          fromClient: true,
          authorUserId: principal.userId,
        },
      });
      return this.itemIn(tx, clientId, itemId);
    });
  }

  invoice(principal: AuthPrincipal, id: string): Promise<InvoiceDetails> {
    return this.prisma.withTenant(async (tx) => {
      const clientId = await this.clientOf(tx, principal);
      return this.billing.details(tx, id, { clientId, status: { in: ['ISSUED', 'PAID'] } });
    });
  }
}
