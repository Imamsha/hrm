import { toDecimal } from '@hrm/business-rules';
import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isoDateSchema, listQuerySchema, requiredText } from './common.js';
import { DOCUMENT_CATEGORIES, EMPLOYMENT_TYPES, nullablePhone, phoneSchema } from './employees.js';
import { currencySchema } from './access.js';
import { nullableId, nullableText } from './structure.js';

/** Money amount as a decimal string (≤ 12 integer digits, 2 decimals); never a float. */
export const moneySchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Enter an amount with up to 2 decimals');

const nullableMoney = z
  .union([moneySchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

const nullableDate = z
  .union([isoDateSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

const rangeOk = (min: string | null | undefined, max: string | null | undefined) =>
  !min || !max || toDecimal(max).gte(toDecimal(min));

// ------------------------------------------------------------------------------ requisitions

const requisitionFields = z.object({
  title: requiredText(200),
  companyId: z.uuid('Select a company'),
  departmentId: nullableId,
  branchId: nullableId,
  designationId: nullableId,
  employmentType: z.enum(EMPLOYMENT_TYPES, 'Select an employment type'),
  headcount: z.coerce.number().int().min(1).max(1000),
  targetDate: nullableDate,
  justification: nullableText(2000),
  budgetMin: nullableMoney,
  budgetMax: nullableMoney,
  currency: currencySchema.default('INR'),
});
export const createRequisitionSchema = requisitionFields.refine(
  (v) => rangeOk(v.budgetMin, v.budgetMax),
  {
    message: 'The maximum cannot be below the minimum',
    path: ['budgetMax'],
  },
);
export const updateRequisitionSchema = requisitionFields.partial();

export const requisitionDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: nullableText(1000),
});

export const recruitmentListQuerySchema = listQuerySchema.extend({
  status: z.string().trim().toUpperCase().max(20).optional(),
  openingId: z.uuid().optional(),
  stage: z.string().trim().toUpperCase().max(20).optional(),
  candidateId: z.uuid().optional(),
});

// ------------------------------------------------------------------------------ openings

const openingFields = z.object({
  title: requiredText(200),
  requisitionId: nullableId,
  companyId: z.uuid('Select a company'),
  departmentId: nullableId,
  branchId: nullableId,
  location: nullableText(200),
  employmentType: z.enum(EMPLOYMENT_TYPES, 'Select an employment type'),
  description: requiredText(20_000),
  requirements: nullableText(10_000),
  experienceMinYears: z.coerce.number().int().min(0).max(60).nullable().optional(),
  experienceMaxYears: z.coerce.number().int().min(0).max(60).nullable().optional(),
  salaryMin: nullableMoney,
  salaryMax: nullableMoney,
  currency: currencySchema.default('INR'),
  showSalary: z.boolean().default(false),
  positions: z.coerce.number().int().min(1).max(1000).default(1),
  hiringManagerId: nullableId,
  closesOn: nullableDate,
});
const openingChecks = (v: {
  salaryMin?: string | null;
  salaryMax?: string | null;
  experienceMinYears?: number | null | undefined;
  experienceMaxYears?: number | null | undefined;
}) =>
  rangeOk(v.salaryMin, v.salaryMax) &&
  (typeof v.experienceMinYears !== 'number' ||
    typeof v.experienceMaxYears !== 'number' ||
    v.experienceMaxYears >= v.experienceMinYears);
export const createOpeningSchema = openingFields.refine(openingChecks, {
  message: 'Ranges must have the maximum at or above the minimum',
  path: ['salaryMax'],
});
export const updateOpeningSchema = openingFields.partial();
export const openingStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED']),
});

// ------------------------------------------------------------------------------ candidates

const skillsSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(50)
  .default([])
  .transform((list) => [...new Map(list.map((s) => [s.toLowerCase(), s])).values()]);

export const candidateSchema = z.object({
  firstName: requiredText(100),
  lastName: nullableText(100),
  email: emailSchema,
  phone: nullablePhone,
  currentCompany: nullableText(200),
  currentTitle: nullableText(200),
  totalExperienceMonths: z.coerce.number().int().min(0).max(720).nullable().optional(),
  location: nullableText(200),
  skills: skillsSchema,
  source: z.enum(['CAREER_PORTAL', 'REFERRAL', 'AGENCY', 'DIRECT', 'OTHER']).default('DIRECT'),
  sourceDetail: nullableText(200),
  notes: nullableText(5000),
});
export const updateCandidateSchema = candidateSchema.partial();

/** Public career-portal application (multipart fields). Consent is mandatory. */
export const portalApplicationSchema = z.object({
  firstName: requiredText(100),
  lastName: z.string().trim().max(100).optional(),
  email: emailSchema,
  phone: phoneSchema,
  currentCompany: z.string().trim().max(200).optional(),
  currentTitle: z.string().trim().max(200).optional(),
  totalExperienceMonths: z.coerce.number().int().min(0).max(720).optional(),
  location: z.string().trim().max(200).optional(),
  coverLetter: z.string().trim().max(5000).optional(),
  consent: z.literal('true', 'You must agree to the processing of your data to apply'),
});

// ------------------------------------------------------------------------------ applications

export const createApplicationSchema = z.object({ candidateId: z.uuid(), openingId: z.uuid() });
export const moveStageSchema = z
  .object({
    stage: z.enum([
      'APPLIED',
      'SCREENING',
      'ASSESSMENT',
      'INTERVIEW',
      'OFFER',
      'REJECTED',
      'WITHDRAWN',
    ]),
    note: nullableText(1000),
    rejectionReason: nullableText(500),
  })
  .refine((v) => v.stage !== 'REJECTED' || !!v.rejectionReason, {
    message: 'Give a reason for the rejection (recorded for the candidate record)',
    path: ['rejectionReason'],
  });

export const assessmentSchema = z
  .object({
    name: requiredText(200),
    score: moneySchema,
    maxScore: moneySchema,
    assessedOn: isoDateSchema,
    notes: nullableText(2000),
  })
  .refine((v) => toDecimal(v.maxScore).gt(0) && toDecimal(v.score).lte(toDecimal(v.maxScore)), {
    message: 'The score must be between 0 and the maximum',
    path: ['score'],
  });

export const interviewSchema = z.object({
  roundName: requiredText(100),
  scheduledAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  mode: z.enum(['IN_PERSON', 'VIDEO', 'PHONE']),
  locationOrLink: nullableText(500),
  panelEmployeeIds: z.array(z.uuid()).min(1, 'Add at least one interviewer').max(10),
});
export const interviewStatusSchema = z.object({
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
});

export const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  recommendation: z.enum(['STRONG_YES', 'YES', 'NO', 'STRONG_NO']),
  notes: requiredText(5000),
});

export const offerSchema = z.object({
  designationId: nullableId,
  jobGradeId: nullableId,
  joiningDate: isoDateSchema,
  annualCtc: moneySchema,
  currency: currencySchema.default('INR'),
  notes: nullableText(5000),
});
export const offerStatusSchema = z.object({
  status: z.enum(['SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN']),
});

/** Converting an accepted offer into an employee (joining). */
export const hireSchema = z.object({
  companyId: z.uuid('Select a company'),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  legalEntityId: nullableId,
  branchId: nullableId,
  departmentId: nullableId,
  teamId: nullableId,
  managerId: nullableId,
  probationEndDate: nullableDate,
  onboardingTemplateId: nullableId,
});

// ------------------------------------------------------------------------------ onboarding

export const onboardingTemplateTaskSchema = z.object({
  title: requiredText(200),
  description: nullableText(2000),
  assignee: z.enum(['HR', 'MANAGER', 'EMPLOYEE', 'IT']),
  dueOffsetDays: z.coerce.number().int().min(-90).max(365),
  documentCategory: z
    .union([z.enum(DOCUMENT_CATEGORIES), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

export const onboardingTemplateSchema = z.object({
  name: requiredText(100),
  description: nullableText(1000),
  isDefault: z.boolean().default(false),
  tasks: z.array(onboardingTemplateTaskSchema).min(1, 'Add at least one task').max(100),
});
export const updateOnboardingTemplateSchema = onboardingTemplateSchema.partial();

export const startOnboardingSchema = z.object({
  employeeId: z.uuid(),
  templateId: z.uuid(),
});

export const completeTaskSchema = z.object({
  status: z.enum(['DONE', 'SKIPPED', 'PENDING']),
});
