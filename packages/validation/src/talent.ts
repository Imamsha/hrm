import { toDecimal, validateScale } from '@hrm/business-rules';
import { z } from 'zod';
import { isoDateSchema, listQuerySchema, requiredText } from './common.js';
import { nullableText } from './structure.js';

/**
 * Performance, learning and engagement (Phase 09, ADR-016). Scales, weights, pass marks,
 * anonymity minimums and points are organization configuration; these schemas check shape and
 * consistency only.
 */

const dec = (v: string) => toDecimal(v);
const optionalId = z
  .union([z.uuid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));
const optionalDate = z
  .union([isoDateSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));
const decimalString = (max = 100) =>
  z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v))
    .refine(
      (v) => /^-?\d{1,12}(\.\d{1,4})?$/.test(v) && dec(v).abs().lte(max),
      `Enter a number up to ${String(max)}`,
    );
const percent = decimalString(100).refine((v) => dec(v).gte(0), 'Enter 0 to 100');
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, 'Use letters, digits, - or _');
const datetime = z.iso.datetime({ offset: true });
export const audienceSchema = z.object({ companyId: optionalId, departmentId: optionalId });

// ------------------------------------------------------------------------------ performance

export const ratingScaleSchema = z
  .object({
    name: requiredText(100),
    points: z
      .array(
        z.object({
          value: decimalString(100),
          label: requiredText(60),
          description: nullableText(300),
        }),
      )
      .min(2, 'A rating scale needs at least two points')
      .max(10),
  })
  .superRefine((v, ctx) => {
    for (const message of validateScale(v.points))
      ctx.addIssue({ code: 'custom', message, path: ['points'] });
  });

export const competencySchema = z.object({
  code: codeSchema,
  name: requiredText(100),
  description: nullableText(1000),
  category: nullableText(60),
});
export const updateCompetencySchema = competencySchema
  .omit({ code: true })
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });

export const reviewTemplateSchema = z
  .object({
    name: requiredText(100),
    ratingScaleId: z.uuid('Select a rating scale'),
    goalsWeightPercent: percent,
    competencies: z
      .array(
        z.object({
          competencyId: z.uuid(),
          weight: decimalString(1000).refine((v) => dec(v).gt(0), 'Weight must be above zero'),
        }),
      )
      .max(40),
    questions: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(40),
          text: requiredText(500),
          required: z.boolean().default(false),
        }),
      )
      .max(20),
    includeSelf: z.boolean(),
    includeManager: z.boolean(),
    peerMin: z.coerce.number().int().min(0).max(10),
    peerMax: z.coerce.number().int().min(0).max(20),
    includeUpward: z.boolean(),
    /** Peer/upward feedback is shown to the reviewee (anonymised) only at or above this count. */
    anonymityMinimum: z.coerce.number().int().min(1).max(50),
  })
  .refine((v) => v.peerMin <= v.peerMax, {
    message: 'The minimum cannot exceed the maximum',
    path: ['peerMin'],
  })
  .refine((v) => v.includeSelf || v.includeManager || v.peerMax > 0 || v.includeUpward, {
    message: 'Choose at least one reviewer',
    path: ['includeManager'],
  })
  .refine(
    (v) => new Set(v.competencies.map((c) => c.competencyId)).size === v.competencies.length,
    { message: 'A competency can appear once', path: ['competencies'] },
  )
  .refine((v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length, {
    message: 'Question ids must be unique',
    path: ['questions'],
  });

export const reviewCycleSchema = z
  .object({
    name: requiredText(120),
    templateId: z.uuid('Select a template'),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    selfDueOn: optionalDate,
    managerDueOn: optionalDate,
    audience: audienceSchema.default({ companyId: null, departmentId: null }),
  })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: 'The period cannot end before it starts',
    path: ['periodEnd'],
  });

export const cycleStatusSchema = z.object({ status: z.enum(['OPEN', 'CALIBRATION', 'CLOSED']) });

const measureSchema = z.object({
  start: decimalString(1e12),
  target: decimalString(1e12),
  current: decimalString(1e12),
  unit: nullableText(20),
});
export const goalSchema = z
  .object({
    title: requiredText(200),
    description: nullableText(2000),
    ownerType: z.enum(['EMPLOYEE', 'DEPARTMENT', 'ORGANIZATION']),
    employeeId: optionalId,
    departmentId: optionalId,
    parentId: optionalId,
    cycleId: optionalId,
    kind: z.enum(['GOAL', 'OBJECTIVE', 'KEY_RESULT', 'KPI']),
    weight: decimalString(1000)
      .refine((v) => dec(v).gte(0), 'Weight cannot be negative')
      .default('1'),
    measure: measureSchema.nullable().optional(),
    dueOn: optionalDate,
  })
  .refine((v) => v.ownerType !== 'EMPLOYEE' || !!v.employeeId, {
    message: 'Select the employee',
    path: ['employeeId'],
  })
  .refine((v) => v.ownerType !== 'DEPARTMENT' || !!v.departmentId, {
    message: 'Select the department',
    path: ['departmentId'],
  })
  .refine((v) => (v.kind === 'KPI' || v.kind === 'KEY_RESULT' ? !!v.measure : true), {
    message: 'A KPI or key result needs a start, target and current value',
    path: ['measure'],
  })
  .refine((v) => v.kind !== 'KEY_RESULT' || !!v.parentId, {
    message: 'A key result belongs to an objective',
    path: ['parentId'],
  });
export const updateGoalSchema = z.object({
  title: requiredText(200).optional(),
  description: nullableText(2000),
  weight: decimalString(1000).optional(),
  dueOn: optionalDate.optional(),
  status: z.enum(['ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED']).optional(),
});
export const goalCheckInSchema = z
  .object({
    progress: percent.optional(),
    current: decimalString(1e12).optional(),
    note: requiredText(1000),
  })
  .refine((v) => v.progress !== undefined || v.current !== undefined, {
    message: 'Give the progress or the current value',
    path: ['progress'],
  });

export const peerNominationSchema = z.object({
  reviewerEmployeeIds: z.array(z.uuid()).min(1).max(20),
});

export const reviewResponseSchema = z
  .object({
    competencies: z
      .array(
        z.object({
          competencyId: z.uuid(),
          rating: decimalString(100),
          comment: nullableText(2000),
        }),
      )
      .max(40)
      .default([]),
    goals: z
      .array(
        z.object({
          goalId: z.uuid(),
          achievementPercent: percent.optional(),
          comment: nullableText(2000),
        }),
      )
      .max(50)
      .default([]),
    answers: z
      .array(z.object({ questionId: z.string().min(1).max(40), text: z.string().trim().max(5000) }))
      .max(20)
      .default([]),
    overallComment: nullableText(5000),
    /** Manager responses only. Recorded for HR; never changes a job or salary. */
    promotion: z.enum(['NONE', 'RECOMMEND', 'STRONGLY_RECOMMEND']).optional(),
    promotionJustification: nullableText(2000),
    submit: z.boolean().default(false),
  })
  .refine((v) => !v.promotion || v.promotion === 'NONE' || !!v.promotionJustification, {
    message: 'Justify the promotion recommendation',
    path: ['promotionJustification'],
  });

export const calibrationSchema = z.object({
  finalRating: decimalString(100),
  reason: requiredText(1000),
});

export const pipSchema = z
  .object({
    employeeId: z.uuid('Select the employee'),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    reason: requiredText(2000),
    objectives: z
      .array(z.object({ text: requiredText(500), measure: nullableText(300) }))
      .min(1, 'Add at least one objective')
      .max(20),
  })
  .refine((v) => v.endDate > v.startDate, {
    message: 'The plan must end after it starts',
    path: ['endDate'],
  });
export const pipCheckInSchema = z.object({ note: requiredText(2000) });
export const pipOutcomeSchema = z
  .object({
    outcome: z.enum(['PASSED', 'FAILED', 'EXTENDED', 'CANCELLED']),
    note: requiredText(2000),
    newEndDate: optionalDate,
  })
  .refine((v) => v.outcome !== 'EXTENDED' || !!v.newEndDate, {
    message: 'Give the new end date',
    path: ['newEndDate'],
  });

export const talentListQuerySchema = listQuerySchema.extend({
  status: z.string().trim().toUpperCase().max(30).optional(),
  employeeId: z.uuid().optional(),
  cycleId: z.uuid().optional(),
  ownerType: z.enum(['EMPLOYEE', 'DEPARTMENT', 'ORGANIZATION']).optional(),
});

// ------------------------------------------------------------------------------ learning

const quizQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    text: requiredText(1000),
    options: z.array(requiredText(300)).min(2).max(10),
    correct: z.array(z.coerce.number().int().min(0)).min(1),
    points: z.coerce.number().int().min(1).max(100).default(1),
  })
  .refine((q) => q.correct.every((i) => i < q.options.length), {
    message: 'A correct answer is not one of the options',
    path: ['correct'],
  });

export const courseModuleSchema = z
  .object({
    title: requiredText(200),
    type: z.enum(['CONTENT', 'QUIZ']),
    content: nullableText(20_000),
    url: z
      .union([z.url(), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    questions: z.array(quizQuestionSchema).max(100).default([]),
  })
  .refine((m) => m.type !== 'QUIZ' || m.questions.length > 0, {
    message: 'A quiz needs at least one question',
    path: ['questions'],
  })
  .refine((m) => m.type !== 'CONTENT' || !!m.content || !!m.url, {
    message: 'Add the content or a link',
    path: ['content'],
  })
  .refine((m) => new Set(m.questions.map((q) => q.id)).size === m.questions.length, {
    message: 'Question ids must be unique',
    path: ['questions'],
  });

export const courseSchema = z.object({
  code: codeSchema,
  title: requiredText(200),
  description: nullableText(5000),
  format: z.enum(['ONLINE', 'VIDEO', 'DOCUMENT', 'CLASSROOM', 'EXTERNAL']),
  durationMinutes: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
  passPercent: z.coerce.number().int().min(0).max(100).default(0),
  certificationValidityMonths: z.coerce.number().int().min(1).max(240).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  modules: z.array(courseModuleSchema).min(1, 'Add at least one module').max(100),
});
export const updateCourseSchema = z.object({
  title: requiredText(200).optional(),
  description: nullableText(5000),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export const learningPathSchema = z.object({
  name: requiredText(120),
  description: nullableText(2000),
  courseIds: z.array(z.uuid()).min(1, 'Add at least one course').max(50),
});

export const learningAssignmentSchema = z
  .object({
    courseId: optionalId,
    pathId: optionalId,
    employeeIds: z.array(z.uuid()).max(500).default([]),
    audience: audienceSchema.optional(),
    dueOn: optionalDate,
  })
  .refine((v) => !!v.courseId !== !!v.pathId, {
    message: 'Choose a course or a learning path',
    path: ['courseId'],
  })
  .refine(
    (v) => v.employeeIds.length > 0 || !!v.audience?.companyId || !!v.audience?.departmentId,
    { message: 'Choose the employees or an audience', path: ['employeeIds'] },
  );

export const quizAttemptSchema = z.object({
  answers: z.record(z.string().min(1).max(40), z.array(z.coerce.number().int().min(0)).max(10)),
});
export const courseFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: nullableText(2000),
});

// ------------------------------------------------------------------------------ engagement

const surveyQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    type: z.enum(['RATING', 'ENPS', 'CHOICE', 'TEXT']),
    text: requiredText(500),
    options: z.array(requiredText(200)).max(20).optional(),
    required: z.boolean().default(false),
  })
  .refine((q) => q.type !== 'CHOICE' || (q.options?.length ?? 0) >= 2, {
    message: 'A choice question needs at least two options',
    path: ['options'],
  });

export const surveySchema = z
  .object({
    title: requiredText(200),
    description: nullableText(2000),
    kind: z.enum(['SURVEY', 'PULSE']),
    anonymous: z.boolean(),
    /** Results (and breakdowns) are hidden below this many responses. */
    minimumGroupSize: z.coerce.number().int().min(1).max(1000),
    audience: audienceSchema.default({ companyId: null, departmentId: null }),
    opensAt: datetime,
    closesAt: datetime,
    questions: z.array(surveyQuestionSchema).min(1, 'Add at least one question').max(50),
  })
  .refine((v) => v.closesAt > v.opensAt, {
    message: 'The survey must close after it opens',
    path: ['closesAt'],
  })
  .refine((v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length, {
    message: 'Question ids must be unique',
    path: ['questions'],
  });

export const surveyResponseSchema = z.object({
  answers: z.record(
    z.string().min(1).max(40),
    z.union([z.number(), z.string().max(5000), z.null()]),
  ),
});

export const badgeSchema = z.object({
  name: requiredText(60),
  description: nullableText(300),
  points: z.coerce.number().int().min(0).max(100_000).default(0),
});
export const recognitionSchema = z.object({
  toEmployeeId: z.uuid('Choose a colleague'),
  badgeId: z.uuid('Choose a badge'),
  message: requiredText(1000),
  public: z.boolean().default(true),
});
export const rewardSchema = z.object({
  name: requiredText(120),
  description: nullableText(1000),
  pointsCost: z.coerce.number().int().min(1).max(10_000_000),
  stock: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
});
export const redemptionDecisionSchema = z
  .object({ status: z.enum(['FULFILLED', 'REJECTED']), note: nullableText(500) })
  .refine((v) => v.status !== 'REJECTED' || !!v.note, { message: 'Give a reason', path: ['note'] });

export const announcementSchema = z
  .object({
    title: requiredText(200),
    body: requiredText(20_000),
    audience: audienceSchema.default({ companyId: null, departmentId: null }),
    pinned: z.boolean().default(false),
    requiresAcknowledgement: z.boolean().default(false),
    publishAt: datetime.nullable().optional(),
    expiresAt: datetime.nullable().optional(),
  })
  .refine((v) => !v.expiresAt || !v.publishAt || v.expiresAt > v.publishAt, {
    message: 'Expiry must be after publishing',
    path: ['expiresAt'],
  });

export const eventSchema = z
  .object({
    title: requiredText(200),
    description: nullableText(5000),
    startsAt: datetime,
    endsAt: datetime,
    location: nullableText(300),
    capacity: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
    audience: audienceSchema.default({ companyId: null, departmentId: null }),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'The event must end after it starts',
    path: ['endsAt'],
  });
export const rsvpSchema = z.object({ response: z.enum(['GOING', 'MAYBE', 'NOT_GOING']) });

export const suggestionSchema = z.object({
  title: requiredText(200),
  body: requiredText(5000),
  category: nullableText(60),
  anonymous: z.boolean().default(false),
});
export const suggestionStatusSchema = z
  .object({
    status: z.enum(['UNDER_REVIEW', 'ACCEPTED', 'IMPLEMENTED', 'DECLINED']),
    response: nullableText(2000),
  })
  .refine((v) => v.status === 'UNDER_REVIEW' || !!v.response, {
    message: 'Explain the decision',
    path: ['response'],
  });
