import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import {
  canMoveTicket,
  slaDue,
  slaState,
  ticketNumber,
  type TicketStatus,
} from '@hrm/business-rules';
import {
  type ArticleItem,
  type HelpdeskCategoryItem,
  PERMISSIONS,
  type TicketDetails,
  type TicketItem,
} from '@hrm/shared-types';
import { DOCUMENT_MAX_BYTES } from '@hrm/validation';
import type {
  articleSchema,
  helpdeskCategorySchema,
  ticketCommentSchema,
  ticketListQuerySchema,
  ticketRatingSchema,
  ticketSchema,
  ticketUpdateSchema,
  updateArticleSchema,
  updateHelpdeskCategorySchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { uuidv7 } from '../../common/ids.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import {
  safeFileName,
  sniffContentType,
  type UploadedFileLike,
} from '../employees/employee-documents.service.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { empSelect, myEmployeeId, ref, requireMe } from '../talent/talent-common.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;

const ticketSelect = {
  id: true,
  number: true,
  subject: true,
  priority: true,
  status: true,
  categoryId: true,
  requesterEmployeeId: true,
  assigneeEmployeeId: true,
  firstResponseDue: true,
  resolutionDue: true,
  firstRespondedAt: true,
  resolvedAt: true,
  escalatedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, code: true, name: true } },
  requester: { select: empSelect },
  assignee: { select: empSelect },
} satisfies Prisma.TicketSelect;
type TicketRow = Prisma.TicketGetPayload<{ select: typeof ticketSelect }>;

const toTicket = (t: TicketRow, now = new Date()): TicketItem => {
  const sla = slaState(t, now);
  return {
    id: t.id,
    number: t.number,
    category: t.category,
    subject: t.subject,
    priority: t.priority,
    status: t.status,
    requester: ref(t.requester),
    assignee: t.assignee ? ref(t.assignee) : null,
    firstResponseDue: t.firstResponseDue?.toISOString() ?? null,
    resolutionDue: t.resolutionDue?.toISOString() ?? null,
    firstRespondedAt: t.firstRespondedAt?.toISOString() ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    responseBreached: sla.responseBreached,
    resolutionBreached: sla.resolutionBreached,
    escalated: !!t.escalatedAt,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
};

/** Tickets, SLAs, escalation and the knowledge base (ADR-019). */
@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------------------- categories

  private categorySelect = {
    id: true,
    code: true,
    name: true,
    description: true,
    status: true,
    confidential: true,
    defaultAssigneeId: true,
    escalationEmployeeId: true,
    agents: { select: { employee: { select: empSelect } } },
    slas: { select: { priority: true, firstResponseHours: true, resolutionHours: true } },
  } as const;

  private async toCategories(
    tx: TenantTransaction,
    rows: Prisma.HelpdeskCategoryGetPayload<{ select: HelpdeskService['categorySelect'] }>[],
  ): Promise<HelpdeskCategoryItem[]> {
    const ids = rows.flatMap((r) =>
      [r.defaultAssigneeId, r.escalationEmployeeId].filter((x): x is string => !!x),
    );
    const people = await tx.employee.findMany({ where: { id: { in: ids } }, select: empSelect });
    const person = (id: string | null) => {
      const p = id ? people.find((x) => x.id === id) : undefined;
      return p ? ref(p) : null;
    };
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      status: r.status,
      confidential: r.confidential,
      agents: r.agents.map((a) => ref(a.employee)),
      defaultAssignee: person(r.defaultAssigneeId),
      escalationContact: person(r.escalationEmployeeId),
      sla: r.slas,
    }));
  }

  categories(): Promise<HelpdeskCategoryItem[]> {
    return this.prisma.withTenant(async (tx) =>
      this.toCategories(
        tx,
        await tx.helpdeskCategory.findMany({
          orderBy: { name: 'asc' },
          select: this.categorySelect,
        }),
      ),
    );
  }

  private async saveCategory(
    tx: TenantTransaction,
    org: string,
    id: string,
    input: {
      agentEmployeeIds: string[];
      defaultAssigneeId?: string | null;
      sla: In<typeof helpdeskCategorySchema>['sla'];
    },
  ) {
    if (input.defaultAssigneeId && !input.agentEmployeeIds.includes(input.defaultAssigneeId))
      throw AppException.badRequest(
        'The default assignee must be one of the agents',
        'defaultAssigneeId',
      );
    const n = await tx.employee.count({
      where: { id: { in: input.agentEmployeeIds }, status: { not: 'SEPARATED' } },
    });
    if (n !== new Set(input.agentEmployeeIds).size)
      throw AppException.badRequest('An agent does not exist or has left', 'agentEmployeeIds');
    await tx.helpdeskAgent.deleteMany({ where: { categoryId: id } });
    await tx.helpdeskAgent.createMany({
      data: [...new Set(input.agentEmployeeIds)].map((employeeId) => ({
        organizationId: org,
        categoryId: id,
        employeeId,
      })),
    });
    await tx.helpdeskSla.deleteMany({ where: { categoryId: id } });
    if (input.sla.length)
      await tx.helpdeskSla.createMany({
        data: input.sla.map((x) => ({
          organizationId: org,
          categoryId: id,
          priority: x.priority,
          firstResponseHours: x.firstResponseHours ?? null,
          resolutionHours: x.resolutionHours ?? null,
        })),
      });
  }

  createCategory(
    principal: AuthPrincipal,
    input: In<typeof helpdeskCategorySchema>,
  ): Promise<HelpdeskCategoryItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const org = principal.organizationId ?? '';
        let id: string;
        try {
          id = (
            await tx.helpdeskCategory.create({
              data: {
                organizationId: org,
                code: input.code,
                name: input.name,
                description: input.description ?? null,
                confidential: input.confidential,
                defaultAssigneeId: input.defaultAssigneeId ?? null,
                escalationEmployeeId: input.escalationEmployeeId ?? null,
              },
              select: { id: true },
            })
          ).id;
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflictOn('A category with this code already exists', 'code');
          throw err;
        }
        await this.saveCategory(tx, org, id, input);
        await this.audit.record(tx, {
          action: 'helpdesk.category.created',
          entityType: 'helpdesk_category',
          entityId: id,
        });
      })
      .then(() => this.categories());
  }

  updateCategory(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof updateHelpdeskCategorySchema>,
  ): Promise<HelpdeskCategoryItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const c = await tx.helpdeskCategory.findFirst({ where: { id }, select: { id: true } });
        if (!c) throw AppException.notFound('Category');
        await tx.helpdeskCategory.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description ?? null,
            confidential: input.confidential,
            defaultAssigneeId: input.defaultAssigneeId ?? null,
            escalationEmployeeId: input.escalationEmployeeId ?? null,
            ...(input.status ? { status: input.status } : {}),
          },
        });
        await this.saveCategory(tx, principal.organizationId ?? '', id, input);
        await this.audit.record(tx, {
          action: 'helpdesk.category.updated',
          entityType: 'helpdesk_category',
          entityId: id,
        });
      })
      .then(() => this.categories());
  }

  // ---------------------------------------------------------------------------- access

  /** Categories the caller works as an agent. */
  private async agentCategories(tx: TenantTransaction, me: string | null): Promise<string[]> {
    if (!me) return [];
    return (
      await tx.helpdeskAgent.findMany({ where: { employeeId: me }, select: { categoryId: true } })
    ).map((a) => a.categoryId);
  }

  /** Which tickets the caller works: their categories, plus every non-confidential one with ticket.manage. */
  private async workWhere(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    me: string | null,
  ): Promise<Prisma.TicketWhereInput> {
    const mine = await this.agentCategories(tx, me);
    const ors: Prisma.TicketWhereInput[] = [{ categoryId: { in: mine } }];
    // Whoever a ticket is assigned (or escalated) to works it.
    if (me) ors.push({ assigneeEmployeeId: me });
    if (can(principal, P.HELPDESK_TICKET_MANAGE, {}))
      ors.push({ category: { confidential: false } });
    return { OR: ors };
  }

  private async access(tx: TenantTransaction, principal: AuthPrincipal, id: string) {
    const me = await myEmployeeId(tx, principal);
    const t = await tx.ticket.findFirst({
      where: { id },
      select: {
        ...ticketSelect,
        category: { select: { id: true, code: true, name: true, confidential: true } },
      },
    });
    if (!t) throw AppException.notFound('Ticket');
    const agentOf = await this.agentCategories(tx, me);
    const work =
      agentOf.includes(t.categoryId) ||
      (me !== null && t.assigneeEmployeeId === me) ||
      (!t.category.confidential && can(principal, P.HELPDESK_TICKET_MANAGE, {}));
    const requester = me !== null && t.requesterEmployeeId === me;
    if (!work && !requester) throw AppException.notFound('Ticket');
    return { t, me, work, requester };
  }

  // ---------------------------------------------------------------------------- tickets

  list(principal: AuthPrincipal, q: In<typeof ticketListQuerySchema>): Promise<TicketItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      let where: Prisma.TicketWhereInput;
      if (q.scope === 'mine')
        where = { requesterEmployeeId: me ?? '00000000-0000-0000-0000-000000000000' };
      else {
        where = await this.workWhere(tx, principal, me);
        if (q.scope === 'queue')
          where = { AND: [where, { status: { notIn: ['RESOLVED', 'CLOSED'] } }] };
      }
      const rows = await tx.ticket.findMany({
        where: {
          AND: [
            where,
            q.status ? { status: q.status as TicketStatus } : {},
            q.categoryId ? { categoryId: q.categoryId } : {},
            q.search
              ? {
                  OR: [
                    { subject: { contains: q.search, mode: 'insensitive' } },
                    { number: { contains: q.search.toUpperCase() } },
                  ],
                }
              : {},
          ],
        },
        orderBy: [{ resolutionDue: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        select: ticketSelect,
        take: 300,
      });
      return rows.map((r) => toTicket(r));
    });
  }

  private async event(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    ticketId: string,
    action: string,
    from: string | null,
    to: string | null,
  ) {
    await tx.ticketEvent.create({
      data: {
        organizationId: principal.organizationId ?? '',
        ticketId,
        action,
        fromValue: from,
        toValue: to,
        actorUserId: principal.userId,
      },
    });
  }

  create(principal: AuthPrincipal, input: In<typeof ticketSchema>): Promise<TicketDetails> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const org = principal.organizationId ?? '';
      const c = await tx.helpdeskCategory.findFirst({
        where: { id: input.categoryId, status: 'ACTIVE' },
        select: {
          id: true,
          defaultAssigneeId: true,
          slas: { where: { priority: input.priority } },
        },
      });
      if (!c) throw AppException.badRequest('The category does not exist', 'categoryId');
      await tx.helpdeskSettings.upsert({
        where: { organizationId: org },
        create: { organizationId: org },
        update: {},
      });
      await tx.$queryRaw`SELECT organization_id FROM helpdesk_settings WHERE organization_id = ${org}::uuid FOR UPDATE`;
      const s = await tx.helpdeskSettings.update({
        where: { organizationId: org },
        data: { nextSequence: { increment: 1 } },
        select: { ticketPrefix: true, nextSequence: true },
      });
      const now = new Date();
      const due = slaDue(now, c.slas[0] ?? null);
      const t = await tx.ticket.create({
        data: {
          organizationId: org,
          number: ticketNumber(s.ticketPrefix, now.getUTCFullYear(), s.nextSequence - 1),
          categoryId: c.id,
          requesterEmployeeId: me,
          assigneeEmployeeId:
            c.defaultAssigneeId && c.defaultAssigneeId !== me ? c.defaultAssigneeId : null,
          subject: input.subject,
          description: input.description,
          priority: input.priority,
          firstResponseDue: due.firstResponseDue,
          resolutionDue: due.resolutionDue,
          createdAt: now,
        },
        select: { id: true },
      });
      await this.event(tx, principal, t.id, 'created', null, input.priority.toLowerCase());
      await this.audit.record(tx, {
        action: 'helpdesk.ticket.created',
        entityType: 'ticket',
        entityId: t.id,
      });
      return this.details(tx, principal, t.id);
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<TicketDetails> {
    return this.prisma.withTenant((tx) => this.details(tx, principal, id));
  }

  private async details(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<TicketDetails> {
    const { work, requester } = await this.access(tx, principal, id);
    const t = await tx.ticket.findFirstOrThrow({
      where: { id },
      select: {
        ...ticketSelect,
        description: true,
        resolution: true,
        rating: true,
        ratingComment: true,
        comments: { where: work ? {} : { internal: false }, orderBy: { createdAt: 'asc' } },
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, fileName: true, contentType: true, size: true, createdAt: true },
        },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    const names = await userNames(tx, [
      ...t.comments.map((c) => c.authorUserId),
      ...t.events.map((e) => e.actorUserId),
    ]);
    return {
      ...toTicket(t),
      description: t.description,
      resolution: t.resolution,
      rating: t.rating,
      ratingComment: t.ratingComment,
      comments: t.comments.map((c) => ({
        id: c.id,
        body: c.body,
        internal: c.internal,
        author: c.authorUserId ? (names.get(c.authorUserId) ?? null) : null,
        byRequester: c.byRequester,
        createdAt: c.createdAt.toISOString(),
      })),
      attachments: t.attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      history: work
        ? t.events.map((e) => ({
            action: e.action,
            from: e.fromValue,
            to: e.toValue,
            actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
            at: e.createdAt.toISOString(),
          }))
        : [],
      can: {
        work,
        comment: t.status !== 'CLOSED' && (work || requester),
        internal: work,
        rate: requester && (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.rating === null,
        reopen: requester && t.status === 'RESOLVED',
        close: (requester || work) && t.status === 'RESOLVED',
      },
    };
  }

  update(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof ticketUpdateSchema>,
  ): Promise<TicketDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { t, work, requester } = await this.access(tx, principal, id);
      const data: Prisma.TicketUncheckedUpdateInput = {};
      if (input.status && input.status !== t.status) {
        // Requesters may only reopen a resolved ticket or close it; agents move it along.
        const requesterMove =
          requester &&
          t.status === 'RESOLVED' &&
          (input.status === 'OPEN' || input.status === 'CLOSED');
        if (!work && !requesterMove)
          throw AppException.forbidden('Only the helpdesk agents can change this ticket');
        if (!canMoveTicket(t.status, input.status))
          throw AppException.conflict(
            `A ${t.status.toLowerCase().replace(/_/g, ' ')} ticket cannot become ${input.status.toLowerCase().replace(/_/g, ' ')}`,
          );
        data.status = input.status;
        if (input.status === 'RESOLVED') {
          data.resolvedAt = new Date();
          data.resolution = input.resolution ?? null;
        }
        if (input.status === 'OPEN') data.resolvedAt = null;
        if (input.status === 'CLOSED') data.closedAt = new Date();
        await this.event(
          tx,
          principal,
          id,
          'status',
          t.status.toLowerCase(),
          input.status.toLowerCase(),
        );
      }
      if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeEmployeeId) {
        if (!work) throw AppException.forbidden('Only the helpdesk agents can assign tickets');
        if (input.assigneeId) {
          const agent = await tx.helpdeskAgent.count({
            where: { categoryId: t.categoryId, employeeId: input.assigneeId },
          });
          if (!agent)
            throw AppException.badRequest('Assign to an agent of this category', 'assigneeId');
        }
        data.assigneeEmployeeId = input.assigneeId;
        await this.event(
          tx,
          principal,
          id,
          'assigned',
          t.assignee ? ref(t.assignee).displayName : null,
          input.assigneeId ?? null,
        );
      }
      if (input.priority && input.priority !== t.priority) {
        if (!work) throw AppException.forbidden('Only the helpdesk agents can change the priority');
        data.priority = input.priority;
        await this.event(
          tx,
          principal,
          id,
          'priority',
          t.priority.toLowerCase(),
          input.priority.toLowerCase(),
        );
      }
      if (Object.keys(data).length) await tx.ticket.update({ where: { id }, data });
      return this.details(tx, principal, id);
    });
  }

  comment(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof ticketCommentSchema>,
  ): Promise<TicketDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { t, work, requester } = await this.access(tx, principal, id);
      if (t.status === 'CLOSED') throw AppException.conflict('The ticket is closed');
      if (input.internal && !work) throw AppException.forbidden('Only agents write internal notes');
      await tx.ticketComment.create({
        data: {
          organizationId: principal.organizationId ?? '',
          ticketId: id,
          body: input.body,
          internal: input.internal,
          byRequester: requester && !work,
          authorUserId: principal.userId,
        },
      });
      // The first public agent reply is the first response; a requester reply moves a waiting ticket back.
      const data: Prisma.TicketUncheckedUpdateInput = {};
      if (work && !input.internal && !t.firstRespondedAt && !requester)
        data.firstRespondedAt = new Date();
      if (requester && !work && t.status === 'WAITING_ON_REQUESTER') data.status = 'IN_PROGRESS';
      if (Object.keys(data).length) await tx.ticket.update({ where: { id }, data });
      return this.details(tx, principal, id);
    });
  }

  rate(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof ticketRatingSchema>,
  ): Promise<TicketDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { t, requester } = await this.access(tx, principal, id);
      if (!requester) throw AppException.forbidden('Only the requester rates a ticket');
      if (t.status !== 'RESOLVED' && t.status !== 'CLOSED')
        throw AppException.conflict('Rate a ticket once it is resolved');
      await tx.ticket.update({
        where: { id },
        data: { rating: input.rating, ratingComment: input.comment ?? null },
      });
      return this.details(tx, principal, id);
    });
  }

  async attach(
    principal: AuthPrincipal,
    id: string,
    file: UploadedFileLike | undefined,
  ): Promise<TicketDetails> {
    if (!file?.buffer.length) throw AppException.badRequest('Choose a file', 'file');
    if (file.size > DOCUMENT_MAX_BYTES)
      throw AppException.badRequest('The file is too large', 'file');
    const type = sniffContentType(file.buffer);
    if (!type) throw AppException.badRequest('Attach a PDF or an image', 'file');
    await this.prisma.withTenant(async (tx) => {
      const { t } = await this.access(tx, principal, id);
      if (t.status === 'CLOSED') throw AppException.conflict('The ticket is closed');
    });
    const key = StorageService.tenantKey(principal.organizationId ?? '', 'helpdesk', uuidv7());
    await this.storage.client.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: type,
        ContentLength: file.size,
      }),
    );
    return this.prisma.withTenant(async (tx) => {
      await tx.ticketAttachment.create({
        data: {
          organizationId: principal.organizationId ?? '',
          ticketId: id,
          storageKey: key,
          fileName: safeFileName(file.originalname),
          contentType: type,
          size: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          uploadedByUserId: principal.userId,
        },
      });
      await this.event(tx, principal, id, 'attachment', null, safeFileName(file.originalname));
      return this.details(tx, principal, id);
    });
  }

  async openAttachment(
    principal: AuthPrincipal,
    id: string,
    attachmentId: string,
  ): Promise<{ stream: Readable; fileName: string; contentType: string; size: number }> {
    const a = await this.prisma.withTenant(async (tx) => {
      await this.access(tx, principal, id);
      const x = await tx.ticketAttachment.findFirst({ where: { id: attachmentId, ticketId: id } });
      if (!x) throw AppException.notFound('Attachment');
      return x;
    });
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: a.storageKey }),
    );
    if (!obj.Body) throw AppException.notFound('Attachment');
    return {
      stream: obj.Body as Readable,
      fileName: a.fileName,
      contentType: a.contentType,
      size: a.size,
    };
  }

  // ---------------------------------------------------------------------------- escalation

  /** Reassigns tickets past their resolution time to the category's escalation contact. */
  escalate(organizationId: string, now = new Date()): Promise<number> {
    return this.prisma.withTenant(
      async (tx) => {
        const late = await tx.ticket.findMany({
          where: {
            status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER'] },
            resolutionDue: { lt: now },
            escalatedAt: null,
          },
          select: {
            id: true,
            assigneeEmployeeId: true,
            requesterEmployeeId: true,
            category: { select: { escalationEmployeeId: true } },
          },
        });
        let n = 0;
        for (const t of late) {
          const to = t.category.escalationEmployeeId;
          await tx.ticket.update({
            where: { id: t.id },
            data: {
              escalatedAt: now,
              ...(to && to !== t.requesterEmployeeId ? { assigneeEmployeeId: to } : {}),
            },
          });
          await tx.ticketEvent.create({
            data: {
              organizationId,
              ticketId: t.id,
              action: 'escalated',
              fromValue: t.assigneeEmployeeId,
              toValue: to,
            },
          });
          await this.audit.record(
            tx,
            { action: 'helpdesk.ticket.escalated', entityType: 'ticket', entityId: t.id },
            { organizationId, actorId: null },
          );
          n++;
        }
        return n;
      },
      { organizationId },
    );
  }

  async tenantsWithBreaches(): Promise<string[]> {
    return (
      await this.prisma.$queryRaw<
        { id: string }[]
      >`SELECT app.tenants_with_breached_tickets()::text AS id`
    ).map((r) => r.id);
  }

  // ---------------------------------------------------------------------------- knowledge base

  private async toArticles(
    tx: TenantTransaction,
    where: Prisma.KbArticleWhereInput,
  ): Promise<ArticleItem[]> {
    const rows = await tx.kbArticle.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        body: true,
        status: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        votes: { select: { helpful: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      body: r.body,
      status: r.status,
      helpful: r.votes.filter((v) => v.helpful).length,
      notHelpful: r.votes.filter((v) => !v.helpful).length,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  articles(principal: AuthPrincipal, search?: string): Promise<ArticleItem[]> {
    const manage = can(principal, P.HELPDESK_KNOWLEDGE_MANAGE, {});
    return this.prisma.withTenant((tx) =>
      this.toArticles(tx, {
        ...(manage ? {} : { status: 'PUBLISHED' }),
        ...(search
          ? {
              OR: search
                .split(/\s+/)
                .filter((w) => w.length > 2)
                .slice(0, 6)
                .flatMap((w) => [
                  { title: { contains: w, mode: 'insensitive' as const } },
                  { body: { contains: w, mode: 'insensitive' as const } },
                ]),
            }
          : {}),
      }),
    );
  }

  createArticle(principal: AuthPrincipal, input: In<typeof articleSchema>): Promise<ArticleItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const a = await tx.kbArticle.create({
          data: {
            organizationId: principal.organizationId ?? '',
            categoryId: input.categoryId ?? null,
            title: input.title,
            body: input.body,
            status: input.status,
            authorUserId: principal.userId,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'helpdesk.article.created',
          entityType: 'kb_article',
          entityId: a.id,
        });
      })
      .then(() => this.articles(principal));
  }

  updateArticle(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof updateArticleSchema>,
  ): Promise<ArticleItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const n = await tx.kbArticle.updateMany({
          where: { id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          },
        });
        if (!n.count) throw AppException.notFound('Article');
        await this.audit.record(tx, {
          action: 'helpdesk.article.updated',
          entityType: 'kb_article',
          entityId: id,
        });
      })
      .then(() => this.articles(principal));
  }

  vote(principal: AuthPrincipal, id: string, helpful: boolean): Promise<ArticleItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        const a = await tx.kbArticle.findFirst({
          where: { id, status: 'PUBLISHED' },
          select: { id: true },
        });
        if (!a) throw AppException.notFound('Article');
        await tx.kbArticleVote.upsert({
          where: { articleId_employeeId: { articleId: id, employeeId: me } },
          create: {
            organizationId: principal.organizationId ?? '',
            articleId: id,
            employeeId: me,
            helpful,
          },
          update: { helpful },
        });
      })
      .then(() => this.articles(principal));
  }
}
