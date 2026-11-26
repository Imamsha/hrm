import { z } from 'zod';
import { isoDateSchema, requiredText } from './common.js';
import { codeSchema, nullableText } from './structure.js';

/**
 * Helpdesk, separation & offboarding, compliance (Phase 11b, ADR-019). SLAs, notice periods,
 * clearance items, exit questions and obligations are organization configuration.
 */

const keep = <T extends z.ZodType>(s: T) =>
  z
    .union([s, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v) as z.output<T> | null | undefined);
const optionalId = keep(z.uuid());
const hours = keep(z.coerce.number().int().min(1).max(8760));
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

// ------------------------------------------------------------------------------ helpdesk

export const helpdeskCategorySchema = z.object({
  code: codeSchema,
  name: requiredText(80),
  description: nullableText(500),
  agentEmployeeIds: z.array(z.uuid()).min(1, 'Add at least one agent').max(50),
  defaultAssigneeId: optionalId,
  escalationEmployeeId: optionalId,
  confidential: z.boolean().default(false),
  sla: z
    .array(z.object({ priority, firstResponseHours: hours, resolutionHours: hours }))
    .max(4)
    .default([])
    .refine((l) => new Set(l.map((x) => x.priority)).size === l.length, 'One SLA per priority'),
});
export const updateHelpdeskCategorySchema = helpdeskCategorySchema.omit({ code: true }).extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const ticketSchema = z.object({
  categoryId: z.uuid('Choose a category'),
  subject: requiredText(200),
  description: requiredText(10_000),
  priority: priority.default('MEDIUM'),
});

export const ticketUpdateSchema = z
  .object({
    status: z
      .enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED'])
      .optional(),
    assigneeId: optionalId,
    priority: priority.optional(),
    resolution: nullableText(2000),
  })
  .refine((v) => v.status !== 'RESOLVED' || !!v.resolution, {
    message: 'Describe the resolution',
    path: ['resolution'],
  });

export const ticketCommentSchema = z.object({
  body: requiredText(10_000),
  internal: z.boolean().default(false),
});

export const ticketRatingSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: nullableText(1000),
});

export const ticketListQuerySchema = z.object({
  scope: z.enum(['mine', 'queue', 'all']).default('mine'),
  status: z.string().trim().toUpperCase().max(30).optional(),
  categoryId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
});

export const articleSchema = z.object({
  categoryId: optionalId,
  title: requiredText(200),
  body: requiredText(50_000),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
});
export const updateArticleSchema = articleSchema.partial();

// ------------------------------------------------------------------------------ separation

export const separationSettingsSchema = z.object({
  /** Null: no notice period is configured; the requested last day is used. */
  noticeDays: z.coerce.number().int().min(0).max(365).nullable(),
});

const reasonCategory = z.enum([
  'CAREER',
  'COMPENSATION',
  'RELOCATION',
  'PERSONAL',
  'HEALTH',
  'STUDIES',
  'MANAGER',
  'WORK_CULTURE',
  'OTHER',
]);

export const resignationSchema = z.object({
  reasonCategory,
  note: nullableText(2000),
  requestedLastDay: isoDateSchema,
});

export const resignationDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    agreedLastDay: isoDateSchema.optional(),
    note: nullableText(1000),
  })
  .refine((v) => v.decision !== 'REJECTED' || !!v.note, {
    message: 'Give a reason',
    path: ['note'],
  });

export const separationCaseSchema = z.object({
  employeeId: z.uuid('Choose the employee'),
  separationType: z.enum(['TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'OTHER']),
  reasonCategory: reasonCategory.default('OTHER'),
  lastWorkingDay: isoDateSchema,
  note: nullableText(2000),
});

export const clearanceTemplateSchema = z.object({
  items: z
    .array(
      z
        .object({
          title: requiredText(120),
          ownerRoleKey: keep(z.string().trim().min(1).max(64)),
          ownerEmployeeId: optionalId,
        })
        .refine((i) => !!i.ownerRoleKey !== !!i.ownerEmployeeId, {
          message: 'Give the item a role or a person',
          path: ['ownerRoleKey'],
        }),
    )
    .max(40),
});

export const clearanceDecisionSchema = z
  .object({ status: z.enum(['CLEARED', 'WAIVED']), note: nullableText(500) })
  .refine((v) => v.status !== 'WAIVED' || !!v.note, {
    message: 'Say why it is waived',
    path: ['note'],
  });

export const exitQuestionsSchema = z.object({
  questions: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).max(40),
          type: z.enum(['RATING', 'CHOICE', 'TEXT']),
          text: requiredText(300),
          options: z.array(requiredText(100)).max(10).optional(),
        })
        .refine((q) => q.type !== 'CHOICE' || (q.options?.length ?? 0) >= 2, {
          message: 'A choice needs two options',
          path: ['options'],
        }),
    )
    .max(30)
    .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, 'Question ids must be unique'),
});

export const exitAnswersSchema = z.object({
  answers: z.record(
    z.string().min(1).max(40),
    z.union([z.number().int().min(1).max(5), z.string().max(5000), z.null()]),
  ),
});

export const exitAnalyticsQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((v) => v.to >= v.from, { message: '"to" must not be before "from"', path: ['to'] });

// ------------------------------------------------------------------------------ compliance

export const obligationSchema = z.object({
  title: requiredText(200),
  category: z.enum(['STATUTORY_FILING', 'LICENCE_RENEWAL', 'AUDIT', 'POLICY_REVIEW', 'OTHER']),
  description: nullableText(2000),
  ownerEmployeeId: z.uuid('Choose the owner'),
  firstDueOn: isoDateSchema,
  recurrence: z.enum(['NONE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']),
});
export const updateObligationSchema = z.object({
  title: requiredText(200).optional(),
  description: nullableText(2000),
  ownerEmployeeId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const completeComplianceTaskSchema = z.object({ note: requiredText(2000) });

export const expiryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(730).default(60),
});
