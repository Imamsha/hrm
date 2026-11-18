/** Employee management transport types (Phase 04). */
import type { Ref } from './structure.js';

export type EmployeeStatusValue = 'ACTIVE' | 'ON_NOTICE' | 'SEPARATED';
export type EmploymentTypeValue = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN' | 'CONSULTANT';
export type ProbationStatusValue = 'NOT_APPLICABLE' | 'ON_PROBATION' | 'CONFIRMED';
export type GenderValue = 'FEMALE' | 'MALE' | 'NON_BINARY' | 'OTHER' | 'UNDISCLOSED';
export type MaritalStatusValue =
  'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | 'SEPARATED' | 'UNDISCLOSED';
export type EmploymentChangeTypeValue =
  | 'JOINING'
  | 'TRANSFER'
  | 'PROMOTION'
  | 'REDESIGNATION'
  | 'MANAGER_CHANGE'
  | 'EMPLOYMENT_TYPE_CHANGE'
  | 'REORGANIZATION'
  | 'REJOINING';
export type SeparationTypeValue =
  'RESIGNATION' | 'TERMINATION' | 'RETIREMENT' | 'CONTRACT_END' | 'OTHER';
export type AddressTypeValue = 'CURRENT' | 'PERMANENT';
export type FamilyRelationValue = 'SPOUSE' | 'CHILD' | 'FATHER' | 'MOTHER' | 'SIBLING' | 'OTHER';
export type SkillLevelValue = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | 'EXPERT';
export type BankAccountTypeValue = 'SAVINGS' | 'CURRENT';
export type EmployeeDocumentCategoryValue =
  'IDENTITY' | 'ADDRESS_PROOF' | 'EDUCATION' | 'EMPLOYMENT' | 'CONTRACT' | 'LETTER' | 'OTHER';

/** A person reference used for managers and direct reports. */
export interface EmployeeRef {
  id: string;
  employeeNumber: string;
  displayName: string;
}

/** The job assignment in force on a date (effective-dated). */
export interface EmploymentRecordItem {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeType: EmploymentChangeTypeValue;
  employmentType: EmploymentTypeValue;
  company: Ref;
  legalEntity: Ref | null;
  branch: Ref | null;
  department: Ref | null;
  team: Ref | null;
  designation: Ref | null;
  jobGrade: (Ref & { rank: number }) | null;
  costCenter: Ref | null;
  manager: EmployeeRef | null;
  remarks: string | null;
  createdAt: string;
}

/** Directory row. */
export interface EmployeeListItem {
  id: string;
  employeeNumber: string;
  displayName: string;
  firstName: string;
  lastName: string | null;
  workEmail: string | null;
  workPhone: string | null;
  status: EmployeeStatusValue;
  dateOfJoining: string;
  /** Current assignment (null only if the first record is future-dated). */
  job: Pick<
    EmploymentRecordItem,
    'company' | 'branch' | 'department' | 'team' | 'designation' | 'manager' | 'employmentType'
  > | null;
  hasUserAccount: boolean;
}

export interface EmployeePersonalDetails {
  dateOfBirth: string | null;
  gender: GenderValue | null;
  maritalStatus: MaritalStatusValue | null;
  nationality: string | null;
  personalEmail: string | null;
  personalPhone: string | null;
}

/** Profile. `personal` is present only with `employees.personal.read` (or for yourself). */
export interface EmployeeDetails extends EmployeeListItem {
  middleName: string | null;
  preferredName: string | null;
  probationStatus: ProbationStatusValue;
  probationEndDate: string | null;
  confirmationDate: string | null;
  noticePeriodDays: number | null;
  resignationDate: string | null;
  lastWorkingDate: string | null;
  separationType: SeparationTypeValue | null;
  separationReason: string | null;
  member: { membershipId: string; email: string } | null;
  personal: EmployeePersonalDetails | null;
  /** What the caller may do with this profile (UI affordances; the API enforces the same). */
  access: {
    update: boolean;
    lifecycle: boolean;
    personal: boolean;
    sensitive: boolean;
    sensitiveManage: boolean;
    documents: boolean;
    documentsManage: boolean;
    self: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeAddressItem {
  id: string;
  type: AddressTypeValue;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  countryCode: string;
}

export interface EmergencyContactItem {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string | null;
  isPrimary: boolean;
}

export interface FamilyMemberItem {
  id: string;
  name: string;
  relation: FamilyRelationValue;
  dateOfBirth: string | null;
  gender: GenderValue | null;
  isDependent: boolean;
  phone: string | null;
}

export interface EducationItem {
  id: string;
  qualification: string;
  fieldOfStudy: string | null;
  institution: string;
  startYear: number | null;
  endYear: number | null;
  grade: string | null;
}

export interface ExperienceItem {
  id: string;
  employer: string;
  jobTitle: string;
  startDate: string;
  endDate: string;
  location: string | null;
  description: string | null;
}

export interface CertificationItem {
  id: string;
  name: string;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  credentialId: string | null;
}

export interface SkillItem {
  id: string;
  name: string;
  level: SkillLevelValue;
  years: number | null;
}

/** Account numbers are never returned in lists; use the reveal endpoint (audited). */
export interface BankAccountItem {
  id: string;
  accountHolderName: string;
  bankName: string;
  branchName: string | null;
  ifsc: string;
  accountType: BankAccountTypeValue;
  accountNumberMasked: string;
  isPrimary: boolean;
}

export interface StatutoryIdsItem {
  panMasked: string | null;
  uanMasked: string | null;
}

export interface EmployeeDocumentItem {
  id: string;
  category: EmployeeDocumentCategoryValue;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface EmployeeSettingsItem {
  numberPrefix: string;
  numberPadding: number;
  nextNumber: number;
  /** The number the next employee will receive, e.g. `EMP-0042`. */
  preview: string;
}

/** Sub-collections reachable under `/employees/:id/<collection>` and `/me/employee/<collection>`. */
export const EMPLOYEE_COLLECTIONS = [
  'addresses',
  'emergency-contacts',
  'family-members',
  'education',
  'experience',
  'certifications',
  'skills',
] as const;
export type EmployeeCollection = (typeof EMPLOYEE_COLLECTIONS)[number];
