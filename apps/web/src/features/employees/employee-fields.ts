import type { EmployeeDetails, EmploymentRecordItem } from '@hrm/shared-types';
import { JOB_CHANGE_TYPES } from '@hrm/validation';
import type { RefRow, RefSource } from '@/features/structure/api';
import type { FieldDef, FormValues } from '@/features/structure/entity-payload';
import {
  CHANGE_TYPE_LABEL,
  EMPLOYMENT_TYPE_LABEL,
  GENDER_OPTIONS,
  MARITAL_OPTIONS,
  options,
  SEPARATION_LABEL,
} from './labels';

const COMPANIES: RefSource = { path: '/companies' };
const EMPLOYEES: RefSource = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};

/** Organizational placement (one employment record). */
export const placementFields: FieldDef[] = [
  {
    name: 'companyId',
    label: 'Company',
    kind: 'ref',
    ref: COMPANIES,
    required: true,
    section: 'Placement',
  },
  {
    name: 'employmentType',
    label: 'Employment type',
    kind: 'select',
    options: options(EMPLOYMENT_TYPE_LABEL),
    required: true,
    placeholder: 'Select…',
    section: 'Placement',
  },
  {
    name: 'legalEntityId',
    label: 'Legal entity (employer)',
    kind: 'ref',
    ref: { path: '/legal-entities' },
    refFilter: { field: 'companyId', param: 'companyId' },
    section: 'Placement',
  },
  {
    name: 'branchId',
    label: 'Branch',
    kind: 'ref',
    ref: { path: '/branches' },
    refFilter: { field: 'companyId', param: 'companyId' },
    section: 'Placement',
  },
  {
    name: 'departmentId',
    label: 'Department',
    kind: 'ref',
    ref: { path: '/departments' },
    refFilter: { field: 'companyId', param: 'companyId' },
    section: 'Placement',
  },
  {
    name: 'teamId',
    label: 'Team',
    kind: 'ref',
    ref: { path: '/teams' },
    refFilter: { field: 'departmentId', param: 'departmentId' },
    section: 'Placement',
  },
  {
    name: 'designationId',
    label: 'Designation',
    kind: 'ref',
    ref: { path: '/designations' },
    section: 'Placement',
  },
  {
    name: 'jobGradeId',
    label: 'Job grade',
    kind: 'ref',
    ref: { path: '/job-grades', sortBy: 'rank' },
    section: 'Placement',
  },
  {
    name: 'costCenterId',
    label: 'Cost center',
    kind: 'ref',
    ref: { path: '/cost-centers', sortBy: 'code' },
    section: 'Placement',
  },
  {
    name: 'managerId',
    label: 'Reporting manager',
    kind: 'ref',
    ref: EMPLOYEES,
    refParams: { status: 'ACTIVE' },
    section: 'Placement',
  },
];

export const emptyPlacement: FormValues = Object.fromEntries(
  placementFields.map((f) => [f.name, '']),
);

/** Prefills a placement from an employment record. */
export function placementValues(r: EmploymentRecordItem | null | undefined): FormValues {
  if (!r) return { ...emptyPlacement };
  return {
    companyId: r.company.id,
    employmentType: r.employmentType,
    legalEntityId: r.legalEntity?.id ?? '',
    branchId: r.branch?.id ?? '',
    departmentId: r.department?.id ?? '',
    teamId: r.team?.id ?? '',
    designationId: r.designation?.id ?? '',
    jobGradeId: r.jobGrade?.id ?? '',
    costCenterId: r.costCenter?.id ?? '',
    managerId: r.manager?.id ?? '',
  };
}

const nameFields: FieldDef[] = [
  { name: 'firstName', label: 'First name', required: true, section: 'Identity' },
  { name: 'lastName', label: 'Last name', section: 'Identity' },
  { name: 'middleName', label: 'Middle name', section: 'Identity' },
  { name: 'preferredName', label: 'Preferred name', section: 'Identity' },
];

export const createEmployeeFields: FieldDef[] = [
  ...nameFields,
  {
    name: 'employeeNumber',
    label: 'Employee number',
    placeholder: 'Generated automatically',
    omitIfBlank: true,
    description: 'Leave empty to use the next number.',
    section: 'Identity',
  },
  { name: 'workEmail', label: 'Work e-mail', kind: 'email', section: 'Identity' },
  { name: 'workPhone', label: 'Work phone', section: 'Identity' },
  {
    name: 'dateOfJoining',
    label: 'Date of joining',
    kind: 'date',
    required: true,
    section: 'Employment',
  },
  {
    name: 'probationEndDate',
    label: 'Probation ends',
    kind: 'date',
    description: 'Leave empty if there is no probation.',
    section: 'Employment',
  },
  {
    name: 'noticePeriodDays',
    label: 'Notice period (days)',
    kind: 'number',
    section: 'Employment',
  },
  ...placementFields,
];

export const emptyEmployee: FormValues = {
  ...Object.fromEntries(createEmployeeFields.map((f) => [f.name, ''])),
};

export const profileFields: FieldDef[] = [
  ...nameFields,
  { name: 'employeeNumber', label: 'Employee number', required: true, section: 'Identity' },
  { name: 'workEmail', label: 'Work e-mail', kind: 'email', section: 'Contact' },
  { name: 'workPhone', label: 'Work phone', section: 'Contact' },
  {
    name: 'noticePeriodDays',
    label: 'Notice period (days)',
    kind: 'number',
    section: 'Employment',
  },
];

export function profileValues(e: EmployeeDetails): FormValues {
  return {
    firstName: e.firstName,
    lastName: e.lastName ?? '',
    middleName: e.middleName ?? '',
    preferredName: e.preferredName ?? '',
    employeeNumber: e.employeeNumber,
    workEmail: e.workEmail ?? '',
    workPhone: e.workPhone ?? '',
    noticePeriodDays: e.noticePeriodDays === null ? '' : String(e.noticePeriodDays),
  };
}

export const personalFields: FieldDef[] = [
  { name: 'dateOfBirth', label: 'Date of birth', kind: 'date' },
  { name: 'gender', label: 'Gender', kind: 'select', options: GENDER_OPTIONS },
  { name: 'maritalStatus', label: 'Marital status', kind: 'select', options: MARITAL_OPTIONS },
  {
    name: 'nationality',
    label: 'Nationality',
    placeholder: 'IN',
    description: 'ISO 3166 two-letter code.',
  },
  { name: 'personalEmail', label: 'Personal e-mail', kind: 'email' },
  { name: 'personalPhone', label: 'Personal phone' },
];

export function personalValues(e: EmployeeDetails): FormValues {
  const p = e.personal;
  return {
    dateOfBirth: p?.dateOfBirth ?? '',
    gender: p?.gender ?? '',
    maritalStatus: p?.maritalStatus ?? '',
    nationality: p?.nationality ?? '',
    personalEmail: p?.personalEmail ?? '',
    personalPhone: p?.personalPhone ?? '',
  };
}

/** What employees may change about themselves. */
export const selfContactFields: FieldDef[] = [
  { name: 'preferredName', label: 'Preferred name' },
  { name: 'maritalStatus', label: 'Marital status', kind: 'select', options: MARITAL_OPTIONS },
  { name: 'personalEmail', label: 'Personal e-mail', kind: 'email' },
  { name: 'personalPhone', label: 'Personal phone' },
];

export const jobChangeFields: FieldDef[] = [
  {
    name: 'effectiveFrom',
    label: 'Effective from',
    kind: 'date',
    required: true,
    section: 'Change',
  },
  {
    name: 'changeType',
    label: 'Type of change',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: JOB_CHANGE_TYPES.map((t) => ({ value: t, label: CHANGE_TYPE_LABEL[t] })),
    section: 'Change',
  },
  { name: 'remarks', label: 'Remarks', kind: 'textarea', section: 'Change' },
  ...placementFields,
];

export const rejoinFields: FieldDef[] = [
  {
    name: 'dateOfJoining',
    label: 'Rejoining date',
    kind: 'date',
    required: true,
    section: 'Rejoining',
  },
  { name: 'probationEndDate', label: 'Probation ends', kind: 'date', section: 'Rejoining' },
  { name: 'remarks', label: 'Remarks', kind: 'textarea', section: 'Rejoining' },
  ...placementFields,
];

export const separationFields: FieldDef[] = [
  {
    name: 'separationType',
    label: 'Type',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: options(SEPARATION_LABEL),
  },
  { name: 'resignationDate', label: 'Notice given on', kind: 'date', required: true },
  { name: 'lastWorkingDate', label: 'Last working day', kind: 'date', required: true },
  { name: 'reason', label: 'Reason', kind: 'textarea' },
];

export const settingsFields: FieldDef[] = [
  {
    name: 'numberPrefix',
    label: 'Prefix',
    placeholder: 'EMP-',
    blank: '',
    description: 'Up to 10 characters; may be empty.',
  },
  {
    name: 'numberPadding',
    label: 'Digits',
    kind: 'number',
    required: true,
    description: 'Zero-padded width, e.g. 4 → 0042.',
  },
  { name: 'nextNumber', label: 'Next number', kind: 'number', required: true },
];
