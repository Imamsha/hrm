/** Organization structure transport types (Phase 03). */

export type RecordStatus = 'ACTIVE' | 'INACTIVE';

export interface Ref {
  id: string;
  code: string;
  name: string;
}

interface Audited {
  id: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyItem extends Audited {
  code: string;
  name: string;
  countryCode: string;
  defaultCurrency: string | null;
  timezone: string | null;
  counts: { legalEntities: number; branches: number; departments: number };
}

export interface LegalEntityItem extends Audited {
  code: string;
  legalName: string;
  countryCode: string;
  company: Ref;
  pan: string | null;
  tan: string | null;
  gstin: string | null;
  cin: string | null;
  registrationNumber: string | null;
  registeredLocation: Ref | null;
}

export interface LocationItem extends Audited {
  code: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  countryCode: string;
  timezone: string | null;
  /** Decimal strings (never floats). */
  latitude: string | null;
  longitude: string | null;
}

export interface BranchItem extends Audited {
  code: string;
  name: string;
  timezone: string | null;
  company: Ref;
  legalEntity: Ref | null;
  location: Ref | null;
  workWeek: { id: string; name: string } | null;
  holidayCalendar: { id: string; name: string } | null;
}

export interface CostCenterItem extends Audited {
  code: string;
  name: string;
  company: Ref | null;
}

export interface DepartmentItem extends Audited {
  code: string;
  name: string;
  company: Ref;
  parent: Ref | null;
  costCenter: Ref | null;
  counts: { children: number; teams: number };
}

export interface TeamItem extends Audited {
  code: string;
  name: string;
  department: Ref;
}

export interface JobGradeItem extends Audited {
  code: string;
  name: string;
  rank: number;
  description: string | null;
  designationCount: number;
}

export interface DesignationItem extends Audited {
  code: string;
  name: string;
  description: string | null;
  jobGrade: (Ref & { rank: number }) | null;
}

export type DayTypeValue = 'FULL' | 'HALF' | 'OFF';

export interface WorkWeekRuleItem {
  weekday: number;
  occurrence: number;
  dayType: DayTypeValue;
}

export interface WorkWeekItem {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  rules: WorkWeekRuleItem[];
  branchCount: number;
  createdAt: string;
  updatedAt: string;
}

export type HolidayKindValue = 'PUBLIC' | 'OPTIONAL';

export interface HolidayItem {
  id: string;
  date: string;
  name: string;
  kind: HolidayKindValue;
}

export interface HolidayCalendarItem {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  holidayCount: number;
  branchCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ResolvedDayKindValue =
  'WORKING' | 'HALF_DAY' | 'WEEKLY_OFF' | 'HOLIDAY' | 'OPTIONAL_HOLIDAY';

/** `GET /calendar/resolve` */
export interface ResolvedCalendar {
  branch: Ref | null;
  workWeek: { id: string; name: string } | null;
  holidayCalendar: { id: string; name: string } | null;
  from: string;
  to: string;
  workingDays: number;
  days: { date: string; weekday: number; kind: ResolvedDayKindValue; holidayName?: string }[];
}

/** `GET /org-chart` — structure tree (people are attached in Phase 04). */
export interface OrgChartDepartmentNode {
  id: string;
  code: string;
  name: string;
  status: RecordStatus;
  teams: Ref[];
  children: OrgChartDepartmentNode[];
}

export interface OrgChartCompanyNode {
  id: string;
  code: string;
  name: string;
  status: RecordStatus;
  branches: Ref[];
  departments: OrgChartDepartmentNode[];
}

export interface OrgChart {
  companies: OrgChartCompanyNode[];
}

export interface ScopedRoleAssignment {
  id: string;
  role: { id: string; key: string; name: string };
  scopeType: 'ORGANIZATION' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT' | 'TEAM' | 'SELF';
  scope: Ref | null;
}
