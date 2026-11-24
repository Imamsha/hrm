import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  aggregateSurvey,
  pointsBalance,
  type SurveyAnswer,
  type SurveyQuestion,
  validateSurveyAnswers,
} from '@hrm/business-rules';
import {
  type AnnouncementItem,
  type BadgeItem,
  type EventItem,
  type MyRecognitionSummary,
  PERMISSIONS,
  type RecognitionItem,
  type RedemptionItem,
  type RewardItem,
  type SuggestionItem,
  type SurveyItem,
  type SurveyResultItem,
} from '@hrm/shared-types';
import type {
  announcementSchema,
  badgeSchema,
  eventSchema,
  recognitionSchema,
  redemptionDecisionSchema,
  rewardSchema,
  rsvpSchema,
  suggestionSchema,
  suggestionStatusSchema,
  surveyResponseSchema,
  surveySchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { mapWriteError } from '../structure/structure.util.js';
import {
  audienceEmployees,
  departmentOf,
  empSelect,
  inAudience,
  myEmployeeId,
  ref,
  requireMe,
} from './talent-common.js';

const P = PERMISSIONS;
const audienceOf = (x: {
  audienceCompanyId: string | null;
  audienceDepartmentId: string | null;
}) => ({ companyId: x.audienceCompanyId, departmentId: x.audienceDepartmentId });

@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------------------ surveys

  private async surveyItem(
    tx: TenantTransaction,
    s: Prisma.SurveyGetPayload<object>,
    me: string | null,
  ): Promise<SurveyItem> {
    const [invited, responded, mine] = await Promise.all([
      tx.surveyInvitation.count({ where: { surveyId: s.id } }),
      tx.surveyInvitation.count({ where: { surveyId: s.id, respondedAt: { not: null } } }),
      me
        ? tx.surveyInvitation.findFirst({
            where: { surveyId: s.id, employeeId: me },
            select: { respondedAt: true },
          })
        : null,
    ]);
    const now = new Date();
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      kind: s.kind,
      anonymous: s.anonymous,
      minimumGroupSize: s.minimumGroupSize,
      opensAt: s.opensAt.toISOString(),
      closesAt: s.closesAt.toISOString(),
      status: s.status === 'PUBLISHED' && s.closesAt <= now ? 'CLOSED' : s.status,
      questions: s.questions as unknown as SurveyQuestion[],
      invited,
      responded,
      canRespond:
        !!mine &&
        !mine.respondedAt &&
        s.status === 'PUBLISHED' &&
        s.opensAt <= now &&
        s.closesAt > now,
      hasResponded: !!mine?.respondedAt,
    };
  }

  surveys(principal: AuthPrincipal): Promise<SurveyItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const manage = can(principal, P.ENGAGEMENT_SURVEY_MANAGE, {});
      const rows = await tx.survey.findMany({
        where: manage
          ? {}
          : { status: { not: 'DRAFT' }, invitations: { some: { employeeId: me ?? '' } } },
        orderBy: { opensAt: 'desc' },
      });
      return Promise.all(rows.map((s) => this.surveyItem(tx, s, me)));
    });
  }

  createSurvey(
    principal: AuthPrincipal,
    input: z.output<typeof surveySchema>,
  ): Promise<SurveyItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await tx.survey.create({
        data: {
          organizationId: principal.organizationId ?? '',
          title: input.title,
          description: input.description ?? null,
          kind: input.kind,
          anonymous: input.anonymous,
          minimumGroupSize: input.minimumGroupSize,
          audienceCompanyId: input.audience.companyId,
          audienceDepartmentId: input.audience.departmentId,
          opensAt: new Date(input.opensAt),
          closesAt: new Date(input.closesAt),
          questions: input.questions,
          createdByUserId: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'engagement.survey.created',
        entityType: 'survey',
        entityId: s.id,
        metadata: { anonymous: s.anonymous },
      });
      return this.surveyItem(tx, s, await myEmployeeId(tx, principal));
    });
  }

  /** Publishing invites the audience as it is now; questions and anonymity are fixed from then on. */
  publishSurvey(principal: AuthPrincipal, id: string): Promise<SurveyItem> {
    return this.prisma.withTenant(
      async (tx) => {
        const s = await tx.survey.findFirst({ where: { id } });
        if (!s) throw AppException.notFound('Survey');
        if (s.status !== 'DRAFT') throw AppException.conflict('Only a draft can be published');
        if (s.closesAt <= new Date()) throw AppException.conflict('The closing time has passed');
        const people = await audienceEmployees(tx, audienceOf(s));
        if (!people.length) throw AppException.conflict('Nobody is in the survey’s audience');
        await tx.surveyInvitation.createMany({
          data: people.map((p) => ({
            organizationId: principal.organizationId ?? '',
            surveyId: id,
            employeeId: p.id,
          })),
          skipDuplicates: true,
        });
        const out = await tx.survey.update({ where: { id }, data: { status: 'PUBLISHED' } });
        await this.audit.record(tx, {
          action: 'engagement.survey.published',
          entityType: 'survey',
          entityId: id,
          metadata: { invited: people.length },
        });
        return this.surveyItem(tx, out, await myEmployeeId(tx, principal));
      },
      { timeoutMs: 60_000 },
    );
  }

  closeSurvey(principal: AuthPrincipal, id: string): Promise<SurveyItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await tx.survey.findFirst({ where: { id }, select: { status: true } });
      if (!s) throw AppException.notFound('Survey');
      if (s.status !== 'PUBLISHED')
        throw AppException.conflict('Only a published survey can be closed');
      const out = await tx.survey.update({
        where: { id },
        data: { status: 'CLOSED', closesAt: new Date() },
      });
      return this.surveyItem(tx, out, await myEmployeeId(tx, principal));
    });
  }

  /**
   * Records a response. For anonymous surveys the response row carries no employee id; only the
   * invitation is marked as responded (so nobody can answer twice and reminders still work).
   */
  respond(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof surveyResponseSchema>,
  ): Promise<SurveyItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      await tx.$queryRaw`SELECT survey_id FROM survey_invitations WHERE survey_id = ${id}::uuid AND employee_id = ${me}::uuid FOR UPDATE`;
      const s = await tx.survey.findFirst({ where: { id } });
      const inv = await tx.surveyInvitation.findFirst({ where: { surveyId: id, employeeId: me } });
      if (!s || !inv) throw AppException.notFound('Survey');
      const now = new Date();
      if (s.status !== 'PUBLISHED' || s.opensAt > now || s.closesAt <= now)
        throw AppException.conflict('The survey is not open');
      if (inv.respondedAt) throw AppException.conflict('You have already responded');
      const problems = validateSurveyAnswers(
        s.questions as unknown as SurveyQuestion[],
        input.answers,
      );
      if (Object.keys(problems).length)
        throw AppException.validation(
          Object.entries(problems).map(([path, message]) => ({ path: `answers.${path}`, message })),
        );
      // Anonymous: a random (not time-ordered) id and only the day of submission, so the response
      // cannot be matched to the invitation's responded-at time.
      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      await tx.surveyResponse.create({
        data: {
          ...(s.anonymous ? { id: randomUUID(), submittedAt: day } : {}),
          organizationId: principal.organizationId ?? '',
          surveyId: id,
          employeeId: s.anonymous ? null : me,
          departmentId: await departmentOf(tx, me),
          answers: input.answers,
        },
      });
      await tx.surveyInvitation.update({
        where: { surveyId_employeeId: { surveyId: id, employeeId: me } },
        data: { respondedAt: now },
      });
      return this.surveyItem(tx, s, me);
    });
  }

  /** Aggregated results; nothing is shown for groups below the survey's minimum size. */
  results(id: string): Promise<SurveyResultItem> {
    return this.prisma.withTenant(async (tx) => {
      const s = await tx.survey.findFirst({ where: { id } });
      if (!s) throw AppException.notFound('Survey');
      const questions = s.questions as unknown as SurveyQuestion[];
      const responses = await tx.surveyResponse.findMany({
        where: { surveyId: id },
        select: { answers: true, departmentId: true },
      });
      const overall = aggregateSurvey(
        questions,
        responses.map((r) => r.answers as Record<string, SurveyAnswer>),
        s.minimumGroupSize,
      );
      const deptIds = [
        ...new Set(responses.map((r) => r.departmentId).filter((x): x is string => !!x)),
      ];
      const departments = await tx.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, name: true },
      });
      const byDepartment = departments.map((d) => {
        const group = responses
          .filter((r) => r.departmentId === d.id)
          .map((r) => r.answers as Record<string, SurveyAnswer>);
        const agg = aggregateSurvey(questions, group, s.minimumGroupSize);
        return {
          department: d.name,
          responses: agg.hidden ? 0 : group.length,
          hidden: agg.hidden,
          averages: Object.fromEntries(
            agg.questions
              .filter((q) => q.average || q.enps)
              .map((q) => [q.id, q.enps ?? q.average ?? '']),
          ),
        };
      });
      return {
        surveyId: id,
        responses: overall.responses,
        hidden: overall.hidden,
        minimumGroupSize: s.minimumGroupSize,
        questions: overall.questions,
        byDepartment,
      };
    });
  }

  // ------------------------------------------------------------------------------ recognition

  badges(): Promise<BadgeItem[]> {
    return this.prisma.withTenant(async (tx) =>
      tx.recognitionBadge.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, description: true, points: true, status: true },
      }),
    );
  }

  createBadge(principal: AuthPrincipal, input: z.output<typeof badgeSchema>): Promise<BadgeItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        try {
          await tx.recognitionBadge.create({
            data: {
              organizationId: principal.organizationId ?? '',
              name: input.name,
              description: input.description ?? null,
              points: input.points,
            },
          });
        } catch (err) {
          mapWriteError(err, { entity: 'badge', uniqueField: 'name' });
        }
      })
      .then(() => this.badges());
  }

  private recognitionItem(
    r: Prisma.RecognitionGetPayload<{
      include: {
        from: { select: typeof empSelect };
        to: { select: typeof empSelect };
        badge: { select: { id: true; name: true } };
      };
    }>,
  ): RecognitionItem {
    return {
      id: r.id,
      from: ref(r.from),
      to: ref(r.to),
      badge: r.badge,
      points: r.points,
      message: r.message,
      public: r.public,
      createdAt: r.createdAt.toISOString(),
    };
  }

  recognize(
    principal: AuthPrincipal,
    input: z.output<typeof recognitionSchema>,
  ): Promise<RecognitionItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      if (input.toEmployeeId === me)
        throw AppException.badRequest('You cannot recognise yourself', 'toEmployeeId');
      const badge = await tx.recognitionBadge.findFirst({
        where: { id: input.badgeId, status: 'ACTIVE' },
      });
      if (!badge) throw AppException.badRequest('The badge does not exist', 'badgeId');
      const to = await tx.employee.findFirst({
        where: { id: input.toEmployeeId, status: { not: 'SEPARATED' } },
        select: { id: true },
      });
      if (!to) throw AppException.badRequest('Choose a current colleague', 'toEmployeeId');
      const r = await tx.recognition.create({
        data: {
          organizationId: principal.organizationId ?? '',
          fromEmployeeId: me,
          toEmployeeId: input.toEmployeeId,
          badgeId: badge.id,
          points: badge.points,
          message: input.message,
          public: input.public,
        },
        include: {
          from: { select: empSelect },
          to: { select: empSelect },
          badge: { select: { id: true, name: true } },
        },
      });
      return this.recognitionItem(r);
    });
  }

  feed(principal: AuthPrincipal): Promise<RecognitionItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const rows = await tx.recognition.findMany({
        where: {
          OR: [{ public: true }, ...(me ? [{ fromEmployeeId: me }, { toEmployeeId: me }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          from: { select: empSelect },
          to: { select: empSelect },
          badge: { select: { id: true, name: true } },
        },
      });
      return rows.map((r) => this.recognitionItem(r));
    });
  }

  private async balanceOf(tx: TenantTransaction, employeeId: string): Promise<number> {
    const [received, held] = await Promise.all([
      tx.recognition.aggregate({ where: { toEmployeeId: employeeId }, _sum: { points: true } }),
      tx.rewardRedemption.aggregate({
        where: { employeeId, status: { in: ['PENDING', 'FULFILLED'] } },
        _sum: { pointsCost: true },
      }),
    ]);
    return pointsBalance([received._sum.points ?? 0], [held._sum.pointsCost ?? 0]);
  }

  mySummary(principal: AuthPrincipal): Promise<MyRecognitionSummary> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const include = {
        from: { select: empSelect },
        to: { select: empSelect },
        badge: { select: { id: true, name: true } },
      } as const;
      const [received, given, redemptions] = await Promise.all([
        tx.recognition.findMany({
          where: { toEmployeeId: me },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include,
        }),
        tx.recognition.findMany({
          where: { fromEmployeeId: me },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include,
        }),
        tx.rewardRedemption.findMany({
          where: { employeeId: me },
          orderBy: { createdAt: 'desc' },
          include: {
            reward: { select: { id: true, name: true } },
            employee: { select: empSelect },
          },
        }),
      ]);
      return {
        balance: await this.balanceOf(tx, me),
        received: received.map((r) => this.recognitionItem(r)),
        given: given.map((r) => this.recognitionItem(r)),
        redemptions: redemptions.map((r) => this.redemptionItem(r)),
      };
    });
  }

  rewards(): Promise<RewardItem[]> {
    return this.prisma.withTenant(async (tx) =>
      tx.reward.findMany({
        orderBy: { pointsCost: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          pointsCost: true,
          stock: true,
          status: true,
        },
      }),
    );
  }

  createReward(
    principal: AuthPrincipal,
    input: z.output<typeof rewardSchema>,
  ): Promise<RewardItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        try {
          await tx.reward.create({
            data: {
              organizationId: principal.organizationId ?? '',
              name: input.name,
              description: input.description ?? null,
              pointsCost: input.pointsCost,
              stock: input.stock ?? null,
            },
          });
        } catch (err) {
          mapWriteError(err, { entity: 'reward', uniqueField: 'name' });
        }
      })
      .then(() => this.rewards());
  }

  private redemptionItem(
    r: Prisma.RewardRedemptionGetPayload<{
      include: {
        reward: { select: { id: true; name: true } };
        employee: { select: typeof empSelect };
      };
    }>,
  ): RedemptionItem {
    return {
      id: r.id,
      reward: r.reward,
      employee: ref(r.employee),
      pointsCost: r.pointsCost,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Redeems points for a reward; the balance and stock are checked under row locks. */
  redeem(principal: AuthPrincipal, rewardId: string): Promise<MyRecognitionSummary> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        await tx.$queryRaw`SELECT id FROM employees WHERE id = ${me}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM rewards WHERE id = ${rewardId}::uuid FOR UPDATE`;
        const reward = await tx.reward.findFirst({ where: { id: rewardId, status: 'ACTIVE' } });
        if (!reward) throw AppException.notFound('Reward');
        if (reward.stock !== null && reward.stock <= 0)
          throw AppException.conflict('This reward is out of stock');
        if ((await this.balanceOf(tx, me)) < reward.pointsCost)
          throw AppException.conflict('You do not have enough points');
        await tx.rewardRedemption.create({
          data: {
            organizationId: principal.organizationId ?? '',
            rewardId,
            employeeId: me,
            pointsCost: reward.pointsCost,
          },
        });
        if (reward.stock !== null)
          await tx.reward.update({ where: { id: rewardId }, data: { stock: reward.stock - 1 } });
      })
      .then(() => this.mySummary(principal));
  }

  redemptions(status?: string): Promise<RedemptionItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.rewardRedemption.findMany({
          where: status ? { status: status as 'PENDING' } : {},
          orderBy: { createdAt: 'asc' },
          include: {
            reward: { select: { id: true, name: true } },
            employee: { select: empSelect },
          },
        })
      ).map((r) => this.redemptionItem(r)),
    );
  }

  decideRedemption(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof redemptionDecisionSchema>,
  ): Promise<RedemptionItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const r = await tx.rewardRedemption.findFirst({
          where: { id },
          select: { status: true, rewardId: true },
        });
        if (!r) throw AppException.notFound('Redemption');
        if (r.status !== 'PENDING')
          throw AppException.conflict('This redemption was already decided');
        await tx.rewardRedemption.update({
          where: { id },
          data: {
            status: input.status,
            note: input.note ?? null,
            decidedByUserId: principal.userId,
            decidedAt: new Date(),
          },
        });
        // A rejected redemption returns the points (no longer held) and the stock.
        if (input.status === 'REJECTED')
          await tx.reward.updateMany({
            where: { id: r.rewardId, stock: { not: null } },
            data: { stock: { increment: 1 } },
          });
        await this.audit.record(tx, {
          action: `engagement.redemption.${input.status.toLowerCase()}`,
          entityType: 'reward_redemption',
          entityId: id,
        });
      })
      .then(() => this.redemptions());
  }

  // ------------------------------------------------------------------------------ announcements

  announcements(principal: AuthPrincipal, includeAll: boolean): Promise<AnnouncementItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const manage = can(principal, P.ENGAGEMENT_CONTENT_MANAGE, {});
      const now = new Date();
      const rows = await tx.announcement.findMany({
        where:
          manage && includeAll
            ? {}
            : { publishAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: [{ pinned: 'desc' }, { publishAt: 'desc' }],
        take: 100,
        include: { reads: me ? { where: { employeeId: me } } : false },
      });
      const visible: typeof rows = [];
      for (const a of rows)
        if ((manage && includeAll) || (me && (await inAudience(tx, me, audienceOf(a)))) || manage)
          visible.push(a);
      const names = await userNames(
        tx,
        visible.map((a) => a.createdByUserId),
      );
      return Promise.all(
        visible.map(async (a) => {
          const read = Array.isArray(a.reads) ? a.reads[0] : undefined;
          let stats: AnnouncementItem['stats'] = null;
          if (manage) {
            const [audience, reads, acks] = await Promise.all([
              audienceEmployees(tx, audienceOf(a)).then((x) => x.length),
              tx.announcementRead.count({ where: { announcementId: a.id } }),
              tx.announcementRead.count({
                where: { announcementId: a.id, acknowledgedAt: { not: null } },
              }),
            ]);
            stats = { audience, read: reads, acknowledged: acks };
          }
          return {
            id: a.id,
            title: a.title,
            body: a.body,
            pinned: a.pinned,
            requiresAcknowledgement: a.requiresAcknowledgement,
            publishAt: a.publishAt.toISOString(),
            expiresAt: a.expiresAt?.toISOString() ?? null,
            author: a.createdByUserId ? (names.get(a.createdByUserId) ?? null) : null,
            readAt: read?.readAt.toISOString() ?? null,
            acknowledgedAt: read?.acknowledgedAt?.toISOString() ?? null,
            stats,
          };
        }),
      );
    });
  }

  createAnnouncement(
    principal: AuthPrincipal,
    input: z.output<typeof announcementSchema>,
  ): Promise<AnnouncementItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const a = await tx.announcement.create({
          data: {
            organizationId: principal.organizationId ?? '',
            title: input.title,
            body: input.body,
            audienceCompanyId: input.audience.companyId,
            audienceDepartmentId: input.audience.departmentId,
            pinned: input.pinned,
            requiresAcknowledgement: input.requiresAcknowledgement,
            publishAt: input.publishAt ? new Date(input.publishAt) : new Date(),
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'engagement.announcement.created',
          entityType: 'announcement',
          entityId: a.id,
        });
      })
      .then(() => this.announcements(principal, true));
  }

  markRead(
    principal: AuthPrincipal,
    id: string,
    acknowledge: boolean,
  ): Promise<AnnouncementItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        const a = await tx.announcement.findFirst({
          where: { id },
          select: {
            audienceCompanyId: true,
            audienceDepartmentId: true,
            requiresAcknowledgement: true,
          },
        });
        if (!a || !(await inAudience(tx, me, audienceOf(a))))
          throw AppException.notFound('Announcement');
        if (acknowledge && !a.requiresAcknowledgement)
          throw AppException.conflict('This announcement does not ask for acknowledgement');
        await tx.announcementRead.upsert({
          where: { announcementId_employeeId: { announcementId: id, employeeId: me } },
          create: {
            organizationId: principal.organizationId ?? '',
            announcementId: id,
            employeeId: me,
            ...(acknowledge ? { acknowledgedAt: new Date() } : {}),
          },
          update: acknowledge ? { acknowledgedAt: new Date() } : {},
        });
      })
      .then(() => this.announcements(principal, false));
  }

  // ------------------------------------------------------------------------------ events

  events(principal: AuthPrincipal): Promise<EventItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const manage = can(principal, P.ENGAGEMENT_CONTENT_MANAGE, {});
      const rows = await tx.companyEvent.findMany({
        where: { endsAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        orderBy: { startsAt: 'asc' },
        include: { rsvps: true },
      });
      const out: EventItem[] = [];
      for (const e of rows) {
        if (!manage && !(me && (await inAudience(tx, me, audienceOf(e))))) continue;
        out.push({
          id: e.id,
          title: e.title,
          description: e.description,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt.toISOString(),
          location: e.location,
          capacity: e.capacity,
          cancelledAt: e.cancelledAt?.toISOString() ?? null,
          going: e.rsvps.filter((r) => r.response === 'GOING').length,
          maybe: e.rsvps.filter((r) => r.response === 'MAYBE').length,
          myResponse: e.rsvps.find((r) => r.employeeId === me)?.response ?? null,
        });
      }
      return out;
    });
  }

  createEvent(principal: AuthPrincipal, input: z.output<typeof eventSchema>): Promise<EventItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        await tx.companyEvent.create({
          data: {
            organizationId: principal.organizationId ?? '',
            title: input.title,
            description: input.description ?? null,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            location: input.location ?? null,
            capacity: input.capacity ?? null,
            audienceCompanyId: input.audience.companyId,
            audienceDepartmentId: input.audience.departmentId,
            createdByUserId: principal.userId,
          },
        });
      })
      .then(() => this.events(principal));
  }

  cancelEvent(principal: AuthPrincipal, id: string): Promise<EventItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const e = await tx.companyEvent.findFirst({ where: { id }, select: { cancelledAt: true } });
        if (!e) throw AppException.notFound('Event');
        if (!e.cancelledAt)
          await tx.companyEvent.update({ where: { id }, data: { cancelledAt: new Date() } });
      })
      .then(() => this.events(principal));
  }

  rsvp(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof rsvpSchema>,
  ): Promise<EventItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        await tx.$queryRaw`SELECT id FROM company_events WHERE id = ${id}::uuid FOR UPDATE`;
        const e = await tx.companyEvent.findFirst({ where: { id }, include: { rsvps: true } });
        if (!e || !(await inAudience(tx, me, audienceOf(e)))) throw AppException.notFound('Event');
        if (e.cancelledAt) throw AppException.conflict('The event was cancelled');
        if (e.endsAt <= new Date()) throw AppException.conflict('The event is over');
        const already = e.rsvps.find((r) => r.employeeId === me)?.response === 'GOING';
        if (
          input.response === 'GOING' &&
          !already &&
          e.capacity !== null &&
          e.rsvps.filter((r) => r.response === 'GOING').length >= e.capacity
        )
          throw AppException.conflict('The event is full');
        await tx.eventRsvp.upsert({
          where: { eventId_employeeId: { eventId: id, employeeId: me } },
          create: {
            organizationId: principal.organizationId ?? '',
            eventId: id,
            employeeId: me,
            response: input.response,
          },
          update: { response: input.response },
        });
      })
      .then(() => this.events(principal));
  }

  // ------------------------------------------------------------------------------ suggestions

  suggestions(principal: AuthPrincipal): Promise<SuggestionItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const rows = await tx.suggestion.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { votes: { select: { employeeId: true } } },
      });
      const authors = await tx.employee.findMany({
        where: { id: { in: rows.map((r) => r.authorEmployeeId).filter((x): x is string => !!x) } },
        select: empSelect,
      });
      const byId = new Map(authors.map((a) => [a.id, a]));
      return rows.map((s) => {
        const author = s.authorEmployeeId ? byId.get(s.authorEmployeeId) : undefined;
        return {
          id: s.id,
          title: s.title,
          body: s.body,
          category: s.category,
          anonymous: s.anonymous,
          author: author ? ref(author) : null,
          status: s.status,
          response: s.response,
          votes: s.votes.length,
          myVote: !!me && s.votes.some((v) => v.employeeId === me),
          createdAt: s.createdAt.toISOString(),
        };
      });
    });
  }

  suggest(
    principal: AuthPrincipal,
    input: z.output<typeof suggestionSchema>,
  ): Promise<SuggestionItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        // Anonymous suggestions store no author at all (database CHECK) and are not audited with an actor.
        const s = await tx.suggestion.create({
          data: {
            // Anonymous: random id and day-only time, so request logs cannot be matched to it.
            ...(input.anonymous
              ? { id: randomUUID(), createdAt: new Date(new Date().toISOString().slice(0, 10)) }
              : {}),
            organizationId: principal.organizationId ?? '',
            authorEmployeeId: input.anonymous ? null : me,
            anonymous: input.anonymous,
            title: input.title,
            body: input.body,
            category: input.category ?? null,
          },
          select: { id: true },
        });
        if (!input.anonymous)
          await this.audit.record(tx, {
            action: 'engagement.suggestion.created',
            entityType: 'suggestion',
            entityId: s.id,
          });
      })
      .then(() => this.suggestions(principal));
  }

  vote(principal: AuthPrincipal, id: string, on: boolean): Promise<SuggestionItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        const s = await tx.suggestion.findFirst({ where: { id }, select: { id: true } });
        if (!s) throw AppException.notFound('Suggestion');
        if (on)
          await tx.suggestionVote.upsert({
            where: { suggestionId_employeeId: { suggestionId: id, employeeId: me } },
            create: {
              organizationId: principal.organizationId ?? '',
              suggestionId: id,
              employeeId: me,
            },
            update: {},
          });
        else await tx.suggestionVote.deleteMany({ where: { suggestionId: id, employeeId: me } });
      })
      .then(() => this.suggestions(principal));
  }

  setSuggestionStatus(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof suggestionStatusSchema>,
  ): Promise<SuggestionItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const s = await tx.suggestion.findFirst({ where: { id }, select: { id: true } });
        if (!s) throw AppException.notFound('Suggestion');
        await tx.suggestion.update({
          where: { id },
          data: {
            status: input.status,
            response: input.response ?? null,
            respondedByUserId: principal.userId,
            respondedAt: new Date(),
          },
        });
        await this.audit.record(tx, {
          action: 'engagement.suggestion.status',
          entityType: 'suggestion',
          entityId: id,
          metadata: { status: input.status },
        });
      })
      .then(() => this.suggestions(principal));
  }
}
