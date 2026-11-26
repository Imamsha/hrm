import type { EmployeeRef } from './employees.js';

/** Helpdesk, separation & offboarding, compliance transport types (Phase 11b, ADR-019). */

export type TicketPriorityValue = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatusValue =
  'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_REQUESTER' | 'RESOLVED' | 'CLOSED';

export interface HelpdeskCategoryItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  confidential: boolean;
  agents: EmployeeRef[];
  defaultAssignee: EmployeeRef | null;
  escalationContact: EmployeeRef | null;
  sla: {
    priority: TicketPriorityValue;
    firstResponseHours: number | null;
    resolutionHours: number | null;
  }[];
}

export interface TicketItem {
  id: string;
  number: string;
  category: { id: string; code: string; name: string };
  subject: string;
  priority: TicketPriorityValue;
  status: TicketStatusValue;
  requester: EmployeeRef;
  assignee: EmployeeRef | null;
  firstResponseDue: string | null;
  resolutionDue: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  escalated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetails extends TicketItem {
  description: string;
  resolution: string | null;
  rating: number | null;
  ratingComment: string | null;
  comments: {
    id: string;
    body: string;
    internal: boolean;
    author: string | null;
    byRequester: boolean;
    createdAt: string;
  }[];
  attachments: {
    id: string;
    fileName: string;
    contentType: string;
    size: number;
    createdAt: string;
  }[];
  history: {
    action: string;
    from: string | null;
    to: string | null;
    actor: string | null;
    at: string;
  }[];
  can: {
    work: boolean;
    comment: boolean;
    internal: boolean;
    rate: boolean;
    reopen: boolean;
    close: boolean;
  };
}

export interface ArticleItem {
  id: string;
  category: { id: string; name: string } | null;
  title: string;
  body: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  helpful: number;
  notHelpful: number;
  updatedAt: string;
}

// ------------------------------------------------------------------------------ separation

export type ReasonCategoryValue =
  | 'CAREER'
  | 'COMPENSATION'
  | 'RELOCATION'
  | 'PERSONAL'
  | 'HEALTH'
  | 'STUDIES'
  | 'MANAGER'
  | 'WORK_CULTURE'
  | 'OTHER';

export interface ResignationItem {
  id: string;
  employee: EmployeeRef;
  reasonCategory: ReasonCategoryValue;
  note: string | null;
  submittedOn: string;
  requestedLastDay: string;
  noticeLastDay: string | null;
  agreedLastDay: string | null;
  waivedNoticeDays: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  decisionNote: string | null;
  approver: EmployeeRef | null;
  caseId: string | null;
  can: { decide: boolean; withdraw: boolean };
}

export interface ClearanceItem {
  id: string;
  title: string;
  kind: 'TEMPLATE' | 'ASSET' | 'LICENSE' | 'KNOWLEDGE_TRANSFER';
  owner: string;
  status: 'PENDING' | 'CLEARED' | 'WAIVED';
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  canDecide: boolean;
}

export interface SeparationCaseItem {
  id: string;
  employee: EmployeeRef;
  separationType: 'RESIGNATION' | 'TERMINATION' | 'RETIREMENT' | 'CONTRACT_END' | 'OTHER';
  reasonCategory: ReasonCategoryValue;
  lastWorkingDay: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  clearance: { total: number; pending: number };
  interviewDone: boolean;
  createdAt: string;
}

export interface SeparationCaseDetails extends SeparationCaseItem {
  note: string | null;
  items: ClearanceItem[];
  settlement: { id: string; status: string; netPayable: string } | null;
  letters: { id: string; title: string; status: string }[];
  can: { complete: boolean; cancel: boolean; interview: boolean; readInterview: boolean };
}

export interface ExitQuestionItem {
  id: string;
  type: 'RATING' | 'CHOICE' | 'TEXT';
  text: string;
  options?: string[];
}

export interface ExitAnalyticsItem {
  from: string;
  to: string;
  separations: number;
  attritionPercent: string | null;
  byMonth: { month: string; count: number }[];
  byType: { type: string; count: number }[];
  byReason: { reason: string; count: number }[];
  byDepartment: { department: string; count: number }[];
  ratings: { questionId: string; text: string; count: number; average: string | null }[];
}

// ------------------------------------------------------------------------------ compliance

export type RecurrenceValue = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';

export interface ObligationItem {
  id: string;
  title: string;
  category: 'STATUTORY_FILING' | 'LICENCE_RENEWAL' | 'AUDIT' | 'POLICY_REVIEW' | 'OTHER';
  description: string | null;
  owner: EmployeeRef;
  firstDueOn: string;
  recurrence: RecurrenceValue;
  status: 'ACTIVE' | 'INACTIVE';
  nextDueOn: string | null;
}

export interface ComplianceTaskItem {
  id: string;
  obligation: { id: string; title: string; category: ObligationItem['category'] };
  owner: EmployeeRef;
  dueOn: string;
  status: 'OPEN' | 'COMPLETED';
  state: 'OVERDUE' | 'DUE_SOON' | 'LATER' | 'DONE';
  completedAt: string | null;
  completedBy: string | null;
  note: string | null;
  evidence: { fileName: string; size: number } | null;
  canComplete: boolean;
}

export interface ExpiryItem {
  kind: 'CERTIFICATION' | 'LICENCE' | 'CONTRACT' | 'COMPLIANCE_TASK';
  title: string;
  subject: string;
  date: string;
  state: 'OVERDUE' | 'DUE_SOON';
  link: string;
}

export interface ComplianceDashboardItem {
  tasks: { overdue: number; dueSoon: number; completedThisMonth: number };
  expiring: ExpiryItem[];
  acknowledgements: {
    documentId: string;
    title: string;
    version: number;
    audience: number;
    acknowledged: number;
  }[];
  recentAudit: { action: string; entityType: string; actor: string | null; at: string }[] | null;
}
