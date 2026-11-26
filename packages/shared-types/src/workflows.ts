import type { EmployeeRef } from './employees.js';

/** Workflow engine and documents transport types (Phase 11a, ADR-018). */

export type WorkflowProcessValue =
  'LEAVE_REQUEST' | 'EXPENSE_CLAIM' | 'TRAVEL_REQUEST' | 'TIMESHEET' | 'RESIGNATION';

export type ApproverRuleItem =
  | { type: 'REPORTING_MANAGER' }
  | { type: 'MANAGER_LEVEL'; level: number }
  | { type: 'ROLE'; roleKey: string }
  | { type: 'EMPLOYEE'; employeeId: string; employee?: EmployeeRef | null };

export interface WorkflowStepItem {
  name: string;
  approver: ApproverRuleItem;
  minMeasure: string | null;
  slaHours: number | null;
  escalateTo:
    | { type: 'NEXT_MANAGER' }
    | { type: 'EMPLOYEE'; employeeId: string; employee?: EmployeeRef | null }
    | null;
}

export interface WorkflowDefinitionItem {
  id: string;
  process: WorkflowProcessValue;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  steps: WorkflowStepItem[];
  instances: number;
  createdAt: string;
}

export type TaskStatusValue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'CANCELLED';

export interface ApprovalTaskItem {
  id: string;
  instanceId: string;
  process: WorkflowProcessValue;
  subjectId: string;
  /** e.g. "Casual leave, 2 days from 2026-12-01". */
  summary: string;
  /** Web route of the request. */
  link: string;
  requester: EmployeeRef;
  stepName: string;
  stepNumber: number;
  stepCount: number;
  dueAt: string | null;
  overdue: boolean;
  onBehalfOf: EmployeeRef | null;
  escalatedFrom: EmployeeRef | null;
  createdAt: string;
}

export interface ApprovalInstanceItem {
  id: string;
  process: WorkflowProcessValue;
  subjectId: string;
  definitionName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requester: EmployeeRef;
  createdAt: string;
  steps: {
    number: number;
    name: string;
    status: TaskStatusValue | 'WAITING';
    assignees: EmployeeRef[];
    onBehalfOf: EmployeeRef | null;
    escalatedFrom: EmployeeRef | null;
    decidedBy: string | null;
    decidedAt: string | null;
    note: string | null;
    skippedReason: string | null;
    dueAt: string | null;
  }[];
}

export interface DelegationItem {
  id: string;
  delegator: EmployeeRef;
  delegate: EmployeeRef;
  from: string;
  to: string;
  processes: WorkflowProcessValue[];
  note: string | null;
  active: boolean;
}

// ------------------------------------------------------------------------------ documents

export type TemplateCategoryValue =
  | 'OFFER_LETTER'
  | 'APPOINTMENT_LETTER'
  | 'EXPERIENCE_LETTER'
  | 'RELIEVING_LETTER'
  | 'SALARY_CERTIFICATE'
  | 'POLICY'
  | 'OTHER';

export interface DocumentTemplateItem {
  id: string;
  name: string;
  category: TemplateCategoryValue;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  title: string;
  body: string;
  mergeFields: string[];
  versions: { version: number; title: string; createdAt: string }[];
}

export interface SignerItem {
  id: string;
  order: number;
  kind: 'EMPLOYEE' | 'CANDIDATE';
  name: string;
  email: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  method: 'LOGIN' | 'EMAIL_OTP' | null;
  at: string | null;
  ip: string | null;
  reason: string | null;
}

export interface GeneratedDocumentItem {
  id: string;
  title: string;
  category: TemplateCategoryValue;
  template: { id: string; name: string; version: number };
  employee: EmployeeRef | null;
  offer: { id: string; candidateName: string } | null;
  sha256: string;
  status: 'FINAL' | 'AWAITING_ACCEPTANCE' | 'ACCEPTED' | 'DECLINED';
  signers: SignerItem[];
  /** True when the caller is the next signer. */
  canAccept: boolean;
  hasCertificate: boolean;
  createdAt: string;
}

export interface LibraryDocumentItem {
  id: string;
  title: string;
  category: string;
  description: string | null;
  requiresAcknowledgement: boolean;
  status: 'PUBLISHED' | 'ARCHIVED';
  version: number;
  fileName: string;
  size: number;
  publishedAt: string;
  audience: { companyId: string | null; departmentId: string | null };
  acknowledgedAt: string | null;
  /** For library managers. */
  stats: { audience: number; acknowledged: number } | null;
}

/** What a candidate sees on the public acceptance page. */
export interface PublicAcceptanceItem {
  organizationName: string;
  title: string;
  candidateName: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  sha256: string;
}
