import { Injectable } from '@nestjs/common';
import { type ApplicationStage, canMoveStage } from '@hrm/business-rules';
import {
  type ApplicationDetails,
  type ApplicationItem,
  type EmployeeDetails,
  type InterviewItem,
  type OfferItem,
  type PaginatedResult,
  PERMISSIONS,
} from '@hrm/shared-types';
import type {
  assessmentSchema,
  feedbackSchema,
  hireSchema,
  interviewSchema,
  moveStageSchema,
  offerSchema,
  recruitmentListQuerySchema,
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
import { toDate } from '../employees/employee-scope.js';
import { EmployeesService } from '../employees/employees.service.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { CandidatesService } from './candidates.service.js';
import {
  applicationSelect,
  interviewSelect,
  offerSelect,
  toApplication,
  toInterview,
  toOffer,
  userNames,
} from './recruitment-mappers.js';

type ListQuery = z.output<typeof recruitmentListQuerySchema>;
const P = PERMISSIONS;

async function myEmployeeId(
  tx: TenantTransaction,
  principal: AuthPrincipal,
): Promise<string | null> {
  if (!principal.membershipId) return null;
  return (
    (
      await tx.employee.findFirst({
        where: { membershipId: principal.membershipId },
        select: { id: true },
      })
    )?.id ?? null
  );
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly candidates: CandidatesService,
    private readonly employees: EmployeesService,
    private readonly onboarding: OnboardingService,
  ) {}

  list(q: ListQuery): Promise<PaginatedResult<ApplicationItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.JobApplicationWhereInput = {
        ...(q.openingId ? { openingId: q.openingId } : {}),
        ...(q.candidateId ? { candidateId: q.candidateId } : {}),
        ...(q.stage ? { stage: q.stage as ApplicationStage } : {}),
        ...(q.search
          ? {
              candidate: {
                OR: [
                  { firstName: { contains: q.search, mode: 'insensitive' } },
                  { lastName: { contains: q.search, mode: 'insensitive' } },
                  { email: { contains: q.search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.jobApplication.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          select: applicationSelect,
          ...skipTake(q),
        }),
        tx.jobApplication.count({ where }),
      ]);
      return paginate(rows.map(toApplication), total, q);
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<ApplicationDetails> {
    return this.prisma.withTenant((tx) => this.details(tx, principal, id));
  }

  private async details(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<ApplicationDetails> {
    const a = await tx.jobApplication.findFirst({
      where: { id },
      select: { ...applicationSelect, candidateId: true },
    });
    if (!a) throw AppException.notFound('Application');
    const [events, assessments, interviews, offers, candidate] = await Promise.all([
      tx.applicationEvent.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'asc' } }),
      tx.assessment.findMany({ where: { applicationId: id }, orderBy: { assessedOn: 'desc' } }),
      tx.interview.findMany({
        where: { applicationId: id },
        orderBy: { scheduledAt: 'asc' },
        select: interviewSelect,
      }),
      tx.offer.findMany({
        where: { applicationId: id },
        orderBy: { createdAt: 'desc' },
        select: offerSelect,
      }),
      this.candidates.candidate(tx, a.candidateId),
    ]);
    const names = await userNames(
      tx,
      events.map((e) => e.actorUserId),
    );
    const me = await myEmployeeId(tx, principal);
    return {
      ...toApplication(a),
      candidateDetails: candidate,
      events: events.map((e) => ({
        id: e.id,
        fromStage: e.fromStage,
        toStage: e.toStage,
        note: e.note,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
        createdAt: e.createdAt.toISOString(),
      })),
      assessments: assessments.map((s) => ({
        id: s.id,
        name: s.name,
        score: s.score.toFixed(2),
        maxScore: s.maxScore.toFixed(2),
        assessedOn: s.assessedOn.toISOString().slice(0, 10),
        notes: s.notes,
      })),
      interviews: interviews.map((i) =>
        toInterview(i, me, can(principal, P.RECRUITMENT_CANDIDATE_READ)),
      ),
      offers: offers.map(toOffer),
      employee: candidate.employee,
    };
  }

  create(
    principal: AuthPrincipal,
    candidateId: string,
    openingId: string,
  ): Promise<ApplicationDetails> {
    return this.prisma.withTenant(async (tx) => {
      if (!(await tx.candidate.findFirst({ where: { id: candidateId }, select: { id: true } })))
        throw AppException.badRequest('Candidate not found', 'candidateId');
      const opening = await tx.jobOpening.findFirst({
        where: { id: openingId },
        select: { status: true },
      });
      if (!opening) throw AppException.badRequest('Job opening not found', 'openingId');
      if (opening.status === 'CLOSED')
        throw AppException.badRequest('The opening is closed', 'openingId');
      const app = await tx.jobApplication
        .create({
          data: { organizationId: principal.organizationId ?? '', candidateId, openingId },
          select: { id: true },
        })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflictOn(
              'The candidate already applied to this opening',
              'openingId',
            );
          throw err;
        });
      await tx.applicationEvent.create({
        data: {
          organizationId: principal.organizationId ?? '',
          applicationId: app.id,
          toStage: 'APPLIED',
          actorUserId: principal.userId,
          note: 'Added by a recruiter',
        },
      });
      await this.audit.record(tx, {
        action: 'application.created',
        entityType: 'job_application',
        entityId: app.id,
      });
      return this.details(tx, principal, app.id);
    });
  }

  /** Moves an application through the pipeline (people decide; nothing is automatic). */
  moveStage(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof moveStageSchema>,
  ): Promise<ApplicationDetails> {
    return this.prisma.withTenant(async (tx) => {
      const a = await tx.jobApplication.findFirst({ where: { id }, select: { stage: true } });
      if (!a) throw AppException.notFound('Application');
      if (!canMoveStage(a.stage, input.stage))
        throw AppException.badRequest(
          `Cannot move from ${a.stage.toLowerCase()} to ${input.stage.toLowerCase()}`,
          'stage',
        );
      await tx.jobApplication.update({
        where: { id },
        data: {
          stage: input.stage,
          rejectionReason: input.stage === 'REJECTED' ? (input.rejectionReason ?? null) : null,
        },
      });
      await tx.applicationEvent.create({
        data: {
          organizationId: principal.organizationId ?? '',
          applicationId: id,
          fromStage: a.stage,
          toStage: input.stage,
          note:
            input.stage === 'REJECTED'
              ? (input.rejectionReason ?? input.note ?? null)
              : (input.note ?? null),
          actorUserId: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'application.stage_changed',
        entityType: 'job_application',
        entityId: id,
        changes: { stage: { from: a.stage, to: input.stage } },
      });
      return this.details(tx, principal, id);
    });
  }

  addAssessment(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof assessmentSchema>,
  ): Promise<ApplicationDetails> {
    return this.prisma.withTenant(async (tx) => {
      await this.active(tx, id);
      await tx.assessment.create({
        data: {
          organizationId: principal.organizationId ?? '',
          applicationId: id,
          name: input.name,
          score: input.score,
          maxScore: input.maxScore,
          assessedOn: toDate(input.assessedOn),
          notes: input.notes ?? null,
          createdByUserId: principal.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'application.assessment_added',
        entityType: 'job_application',
        entityId: id,
        metadata: { name: input.name },
      });
      return this.details(tx, principal, id);
    });
  }

  // ------------------------------------------------------------------ interviews

  scheduleInterview(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof interviewSchema>,
  ): Promise<ApplicationDetails> {
    return this.prisma.withTenant(async (tx) => {
      await this.active(tx, id);
      const panel = [...new Set(input.panelEmployeeIds)];
      const found = await tx.employee.findMany({
        where: { id: { in: panel }, status: { not: 'SEPARATED' } },
        select: { id: true },
      });
      if (found.length !== panel.length)
        throw AppException.badRequest('An interviewer was not found', 'panelEmployeeIds');
      const organizationId = principal.organizationId ?? '';
      const interview = await tx.interview.create({
        data: {
          organizationId,
          applicationId: id,
          roundName: input.roundName,
          scheduledAt: new Date(input.scheduledAt),
          durationMinutes: input.durationMinutes,
          mode: input.mode,
          locationOrLink: input.locationOrLink ?? null,
          createdByUserId: principal.userId,
          panel: { create: panel.map((employeeId) => ({ employeeId })) },
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'interview.scheduled',
        entityType: 'interview',
        entityId: interview.id,
        metadata: { applicationId: id, round: input.roundName, panel: panel.length },
      });
      return this.details(tx, principal, id);
    });
  }

  setInterviewStatus(
    principal: AuthPrincipal,
    interviewId: string,
    status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
  ) {
    return this.prisma.withTenant(async (tx) => {
      const i = await tx.interview.findFirst({
        where: { id: interviewId },
        select: { applicationId: true, status: true },
      });
      if (!i) throw AppException.notFound('Interview');
      await tx.interview.update({ where: { id: interviewId }, data: { status } });
      await this.audit.record(tx, {
        action: 'interview.status_changed',
        entityType: 'interview',
        entityId: interviewId,
        changes: { status: { from: i.status, to: status } },
      });
      return this.details(tx, principal, i.applicationId);
    });
  }

  /** Interviews where the caller sits on the panel (any employee; no recruiter role needed). */
  myInterviews(principal: AuthPrincipal): Promise<InterviewItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      if (!me) return [];
      const rows = await tx.interview.findMany({
        where: { panel: { some: { employeeId: me } }, status: { not: 'CANCELLED' } },
        orderBy: { scheduledAt: 'desc' },
        select: interviewSelect,
        take: 200,
      });
      return rows.map((i) => toInterview(i, me, false));
    });
  }

  /** A panelist submits (or revises) their own feedback. */
  submitFeedback(
    principal: AuthPrincipal,
    interviewId: string,
    input: z.output<typeof feedbackSchema>,
  ): Promise<InterviewItem> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const seat = me
        ? await tx.interviewPanelist.findFirst({
            where: { interviewId, employeeId: me },
            select: { interviewId: true },
          })
        : null;
      if (!seat || !me) throw AppException.notFound('Interview');
      const interview = await tx.interview.findFirst({
        where: { id: interviewId },
        select: { status: true },
      });
      if (interview?.status === 'CANCELLED')
        throw AppException.conflict('The interview was cancelled');
      await tx.interviewPanelist.update({
        where: { interviewId_employeeId: { interviewId, employeeId: me } },
        data: {
          rating: input.rating,
          recommendation: input.recommendation,
          notes: input.notes,
          submittedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        action: 'interview.feedback_submitted',
        entityType: 'interview',
        entityId: interviewId,
      });
      const row = await tx.interview.findFirst({
        where: { id: interviewId },
        select: interviewSelect,
      });
      return toInterview(row as NonNullable<typeof row>, me, false);
    });
  }

  // ------------------------------------------------------------------ offers

  createOffer(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof offerSchema>,
  ): Promise<ApplicationDetails> {
    return this.prisma.withTenant(async (tx) => {
      const a = await this.active(tx, id);
      if (a.stage !== 'OFFER')
        throw AppException.conflict('Move the application to the offer stage first');
      if (
        input.designationId &&
        !(await tx.designation.findFirst({ where: { id: input.designationId } }))
      )
        throw AppException.badRequest('Designation not found', 'designationId');
      if (input.jobGradeId && !(await tx.jobGrade.findFirst({ where: { id: input.jobGradeId } })))
        throw AppException.badRequest('Job grade not found', 'jobGradeId');
      const offer = await tx.offer
        .create({
          data: {
            organizationId: principal.organizationId ?? '',
            applicationId: id,
            designationId: input.designationId ?? null,
            jobGradeId: input.jobGradeId ?? null,
            joiningDate: toDate(input.joiningDate),
            annualCtc: input.annualCtc,
            currency: input.currency,
            notes: input.notes ?? null,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflict(
              'This application already has a live offer; withdraw it first',
            );
          throw err;
        });
      // Offer amounts are compensation data: audited without the amount.
      await this.audit.record(tx, {
        action: 'offer.created',
        entityType: 'offer',
        entityId: offer.id,
        metadata: { applicationId: id },
      });
      return this.details(tx, principal, id);
    });
  }

  setOfferStatus(
    principal: AuthPrincipal,
    offerId: string,
    status: 'SENT' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN',
  ): Promise<OfferItem> {
    return this.prisma.withTenant(async (tx) => {
      const o = await tx.offer.findFirst({ where: { id: offerId }, select: { status: true } });
      if (!o) throw AppException.notFound('Offer');
      const allowed: Record<string, string[]> = {
        SENT: ['DRAFT'],
        ACCEPTED: ['SENT'],
        DECLINED: ['SENT'],
        WITHDRAWN: ['DRAFT', 'SENT', 'ACCEPTED'],
      };
      if (!allowed[status]?.includes(o.status))
        throw AppException.conflict(
          `A ${o.status.toLowerCase()} offer cannot become ${status.toLowerCase()}`,
        );
      await tx.offer.update({
        where: { id: offerId },
        data: {
          status,
          ...(status === 'SENT' ? { sentAt: new Date() } : {}),
          ...(status === 'ACCEPTED' || status === 'DECLINED' ? { respondedAt: new Date() } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'offer.status_changed',
        entityType: 'offer',
        entityId: offerId,
        changes: { status: { from: o.status, to: status } },
      });
      const row = await tx.offer.findFirst({ where: { id: offerId }, select: offerSelect });
      return toOffer(row as NonNullable<typeof row>);
    });
  }

  /**
   * Hires the candidate of an accepted offer in one transaction: creates the employee (joining
   * on the offer's date and designation), links the candidate, records HIRED, starts onboarding
   * from a template when given, and marks the requisition filled once its headcount is reached.
   */
  hire(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof hireSchema>,
  ): Promise<EmployeeDetails> {
    if (!can(principal, P.EMPLOYEES_EMPLOYEE_CREATE, { companyId: input.companyId }))
      throw AppException.forbidden('Hiring also requires permission to add employees');
    return this.prisma.withTenant(async (tx) => {
      const a = await tx.jobApplication.findFirst({
        where: { id },
        select: {
          stage: true,
          candidate: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              employeeId: true,
            },
          },
          opening: { select: { id: true, requisitionId: true } },
          offers: {
            where: { status: 'ACCEPTED' },
            select: { id: true, joiningDate: true, designationId: true, jobGradeId: true },
            take: 1,
          },
        },
      });
      if (!a) throw AppException.notFound('Application');
      if (a.stage !== 'OFFER')
        throw AppException.conflict('Only applications at the offer stage can be hired');
      const offer = a.offers[0];
      if (!offer) throw AppException.conflict('The candidate has not accepted an offer');
      if (a.candidate.employeeId)
        throw AppException.conflict('This candidate is already an employee');
      const joiningDate = offer.joiningDate.toISOString().slice(0, 10);
      const employee = await this.employees.joinInTx(tx, principal, {
        firstName: a.candidate.firstName,
        lastName: a.candidate.lastName,
        personalEmail: a.candidate.email,
        personalPhone: a.candidate.phone,
        dateOfJoining: joiningDate,
        probationEndDate: input.probationEndDate ?? null,
        companyId: input.companyId,
        employmentType: input.employmentType,
        legalEntityId: input.legalEntityId ?? null,
        branchId: input.branchId ?? null,
        departmentId: input.departmentId ?? null,
        teamId: input.teamId ?? null,
        designationId: offer.designationId,
        jobGradeId: offer.jobGradeId,
        managerId: input.managerId ?? null,
      } as Parameters<EmployeesService['joinInTx']>[2]);
      await tx.candidate.update({
        where: { id: a.candidate.id },
        data: { employeeId: employee.id },
      });
      await tx.jobApplication.update({ where: { id }, data: { stage: 'HIRED' } });
      await tx.applicationEvent.create({
        data: {
          organizationId: principal.organizationId ?? '',
          applicationId: id,
          fromStage: 'OFFER',
          toStage: 'HIRED',
          actorUserId: principal.userId,
          note: `Joined as ${employee.employeeNumber}`,
        },
      });
      if (input.onboardingTemplateId) {
        await this.onboarding.startInTx(tx, principal, employee.id, input.onboardingTemplateId);
      }
      if (a.opening.requisitionId) {
        const req = await tx.jobRequisition.findFirst({
          where: { id: a.opening.requisitionId },
          select: { headcount: true },
        });
        const hired = await tx.jobApplication.count({
          where: { stage: 'HIRED', opening: { requisitionId: a.opening.requisitionId } },
        });
        if (req && hired >= req.headcount)
          await tx.jobRequisition.update({
            where: { id: a.opening.requisitionId },
            data: { status: 'FILLED' },
          });
      }
      await this.audit.record(tx, {
        action: 'application.hired',
        entityType: 'job_application',
        entityId: id,
        metadata: { employeeId: employee.id, employeeNumber: employee.employeeNumber },
      });
      return employee;
    });
  }

  private async active(tx: TenantTransaction, id: string) {
    const a = await tx.jobApplication.findFirst({ where: { id }, select: { stage: true } });
    if (!a) throw AppException.notFound('Application');
    if (a.stage === 'HIRED' || a.stage === 'REJECTED' || a.stage === 'WITHDRAWN')
      throw AppException.conflict(`The application is ${a.stage.toLowerCase()}`);
    return a;
  }
}
