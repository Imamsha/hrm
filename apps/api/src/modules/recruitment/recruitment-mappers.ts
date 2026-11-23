import { summarizeFeedback } from '@hrm/business-rules';
import type {
  ApplicationItem,
  ApplicationStageValue,
  CandidateItem,
  EmployeeRef,
  InterviewItem,
  MoneyRange,
  OfferItem,
  OpeningItem,
  RequisitionItem,
} from '@hrm/shared-types';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { employeeRefSelect, toEmployeeRef } from '../employees/employee-mapper.js';
import { displayName, isoOrNull } from '../employees/employee-scope.js';
import { refSelect, toRef } from '../structure/structure.util.js';

type Dec = { toFixed(n: number): string } | null;
export const money = (min: Dec, max: Dec, currency: string): MoneyRange => ({
  min: min ? min.toFixed(2) : null,
  max: max ? max.toFixed(2) : null,
  currency,
});

/** Full names of users (actors) for display. */
export async function userNames(
  tx: TenantTransaction,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const rows = await tx.membership.findMany({
    where: { userId: { in: wanted } },
    select: { userId: true, user: { select: { fullName: true } } },
  });
  return new Map(rows.map((r) => [r.userId, r.user.fullName]));
}

export const requisitionSelect = {
  id: true,
  title: true,
  employmentType: true,
  headcount: true,
  targetDate: true,
  justification: true,
  budgetMin: true,
  budgetMax: true,
  currency: true,
  status: true,
  requestedByUserId: true,
  decidedByUserId: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  companyId: true,
  company: { select: refSelect },
  department: { select: refSelect },
  branch: { select: refSelect },
  designation: { select: refSelect },
  _count: { select: { openings: true } },
} satisfies Prisma.JobRequisitionSelect;

export function toRequisition(
  r: Prisma.JobRequisitionGetPayload<{ select: typeof requisitionSelect }>,
  names: Map<string, string>,
): RequisitionItem {
  return {
    id: r.id,
    title: r.title,
    company: toRef(r.company) as RequisitionItem['company'],
    department: toRef(r.department),
    branch: toRef(r.branch),
    designation: toRef(r.designation),
    employmentType: r.employmentType,
    headcount: r.headcount,
    targetDate: isoOrNull(r.targetDate),
    justification: r.justification,
    budget: money(r.budgetMin, r.budgetMax, r.currency),
    status: r.status,
    requestedBy: r.requestedByUserId ? (names.get(r.requestedByUserId) ?? null) : null,
    requestedByUserId: r.requestedByUserId,
    decidedBy: r.decidedByUserId ? (names.get(r.decidedByUserId) ?? null) : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    openingCount: r._count.openings,
    createdAt: r.createdAt.toISOString(),
  };
}

export const openingSelect = {
  id: true,
  title: true,
  slug: true,
  location: true,
  employmentType: true,
  description: true,
  requirements: true,
  experienceMinYears: true,
  experienceMaxYears: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  showSalary: true,
  positions: true,
  status: true,
  publishedAt: true,
  closesOn: true,
  createdAt: true,
  companyId: true,
  requisition: { select: { id: true, title: true } },
  company: { select: refSelect },
  department: { select: refSelect },
  branch: { select: refSelect },
  hiringManager: { select: employeeRefSelect },
} satisfies Prisma.JobOpeningSelect;

const STAGES: ApplicationStageValue[] = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
];

export async function pipelineCounts(tx: TenantTransaction, openingIds: string[]) {
  const rows = openingIds.length
    ? await tx.jobApplication.groupBy({
        by: ['openingId', 'stage'],
        where: { openingId: { in: openingIds } },
        _count: { _all: true },
      })
    : [];
  const out = new Map<string, Record<ApplicationStageValue, number>>();
  for (const id of openingIds)
    out.set(
      id,
      Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ApplicationStageValue, number>,
    );
  for (const r of rows) {
    const p = out.get(r.openingId);
    if (p) p[r.stage] = r._count._all;
  }
  return out;
}

export function toOpening(
  o: Prisma.JobOpeningGetPayload<{ select: typeof openingSelect }>,
  pipeline: Record<ApplicationStageValue, number>,
): OpeningItem {
  return {
    id: o.id,
    title: o.title,
    slug: o.slug,
    requisition: o.requisition,
    company: toRef(o.company) as OpeningItem['company'],
    department: toRef(o.department),
    branch: toRef(o.branch),
    location: o.location,
    employmentType: o.employmentType,
    description: o.description,
    requirements: o.requirements,
    experienceMinYears: o.experienceMinYears,
    experienceMaxYears: o.experienceMaxYears,
    salary: money(o.salaryMin, o.salaryMax, o.currency),
    showSalary: o.showSalary,
    positions: o.positions,
    hiringManager: toEmployeeRef(o.hiringManager),
    status: o.status,
    publishedAt: o.publishedAt?.toISOString() ?? null,
    closesOn: isoOrNull(o.closesOn),
    pipeline,
    hired: pipeline.HIRED,
    createdAt: o.createdAt.toISOString(),
  };
}

export const candidateSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  currentCompany: true,
  currentTitle: true,
  totalExperienceMonths: true,
  location: true,
  skills: true,
  source: true,
  sourceDetail: true,
  notes: true,
  consentAt: true,
  resumeStorageKey: true,
  resumeFileName: true,
  createdAt: true,
  employee: { select: employeeRefSelect },
  _count: { select: { applications: true } },
} satisfies Prisma.CandidateSelect;

export const candidateName = (c: { firstName: string; lastName: string | null }) =>
  displayName({ firstName: c.firstName, lastName: c.lastName, preferredName: null });

export function toCandidate(
  c: Prisma.CandidateGetPayload<{ select: typeof candidateSelect }>,
): CandidateItem {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    displayName: candidateName(c),
    email: c.email,
    phone: c.phone,
    currentCompany: c.currentCompany,
    currentTitle: c.currentTitle,
    totalExperienceMonths: c.totalExperienceMonths,
    location: c.location,
    skills: c.skills,
    source: c.source,
    sourceDetail: c.sourceDetail,
    notes: c.notes,
    hasResume: c.resumeStorageKey !== null,
    resumeFileName: c.resumeFileName,
    consentAt: c.consentAt?.toISOString() ?? null,
    employee: toEmployeeRef(c.employee),
    applicationCount: c._count.applications,
    createdAt: c.createdAt.toISOString(),
  };
}

const nameSelect = { id: true, firstName: true, lastName: true } as const;

export const applicationSelect = {
  id: true,
  stage: true,
  rejectionReason: true,
  appliedAt: true,
  updatedAt: true,
  candidate: { select: { ...nameSelect, email: true } },
  opening: { select: { id: true, title: true } },
  interviews: { select: { panel: { select: { rating: true, recommendation: true } } } },
  offers: {
    select: { id: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.JobApplicationSelect;

export function toApplication(
  a: Prisma.JobApplicationGetPayload<{ select: typeof applicationSelect }>,
): ApplicationItem {
  const f = summarizeFeedback(a.interviews.flatMap((i) => i.panel));
  return {
    id: a.id,
    candidate: {
      id: a.candidate.id,
      displayName: candidateName(a.candidate),
      email: a.candidate.email,
    },
    opening: a.opening,
    stage: a.stage,
    rejectionReason: a.rejectionReason,
    appliedAt: a.appliedAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    feedback: { submitted: f.submitted, averageRating: f.averageRating },
    offer: a.offers[0] ? { id: a.offers[0].id, status: a.offers[0].status } : null,
  };
}

export const interviewSelect = {
  id: true,
  applicationId: true,
  roundName: true,
  scheduledAt: true,
  durationMinutes: true,
  mode: true,
  locationOrLink: true,
  status: true,
  application: {
    select: { candidate: { select: nameSelect }, opening: { select: { id: true, title: true } } },
  },
  panel: {
    select: {
      rating: true,
      recommendation: true,
      notes: true,
      submittedAt: true,
      employee: { select: employeeRefSelect },
    },
  },
} satisfies Prisma.InterviewSelect;

/**
 * Interview view. Panel feedback is visible to recruiters; a panelist sees only their own
 * feedback until they submit (independent assessments, no anchoring on others' ratings).
 */
export function toInterview(
  i: Prisma.InterviewGetPayload<{ select: typeof interviewSelect }>,
  viewerEmployeeId: string | null,
  recruiter: boolean,
): InterviewItem {
  const mine = i.panel.find((p) => p.employee.id === viewerEmployeeId);
  const showAll = recruiter || Boolean(mine?.submittedAt);
  return {
    id: i.id,
    applicationId: i.applicationId,
    candidate: {
      id: i.application.candidate.id,
      displayName: candidateName(i.application.candidate),
    },
    opening: i.application.opening,
    roundName: i.roundName,
    scheduledAt: i.scheduledAt.toISOString(),
    durationMinutes: i.durationMinutes,
    mode: i.mode,
    locationOrLink: i.locationOrLink,
    status: i.status,
    panel: i.panel.map((p) => {
      const visible = showAll || p.employee.id === viewerEmployeeId;
      return {
        employee: toEmployeeRef(p.employee) as EmployeeRef,
        rating: visible ? p.rating : null,
        recommendation: visible ? p.recommendation : null,
        notes: visible ? p.notes : null,
        submittedAt: p.submittedAt?.toISOString() ?? null,
      };
    }),
  };
}

export const offerSelect = {
  id: true,
  applicationId: true,
  joiningDate: true,
  annualCtc: true,
  currency: true,
  notes: true,
  status: true,
  sentAt: true,
  respondedAt: true,
  createdAt: true,
  designation: { select: refSelect },
  jobGrade: { select: refSelect },
  application: {
    select: { candidate: { select: nameSelect }, opening: { select: { id: true, title: true } } },
  },
} satisfies Prisma.OfferSelect;

export function toOffer(o: Prisma.OfferGetPayload<{ select: typeof offerSelect }>): OfferItem {
  return {
    id: o.id,
    applicationId: o.applicationId,
    candidate: {
      id: o.application.candidate.id,
      displayName: candidateName(o.application.candidate),
    },
    opening: o.application.opening,
    designation: toRef(o.designation),
    jobGrade: toRef(o.jobGrade),
    joiningDate: o.joiningDate.toISOString().slice(0, 10),
    annualCtc: o.annualCtc.toFixed(2),
    currency: o.currency,
    notes: o.notes,
    status: o.status,
    sentAt: o.sentAt?.toISOString() ?? null,
    respondedAt: o.respondedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}
