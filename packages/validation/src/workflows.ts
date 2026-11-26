import {
  MERGE_FIELDS,
  type TemplateCategory,
  toDecimal,
  validateDefinition,
  validateTemplate,
} from '@hrm/business-rules';
import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isoDateSchema, requiredText } from './common.js';
import { nullableText } from './structure.js';

/**
 * Workflow engine, documents and e-acceptance (Phase 11a, ADR-018). Chains, thresholds, SLAs and
 * template wording are organization configuration; these schemas check shape and consistency.
 */

const processSchema = z.enum([
  'LEAVE_REQUEST',
  'EXPENSE_CLAIM',
  'TRAVEL_REQUEST',
  'TIMESHEET',
  'RESIGNATION',
]);
const threshold = z
  .union([z.string().trim(), z.number(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined || v === null ? null : String(v)))
  .refine(
    (v) => v === null || (/^\d{1,12}(\.\d{1,2})?$/.test(v) && toDecimal(v).gte(0)),
    'Enter a number of 0 or more',
  );

const approverSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('REPORTING_MANAGER') }),
  z.object({ type: z.literal('MANAGER_LEVEL'), level: z.coerce.number().int() }),
  z.object({ type: z.literal('ROLE'), roleKey: z.string().trim().min(1).max(64) }),
  z.object({ type: z.literal('EMPLOYEE'), employeeId: z.uuid('Choose the employee') }),
]);
const escalationSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('NEXT_MANAGER') }),
    z.object({ type: z.literal('EMPLOYEE'), employeeId: z.uuid('Choose the employee') }),
  ])
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const workflowStepSchema = z.object({
  name: requiredText(80),
  approver: approverSchema,
  minMeasure: threshold,
  slaHours: z.coerce
    .number()
    .int()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  escalateTo: escalationSchema,
});

export const workflowDefinitionSchema = z
  .object({
    process: processSchema,
    name: requiredText(120),
    steps: z.array(workflowStepSchema).max(10),
  })
  .superRefine((v, ctx) => {
    for (const message of validateDefinition(v.steps))
      ctx.addIssue({ code: 'custom', message, path: ['steps'] });
  });

export const workflowStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });

export const approvalDecisionSchema = z
  .object({ decision: z.enum(['APPROVED', 'REJECTED']), note: nullableText(500) })
  .refine((v) => v.decision !== 'REJECTED' || !!v.note, {
    message: 'Give a reason',
    path: ['note'],
  });

export const delegationSchema = z
  .object({
    delegateEmployeeId: z.uuid('Choose the delegate'),
    from: isoDateSchema,
    to: isoDateSchema,
    processes: z.array(processSchema).max(5).default([]),
    note: nullableText(300),
  })
  .refine((v) => v.to >= v.from, { message: 'The end cannot be before the start', path: ['to'] });

// ------------------------------------------------------------------------------ documents

export const templateCategorySchema = z.enum([
  'OFFER_LETTER',
  'APPOINTMENT_LETTER',
  'EXPERIENCE_LETTER',
  'RELIEVING_LETTER',
  'SALARY_CERTIFICATE',
  'POLICY',
  'OTHER',
]);

export const documentTemplateSchema = z
  .object({
    name: requiredText(120),
    category: templateCategorySchema,
    title: requiredText(200),
    body: requiredText(50_000),
  })
  .superRefine((v, ctx) => {
    for (const message of validateTemplate(v.category, `${v.title}\n${v.body}`))
      ctx.addIssue({ code: 'custom', message, path: ['body'] });
  });

/** A new version of an existing template (category fixed by the template). */
export const templateVersionSchema = z.object({
  title: requiredText(200),
  body: requiredText(50_000),
});

export const generateDocumentSchema = z
  .object({
    templateId: z.uuid('Choose the template'),
    employeeId: z.uuid().optional(),
    offerId: z.uuid().optional(),
    /** Values the catalogue cannot derive (e.g. a last working day); merged over derived ones. */
    values: z.record(z.string().max(60), z.string().trim().max(500)).default({}),
    signers: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('EMPLOYEE'), employeeId: z.uuid('Choose the signer') }),
          z.object({ kind: z.literal('CANDIDATE') }),
        ]),
      )
      .max(5)
      .default([]),
  })
  .refine((v) => !!v.employeeId !== !!v.offerId, {
    message: 'Choose the employee or the offer',
    path: ['employeeId'],
  });

export const declineSchema = z.object({ reason: requiredText(500) });
export const otpRequestSchema = z.object({ email: emailSchema });
export const otpAcceptSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const libraryDocumentSchema = z.object({
  title: requiredText(200),
  category: requiredText(60),
  description: nullableText(2000),
  requiresAcknowledgement: z.coerce.boolean().default(false),
  audienceCompanyId: z
    .union([z.uuid(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  audienceDepartmentId: z
    .union([z.uuid(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
});

/** The catalogue of merge fields, for editors. */
export const mergeFieldsFor = (category: TemplateCategory): readonly string[] =>
  MERGE_FIELDS[category];
