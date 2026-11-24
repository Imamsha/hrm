import type { EmployeeRef } from './employees.js';

/** Clients & projects transport types (Phase 10, ADR-017). Money and hours are decimal strings. */

export type BillingTypeValue = 'TIME_AND_MATERIALS' | 'FIXED_FEE' | 'NON_BILLABLE';
export type ProjectStatusValue = 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type ProjectRoleValue = 'MANAGER' | 'MEMBER' | 'VIEWER';
export type WorkItemTypeValue = 'EPIC' | 'FEATURE' | 'STORY' | 'TASK' | 'BUG' | 'SUBTASK';
export type BoardCategoryValue = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type PriorityValue = 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST';
export type SeverityValue = 'MINOR' | 'MAJOR' | 'CRITICAL' | 'BLOCKER';

export interface ClientRef {
  id: string;
  code: string;
  name: string;
}
export interface ProjectRef {
  id: string;
  key: string;
  name: string;
}

// ------------------------------------------------------------------------------ clients

export interface ClientContactItem {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export interface ClientItem extends ClientRef {
  currency: string;
  paymentTermsDays: number;
  billingAddress: string | null;
  taxNumber: string | null;
  email: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  projects: number;
  contacts: ClientContactItem[];
  portalUsers: { membershipId: string; name: string; email: string }[];
}

// ------------------------------------------------------------------------------ projects

export interface ProgressSummary {
  todo: string;
  inProgress: string;
  done: string;
  percentDone: string;
}

export interface ProjectItem extends ProjectRef {
  description: string | null;
  client: ClientRef | null;
  billingType: BillingTypeValue;
  status: ProjectStatusValue;
  startDate: string | null;
  endDate: string | null;
  portalEnabled: boolean;
  progress: ProgressSummary;
  /** The caller's role on the project, if a member. */
  myRole: ProjectRoleValue | null;
  canManage: boolean;
}

export interface BoardColumnItem {
  id: string;
  name: string;
  category: BoardCategoryValue;
  position: number;
  wipLimit: number | null;
}

export interface ProjectMemberItem {
  id: string;
  employee: EmployeeRef;
  role: ProjectRoleValue;
  /** Only for people who manage the project. */
  billingRate: string | null;
  allocationPercent: string | null;
}

export interface SprintItem {
  id: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  committedPoints: string | null;
  completedPoints: string | null;
  items: number;
  points: string;
}

export interface ProjectDetails extends ProjectItem {
  members: ProjectMemberItem[];
  columns: BoardColumnItem[];
  sprints: SprintItem[];
  /** Only for people who manage the project. */
  finance: {
    hourlyRate: string | null;
    budgetAmount: string | null;
    budgetHours: string | null;
    hoursLogged: string;
    billableAmount: string;
    hoursPercent: string | null;
    amountPercent: string | null;
  } | null;
}

// ------------------------------------------------------------------------------ work items

export interface WorkItemItem {
  id: string;
  key: string;
  type: WorkItemTypeValue;
  title: string;
  priority: PriorityValue;
  column: { id: string; name: string; category: BoardCategoryValue };
  assignee: EmployeeRef | null;
  parent: { id: string; key: string; title: string; type: WorkItemTypeValue } | null;
  sprintId: string | null;
  storyPoints: string | null;
  estimateHours: string | null;
  dueDate: string | null;
  labels: string[];
  severity: SeverityValue | null;
  clientVisible: boolean;
  fromClient: boolean;
  rank: number;
  children: number;
  updatedAt: string;
}

export interface CommentItem {
  id: string;
  body: string;
  clientVisible: boolean;
  author: string | null;
  fromClient: boolean;
  createdAt: string;
}

export interface WorkItemDetails extends WorkItemItem {
  project: ProjectRef;
  description: string | null;
  stepsToReproduce: string | null;
  environment: string | null;
  reporter: string | null;
  loggedHours: string;
  childItems: WorkItemItem[];
  comments: CommentItem[];
  history: {
    field: string;
    from: string | null;
    to: string | null;
    actor: string | null;
    at: string;
  }[];
}

export interface BoardData {
  sprint: SprintItem | null;
  columns: (BoardColumnItem & { items: WorkItemItem[] })[];
}

// ------------------------------------------------------------------------------ timesheets

export type TimesheetStatusValue = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface TimeEntryItem {
  id: string;
  date: string;
  project: ProjectRef;
  workItem: { id: string; key: string; title: string } | null;
  hours: string;
  billable: boolean;
  note: string | null;
  invoiced: boolean;
}

export interface TimesheetItem {
  id: string | null;
  employee: EmployeeRef;
  weekStart: string;
  status: TimesheetStatusValue;
  totalHours: string;
  billableHours: string;
  submittedAt: string | null;
  approver: EmployeeRef | null;
  decisionNote: string | null;
  entries: TimeEntryItem[];
  can: { edit: boolean; submit: boolean; decide: boolean };
}

export interface TimeReportItem {
  rows: {
    project: ProjectRef;
    client: ClientRef | null;
    employee: EmployeeRef;
    hours: string;
    billableHours: string;
    /** Billable hours × rate; null without a rate. */
    amount: string | null;
  }[];
  totals: { hours: string; billableHours: string };
}

// ------------------------------------------------------------------------------ billing

export interface TaxRateItem {
  id: string;
  name: string;
  ratePercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface BillingSettingsItem {
  invoicePrefix: string;
  nextSequence: number;
}

export type InvoiceStatusValue = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';

export interface InvoiceItem {
  id: string;
  number: string | null;
  client: ClientRef;
  currency: string;
  status: InvoiceStatusValue;
  issuedOn: string | null;
  dueOn: string | null;
  subtotal: string;
  taxTotal: string;
  total: string;
  paid: string;
  balance: string;
  overdue: boolean;
  createdAt: string;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  project: ProjectRef | null;
  source: 'TIME' | 'MANUAL';
  quantity: string;
  unitPrice: string;
  amount: string;
  taxName: string | null;
  taxPercent: string | null;
  tax: string;
  total: string;
}

export interface InvoiceDetails extends InvoiceItem {
  notes: string | null;
  voidReason: string | null;
  lines: InvoiceLineItem[];
  payments: { id: string; amount: string; receivedOn: string; reference: string | null }[];
}

// ------------------------------------------------------------------------------ portal

export interface PortalProjectItem extends ProjectRef {
  status: ProjectStatusValue;
  startDate: string | null;
  endDate: string | null;
  progress: ProgressSummary;
  openBugs: number;
}

export interface PortalWorkItem {
  id: string;
  key: string;
  type: WorkItemTypeValue;
  title: string;
  status: string;
  category: BoardCategoryValue;
  priority: PriorityValue;
  severity: SeverityValue | null;
  fromClient: boolean;
  updatedAt: string;
}

export interface PortalWorkItemDetails extends PortalWorkItem {
  project: ProjectRef;
  description: string | null;
  stepsToReproduce: string | null;
  comments: { id: string; body: string; author: string; fromClient: boolean; createdAt: string }[];
}

export interface PortalSummary {
  client: ClientRef;
  projects: PortalProjectItem[];
  invoices: InvoiceItem[];
}
