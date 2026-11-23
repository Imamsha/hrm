/** Shifts, attendance and leave transport types (Phase 05). */
import type { EmployeeRef } from './employees.js';
import type { RecordStatus } from './structure.js';

// ------------------------------------------------------------------------------ shifts

export interface ShiftItem {
  id: string;
  code: string;
  name: string;
  /** Local wall-clock times `HH:MM`; end ≤ start means the shift crosses midnight. */
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMinutes: number | null;
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
  isDefault: boolean;
  status: RecordStatus;
  assignmentCount: number;
}

export interface ShiftAssignmentItem {
  id: string;
  employee: EmployeeRef;
  shift: { id: string; code: string; name: string };
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface RosterEntryItem {
  id: string;
  employee: EmployeeRef;
  date: string;
  /** Null = day off (overrides the work week for this employee). */
  shift: { id: string; code: string; name: string } | null;
  note: string | null;
}

// ------------------------------------------------------------------------------ attendance

export type PunchSourceValue = 'WEB' | 'MOBILE' | 'QR' | 'BIOMETRIC_IMPORT' | 'MANUAL';
export type PunchDirectionValue = 'IN' | 'OUT';
export type AttendanceStatusValue =
  'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'WEEKLY_OFF' | 'HOLIDAY' | 'PENDING';

export interface PunchItem {
  id: string;
  punchedAt: string;
  direction: PunchDirectionValue;
  source: PunchSourceValue;
  latitude: string | null;
  longitude: string | null;
  note: string | null;
}

export interface AttendanceDayItem {
  date: string;
  status: AttendanceStatusValue;
  /** Leave covering the day (approved), if any. */
  leave: { type: string; session: 'FULL' | 'FIRST_HALF' | 'SECOND_HALF' } | null;
  /** Days of the leave on this day that are unpaid (0, 0.5 or 1); payroll loss of pay. */
  unpaidLeaveDays?: number;
  /** The calendar makes this a half working day. */
  halfWorkingDay?: boolean;
  holidayName: string | null;
  shift: { code: string; name: string } | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  missingPunch: boolean;
  workedOnOffDay: boolean;
  regularized: boolean;
  /** A regularization awaiting decision for this day. */
  pendingRegularization: boolean;
}

export interface AttendanceTotals {
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  weeklyOff: number;
  holiday: number;
  pending: number;
  workedMinutes: number;
  lateDays: number;
  overtimeMinutes: number;
  missingPunches: number;
}

/** `GET …/attendance?from&to` */
export interface AttendanceRangeItem {
  employee: EmployeeRef;
  timeZone: string;
  from: string;
  to: string;
  days: AttendanceDayItem[];
  totals: AttendanceTotals;
}

/** Today's state for the clock-in widget. */
export interface TodayAttendance {
  day: AttendanceDayItem;
  punches: PunchItem[];
  /** What the next punch would be. */
  nextDirection: PunchDirectionValue;
  timeZone: string;
  allowed: { web: boolean; mobile: boolean; qr: boolean; geolocationRequired: boolean };
}

/** Team/organization day overview. */
export interface AttendanceSummaryItem {
  date: string;
  counts: Record<AttendanceStatusValue, number>;
  late: number;
  missingPunches: number;
  employees: {
    employee: EmployeeRef;
    department: string | null;
    status: AttendanceStatusValue;
    firstIn: string | null;
    lastOut: string | null;
    lateMinutes: number;
  }[];
}

export type RequestStatusValue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface RegularizationItem {
  id: string;
  employee: EmployeeRef;
  date: string;
  requestedIn: string;
  requestedOut: string;
  reason: string;
  status: RequestStatusValue;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface KioskToken {
  token: string;
  /** URL to encode in the QR code (opens the web app's QR clock-in). */
  url: string;
  expiresAt: string;
  rotatesInSeconds: number;
  branch: { id: string; code: string; name: string };
}

export interface TimeSettingsItem {
  leaveYearStartMonth: number;
  webPunchEnabled: boolean;
  mobilePunchEnabled: boolean;
  qrPunchEnabled: boolean;
  geolocationRequired: boolean;
  qrRotationSeconds: number;
}

export interface PunchImportResult {
  imported: number;
  duplicates: number;
  errors: { row: number; message: string }[];
}

// ------------------------------------------------------------------------------ leave

export type AccrualMethodValue = 'NONE' | 'YEARLY' | 'MONTHLY';
export type LeaveSessionValue = 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveTypeItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isPaid: boolean;
  /** Track a balance (false = unlimited / not tracked, e.g. loss of pay). */
  tracksBalance: boolean;
  accrualMethod: AccrualMethodValue;
  /** Decimal string, days per leave year. */
  annualQuota: string;
  prorateOnJoining: boolean;
  /** Decimal string or null (null = nothing carries forward). */
  carryForwardMax: string | null;
  allowNegativeBalance: boolean;
  allowHalfDay: boolean;
  countWeeklyOffs: boolean;
  countHolidays: boolean;
  minNoticeDays: number;
  maxConsecutiveDays: string | null;
  allowDuringProbation: boolean;
  /** Empty = all employment types. */
  employmentTypes: string[];
  status: RecordStatus;
}

export interface LeaveBalanceItem {
  leaveType: { id: string; code: string; name: string; isPaid: boolean; tracksBalance: boolean };
  year: number;
  /** Decimal strings. */
  opening: string;
  accrued: string;
  adjusted: string;
  used: string;
  pending: string;
  /** accrued + opening + adjusted − used. */
  balance: string;
  /** balance − pending. */
  available: string;
}

export interface LeaveRequestItem {
  id: string;
  employee: EmployeeRef;
  leaveType: { id: string; code: string; name: string };
  startDate: string;
  endDate: string;
  startSession: LeaveSessionValue;
  endSession: LeaveSessionValue;
  days: string;
  reason: string | null;
  status: RequestStatusValue;
  approver: EmployeeRef | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  /** Caller may approve/reject this request. */
  canDecide: boolean;
}

export interface LeaveLedgerItem {
  id: string;
  entryType:
    'OPENING' | 'ACCRUAL' | 'ADJUSTMENT' | 'USAGE' | 'REVERSAL' | 'CARRY_FORWARD' | 'LAPSE';
  days: string;
  effectiveDate: string;
  note: string | null;
  createdAt: string;
}

/** `POST /leave/requests/preview` */
export interface LeavePreview {
  days: string;
  breakdown: { date: string; days: number; kind: string }[];
  balance: LeaveBalanceItem | null;
  problems: string[];
}

/** Items awaiting the caller's decision. */
export interface ApprovalInbox {
  leave: LeaveRequestItem[];
  regularizations: RegularizationItem[];
}
