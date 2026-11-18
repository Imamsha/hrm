import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isoDateSchema, listQuerySchema, requiredText } from './common.js';
import { countryCodeSchema, nullableId, nullableText, panSchema } from './structure.js';

// ------------------------------------------------------------------------------ primitives

/** Optional date that may be cleared: "" and null become null; undefined means "unchanged". */
export const nullableDate = z
  .union([isoDateSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

/** Optional enum that may be cleared ("" → null). */
const nullableEnum = <T extends [string, ...string[]]>(values: T) =>
  z
    .union([z.enum(values), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

/** Lenient international phone number: digits with optional +, spaces, dashes, parentheses. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, 'Enter a valid phone number');
export const nullablePhone = z
  .union([phoneSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

export const nullableEmail = z
  .union([emailSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

/** Employee number: upper-cased; letters, digits, "-", "_" or "/"; 1–30 characters. */
export const employeeNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9/_-]{0,29}$/, 'Use 1–30 letters, digits, "-", "_" or "/"');

export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERN',
  'CONSULTANT',
] as const;
export const GENDERS = ['FEMALE', 'MALE', 'NON_BINARY', 'OTHER', 'UNDISCLOSED'] as const;
export const MARITAL_STATUSES = [
  'SINGLE',
  'MARRIED',
  'DIVORCED',
  'WIDOWED',
  'SEPARATED',
  'UNDISCLOSED',
] as const;
export const JOB_CHANGE_TYPES = [
  'TRANSFER',
  'PROMOTION',
  'REDESIGNATION',
  'MANAGER_CHANGE',
  'EMPLOYMENT_TYPE_CHANGE',
  'REORGANIZATION',
] as const;
export const SEPARATION_TYPES = [
  'RESIGNATION',
  'TERMINATION',
  'RETIREMENT',
  'CONTRACT_END',
  'OTHER',
] as const;
export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_NOTICE', 'SEPARATED'] as const;
export const FAMILY_RELATIONS = [
  'SPOUSE',
  'CHILD',
  'FATHER',
  'MOTHER',
  'SIBLING',
  'OTHER',
] as const;
export const SKILL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
export const DOCUMENT_CATEGORIES = [
  'IDENTITY',
  'ADDRESS_PROOF',
  'EDUCATION',
  'EMPLOYMENT',
  'CONTRACT',
  'LETTER',
  'OTHER',
] as const;

const todayIso = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------------------ job assignment

/** The organizational placement of an employee (one effective-dated employment record). */
export const jobAssignmentSchema = z.object({
  companyId: z.uuid('Select a company'),
  employmentType: z.enum(EMPLOYMENT_TYPES, 'Select an employment type'),
  legalEntityId: nullableId,
  branchId: nullableId,
  departmentId: nullableId,
  teamId: nullableId,
  designationId: nullableId,
  jobGradeId: nullableId,
  costCenterId: nullableId,
  managerId: nullableId,
});

const personalFields = {
  dateOfBirth: nullableDate,
  gender: nullableEnum([...GENDERS]),
  maritalStatus: nullableEnum([...MARITAL_STATUSES]),
  nationality: z
    .union([countryCodeSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  personalEmail: nullableEmail,
  personalPhone: nullablePhone,
};

const nameFields = {
  firstName: requiredText(100),
  middleName: nullableText(100),
  lastName: nullableText(100),
  preferredName: nullableText(100),
};

const dobBeforeJoining = (v: { dateOfBirth?: string | null; dateOfJoining?: string }) =>
  !v.dateOfBirth || !v.dateOfJoining || v.dateOfBirth < v.dateOfJoining;
const dobNotFuture = (v: { dateOfBirth?: string | null }) =>
  !v.dateOfBirth || v.dateOfBirth <= todayIso();

/** `POST /employees` — joining: creates the employee and their first employment record. */
export const createEmployeeSchema = jobAssignmentSchema
  .extend({
    ...nameFields,
    /** Leave empty to generate from the organization's numbering settings. */
    employeeNumber: z
      .union([employeeNumberSchema, z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === '' || v === null ? undefined : v)),
    workEmail: nullableEmail,
    workPhone: nullablePhone,
    dateOfJoining: isoDateSchema,
    probationEndDate: nullableDate,
    noticePeriodDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
    membershipId: nullableId,
    ...personalFields,
  })
  .refine((v) => !v.probationEndDate || v.probationEndDate > v.dateOfJoining, {
    message: 'Probation must end after the joining date',
    path: ['probationEndDate'],
  })
  .refine(dobBeforeJoining, {
    message: 'Date of birth must be before the joining date',
    path: ['dateOfBirth'],
  })
  .refine(dobNotFuture, {
    message: 'Date of birth cannot be in the future',
    path: ['dateOfBirth'],
  });
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;

/** `PATCH /employees/:id` — profile fields (job changes go through `/job-changes`). */
export const updateEmployeeSchema = z
  .object({
    ...nameFields,
    firstName: requiredText(100).optional(),
    employeeNumber: employeeNumberSchema.optional(),
    workEmail: nullableEmail,
    workPhone: nullablePhone,
    noticePeriodDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
    ...personalFields,
  })
  .refine(dobNotFuture, {
    message: 'Date of birth cannot be in the future',
    path: ['dateOfBirth'],
  });

/** `PATCH /me/employee` — what an employee may change about themselves. */
export const updateSelfSchema = z.object({
  preferredName: nullableText(100),
  personalEmail: nullableEmail,
  personalPhone: nullablePhone,
  maritalStatus: nullableEnum([...MARITAL_STATUSES]),
});

export const linkMemberSchema = z.object({ membershipId: z.uuid().nullable() });

export const employeeListQuerySchema = listQuerySchema.extend({
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  companyId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  /** Includes sub-departments. */
  departmentId: z.uuid().optional(),
  teamId: z.uuid().optional(),
  designationId: z.uuid().optional(),
  managerId: z.uuid().optional(),
});
export type EmployeeListQuery = z.output<typeof employeeListQuerySchema>;

// ------------------------------------------------------------------------------ lifecycle

/** `POST /employees/:id/job-changes` — a new effective-dated assignment (full placement). */
export const jobChangeSchema = jobAssignmentSchema.extend({
  effectiveFrom: isoDateSchema,
  changeType: z.enum(JOB_CHANGE_TYPES, 'Select the type of change'),
  remarks: nullableText(500),
});
export type JobChangeInput = z.input<typeof jobChangeSchema>;

export const confirmEmployeeSchema = z.object({ confirmationDate: isoDateSchema });
export const extendProbationSchema = z.object({ probationEndDate: isoDateSchema });

export const separationSchema = z
  .object({
    separationType: z.enum(SEPARATION_TYPES, 'Select the type of separation'),
    /** Date notice was given / the decision was communicated. */
    resignationDate: isoDateSchema,
    lastWorkingDate: isoDateSchema,
    reason: nullableText(1000),
  })
  .refine((v) => v.lastWorkingDate >= v.resignationDate, {
    message: 'Last working day cannot be before the notice date',
    path: ['lastWorkingDate'],
  });

export const rejoinSchema = jobAssignmentSchema.extend({
  dateOfJoining: isoDateSchema,
  probationEndDate: nullableDate,
  remarks: nullableText(500),
});

// ------------------------------------------------------------------------------ sub-records

export const addressSchema = z.object({
  type: z.enum(['CURRENT', 'PERMANENT']),
  line1: requiredText(200),
  line2: nullableText(200),
  city: requiredText(100),
  state: nullableText(100),
  postalCode: nullableText(20),
  countryCode: countryCodeSchema.default('IN'),
});

export const emergencyContactSchema = z.object({
  name: requiredText(200),
  relationship: requiredText(50),
  phone: phoneSchema,
  email: nullableEmail,
  isPrimary: z.boolean().default(false),
});

export const familyMemberFields = z.object({
  name: requiredText(200),
  relation: z.enum(FAMILY_RELATIONS),
  dateOfBirth: nullableDate,
  gender: nullableEnum([...GENDERS]),
  isDependent: z.boolean().default(false),
  phone: nullablePhone,
});
export const familyMemberSchema = familyMemberFields.refine(dobNotFuture, {
  message: 'Date of birth cannot be in the future',
  path: ['dateOfBirth'],
});

const year = z.coerce.number().int().min(1900).max(2200);
export const educationFields = z.object({
  qualification: requiredText(200),
  fieldOfStudy: nullableText(200),
  institution: requiredText(200),
  startYear: year.nullable().optional(),
  endYear: year.nullable().optional(),
  grade: nullableText(20),
});
export const educationSchema = educationFields.refine(
  (v) => !v.startYear || !v.endYear || v.endYear >= v.startYear,
  {
    message: 'End year cannot be before start year',
    path: ['endYear'],
  },
);

export const experienceFields = z.object({
  employer: requiredText(200),
  jobTitle: requiredText(200),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  location: nullableText(200),
  description: nullableText(2000),
});
export const experienceSchema = experienceFields.refine((v) => v.endDate >= v.startDate, {
  message: 'End date cannot be before start date',
  path: ['endDate'],
});

export const certificationFields = z.object({
  name: requiredText(200),
  issuer: nullableText(200),
  issuedOn: nullableDate,
  expiresOn: nullableDate,
  credentialId: nullableText(100),
});
export const certificationSchema = certificationFields.refine(
  (v) => !v.issuedOn || !v.expiresOn || v.expiresOn >= v.issuedOn,
  {
    message: 'Expiry cannot be before the issue date',
    path: ['expiresOn'],
  },
);

export const skillSchema = z.object({
  name: requiredText(100),
  level: z.enum(SKILL_LEVELS),
  years: z.coerce.number().int().min(0).max(60).nullable().optional(),
});

/** Indian Financial System Code: 4 letters (bank), 0, 6 alphanumerics (branch). */
export const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC is 11 characters, e.g. HDFC0001234');

export const bankAccountNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6,20}$/, 'Account number is 6–20 letters or digits');

export const createBankAccountSchema = z.object({
  accountHolderName: requiredText(200),
  bankName: requiredText(200),
  branchName: nullableText(200),
  ifsc: ifscSchema,
  accountNumber: bankAccountNumberSchema,
  accountType: z.enum(['SAVINGS', 'CURRENT']),
  isPrimary: z.boolean().default(false),
});
export const updateBankAccountSchema = createBankAccountSchema.partial();

/** UAN (EPF Universal Account Number): 12 digits. */
export const uanSchema = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v === null || v === undefined || /^[0-9]{12}$/.test(v), 'UAN is 12 digits');

export const statutoryIdsSchema = z.object({ pan: panSchema, uan: uanSchema });

export const employeeSettingsSchema = z.object({
  numberPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z0-9][A-Z0-9/_-]{0,9})?$/, 'Up to 10 letters, digits, "-", "_" or "/"'),
  numberPadding: z.coerce.number().int().min(1).max(10),
  nextNumber: z.coerce.number().int().min(1).max(999_999_999),
});

export const documentMetadataSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES, 'Select a category'),
  title: requiredText(200),
});
export const updateDocumentSchema = documentMetadataSchema.partial();

/** Upload limits shared by web (pre-check) and API (enforced). */
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Formats an employee number from settings, e.g. ("EMP-", 4, 42) → "EMP-0042". */
export function formatEmployeeNumber(prefix: string, padding: number, n: number): string {
  return `${prefix}${String(n).padStart(padding, '0')}`;
}
