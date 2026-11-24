import { toDecimal, validateBoardColumns, validateTimesheet } from '@hrm/business-rules';
import { z } from 'zod';
import { currencySchema } from './access.js';
import { emailSchema } from './auth.js';
import { isoDateSchema, requiredText } from './common.js';
import { moneySchema } from './recruitment.js';
import { codeSchema, nullableText } from './structure.js';

/**
 * Clients & projects (Phase 10, ADR-017). Rates, budgets and tax rates are organization
 * configuration; these schemas check shape and consistency only.
 *
 * Update schemas: `undefined` means "unchanged" and `null`/"" means "clear" — omitted fields are
 * never turned into null.
 */

const dec = (v: string) => toDecimal(v);
/** Optional on create, "unchanged" when omitted on update; "" and null clear. */
const keep = <T extends z.ZodType>(s: T) =>
  z
    .union([s, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v) as z.output<T> | null | undefined);
const optionalId = keep(z.uuid());
const optionalDate = keep(isoDateSchema);
const optionalMoney = keep(moneySchema);
const hoursSchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine(
    (v) =>
      /^\d{1,2}(\.\d{1,2})?$/.test(v) &&
      dec(v).gte(0.25) &&
      dec(v).lte(24) &&
      dec(v).times(4).isInteger(),
    'Enter 0.25–24 hours in quarter hours',
  );
const budgetHours = keep(
  z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d{1,7}(\.\d{1,2})?$/.test(v), 'Enter hours with up to 2 decimals'),
);
const percentSchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && dec(v).lte(100), 'Enter 0 to 100');
const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2–10 letters or digits, starting with a letter');

// ------------------------------------------------------------------------------ clients

export const clientContactSchema = z.object({
  name: requiredText(120),
  email: keep(emailSchema),
  phone: nullableText(30),
  role: nullableText(80),
});

export const clientSchema = z.object({
  code: codeSchema,
  name: requiredText(200),
  currency: currencySchema,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  billingAddress: nullableText(1000),
  taxNumber: nullableText(40),
  email: keep(emailSchema),
  notes: nullableText(2000),
});
export const updateClientSchema = z.object({
  name: requiredText(200).optional(),
  currency: currencySchema.optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  billingAddress: nullableText(1000),
  taxNumber: nullableText(40),
  email: keep(emailSchema),
  notes: nullableText(2000),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

/** Links an existing member (invited with the `client` role) to a client. */
export const portalUserSchema = z.object({ membershipId: z.uuid('Choose the member') });

// ------------------------------------------------------------------------------ projects

const billingType = z.enum(['TIME_AND_MATERIALS', 'FIXED_FEE', 'NON_BILLABLE']);
const projectStatus = z.enum(['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']);

export const projectSchema = z
  .object({
    key: projectKeySchema,
    name: requiredText(200),
    description: nullableText(5000),
    clientId: optionalId,
    billingType,
    hourlyRate: optionalMoney,
    budgetAmount: optionalMoney,
    budgetHours,
    startDate: optionalDate,
    endDate: optionalDate,
    portalEnabled: z.boolean().default(false),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'The project cannot end before it starts',
    path: ['endDate'],
  })
  .refine((v) => v.billingType === 'NON_BILLABLE' || !!v.clientId, {
    message: 'A billable project needs a client',
    path: ['clientId'],
  })
  .refine((v) => !v.portalEnabled || !!v.clientId, {
    message: 'Only client projects can be shown in the portal',
    path: ['portalEnabled'],
  });

export const updateProjectSchema = z
  .object({
    name: requiredText(200).optional(),
    description: nullableText(5000),
    hourlyRate: optionalMoney,
    budgetAmount: optionalMoney,
    budgetHours,
    startDate: optionalDate,
    endDate: optionalDate,
    portalEnabled: z.boolean().optional(),
    status: projectStatus.optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'The project cannot end before it starts',
    path: ['endDate'],
  });

export const projectMemberSchema = z.object({
  employeeId: z.uuid('Choose the employee'),
  role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']),
  billingRate: optionalMoney,
  allocationPercent: keep(percentSchema),
});
export const updateProjectMemberSchema = z.object({
  role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']).optional(),
  billingRate: optionalMoney,
  allocationPercent: keep(percentSchema),
});

export const boardColumnsSchema = z
  .object({
    columns: z
      .array(
        z.object({
          id: z.uuid().optional(),
          name: requiredText(40),
          category: z.enum(['TODO', 'IN_PROGRESS', 'DONE']),
          wipLimit: z.coerce.number().int().min(1).max(999).nullable().optional(),
        }),
      )
      .min(3)
      .max(15),
  })
  .superRefine((v, ctx) => {
    for (const message of validateBoardColumns(v.columns))
      ctx.addIssue({ code: 'custom', message, path: ['columns'] });
  });

export const projectListQuerySchema = z.object({
  status: z.string().trim().toUpperCase().max(20).optional(),
  clientId: z.uuid().optional(),
  mine: z.stringbool().optional(),
  search: z.string().trim().max(100).optional(),
});

// ------------------------------------------------------------------------------ work items

const workItemType = z.enum(['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG', 'SUBTASK']);
const priority = z.enum(['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST']);
const severity = z.enum(['MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER']);
const storyPoints = keep(
  z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d{1,3}(\.\d)?$/.test(v), 'Enter points up to 999.9'),
);
const labels = z.array(z.string().trim().min(1).max(30)).max(10);

export const workItemSchema = z
  .object({
    type: workItemType,
    title: requiredText(300),
    description: nullableText(20_000),
    parentId: optionalId,
    columnId: optionalId,
    priority: priority.default('MEDIUM'),
    assigneeId: optionalId,
    sprintId: optionalId,
    storyPoints,
    estimateHours: budgetHours,
    dueDate: optionalDate,
    labels: labels.default([]),
    severity: keep(severity),
    stepsToReproduce: nullableText(5000),
    environment: nullableText(300),
    clientVisible: z.boolean().default(false),
  })
  .refine((v) => v.type === 'BUG' || (!v.severity && !v.stepsToReproduce && !v.environment), {
    message: 'Severity, steps and environment are for bugs',
    path: ['severity'],
  })
  .refine((v) => v.type !== 'BUG' || !!v.severity, {
    message: 'Choose the severity',
    path: ['severity'],
  });

export const updateWorkItemSchema = z.object({
  title: requiredText(300).optional(),
  description: nullableText(20_000),
  parentId: optionalId,
  columnId: z.uuid().optional(),
  priority: priority.optional(),
  assigneeId: optionalId,
  sprintId: optionalId,
  storyPoints,
  estimateHours: budgetHours,
  dueDate: optionalDate,
  labels: labels.optional(),
  severity: keep(severity),
  stepsToReproduce: nullableText(5000),
  environment: nullableText(300),
  clientVisible: z.boolean().optional(),
  /** Position within the column (board ordering). */
  rank: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

export const commentSchema = z.object({
  body: requiredText(10_000),
  clientVisible: z.boolean().default(false),
});

export const workItemListQuerySchema = z.object({
  type: z.string().trim().toUpperCase().max(20).optional(),
  sprintId: z.string().trim().max(40).optional(),
  assigneeId: z.uuid().optional(),
  columnId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
});

// ------------------------------------------------------------------------------ sprints

export const sprintSchema = z
  .object({
    name: requiredText(80),
    goal: nullableText(1000),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The sprint cannot end before it starts',
    path: ['endDate'],
  });

export const completeSprintSchema = z.object({
  /** Where unfinished items go: a planned sprint of the same project, or the backlog (null). */
  moveToSprintId: optionalId,
});

// ------------------------------------------------------------------------------ timesheets

export const timeEntrySchema = z.object({
  date: isoDateSchema,
  projectId: z.uuid('Choose the project'),
  workItemId: optionalId,
  hours: hoursSchema,
  billable: z.boolean().default(true),
  note: nullableText(500),
});

/** Replaces a draft week's entries. */
export const timesheetSchema = z
  .object({
    weekStart: isoDateSchema.refine(
      (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1,
      'A week starts on Monday',
    ),
    entries: z.array(timeEntrySchema).max(200),
  })
  .superRefine((v, ctx) => {
    // Per-entry hours are already reported by the entry field; keep the week-level checks.
    for (const message of validateTimesheet(v.weekStart, v.entries))
      if (!message.includes('quarter hours'))
        ctx.addIssue({ code: 'custom', message, path: ['entries'] });
  });

export const timesheetDecisionSchema = z
  .object({ decision: z.enum(['APPROVED', 'REJECTED']), note: nullableText(500) })
  .refine((v) => v.decision !== 'REJECTED' || !!v.note, {
    message: 'Give a reason',
    path: ['note'],
  });

export const timesheetListQuerySchema = z.object({
  scope: z.enum(['approvals', 'all']).default('approvals'),
  status: z.string().trim().toUpperCase().max(20).optional(),
  weekStart: isoDateSchema.optional(),
  employeeId: z.uuid().optional(),
});

export const timeReportQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    projectId: z.uuid().optional(),
    clientId: z.uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: '"to" must not be before "from"', path: ['to'] });

// ------------------------------------------------------------------------------ billing

export const taxRateSchema = z
  .object({
    name: requiredText(60),
    ratePercent: percentSchema,
    effectiveFrom: isoDateSchema,
    effectiveTo: optionalDate,
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: 'The end date cannot be before the start',
    path: ['effectiveTo'],
  });

export const billingSettingsSchema = z.object({
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{0,9}$/, 'Use up to 10 letters or digits'),
});

const invoiceLineSchema = z.object({
  description: requiredText(500),
  projectId: optionalId,
  quantity: z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d{1,9}(\.\d{1,2})?$/.test(v) && dec(v).gt(0), 'Enter a quantity above zero'),
  unitPrice: moneySchema,
  taxRateId: optionalId,
});

export const invoiceSchema = z
  .object({
    clientId: z.uuid('Choose the client'),
    /** Pull approved, billable, uninvoiced time of the client's T&M projects in this period. */
    timeFrom: optionalDate,
    timeTo: optionalDate,
    timeTaxRateId: optionalId,
    lines: z.array(invoiceLineSchema).max(200).default([]),
    notes: nullableText(2000),
  })
  .refine((v) => !v.timeFrom === !v.timeTo, {
    message: 'Give both dates of the time period',
    path: ['timeTo'],
  })
  .refine((v) => !v.timeFrom || !v.timeTo || v.timeTo >= v.timeFrom, {
    message: '"to" must not be before "from"',
    path: ['timeTo'],
  })
  .refine((v) => !!v.timeFrom || v.lines.length > 0, {
    message: 'Add time or at least one line',
    path: ['lines'],
  });

export const issueInvoiceSchema = z.object({ issuedOn: isoDateSchema });

export const paymentSchema = z.object({
  amount: moneySchema.refine((v) => dec(v).gt(0), 'Must be above zero'),
  receivedOn: isoDateSchema,
  reference: nullableText(100),
});

export const voidInvoiceSchema = z.object({ reason: requiredText(500) });

// ------------------------------------------------------------------------------ portal

export const portalRequestSchema = z.object({
  projectId: z.uuid('Choose the project'),
  type: z.enum(['BUG', 'STORY']),
  title: requiredText(300),
  description: requiredText(20_000),
  severity: keep(severity),
  stepsToReproduce: nullableText(5000),
});

export const portalCommentSchema = z.object({ body: requiredText(10_000) });
