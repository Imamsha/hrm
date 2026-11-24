import { Injectable } from '@nestjs/common';
import {
  canMoveCycle,
  canRevealAggregate,
  Decimal,
  metricProgress,
  nearestPoint,
  ratingDistribution,
  reviewScore,
  rollUpProgress,
  type ScalePoint,
} from '@hrm/business-rules';
import {
  type CompetencyItem,
  type GoalCheckInItem,
  type GoalItem,
  type ImprovementPlanItem,
  type MyReviewTask,
  type PaginatedResult,
  type ParticipantItem,
  PERMISSIONS,
  type RatingScaleItem,
  type ReviewContent,
  type ReviewCycleItem,
  type ReviewDetails,
  type ReviewTemplateItem,
} from '@hrm/shared-types';
import type {
  calibrationSchema,
  competencySchema,
  goalCheckInSchema,
  goalSchema,
  pipCheckInSchema,
  pipOutcomeSchema,
  pipSchema,
  ratingScaleSchema,
  reviewCycleSchema,
  reviewResponseSchema,
  reviewTemplateSchema,
  talentListQuerySchema,
  updateCompetencySchema,
  updateGoalSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { isoDate, isoOrNull, toDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { definedOnly, mapWriteError } from '../structure/structure.util.js';
import {
  audienceEmployees,
  dec,
  directReports,
  empSelect,
  managerOf,
  myEmployeeId,
  ref,
  requireMe,
} from './talent-common.js';

const P = PERMISSIONS;
type Snapshot = Omit<ReviewTemplateItem, 'status'> & { scale: ScalePoint[] };
type TemplateRow = Prisma.ReviewTemplateGetPayload<{ include: { ratingScale: true } }>;

async function templateItem(tx: TenantTransaction, t: TemplateRow): Promise<ReviewTemplateItem> {
  const comps = t.competencies as { competencyId: string; weight: string }[];
  const rows = await tx.competency.findMany({
    where: { id: { in: comps.map((c) => c.competencyId) } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    id: t.id,
    name: t.name,
    ratingScale: { id: t.ratingScale.id, name: t.ratingScale.name },
    goalsWeightPercent: dec(t.goalsWeightPercent) ?? '0',
    competencies: comps.map((c) => ({
      competencyId: c.competencyId,
      code: byId.get(c.competencyId)?.code ?? '',
      name: byId.get(c.competencyId)?.name ?? '',
      weight: c.weight,
    })),
    questions: t.questions as ReviewTemplateItem['questions'],
    includeSelf: t.includeSelf,
    includeManager: t.includeManager,
    peerMin: t.peerMin,
    peerMax: t.peerMax,
    includeUpward: t.includeUpward,
    anonymityMinimum: t.anonymityMinimum,
    status: t.status,
  };
}

const goalInclude = {
  employee: { select: empSelect },
  parent: { select: { id: true, title: true } },
  _count: { select: { children: true } },
} satisfies Prisma.GoalInclude;
type GoalRow = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------------------ configuration

  scales(): Promise<RatingScaleItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (await tx.ratingScale.findMany({ orderBy: { name: 'asc' } })).map((s) => ({
        id: s.id,
        name: s.name,
        points: s.points as unknown as RatingScaleItem['points'],
        status: s.status,
      })),
    );
  }

  createScale(
    principal: AuthPrincipal,
    input: z.output<typeof ratingScaleSchema>,
  ): Promise<RatingScaleItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        try {
          const s = await tx.ratingScale.create({
            data: {
              organizationId: principal.organizationId ?? '',
              name: input.name,
              points: input.points,
            },
            select: { id: true },
          });
          await this.audit.record(tx, {
            action: 'performance.scale.created',
            entityType: 'rating_scale',
            entityId: s.id,
          });
        } catch (err) {
          mapWriteError(err, { entity: 'rating scale', uniqueField: 'name' });
        }
      })
      .then(() => this.scales());
  }

  competencies(): Promise<CompetencyItem[]> {
    return this.prisma.withTenant(async (tx) =>
      tx.competency.findMany({
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          category: true,
          status: true,
        },
      }),
    );
  }

  createCompetency(
    principal: AuthPrincipal,
    input: z.output<typeof competencySchema>,
  ): Promise<CompetencyItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        try {
          await tx.competency.create({
            data: {
              organizationId: principal.organizationId ?? '',
              code: input.code,
              name: input.name,
              description: input.description ?? null,
              category: input.category ?? null,
            },
          });
        } catch (err) {
          mapWriteError(err, { entity: 'competency', uniqueField: 'code' });
        }
      })
      .then(() => this.competencies());
  }

  updateCompetency(
    id: string,
    input: z.output<typeof updateCompetencySchema>,
  ): Promise<CompetencyItem[]> {
    return this.prisma
      .withTenant(async (tx) => tx.competency.update({ where: { id }, data: definedOnly(input) }))
      .then(() => this.competencies());
  }

  templates(): Promise<ReviewTemplateItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.reviewTemplate.findMany({
        orderBy: { name: 'asc' },
        include: { ratingScale: true },
      });
      return Promise.all(rows.map((t) => templateItem(tx, t)));
    });
  }

  createTemplate(
    principal: AuthPrincipal,
    input: z.output<typeof reviewTemplateSchema>,
  ): Promise<ReviewTemplateItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const scale = await tx.ratingScale.findFirst({
          where: { id: input.ratingScaleId },
          select: { status: true },
        });
        if (!scale)
          throw AppException.badRequest('The rating scale does not exist', 'ratingScaleId');
        const known = await tx.competency.count({
          where: { id: { in: input.competencies.map((c) => c.competencyId) }, status: 'ACTIVE' },
        });
        if (known !== input.competencies.length)
          throw AppException.badRequest(
            'A competency does not exist or is inactive',
            'competencies',
          );
        try {
          const t = await tx.reviewTemplate.create({
            data: {
              organizationId: principal.organizationId ?? '',
              name: input.name,
              ratingScaleId: input.ratingScaleId,
              goalsWeightPercent: input.goalsWeightPercent,
              competencies: input.competencies,
              questions: input.questions,
              includeSelf: input.includeSelf,
              includeManager: input.includeManager,
              peerMin: input.peerMin,
              peerMax: input.peerMax,
              includeUpward: input.includeUpward,
              anonymityMinimum: input.anonymityMinimum,
            },
            select: { id: true },
          });
          await this.audit.record(tx, {
            action: 'performance.template.created',
            entityType: 'review_template',
            entityId: t.id,
          });
        } catch (err) {
          if (err instanceof AppException) throw err;
          mapWriteError(err, { entity: 'template', uniqueField: 'name' });
        }
      })
      .then(() => this.templates());
  }

  // ------------------------------------------------------------------------------ cycles

  private async cycleItem(
    tx: TenantTransaction,
    c: Prisma.ReviewCycleGetPayload<{
      include: { template: { select: { id: true; name: true } } };
    }>,
  ): Promise<ReviewCycleItem> {
    const [participants, self, manager, finalized] = await Promise.all([
      tx.reviewParticipant.count({ where: { cycleId: c.id } }),
      tx.reviewResponse.count({
        where: { participant: { cycleId: c.id }, role: 'SELF', status: 'SUBMITTED' },
      }),
      tx.reviewResponse.count({
        where: { participant: { cycleId: c.id }, role: 'MANAGER', status: 'SUBMITTED' },
      }),
      tx.reviewParticipant.count({ where: { cycleId: c.id, finalRating: { not: null } } }),
    ]);
    return {
      id: c.id,
      name: c.name,
      template: c.template,
      periodStart: isoDate(c.periodStart),
      periodEnd: isoDate(c.periodEnd),
      selfDueOn: isoOrNull(c.selfDueOn),
      managerDueOn: isoOrNull(c.managerDueOn),
      audience: { companyId: c.audienceCompanyId, departmentId: c.audienceDepartmentId },
      status: c.status,
      launchedAt: c.launchedAt?.toISOString() ?? null,
      closedAt: c.closedAt?.toISOString() ?? null,
      participants,
      progress: { selfSubmitted: self, managerSubmitted: manager, finalized },
    };
  }

  cycles(): Promise<ReviewCycleItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.reviewCycle.findMany({
        orderBy: { periodStart: 'desc' },
        include: { template: { select: { id: true, name: true } } },
      });
      return Promise.all(rows.map((c) => this.cycleItem(tx, c)));
    });
  }

  createCycle(
    principal: AuthPrincipal,
    input: z.output<typeof reviewCycleSchema>,
  ): Promise<ReviewCycleItem> {
    return this.prisma.withTenant(async (tx) => {
      const t = await tx.reviewTemplate.findFirst({
        where: { id: input.templateId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!t)
        throw AppException.badRequest('The template does not exist or is inactive', 'templateId');
      const c = await tx.reviewCycle.create({
        data: {
          organizationId: principal.organizationId ?? '',
          name: input.name,
          templateId: input.templateId,
          periodStart: toDate(input.periodStart),
          periodEnd: toDate(input.periodEnd),
          selfDueOn: input.selfDueOn ? toDate(input.selfDueOn) : null,
          managerDueOn: input.managerDueOn ? toDate(input.managerDueOn) : null,
          audienceCompanyId: input.audience.companyId,
          audienceDepartmentId: input.audience.departmentId,
          createdByUserId: principal.userId,
        },
        include: { template: { select: { id: true, name: true } } },
      });
      await this.audit.record(tx, {
        action: 'performance.cycle.created',
        entityType: 'review_cycle',
        entityId: c.id,
      });
      return this.cycleItem(tx, c);
    });
  }

  /**
   * DRAFT → OPEN launches the cycle: snapshots the template and scale, enrols everyone in the
   * audience with their manager now, and creates the reviewer slots. OPEN ↔ CALIBRATION and
   * CALIBRATION → CLOSED (finalizes ratings and releases results).
   */
  setCycleStatus(
    principal: AuthPrincipal,
    id: string,
    status: 'OPEN' | 'CALIBRATION' | 'CLOSED',
  ): Promise<ReviewCycleItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM review_cycles WHERE id = ${id}::uuid FOR UPDATE`;
        const c = await tx.reviewCycle.findFirst({ where: { id } });
        if (!c) throw AppException.notFound('Review cycle');
        if (!canMoveCycle(c.status, status))
          throw AppException.conflict(
            `A ${c.status.toLowerCase()} cycle cannot become ${status.toLowerCase()}`,
          );
        const data: Prisma.ReviewCycleUpdateInput = { status };
        if (c.status === 'DRAFT') {
          const t = await tx.reviewTemplate.findFirst({
            where: { id: c.templateId },
            include: { ratingScale: true },
          });
          if (!t) throw AppException.notFound('Template');
          const snapshot: Snapshot = {
            ...(await templateItem(tx, t)),
            scale: t.ratingScale.points as unknown as ScalePoint[],
          };
          const people = await audienceEmployees(tx, {
            companyId: c.audienceCompanyId,
            departmentId: c.audienceDepartmentId,
          });
          if (!people.length) throw AppException.conflict('Nobody is in the cycle’s audience');
          for (const p of people) {
            const manager = await managerOf(tx, p.id);
            const part = await tx.reviewParticipant.create({
              data: {
                organizationId,
                cycleId: id,
                employeeId: p.id,
                managerEmployeeId: manager && manager !== p.id ? manager : null,
              },
              select: { id: true, managerEmployeeId: true },
            });
            const slots: { reviewerEmployeeId: string; role: 'SELF' | 'MANAGER' | 'UPWARD' }[] = [];
            if (t.includeSelf) slots.push({ reviewerEmployeeId: p.id, role: 'SELF' });
            if (t.includeManager && part.managerEmployeeId)
              slots.push({ reviewerEmployeeId: part.managerEmployeeId, role: 'MANAGER' });
            if (t.includeUpward)
              for (const r of await directReports(tx, p.id))
                slots.push({ reviewerEmployeeId: r, role: 'UPWARD' });
            if (slots.length)
              await tx.reviewResponse.createMany({
                data: slots.map((s) => ({ organizationId, participantId: part.id, ...s })),
              });
          }
          Object.assign(data, {
            templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            launchedAt: new Date(),
          });
        }
        if (status === 'CLOSED') {
          // Final rating = calibrated rating, else the computed one; then results are released.
          const parts = await tx.reviewParticipant.findMany({
            where: { cycleId: id },
            select: { id: true, finalRating: true, computedRating: true },
          });
          for (const p of parts)
            if (p.finalRating === null && p.computedRating !== null)
              await tx.reviewParticipant.update({
                where: { id: p.id },
                data: { finalRating: p.computedRating },
              });
          data.closedAt = new Date();
        }
        await tx.reviewCycle.update({ where: { id }, data });
        await this.audit.record(tx, {
          action: `performance.cycle.${status.toLowerCase()}`,
          entityType: 'review_cycle',
          entityId: id,
        });
        const out = await tx.reviewCycle.findFirst({
          where: { id },
          include: { template: { select: { id: true, name: true } } },
        });
        if (!out) throw AppException.notFound('Review cycle');
        return this.cycleItem(tx, out);
      },
      { timeoutMs: 120_000 },
    );
  }

  // ------------------------------------------------------------------------------ participants & reviews

  private async participantItem(
    tx: TenantTransaction,
    p: Prisma.ReviewParticipantGetPayload<{
      include: {
        employee: { select: typeof empSelect };
        cycle: true;
        responses: { select: { role: true; status: true } };
      };
    }>,
  ): Promise<ParticipantItem> {
    const manager = p.managerEmployeeId
      ? await tx.employee.findFirst({ where: { id: p.managerEmployeeId }, select: empSelect })
      : null;
    const snap = p.cycle.templateSnapshot as unknown as Snapshot | null;
    const roles = ['SELF', 'MANAGER', 'PEER', 'UPWARD'] as const;
    return {
      id: p.id,
      cycle: { id: p.cycle.id, name: p.cycle.name, status: p.cycle.status },
      employee: ref(p.employee),
      manager: manager ? ref(manager) : null,
      computedScore: dec(p.computedScore),
      computedRating: dec(p.computedRating),
      finalRating:
        p.cycle.status === 'CLOSED' || p.finalRating !== null ? dec(p.finalRating) : null,
      finalLabel:
        p.finalRating !== null && snap
          ? (nearestPoint(p.finalRating.toString(), snap.scale)?.label ?? null)
          : null,
      calibrationReason: p.calibrationReason,
      promotion: p.promotion,
      promotionJustification: p.promotionJustification,
      acknowledgedAt: p.acknowledgedAt?.toISOString() ?? null,
      responses: roles
        .map((role) => ({
          role,
          total: p.responses.filter((r) => r.role === role && r.status !== 'DECLINED').length,
          submitted: p.responses.filter((r) => r.role === role && r.status === 'SUBMITTED').length,
        }))
        .filter((r) => r.total > 0),
    };
  }

  participants(principal: AuthPrincipal, cycleId: string): Promise<ParticipantItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const all = can(principal, P.PERFORMANCE_CYCLE_MANAGE, {});
      const rows = await tx.reviewParticipant.findMany({
        where: {
          cycleId,
          ...(all ? {} : { managerEmployeeId: me ?? '00000000-0000-0000-0000-000000000000' }),
        },
        orderBy: { employee: { employeeNumber: 'asc' } },
        include: {
          employee: { select: empSelect },
          cycle: true,
          responses: { select: { role: true, status: true } },
        },
      });
      return Promise.all(rows.map((r) => this.participantItem(tx, r)));
    });
  }

  myTasks(principal: AuthPrincipal): Promise<MyReviewTask[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const rows = await tx.reviewResponse.findMany({
        where: {
          reviewerEmployeeId: me,
          participant: { cycle: { status: { in: ['OPEN', 'CALIBRATION', 'CLOSED'] } } },
        },
        orderBy: { createdAt: 'desc' },
        include: { participant: { include: { employee: { select: empSelect }, cycle: true } } },
      });
      return rows.map((r) => ({
        responseId: r.id,
        role: r.role,
        status: r.status,
        participantId: r.participantId,
        cycle: {
          id: r.participant.cycle.id,
          name: r.participant.cycle.name,
          selfDueOn: isoOrNull(r.participant.cycle.selfDueOn),
          managerDueOn: isoOrNull(r.participant.cycle.managerDueOn),
        },
        employee: ref(r.participant.employee),
      }));
    });
  }

  /** Participant ids the caller takes part in as reviewee (own results). */
  myReviews(principal: AuthPrincipal): Promise<ParticipantItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const rows = await tx.reviewParticipant.findMany({
        where: { employeeId: me, cycle: { status: { not: 'DRAFT' } } },
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: empSelect },
          cycle: true,
          responses: { select: { role: true, status: true } },
        },
      });
      return Promise.all(
        rows.map(async (r) => ({
          ...(await this.participantItem(tx, r)),
          ...(r.cycle.status === 'CLOSED'
            ? {}
            : { finalRating: null, finalLabel: null, computedRating: null, computedScore: null }),
        })),
      );
    });
  }

  /**
   * One participant's review as the caller may see it:
   *  - HR (cycle manage) and the manager see every response with names;
   *  - a reviewer sees only their own response;
   *  - the employee sees their self-review, and after the cycle closes the final rating, the
   *    manager's review and peer/upward feedback aggregated without names (minimum count).
   */
  review(principal: AuthPrincipal, participantId: string): Promise<ReviewDetails> {
    return this.prisma.withTenant(async (tx) => this.reviewIn(tx, principal, participantId));
  }

  private async reviewIn(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    participantId: string,
  ): Promise<ReviewDetails> {
    const p = await tx.reviewParticipant.findFirst({
      where: { id: participantId },
      include: {
        employee: { select: empSelect },
        cycle: true,
        responses: { include: { reviewer: { select: empSelect } } },
      },
    });
    if (!p) throw AppException.notFound('Review');
    const me = await myEmployeeId(tx, principal);
    const hr = can(principal, P.PERFORMANCE_CYCLE_MANAGE, {});
    const isManager = me !== null && p.managerEmployeeId === me;
    const isSelf = me !== null && p.employeeId === me;
    const myResponses = p.responses.filter((r) => r.reviewerEmployeeId === me);
    if (!hr && !isManager && !isSelf && !myResponses.length) throw AppException.notFound('Review');
    const snap = p.cycle.templateSnapshot as unknown as Snapshot | null;
    if (!snap) throw AppException.conflict('The cycle has not been launched');
    const closed = p.cycle.status === 'CLOSED';
    const full = hr || isManager;
    const toResponse = (r: (typeof p.responses)[number]) => ({
      id: r.id,
      role: r.role,
      reviewer: ref(r.reviewer),
      status: r.status,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      content: r.content as unknown as ReviewContent,
    });
    let visible = full ? p.responses.map(toResponse) : myResponses.map(toResponse);
    if (isSelf && !full && closed)
      visible = p.responses
        .filter((r) => (r.role === 'MANAGER' || r.role === 'SELF') && r.status === 'SUBMITTED')
        .map(toResponse);
    const anonymousFeedback = (['PEER', 'UPWARD'] as const)
      .map((role) => {
        const subs = p.responses.filter((r) => r.role === role && r.status === 'SUBMITTED');
        const reveal = isSelf && closed && canRevealAggregate(subs.length, snap.anonymityMinimum);
        // Content may be partial (e.g. an empty object) in older or unfinished responses.
        const contents = subs.map((s) => s.content as unknown as Partial<ReviewContent>);
        const competencyAverages = reveal
          ? snap.competencies.map((c) => {
              const ratings = contents.flatMap((x) =>
                (x.competencies ?? [])
                  .filter((y) => y.competencyId === c.competencyId)
                  .map((y) => new Decimal(y.rating)),
              );
              return {
                competencyId: c.competencyId,
                average: ratings.length
                  ? ratings
                      .reduce((a, b) => a.plus(b), new Decimal(0))
                      .dividedBy(ratings.length)
                      .toFixed(2)
                  : '',
              };
            })
          : [];
        // Comments in a stable but non-identifying order (sorted text, not submission order).
        const comments = reveal
          ? contents
              .map((x) => x.overallComment)
              .filter((t): t is string => !!t)
              .sort()
          : [];
        return { role, responses: subs.length, hidden: !reveal, comments, competencyAverages };
      })
      .filter((x) => isSelf && !full && x.responses >= 0);
    const goals = await tx.goal.findMany({
      where: {
        employeeId: p.employeeId,
        OR: [{ cycleId: p.cycleId }, { cycleId: null, status: { not: 'CANCELLED' } }],
      },
      include: goalInclude,
    });
    const base = await this.participantItem(tx, {
      ...p,
      responses: p.responses.map((r) => ({ role: r.role, status: r.status })),
    });
    return {
      ...base,
      ...(isSelf && !full && !closed
        ? {
            finalRating: null,
            finalLabel: null,
            computedRating: null,
            computedScore: null,
            promotion: 'NONE' as const,
            promotionJustification: null,
          }
        : {}),
      ...(!full ? { calibrationReason: null } : {}),
      template: { ...snap, status: 'ACTIVE' },
      goals: goals.map((g) => this.goalItem(g, true)),
      visible,
      anonymousFeedback,
      can: {
        calibrate: hr && p.cycle.status === 'CALIBRATION',
        acknowledge: isSelf && closed && !p.acknowledgedAt,
        nominatePeers: (isSelf || isManager || hr) && p.cycle.status === 'OPEN' && snap.peerMax > 0,
      },
    };
  }

  /** Saves (or submits) the caller's own response; manager submissions recompute the score. */
  saveResponse(
    principal: AuthPrincipal,
    responseId: string,
    input: z.output<typeof reviewResponseSchema>,
  ): Promise<ReviewDetails> {
    return this.prisma.withTenant(async (tx) => {
      const me = await requireMe(tx, principal);
      const r = await tx.reviewResponse.findFirst({
        where: { id: responseId },
        include: { participant: { include: { cycle: true } } },
      });
      if (!r || r.reviewerEmployeeId !== me) throw AppException.notFound('Review');
      if (r.participant.cycle.status !== 'OPEN')
        throw AppException.conflict('Reviews can be written only while the cycle is open');
      if (r.status === 'SUBMITTED')
        throw AppException.conflict('This review was already submitted');
      if (r.status === 'DECLINED') throw AppException.conflict('This review request was declined');
      const snap = r.participant.cycle.templateSnapshot as unknown as Snapshot;
      const values = new Set(snap.scale.map((s) => new Decimal(s.value).toString()));
      for (const c of input.competencies)
        if (!values.has(new Decimal(c.rating).toString()))
          throw AppException.badRequest(
            'Ratings must be points of the rating scale',
            'competencies',
          );
      const allowed = new Set(snap.competencies.map((c) => c.competencyId));
      if (input.competencies.some((c) => !allowed.has(c.competencyId)))
        throw AppException.badRequest('A competency is not part of this review', 'competencies');
      if (input.submit) {
        const required = snap.questions.filter((q) => q.required).map((q) => q.id);
        const answered = new Set(
          input.answers.filter((a) => a.text.trim()).map((a) => a.questionId),
        );
        if (required.some((q) => !answered.has(q)))
          throw AppException.badRequest('Answer the required questions', 'answers');
        if (input.competencies.length < snap.competencies.length)
          throw AppException.badRequest('Rate every competency before submitting', 'competencies');
      }
      const content: ReviewContent = {
        competencies: input.competencies.map((c) => ({ ...c, comment: c.comment ?? null })),
        goals: input.goals.map((g) => ({ ...g, comment: g.comment ?? null })),
        answers: input.answers,
        overallComment: input.overallComment ?? null,
      };
      await tx.reviewResponse.update({
        where: { id: responseId },
        data: {
          content: content as unknown as Prisma.InputJsonValue,
          ...(input.submit ? { status: 'SUBMITTED', submittedAt: new Date() } : {}),
        },
      });
      if (r.role === 'MANAGER') {
        const goalRows = await tx.goal.findMany({
          where: {
            employeeId: r.participant.employeeId,
            OR: [
              { cycleId: r.participant.cycleId },
              { cycleId: null, status: { not: 'CANCELLED' } },
            ],
          },
          select: { id: true, progress: true, weight: true },
        });
        const override = new Map(
          input.goals
            .filter((g) => g.achievementPercent !== undefined)
            .map((g) => [g.goalId, g.achievementPercent ?? '0']),
        );
        const weights = new Map(snap.competencies.map((c) => [c.competencyId, c.weight]));
        const score = reviewScore({
          scale: snap.scale,
          goalsWeightPercent: snap.goalsWeightPercent,
          goals: goalRows.map((g) => ({
            achievementPercent: override.get(g.id) ?? g.progress.toString(),
            weight: g.weight.toString(),
          })),
          competencies: input.competencies.map((c) => ({
            rating: c.rating,
            weight: weights.get(c.competencyId) ?? '1',
          })),
        });
        await tx.reviewParticipant.update({
          where: { id: r.participantId },
          data: {
            computedScore: score.overall?.toFixed(2) ?? null,
            computedRating: score.point?.value ?? null,
            ...(input.promotion
              ? {
                  promotion: input.promotion,
                  promotionJustification:
                    input.promotion === 'NONE' ? null : (input.promotionJustification ?? null),
                }
              : {}),
          },
        });
      }
      if (input.submit)
        await this.audit.record(tx, {
          action: 'performance.review.submitted',
          entityType: 'review_response',
          entityId: responseId,
          metadata: { role: r.role },
        });
      return this.reviewIn(tx, principal, r.participantId);
    });
  }

  declineResponse(principal: AuthPrincipal, responseId: string): Promise<MyReviewTask[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const me = await requireMe(tx, principal);
        const r = await tx.reviewResponse.findFirst({
          where: { id: responseId },
          select: { reviewerEmployeeId: true, role: true, status: true },
        });
        if (!r || r.reviewerEmployeeId !== me) throw AppException.notFound('Review');
        if (r.role !== 'PEER')
          throw AppException.conflict('Only peer review requests can be declined');
        if (r.status !== 'PENDING')
          throw AppException.conflict('This request is no longer pending');
        await tx.reviewResponse.update({ where: { id: responseId }, data: { status: 'DECLINED' } });
      })
      .then(() => this.myTasks(principal));
  }

  nominatePeers(
    principal: AuthPrincipal,
    participantId: string,
    reviewerIds: string[],
  ): Promise<ReviewDetails> {
    return this.prisma.withTenant(async (tx) => {
      const details = await this.reviewIn(tx, principal, participantId);
      if (!details.can.nominatePeers)
        throw AppException.forbidden(
          'Peers can be nominated by the employee, the manager or HR while the cycle is open',
        );
      const p = await tx.reviewParticipant.findFirst({
        where: { id: participantId },
        select: {
          employeeId: true,
          managerEmployeeId: true,
          responses: {
            where: { role: 'PEER', status: { not: 'DECLINED' } },
            select: { reviewerEmployeeId: true },
          },
        },
      });
      if (!p) throw AppException.notFound('Review');
      const existing = new Set(p.responses.map((r) => r.reviewerEmployeeId));
      const fresh = [...new Set(reviewerIds)].filter((x) => !existing.has(x));
      if (fresh.some((x) => x === p.employeeId))
        throw AppException.badRequest(
          'Employees cannot review themselves as a peer',
          'reviewerEmployeeIds',
        );
      if (existing.size + fresh.length > details.template.peerMax)
        throw AppException.badRequest(
          `At most ${String(details.template.peerMax)} peers`,
          'reviewerEmployeeIds',
        );
      const found = await tx.employee.count({
        where: { id: { in: fresh }, status: { not: 'SEPARATED' } },
      });
      if (found !== fresh.length)
        throw AppException.badRequest('A selected employee does not exist', 'reviewerEmployeeIds');
      if (fresh.length)
        await tx.reviewResponse.createMany({
          data: fresh.map((x) => ({
            organizationId: principal.organizationId ?? '',
            participantId,
            reviewerEmployeeId: x,
            role: 'PEER' as const,
            nominatedByUserId: principal.userId,
          })),
          skipDuplicates: true,
        });
      return this.reviewIn(tx, principal, participantId);
    });
  }

  calibrate(
    principal: AuthPrincipal,
    participantId: string,
    input: z.output<typeof calibrationSchema>,
  ): Promise<ReviewDetails> {
    return this.prisma.withTenant(async (tx) => {
      const p = await tx.reviewParticipant.findFirst({
        where: { id: participantId },
        include: { cycle: true },
      });
      if (!p) throw AppException.notFound('Review');
      if (p.cycle.status !== 'CALIBRATION')
        throw AppException.conflict('Ratings are calibrated during the calibration stage');
      const snap = p.cycle.templateSnapshot as unknown as Snapshot;
      if (!snap.scale.some((s) => new Decimal(s.value).equals(new Decimal(input.finalRating))))
        throw AppException.badRequest('Choose a point of the rating scale', 'finalRating');
      await tx.reviewParticipant.update({
        where: { id: participantId },
        data: {
          finalRating: input.finalRating,
          calibrationReason: input.reason,
          calibratedByUserId: principal.userId,
          calibratedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        action: 'performance.review.calibrated',
        entityType: 'review_participant',
        entityId: participantId,
        metadata: { from: p.computedRating?.toString() ?? null, to: input.finalRating },
      });
      return this.reviewIn(tx, principal, participantId);
    });
  }

  acknowledge(principal: AuthPrincipal, participantId: string): Promise<ReviewDetails> {
    return this.prisma.withTenant(async (tx) => {
      const d = await this.reviewIn(tx, principal, participantId);
      if (!d.can.acknowledge)
        throw AppException.conflict('Results can be acknowledged by the employee once released');
      await tx.reviewParticipant.update({
        where: { id: participantId },
        data: { acknowledgedAt: new Date() },
      });
      return this.reviewIn(tx, principal, participantId);
    });
  }

  distribution(
    cycleId: string,
  ): Promise<{ value: string; label: string; count: number; percent: string }[]> {
    return this.prisma.withTenant(async (tx) => {
      const c = await tx.reviewCycle.findFirst({
        where: { id: cycleId },
        select: { templateSnapshot: true },
      });
      if (!c?.templateSnapshot) throw AppException.notFound('Review cycle');
      const parts = await tx.reviewParticipant.findMany({
        where: { cycleId },
        select: { finalRating: true, computedRating: true },
      });
      const ratings = parts
        .map((p) => (p.finalRating ?? p.computedRating)?.toString())
        .filter((x): x is string => !!x);
      return ratingDistribution(ratings, (c.templateSnapshot as unknown as Snapshot).scale);
    });
  }

  // ------------------------------------------------------------------------------ goals

  private goalItem(g: GoalRow, canEdit: boolean): GoalItem {
    return {
      id: g.id,
      ownerType: g.ownerType,
      employee: g.employee ? ref(g.employee) : null,
      department: null,
      parent: g.parent,
      cycleId: g.cycleId,
      kind: g.kind,
      title: g.title,
      description: g.description,
      weight: dec(g.weight) ?? '1',
      measure:
        g.measureTarget !== null
          ? {
              start: dec(g.measureStart, 4) ?? '0',
              target: dec(g.measureTarget, 4) ?? '0',
              current: dec(g.measureCurrent, 4) ?? '0',
              unit: g.unit,
            }
          : null,
      progress: dec(g.progress) ?? '0',
      status: g.status,
      dueOn: isoOrNull(g.dueOn),
      children: g._count.children,
      canEdit,
    };
  }

  /** Who may edit a goal: HR (goal manage), the employee for own goals, their manager. */
  private async canEditGoal(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    g: { ownerType: string; employeeId: string | null },
  ): Promise<boolean> {
    if (can(principal, P.PERFORMANCE_GOAL_MANAGE, {})) return true;
    if (g.ownerType !== 'EMPLOYEE' || !g.employeeId) return false;
    const me = await myEmployeeId(tx, principal);
    if (!me) return false;
    return g.employeeId === me || (await managerOf(tx, g.employeeId)) === me;
  }

  goals(
    principal: AuthPrincipal,
    q: z.output<typeof talentListQuerySchema>,
  ): Promise<PaginatedResult<GoalItem>> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const hr = can(principal, P.PERFORMANCE_GOAL_MANAGE, {});
      const team = me ? await directReports(tx, me) : [];
      // Organization and department goals are visible to everyone (alignment); personal goals to
      // the employee, their manager and HR.
      const visible: Prisma.GoalWhereInput = hr
        ? {}
        : {
            OR: [
              { ownerType: { not: 'EMPLOYEE' } },
              { employeeId: { in: [...(me ? [me] : []), ...team] } },
            ],
          };
      const where: Prisma.GoalWhereInput = {
        AND: [
          visible,
          q.employeeId ? { employeeId: q.employeeId } : {},
          q.ownerType ? { ownerType: q.ownerType } : {},
          q.cycleId ? { cycleId: q.cycleId } : {},
          q.status ? { status: q.status as GoalRow['status'] } : {},
        ],
      };
      const [rows, total] = await Promise.all([
        tx.goal.findMany({
          where,
          orderBy: [{ ownerType: 'desc' }, { createdAt: 'asc' }],
          include: goalInclude,
          ...skipTake(q),
        }),
        tx.goal.count({ where }),
      ]);
      const items = await Promise.all(
        rows.map(async (g) => this.goalItem(g, await this.canEditGoal(tx, principal, g))),
      );
      return paginate(items, total, q);
    });
  }

  createGoal(principal: AuthPrincipal, input: z.output<typeof goalSchema>): Promise<GoalItem> {
    return this.prisma.withTenant(async (tx) => {
      if (
        !(await this.canEditGoal(tx, principal, {
          ownerType: input.ownerType,
          employeeId: input.employeeId,
        }))
      )
        throw AppException.forbidden(
          'You can set goals for yourself and your team; organization and department goals need performance.goal.manage',
        );
      if (input.parentId) {
        const parent = await tx.goal.findFirst({
          where: { id: input.parentId },
          select: { kind: true },
        });
        if (!parent) throw AppException.badRequest('The parent goal does not exist', 'parentId');
        if (input.kind === 'KEY_RESULT' && parent.kind !== 'OBJECTIVE')
          throw AppException.badRequest('Key results belong to an objective', 'parentId');
      }
      const m = input.measure ?? null;
      const g = await tx.goal.create({
        data: {
          organizationId: principal.organizationId ?? '',
          ownerType: input.ownerType,
          employeeId: input.employeeId,
          departmentId: input.departmentId,
          parentId: input.parentId,
          cycleId: input.cycleId,
          kind: input.kind,
          title: input.title,
          description: input.description ?? null,
          weight: input.weight,
          measureStart: m?.start ?? null,
          measureTarget: m?.target ?? null,
          measureCurrent: m?.current ?? null,
          unit: m?.unit ?? null,
          progress: m ? metricProgress(m).toFixed(2) : '0',
          dueOn: input.dueOn ? toDate(input.dueOn) : null,
          createdByUserId: principal.userId,
        },
        include: goalInclude,
      });
      if (g.parentId) await this.rollUp(tx, g.parentId);
      await this.audit.record(tx, {
        action: 'performance.goal.created',
        entityType: 'goal',
        entityId: g.id,
      });
      return this.goalItem(g, true);
    });
  }

  updateGoal(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof updateGoalSchema>,
  ): Promise<GoalItem> {
    return this.prisma.withTenant(async (tx) => {
      const g = await tx.goal.findFirst({ where: { id } });
      if (!g) throw AppException.notFound('Goal');
      if (!(await this.canEditGoal(tx, principal, g))) throw AppException.forbidden();
      const out = await tx.goal.update({
        where: { id },
        data: {
          ...definedOnly({
            title: input.title,
            description: input.description,
            weight: input.weight,
            status: input.status,
          }),
          ...(input.dueOn !== undefined ? { dueOn: input.dueOn ? toDate(input.dueOn) : null } : {}),
        },
        include: goalInclude,
      });
      if (out.parentId) await this.rollUp(tx, out.parentId);
      return this.goalItem(out, true);
    });
  }

  /** Records progress (a percentage, or the current value of a measured goal); append-only history. */
  checkIn(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof goalCheckInSchema>,
  ): Promise<GoalItem> {
    return this.prisma.withTenant(async (tx) => {
      const g = await tx.goal.findFirst({ where: { id } });
      if (!g) throw AppException.notFound('Goal');
      if (!(await this.canEditGoal(tx, principal, g))) throw AppException.forbidden();
      if (g.kind === 'OBJECTIVE' && (await tx.goal.count({ where: { parentId: id } })))
        throw AppException.conflict('An objective’s progress comes from its key results');
      let progress: Decimal;
      let current: string | null = null;
      if (g.measureTarget !== null) {
        if (input.current === undefined)
          throw AppException.badRequest('Give the current value', 'current');
        current = input.current;
        progress = metricProgress({
          start: (g.measureStart ?? 0).toString(),
          target: g.measureTarget.toString(),
          current,
        });
      } else {
        if (input.progress === undefined)
          throw AppException.badRequest('Give the progress in percent', 'progress');
        progress = new Decimal(input.progress);
      }
      await tx.goalCheckIn.create({
        data: {
          organizationId: principal.organizationId ?? '',
          goalId: id,
          progress: progress.toFixed(2),
          current,
          note: input.note,
          authorUserId: principal.userId,
        },
      });
      const out = await tx.goal.update({
        where: { id },
        data: {
          progress: progress.toFixed(2),
          ...(current !== null ? { measureCurrent: current } : {}),
        },
        include: goalInclude,
      });
      if (out.parentId) await this.rollUp(tx, out.parentId);
      return this.goalItem(out, true);
    });
  }

  goalHistory(principal: AuthPrincipal, id: string): Promise<GoalCheckInItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const g = await tx.goal.findFirst({
        where: { id },
        select: { ownerType: true, employeeId: true },
      });
      if (!g) throw AppException.notFound('Goal');
      const rows = await tx.goalCheckIn.findMany({
        where: { goalId: id },
        orderBy: { createdAt: 'desc' },
      });
      const names = await userNames(
        tx,
        rows.map((r) => r.authorUserId),
      );
      return rows.map((r) => ({
        progress: dec(r.progress) ?? '0',
        current: dec(r.current, 4),
        note: r.note,
        author: r.authorUserId ? (names.get(r.authorUserId) ?? null) : null,
        at: r.createdAt.toISOString(),
      }));
    });
  }

  /** Objective progress = weighted average of its active children (recursive upward). */
  private async rollUp(tx: TenantTransaction, parentId: string, depth = 0): Promise<void> {
    if (depth > 10) return;
    const kids = await tx.goal.findMany({
      where: { parentId, status: { not: 'CANCELLED' } },
      select: { progress: true, weight: true },
    });
    const parent = await tx.goal.findFirst({
      where: { id: parentId },
      select: { parentId: true, measureTarget: true },
    });
    if (!parent || parent.measureTarget !== null) return;
    await tx.goal.update({
      where: { id: parentId },
      data: {
        progress: rollUpProgress(
          kids.map((k) => ({ progress: k.progress.toString(), weight: k.weight.toString() })),
        ).toFixed(2),
      },
    });
    if (parent.parentId) await this.rollUp(tx, parent.parentId, depth + 1);
  }

  // ------------------------------------------------------------------------------ improvement plans

  private async pipItem(tx: TenantTransaction, id: string): Promise<ImprovementPlanItem> {
    const p = await tx.improvementPlan.findFirst({
      where: { id },
      include: { employee: { select: empSelect }, checkIns: { orderBy: { createdAt: 'desc' } } },
    });
    if (!p) throw AppException.notFound('Improvement plan');
    const manager = p.managerEmployeeId
      ? await tx.employee.findFirst({ where: { id: p.managerEmployeeId }, select: empSelect })
      : null;
    const names = await userNames(
      tx,
      p.checkIns.map((c) => c.authorUserId),
    );
    return {
      id: p.id,
      employee: ref(p.employee),
      manager: manager ? ref(manager) : null,
      startDate: isoDate(p.startDate),
      endDate: isoDate(p.endDate),
      reason: p.reason,
      objectives: p.objectives as ImprovementPlanItem['objectives'],
      status: p.status,
      outcomeNote: p.outcomeNote,
      checkIns: p.checkIns.map((c) => ({
        note: c.note,
        author: c.authorUserId ? (names.get(c.authorUserId) ?? null) : null,
        at: c.createdAt.toISOString(),
      })),
    };
  }

  /** PIPs are visible only to HR (pip manage), the employee and their manager. */
  private async pipAccess(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<{ hr: boolean; manager: boolean; self: boolean }> {
    const p = await tx.improvementPlan.findFirst({
      where: { id },
      select: { employeeId: true, managerEmployeeId: true },
    });
    if (!p) throw AppException.notFound('Improvement plan');
    const me = await myEmployeeId(tx, principal);
    const access = {
      hr: can(principal, P.PERFORMANCE_PIP_MANAGE, {}),
      manager: me !== null && p.managerEmployeeId === me,
      self: me !== null && p.employeeId === me,
    };
    if (!access.hr && !access.manager && !access.self)
      throw AppException.notFound('Improvement plan');
    return access;
  }

  pips(principal: AuthPrincipal): Promise<ImprovementPlanItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const hr = can(principal, P.PERFORMANCE_PIP_MANAGE, {});
      const rows = await tx.improvementPlan.findMany({
        where: hr ? {} : { OR: [{ employeeId: me ?? '' }, { managerEmployeeId: me ?? '' }] },
        orderBy: { startDate: 'desc' },
        select: { id: true },
      });
      return Promise.all(rows.map((r) => this.pipItem(tx, r.id)));
    });
  }

  createPip(
    principal: AuthPrincipal,
    input: z.output<typeof pipSchema>,
  ): Promise<ImprovementPlanItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const manager = await managerOf(tx, input.employeeId);
      if (!can(principal, P.PERFORMANCE_PIP_MANAGE, {}) && (me === null || manager !== me))
        throw AppException.forbidden(
          'Improvement plans are started by the employee’s manager or HR',
        );
      if (input.employeeId === me)
        throw AppException.forbidden('You cannot start an improvement plan for yourself');
      const p = await tx.improvementPlan.create({
        data: {
          organizationId: principal.organizationId ?? '',
          employeeId: input.employeeId,
          managerEmployeeId: manager && manager !== input.employeeId ? manager : null,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
          reason: input.reason,
          objectives: input.objectives.map((o) => ({
            text: o.text,
            measure: o.measure ?? null,
          })),
          createdByUserId: principal.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'performance.pip.started',
        entityType: 'improvement_plan',
        entityId: p.id,
        metadata: { employeeId: input.employeeId },
      });
      return this.pipItem(tx, p.id);
    });
  }

  pip(principal: AuthPrincipal, id: string): Promise<ImprovementPlanItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.pipAccess(tx, principal, id);
      return this.pipItem(tx, id);
    });
  }

  pipCheckIn(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof pipCheckInSchema>,
  ): Promise<ImprovementPlanItem> {
    return this.prisma.withTenant(async (tx) => {
      const a = await this.pipAccess(tx, principal, id);
      if (!a.hr && !a.manager)
        throw AppException.forbidden('Check-ins are recorded by the manager or HR');
      const p = await tx.improvementPlan.findFirst({ where: { id }, select: { status: true } });
      if (p?.status !== 'ACTIVE') throw AppException.conflict('The plan is closed');
      await tx.pipCheckIn.create({
        data: {
          organizationId: principal.organizationId ?? '',
          planId: id,
          note: input.note,
          authorUserId: principal.userId,
        },
      });
      return this.pipItem(tx, id);
    });
  }

  pipOutcome(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof pipOutcomeSchema>,
  ): Promise<ImprovementPlanItem> {
    return this.prisma.withTenant(async (tx) => {
      const a = await this.pipAccess(tx, principal, id);
      if (!a.hr && !a.manager)
        throw AppException.forbidden('Outcomes are recorded by the manager or HR');
      const p = await tx.improvementPlan.findFirst({
        where: { id },
        select: { status: true, endDate: true },
      });
      if (p?.status !== 'ACTIVE') throw AppException.conflict('The plan is closed');
      if (input.outcome === 'EXTENDED') {
        if (!input.newEndDate || input.newEndDate <= isoDate(p.endDate))
          throw AppException.badRequest(
            'The new end date must be after the current one',
            'newEndDate',
          );
        await tx.improvementPlan.update({
          where: { id },
          data: { endDate: toDate(input.newEndDate) },
        });
        await tx.pipCheckIn.create({
          data: {
            organizationId: principal.organizationId ?? '',
            planId: id,
            note: `Extended to ${input.newEndDate}: ${input.note}`,
            authorUserId: principal.userId,
          },
        });
      } else {
        await tx.improvementPlan.update({
          where: { id },
          data: { status: input.outcome, outcomeNote: input.note, closedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        action: `performance.pip.${input.outcome.toLowerCase()}`,
        entityType: 'improvement_plan',
        entityId: id,
      });
      return this.pipItem(tx, id);
    });
  }
}
