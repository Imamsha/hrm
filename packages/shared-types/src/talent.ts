import type { EmployeeRef } from './employees.js';

// ------------------------------------------------------------------------------ performance

export interface ScalePointItem {
  value: string;
  label: string;
  description?: string | null;
}

export interface RatingScaleItem {
  id: string;
  name: string;
  points: ScalePointItem[];
  status: 'ACTIVE' | 'INACTIVE';
}

export interface CompetencyItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ReviewTemplateItem {
  id: string;
  name: string;
  ratingScale: { id: string; name: string };
  goalsWeightPercent: string;
  competencies: { competencyId: string; code: string; name: string; weight: string }[];
  questions: { id: string; text: string; required: boolean }[];
  includeSelf: boolean;
  includeManager: boolean;
  peerMin: number;
  peerMax: number;
  includeUpward: boolean;
  anonymityMinimum: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export type ReviewCycleStatusValue = 'DRAFT' | 'OPEN' | 'CALIBRATION' | 'CLOSED';
export type ReviewerRoleValue = 'SELF' | 'MANAGER' | 'PEER' | 'UPWARD';
export type PromotionValue = 'NONE' | 'RECOMMEND' | 'STRONGLY_RECOMMEND';

export interface ReviewCycleItem {
  id: string;
  name: string;
  template: { id: string; name: string };
  periodStart: string;
  periodEnd: string;
  selfDueOn: string | null;
  managerDueOn: string | null;
  audience: { companyId: string | null; departmentId: string | null };
  status: ReviewCycleStatusValue;
  launchedAt: string | null;
  closedAt: string | null;
  participants: number;
  progress: { selfSubmitted: number; managerSubmitted: number; finalized: number };
}

export interface ReviewContent {
  competencies: { competencyId: string; rating: string; comment: string | null }[];
  goals: { goalId: string; achievementPercent?: string; comment: string | null }[];
  answers: { questionId: string; text: string }[];
  overallComment: string | null;
}

export interface ReviewResponseItem {
  id: string;
  role: ReviewerRoleValue;
  reviewer: EmployeeRef | null;
  status: 'PENDING' | 'SUBMITTED' | 'DECLINED';
  submittedAt: string | null;
  content: ReviewContent | null;
}

export interface ParticipantItem {
  id: string;
  cycle: { id: string; name: string; status: ReviewCycleStatusValue };
  employee: EmployeeRef;
  manager: EmployeeRef | null;
  computedScore: string | null;
  computedRating: string | null;
  finalRating: string | null;
  finalLabel: string | null;
  calibrationReason: string | null;
  promotion: PromotionValue;
  promotionJustification: string | null;
  acknowledgedAt: string | null;
  responses: { role: ReviewerRoleValue; submitted: number; total: number }[];
}

/** What a viewer sees of one participant's review, filtered by their role. */
export interface ReviewDetails extends ParticipantItem {
  /** The template as snapshotted at launch, with its rating scale points. */
  template: ReviewTemplateItem & { scale: ScalePointItem[] };
  goals: GoalItem[];
  responses: ReviewParticipantSummary['responses'];
  visible: ReviewResponseItem[];
  /** Peer/upward feedback for the reviewee: aggregated, without names, shown at the minimum count. */
  anonymousFeedback: {
    role: 'PEER' | 'UPWARD';
    responses: number;
    hidden: boolean;
    comments: string[];
    competencyAverages: { competencyId: string; average: string }[];
  }[];
  can: { calibrate: boolean; acknowledge: boolean; nominatePeers: boolean };
}
export type ReviewParticipantSummary = ParticipantItem;

export interface MyReviewTask {
  responseId: string;
  role: ReviewerRoleValue;
  status: 'PENDING' | 'SUBMITTED' | 'DECLINED';
  participantId: string;
  cycle: { id: string; name: string; selfDueOn: string | null; managerDueOn: string | null };
  employee: EmployeeRef;
}

export type GoalKindValue = 'GOAL' | 'OBJECTIVE' | 'KEY_RESULT' | 'KPI';
export interface GoalItem {
  id: string;
  ownerType: 'EMPLOYEE' | 'DEPARTMENT' | 'ORGANIZATION';
  employee: EmployeeRef | null;
  department: { id: string; name: string } | null;
  parent: { id: string; title: string } | null;
  cycleId: string | null;
  kind: GoalKindValue;
  title: string;
  description: string | null;
  weight: string;
  measure: { start: string; target: string; current: string; unit: string | null } | null;
  progress: string;
  status: 'ACTIVE' | 'ACHIEVED' | 'MISSED' | 'CANCELLED';
  dueOn: string | null;
  children: number;
  canEdit: boolean;
}

export interface GoalCheckInItem {
  progress: string;
  current: string | null;
  note: string;
  author: string | null;
  at: string;
}

export interface ImprovementPlanItem {
  id: string;
  employee: EmployeeRef;
  manager: EmployeeRef | null;
  startDate: string;
  endDate: string;
  reason: string;
  objectives: { text: string; measure: string | null }[];
  status: 'ACTIVE' | 'PASSED' | 'FAILED' | 'CANCELLED';
  outcomeNote: string | null;
  checkIns: { note: string; author: string | null; at: string }[];
}

// ------------------------------------------------------------------------------ learning

export interface CourseModuleItem {
  id: string;
  title: string;
  type: 'CONTENT' | 'QUIZ';
  content: string | null;
  url: string | null;
  /** Correct answers are included only for course managers. */
  questions: { id: string; text: string; options: string[]; points: number; correct?: number[] }[];
}

export interface CourseItem {
  id: string;
  code: string;
  title: string;
  description: string | null;
  format: 'ONLINE' | 'VIDEO' | 'DOCUMENT' | 'CLASSROOM' | 'EXTERNAL';
  durationMinutes: number | null;
  passPercent: number;
  certificationValidityMonths: number | null;
  skills: string[];
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  moduleCount: number;
  enrolled: number;
  completed: number;
}

export interface CourseDetails extends CourseItem {
  modules: CourseModuleItem[];
  myEnrollment: EnrollmentItem | null;
}

export interface LearningPathItem {
  id: string;
  name: string;
  description: string | null;
  courses: { id: string; code: string; title: string }[];
}

export interface EnrollmentItem {
  id: string;
  course: { id: string; code: string; title: string; moduleCount: number };
  employee: EmployeeRef;
  source: 'SELF' | 'ASSIGNED' | 'PATH';
  dueOn: string | null;
  status: 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'WITHDRAWN';
  completedModules: string[];
  progress: number;
  scorePercent: string | null;
  completedAt: string | null;
  certificationExpiresOn: string | null;
  overdue: boolean;
}

export interface QuizResultItem {
  scorePercent: string;
  passed: boolean;
  perQuestion: { id: string; correct: boolean }[];
  enrollment: EnrollmentItem;
}

export interface SkillMatrixItem {
  skills: string[];
  rows: { employee: EmployeeRef; levels: Record<string, string> }[];
  expiringCertifications: { employee: EmployeeRef; name: string; expiresOn: string }[];
}

// ------------------------------------------------------------------------------ engagement

export interface SurveyQuestionItem {
  id: string;
  type: 'RATING' | 'ENPS' | 'CHOICE' | 'TEXT';
  text: string;
  options?: string[];
  required: boolean;
}

export interface SurveyItem {
  id: string;
  title: string;
  description: string | null;
  kind: 'SURVEY' | 'PULSE';
  anonymous: boolean;
  minimumGroupSize: number;
  opensAt: string;
  closesAt: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  questions: SurveyQuestionItem[];
  invited: number;
  responded: number;
  /** For the caller: invited and not yet responded while the survey is open. */
  canRespond: boolean;
  hasResponded: boolean;
}

export interface SurveyResultItem {
  surveyId: string;
  responses: number;
  hidden: boolean;
  minimumGroupSize: number;
  questions: {
    id: string;
    type: SurveyQuestionItem['type'];
    text: string;
    responses: number;
    average?: string;
    enps?: string;
    distribution?: Record<string, number>;
    texts?: string[];
  }[];
  byDepartment: {
    department: string;
    responses: number;
    hidden: boolean;
    averages: Record<string, string>;
  }[];
}

export interface BadgeItem {
  id: string;
  name: string;
  description: string | null;
  points: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface RecognitionItem {
  id: string;
  from: EmployeeRef;
  to: EmployeeRef;
  badge: { id: string; name: string };
  points: number;
  message: string;
  public: boolean;
  createdAt: string;
}

export interface RewardItem {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  stock: number | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface RedemptionItem {
  id: string;
  reward: { id: string; name: string };
  employee: EmployeeRef;
  pointsCost: number;
  status: 'PENDING' | 'FULFILLED' | 'REJECTED';
  note: string | null;
  createdAt: string;
}

export interface MyRecognitionSummary {
  balance: number;
  received: RecognitionItem[];
  given: RecognitionItem[];
  redemptions: RedemptionItem[];
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  requiresAcknowledgement: boolean;
  publishAt: string;
  expiresAt: string | null;
  author: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  /** Managers of content see read/acknowledged counts. */
  stats: { audience: number; read: number; acknowledged: number } | null;
}

export interface EventItem {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  capacity: number | null;
  cancelledAt: string | null;
  going: number;
  maybe: number;
  myResponse: 'GOING' | 'MAYBE' | 'NOT_GOING' | null;
}

export interface SuggestionItem {
  id: string;
  title: string;
  body: string;
  category: string | null;
  anonymous: boolean;
  author: EmployeeRef | null;
  status: 'NEW' | 'UNDER_REVIEW' | 'ACCEPTED' | 'IMPLEMENTED' | 'DECLINED';
  response: string | null;
  votes: number;
  myVote: boolean;
  createdAt: string;
}
