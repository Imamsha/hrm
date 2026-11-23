import type { EmployeeRef } from './employees.js';

export type ExpenseClaimStatusValue =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'MANAGER_APPROVED'
  | 'FINANCE_APPROVED'
  | 'REIMBURSED'
  | 'REJECTED'
  | 'CANCELLED';
export type PayoutMethodValue = 'PAYROLL' | 'EXTERNAL';
export type TravelStatusValue = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'SETTLED';
export type AssetStatusValue = 'IN_STOCK' | 'ALLOCATED' | 'IN_REPAIR' | 'RETIRED' | 'LOST';

export interface ExpenseSettingsItem {
  claimWindowDays: number | null;
  defaultPayoutMethod: PayoutMethodValue;
  currency: string;
}

export interface ExpenseCategoryItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  maxPerItem: string | null;
  maxPerMonth: string | null;
  receiptRequiredAbove: string | null;
  dailyLimit: string | null;
  taxable: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ExpenseIssueItem {
  item: number;
  code: string;
  severity: 'BLOCK' | 'WARN';
  message: string;
}

export interface ExpenseItemItem {
  id: string;
  category: { id: string; code: string; name: string };
  date: string;
  days: number;
  description: string;
  merchant: string | null;
  currency: string;
  originalAmount: string;
  exchangeRate: string;
  amount: string;
  approvedAmount: string | null;
  financeNote: string | null;
  justification: string | null;
  issues: ExpenseIssueItem[];
  receipt: { fileName: string; contentType: string; sizeBytes: number } | null;
}

export interface ExpenseClaimItem {
  id: string;
  employee: EmployeeRef;
  title: string;
  trip: { id: string; purpose: string } | null;
  status: ExpenseClaimStatusValue;
  totalClaimed: string;
  totalApproved: string | null;
  payoutMethod: PayoutMethodValue | null;
  approver: EmployeeRef | null;
  submittedAt: string | null;
  decisionNote: string | null;
  paidOn: string | null;
  paidReference: string | null;
  reimbursedAt: string | null;
  payrollRunId: string | null;
  createdAt: string;
  itemCount: number;
  /** What the caller may do now. */
  can: {
    edit: boolean;
    submit: boolean;
    cancel: boolean;
    reopen: boolean;
    managerDecide: boolean;
    financeDecide: boolean;
    markPaid: boolean;
  };
}

export interface ExpenseClaimEventItem {
  fromStatus: ExpenseClaimStatusValue | null;
  toStatus: ExpenseClaimStatusValue;
  note: string | null;
  actor: string | null;
  at: string;
}

export interface ExpenseClaimDetails extends ExpenseClaimItem {
  items: ExpenseItemItem[];
  events: ExpenseClaimEventItem[];
  /** Live policy check of the items (drafts) or the issues recorded at submission. */
  issues: ExpenseIssueItem[];
}

export interface TravelLegItem {
  from: string;
  to: string;
  departOn: string;
  mode: 'FLIGHT' | 'TRAIN' | 'BUS' | 'CAR' | 'OTHER';
}

export interface TravelRequestItem {
  id: string;
  employee: EmployeeRef;
  purpose: string;
  startDate: string;
  endDate: string;
  legs: TravelLegItem[];
  estimatedCost: string | null;
  advanceRequested: string | null;
  notes: string | null;
  status: TravelStatusValue;
  approver: EmployeeRef | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  settlementBalance: string | null;
  recoveryMethod: PayoutMethodValue | null;
  recoveryReference: string | null;
  recoveredAt: string | null;
  settledAt: string | null;
  createdAt: string;
  can: { decide: boolean; cancel: boolean; desk: boolean };
}

export interface TravelBookingItem {
  id: string;
  type: 'FLIGHT' | 'TRAIN' | 'BUS' | 'CAB' | 'HOTEL' | 'OTHER';
  vendor: string;
  reference: string | null;
  bookedOn: string;
  amount: string;
  paidByCompany: boolean;
  notes: string | null;
}

export interface TravelAdvanceItem {
  id: string;
  amount: string;
  paidOn: string;
  reference: string;
}

export interface TravelRequestDetails extends TravelRequestItem {
  bookings: TravelBookingItem[];
  advances: TravelAdvanceItem[];
  claims: {
    id: string;
    title: string;
    status: ExpenseClaimStatusValue;
    totalClaimed: string;
    totalApproved: string | null;
  }[];
  /** Live settlement preview: approved claims minus advances. */
  settlement: {
    advances: string;
    claimed: string;
    balance: string;
    direction: 'PAYABLE' | 'RECOVERABLE' | 'SETTLED';
    pendingClaims: number;
  };
}

export interface AssetCategoryItem {
  id: string;
  code: string;
  name: string;
  usefulLifeMonths: number | null;
  salvagePercent: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  assetCount: number;
}

export interface AssetAllocationItem {
  id: string;
  employee: EmployeeRef;
  allocatedOn: string;
  expectedReturnOn: string | null;
  conditionNote: string | null;
  acknowledgedAt: string | null;
  returnedOn: string | null;
  returnCondition: 'GOOD' | 'DAMAGED' | 'LOST' | null;
  returnNote: string | null;
}

export interface AssetItem {
  id: string;
  tag: string;
  name: string;
  category: { id: string; code: string; name: string };
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  vendor: string | null;
  purchaseDate: string | null;
  purchaseCost: string | null;
  warrantyEnd: string | null;
  location: { id: string; code: string; name: string } | null;
  status: AssetStatusValue;
  notes: string | null;
  holder: EmployeeRef | null;
  /** Informational straight-line value today (null when not depreciated or no cost/date). */
  bookValue: string | null;
}

export interface AssetDetails extends AssetItem {
  allocations: AssetAllocationItem[];
  maintenance: {
    id: string;
    startedOn: string;
    completedOn: string | null;
    vendor: string | null;
    cost: string | null;
    description: string;
  }[];
  events: {
    type: string;
    note: string | null;
    employee: EmployeeRef | null;
    actor: string | null;
    at: string;
  }[];
}

export interface SoftwareLicenseItem {
  id: string;
  name: string;
  vendor: string | null;
  seats: number;
  usedSeats: number;
  expiresOn: string | null;
  cost: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  assignees: { assignmentId: string; employee: EmployeeRef; assignedOn: string }[];
}

export interface MyAssetsItem {
  assets: (AssetItem & {
    allocationId: string;
    allocatedOn: string;
    acknowledgedAt: string | null;
    expectedReturnOn: string | null;
  })[];
  licenses: { id: string; name: string; vendor: string | null; assignedOn: string }[];
}
