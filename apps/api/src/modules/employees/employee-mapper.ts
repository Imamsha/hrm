import type {
  EmployeeDetails,
  EmployeeListItem,
  EmployeeRef,
  EmploymentRecordItem,
  Ref,
} from '@hrm/shared-types';
import type { Prisma } from '../../../generated/prisma/client.js';
import { refSelect, toRef } from '../structure/structure.util.js';
import { currentRecord, displayName, isoDate, isoOrNull } from './employee-scope.js';

export const employeeRefSelect = {
  id: true,
  employeeNumber: true,
  firstName: true,
  lastName: true,
  preferredName: true,
} satisfies Prisma.EmployeeSelect;

export function toEmployeeRef(
  e: Prisma.EmployeeGetPayload<{ select: typeof employeeRefSelect }> | null,
): EmployeeRef | null {
  return e ? { id: e.id, employeeNumber: e.employeeNumber, displayName: displayName(e) } : null;
}

export const recordSelect = {
  id: true,
  effectiveFrom: true,
  effectiveTo: true,
  changeType: true,
  employmentType: true,
  remarks: true,
  createdAt: true,
  companyId: true,
  branchId: true,
  departmentId: true,
  teamId: true,
  managerId: true,
  company: { select: refSelect },
  legalEntity: { select: { id: true, code: true, legalName: true } },
  branch: { select: refSelect },
  department: { select: refSelect },
  team: { select: refSelect },
  designation: { select: refSelect },
  jobGrade: { select: { ...refSelect, rank: true } },
  costCenter: { select: refSelect },
  manager: { select: employeeRefSelect },
} satisfies Prisma.EmploymentRecordSelect;

export type RecordRow = Prisma.EmploymentRecordGetPayload<{ select: typeof recordSelect }>;

export function toRecordItem(r: RecordRow): EmploymentRecordItem {
  const legalEntity: Ref | null = r.legalEntity
    ? { id: r.legalEntity.id, code: r.legalEntity.code, name: r.legalEntity.legalName }
    : null;
  return {
    id: r.id,
    effectiveFrom: isoDate(r.effectiveFrom),
    effectiveTo: isoOrNull(r.effectiveTo),
    changeType: r.changeType,
    employmentType: r.employmentType,
    company: toRef(r.company) as Ref,
    legalEntity,
    branch: toRef(r.branch),
    department: toRef(r.department),
    team: toRef(r.team),
    designation: toRef(r.designation),
    jobGrade: r.jobGrade
      ? { id: r.jobGrade.id, code: r.jobGrade.code, name: r.jobGrade.name, rank: r.jobGrade.rank }
      : null,
    costCenter: toRef(r.costCenter),
    manager: toEmployeeRef(r.manager),
    remarks: r.remarks,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Newest records first; three are enough to find the current one (one future change max). */
export const recentRecords = {
  select: recordSelect,
  orderBy: { effectiveFrom: 'desc' },
  take: 3,
} satisfies Prisma.Employee$employmentRecordsArgs;

export const employeeListSelect = {
  ...employeeRefSelect,
  workEmail: true,
  workPhone: true,
  status: true,
  dateOfJoining: true,
  membershipId: true,
  employmentRecords: recentRecords,
} satisfies Prisma.EmployeeSelect;

export type EmployeeListRow = Prisma.EmployeeGetPayload<{ select: typeof employeeListSelect }>;

export function toListItem(e: EmployeeListRow, today: string): EmployeeListItem {
  const job = currentRecord(e.employmentRecords, today);
  const item = job ? toRecordItem(job) : null;
  return {
    id: e.id,
    employeeNumber: e.employeeNumber,
    displayName: displayName(e),
    firstName: e.firstName,
    lastName: e.lastName,
    workEmail: e.workEmail,
    workPhone: e.workPhone,
    status: e.status,
    dateOfJoining: isoDate(e.dateOfJoining),
    job: item
      ? {
          company: item.company,
          branch: item.branch,
          department: item.department,
          team: item.team,
          designation: item.designation,
          manager: item.manager,
          employmentType: item.employmentType,
        }
      : null,
    hasUserAccount: e.membershipId !== null,
  };
}

export const employeeDetailSelect = {
  ...employeeListSelect,
  middleName: true,
  probationStatus: true,
  probationEndDate: true,
  confirmationDate: true,
  noticePeriodDays: true,
  resignationDate: true,
  lastWorkingDate: true,
  separationType: true,
  separationReason: true,
  dateOfBirth: true,
  gender: true,
  maritalStatus: true,
  nationality: true,
  personalEmail: true,
  personalPhone: true,
  createdAt: true,
  updatedAt: true,
  membership: { select: { id: true, userId: true, user: { select: { email: true } } } },
} satisfies Prisma.EmployeeSelect;

export type EmployeeDetailRow = Prisma.EmployeeGetPayload<{ select: typeof employeeDetailSelect }>;

export function toDetails(
  e: EmployeeDetailRow,
  today: string,
  access: EmployeeDetails['access'],
): EmployeeDetails {
  return {
    ...toListItem(e, today),
    middleName: e.middleName,
    preferredName: e.preferredName,
    probationStatus: e.probationStatus,
    probationEndDate: isoOrNull(e.probationEndDate),
    confirmationDate: isoOrNull(e.confirmationDate),
    noticePeriodDays: e.noticePeriodDays,
    resignationDate: isoOrNull(e.resignationDate),
    lastWorkingDate: isoOrNull(e.lastWorkingDate),
    separationType: e.separationType,
    separationReason: e.separationReason,
    member: e.membership ? { membershipId: e.membership.id, email: e.membership.user.email } : null,
    personal:
      access.personal || access.self
        ? {
            dateOfBirth: isoOrNull(e.dateOfBirth),
            gender: e.gender,
            maritalStatus: e.maritalStatus,
            nationality: e.nationality,
            personalEmail: e.personalEmail,
            personalPhone: e.personalPhone,
          }
        : null,
    access,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
