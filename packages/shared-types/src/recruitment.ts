/** Recruitment and onboarding transport types (Phase 06). */
import type { EmployeeRef, EmploymentTypeValue } from './employees.js';
import type { Ref } from './structure.js';

export type RequisitionStatusValue =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'FILLED';
export type OpeningStatusValue = 'DRAFT' | 'PUBLISHED' | 'ON_HOLD' | 'CLOSED';
export type ApplicationStageValue =
  | 'APPLIED'
  | 'SCREENING'
  | 'ASSESSMENT'
  | 'INTERVIEW'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN';
export type CandidateSourceValue = 'CAREER_PORTAL' | 'REFERRAL' | 'AGENCY' | 'DIRECT' | 'OTHER';
export type InterviewModeValue = 'IN_PERSON' | 'VIDEO' | 'PHONE';
export type InterviewStatusValue = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type RecommendationValue = 'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO';
export type OfferStatusValue = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';
export type OnboardingAssigneeValue = 'HR' | 'MANAGER' | 'EMPLOYEE' | 'IT';
export type OnboardingTaskStatusValue = 'PENDING' | 'DONE' | 'SKIPPED';

/** Money as a decimal string with its ISO currency. */
export interface MoneyRange {
  min: string | null;
  max: string | null;
  currency: string;
}

export interface RequisitionItem {
  id: string;
  title: string;
  company: Ref;
  department: Ref | null;
  branch: Ref | null;
  designation: Ref | null;
  employmentType: EmploymentTypeValue;
  headcount: number;
  targetDate: string | null;
  justification: string | null;
  budget: MoneyRange;
  status: RequisitionStatusValue;
  requestedBy: string | null;
  /** The requester's user id (they cannot decide their own requisition). */
  requestedByUserId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  openingCount: number;
  createdAt: string;
}

export interface OpeningItem {
  id: string;
  title: string;
  slug: string;
  requisition: { id: string; title: string } | null;
  company: Ref;
  department: Ref | null;
  branch: Ref | null;
  location: string | null;
  employmentType: EmploymentTypeValue;
  description: string;
  requirements: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  salary: MoneyRange;
  showSalary: boolean;
  positions: number;
  hiringManager: EmployeeRef | null;
  status: OpeningStatusValue;
  publishedAt: string | null;
  closesOn: string | null;
  /** Applications by stage. */
  pipeline: Record<ApplicationStageValue, number>;
  hired: number;
  createdAt: string;
}

/** What the public career portal shows (never internal fields). */
export interface PublicOpening {
  slug: string;
  title: string;
  company: string;
  location: string | null;
  employmentType: EmploymentTypeValue;
  description: string;
  requirements: string | null;
  experienceMinYears: number | null;
  experienceMaxYears: number | null;
  salary: MoneyRange | null;
  publishedAt: string;
  closesOn: string | null;
}

export interface PublicCareers {
  organization: { name: string; slug: string };
  openings: PublicOpening[];
}

export interface CandidateItem {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  email: string;
  phone: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  totalExperienceMonths: number | null;
  location: string | null;
  skills: string[];
  source: CandidateSourceValue;
  sourceDetail: string | null;
  notes: string | null;
  hasResume: boolean;
  resumeFileName: string | null;
  consentAt: string | null;
  employee: EmployeeRef | null;
  applicationCount: number;
  createdAt: string;
}

export interface ApplicationItem {
  id: string;
  candidate: { id: string; displayName: string; email: string };
  opening: { id: string; title: string };
  stage: ApplicationStageValue;
  rejectionReason: string | null;
  appliedAt: string;
  updatedAt: string;
  /** Aggregated panel feedback across interviews. */
  feedback: { submitted: number; averageRating: number | null };
  offer: { id: string; status: OfferStatusValue } | null;
}

export interface ApplicationEventItem {
  id: string;
  fromStage: ApplicationStageValue | null;
  toStage: ApplicationStageValue;
  note: string | null;
  actor: string | null;
  createdAt: string;
}

export interface AssessmentItem {
  id: string;
  name: string;
  score: string;
  maxScore: string;
  assessedOn: string;
  notes: string | null;
}

export interface PanelistItem {
  employee: EmployeeRef;
  rating: number | null;
  recommendation: RecommendationValue | null;
  notes: string | null;
  submittedAt: string | null;
}

export interface InterviewItem {
  id: string;
  applicationId: string;
  candidate: { id: string; displayName: string };
  opening: { id: string; title: string };
  roundName: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: InterviewModeValue;
  locationOrLink: string | null;
  status: InterviewStatusValue;
  panel: PanelistItem[];
}

export interface OfferItem {
  id: string;
  applicationId: string;
  candidate: { id: string; displayName: string };
  opening: { id: string; title: string };
  designation: Ref | null;
  jobGrade: Ref | null;
  joiningDate: string;
  annualCtc: string;
  currency: string;
  notes: string | null;
  status: OfferStatusValue;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
}

/** Full application view (detail page). */
export interface ApplicationDetails extends ApplicationItem {
  candidateDetails: CandidateItem;
  events: ApplicationEventItem[];
  assessments: AssessmentItem[];
  interviews: InterviewItem[];
  offers: OfferItem[];
  employee: EmployeeRef | null;
}

export interface OnboardingTemplateTaskItem {
  id: string;
  title: string;
  description: string | null;
  assignee: OnboardingAssigneeValue;
  dueOffsetDays: number;
  documentCategory: string | null;
  sortOrder: number;
}

export interface OnboardingTemplateItem {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  tasks: OnboardingTemplateTaskItem[];
  planCount: number;
}

export interface OnboardingTaskItem {
  id: string;
  title: string;
  description: string | null;
  assignee: OnboardingAssigneeValue;
  assigneeEmployee: EmployeeRef | null;
  dueDate: string;
  documentCategory: string | null;
  status: OnboardingTaskStatusValue;
  completedAt: string | null;
  completedBy: string | null;
  /** The caller may complete it (assignee, or HR). */
  canComplete: boolean;
}

export interface OnboardingPlanItem {
  id: string;
  employee: EmployeeRef;
  template: { id: string; name: string } | null;
  joiningDate: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  progress: { total: number; closed: number; percent: number };
  tasks: OnboardingTaskItem[];
  createdAt: string;
}
