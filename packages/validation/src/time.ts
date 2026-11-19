import { type ShiftRule, validateLeaveSessions, validateShift } from '@hrm/business-rules';
import { z } from 'zod';
import { isoDateSchema, listQuerySchema, requiredText } from './common.js';
import { EMPLOYMENT_TYPES } from './employees.js';
import { codeSchema, nullableText } from './structure.js';

/** `HH:MM` 24-hour wall-clock time. */
export const timeOfDaySchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function timeOf(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const minutes = (max: number) => z.coerce.number().int().min(0).max(max);

/** Decimal day count as a string, up to 2 decimals (never a float in storage). */
export const dayAmountSchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d{1,4}(\.\d{1,2})?$/.test(v), 'Use a number with up to 2 decimals');

// ------------------------------------------------------------------------------ shifts

const shiftFields = z.object({
  code: codeSchema,
  name: requiredText(100),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
  breakMinutes: minutes(720).default(0),
  graceInMinutes: minutes(240).default(0),
  graceOutMinutes: minutes(240).default(0),
  fullDayMinutes: minutes(1440),
  halfDayMinutes: minutes(1440),
  overtimeAfterMinutes: minutes(1440).nullable().optional(),
  windowBeforeMinutes: minutes(720).default(240),
  windowAfterMinutes: minutes(720).default(360),
  isDefault: z.boolean().default(false),
});

export function shiftRuleOf(v: z.output<typeof shiftFields>): ShiftRule {
  return {
    startMinutes: minutesOf(v.startTime),
    endMinutes: minutesOf(v.endTime),
    breakMinutes: v.breakMinutes,
    graceInMinutes: v.graceInMinutes,
    graceOutMinutes: v.graceOutMinutes,
    fullDayMinutes: v.fullDayMinutes,
    halfDayMinutes: v.halfDayMinutes,
    overtimeAfterMinutes: v.overtimeAfterMinutes ?? null,
    windowBeforeMinutes: v.windowBeforeMinutes,
    windowAfterMinutes: v.windowAfterMinutes,
  };
}

export const createShiftSchema = shiftFields.superRefine((v, ctx) => {
  for (const message of validateShift(shiftRuleOf(v)))
    ctx.addIssue({ code: 'custom', message, path: ['fullDayMinutes'] });
});
export const updateShiftSchema = shiftFields
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });

export const shiftAssignmentSchema = z
  .object({
    employeeIds: z.array(z.uuid()).min(1).max(500),
    shiftId: z.uuid(),
    effectiveFrom: isoDateSchema,
    effectiveTo: z
      .union([isoDateSchema, z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === '' ? null : v)),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: 'The end date cannot be before the start date',
    path: ['effectiveTo'],
  });

export const shiftAssignmentQuerySchema = listQuerySchema.extend({
  employeeId: z.uuid().optional(),
  shiftId: z.uuid().optional(),
  /** Assignments in force on this date. */
  on: isoDateSchema.optional(),
});

export const rosterEntriesSchema = z.object({
  entries: z
    .array(
      z.object({
        employeeId: z.uuid(),
        date: isoDateSchema,
        /** null = day off. */
        shiftId: z.uuid().nullable(),
        note: nullableText(200),
      }),
    )
    .min(1)
    .max(1000),
});

export const rangeQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((v) => v.to >= v.from, { message: '`to` must not be before `from`', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 92 * 86_400_000, {
    message: 'Ranges are limited to 93 days',
    path: ['to'],
  });

export const rosterQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    departmentId: z.uuid().optional(),
    employeeId: z.uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: '`to` must not be before `from`', path: ['to'] });

// ------------------------------------------------------------------------------ attendance

const coordinate = (limit: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .refine(
      (v) => /^-?\d{1,3}(\.\d{1,6})?$/.test(v) && Math.abs(Number(v)) <= limit,
      'Invalid coordinate',
    )
    .optional();

export const punchSchema = z.object({
  /** Leave empty to toggle (IN after OUT and vice versa). */
  direction: z.enum(['IN', 'OUT']).optional(),
  source: z.enum(['WEB', 'MOBILE']).default('WEB'),
  qrToken: z.string().min(10).max(2000).optional(),
  latitude: coordinate(90),
  longitude: coordinate(180),
});

export const manualPunchSchema = z.object({
  punchedAt: z.iso.datetime({ offset: true }),
  direction: z.enum(['IN', 'OUT']),
  note: requiredText(500),
});

export const punchImportSchema = z.object({
  punches: z
    .array(
      z.object({
        employeeNumber: z.string().trim().toUpperCase().min(1).max(30),
        punchedAt: z.iso.datetime({ offset: true }),
        direction: z.enum(['IN', 'OUT']),
        deviceLabel: z.string().trim().max(100).optional(),
      }),
    )
    .min(1)
    .max(2000),
});

export const regularizationSchema = z
  .object({
    date: isoDateSchema,
    requestedIn: z.iso.datetime({ offset: true }),
    requestedOut: z.iso.datetime({ offset: true }),
    reason: requiredText(500),
  })
  .refine((v) => Date.parse(v.requestedOut) > Date.parse(v.requestedIn), {
    message: 'Out must be after in',
    path: ['requestedOut'],
  })
  .refine((v) => Date.parse(v.requestedOut) - Date.parse(v.requestedIn) <= 24 * 3_600_000, {
    message: 'A day cannot exceed 24 hours',
    path: ['requestedOut'],
  });

export const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: nullableText(500),
});

export const attendanceSummaryQuerySchema = z.object({
  date: isoDateSchema,
  departmentId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});

export const timeSettingsSchema = z.object({
  leaveYearStartMonth: z.coerce.number().int().min(1).max(12),
  webPunchEnabled: z.boolean(),
  mobilePunchEnabled: z.boolean(),
  qrPunchEnabled: z.boolean(),
  geolocationRequired: z.boolean(),
  qrRotationSeconds: z.coerce.number().int().min(15).max(300),
});

// ------------------------------------------------------------------------------ leave

const leaveTypeFields = z.object({
  code: codeSchema,
  name: requiredText(100),
  description: nullableText(500),
  isPaid: z.boolean().default(true),
  tracksBalance: z.boolean().default(true),
  accrualMethod: z.enum(['NONE', 'YEARLY', 'MONTHLY']).default('YEARLY'),
  annualQuota: dayAmountSchema.default('0'),
  prorateOnJoining: z.boolean().default(false),
  carryForwardMax: z
    .union([dayAmountSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  allowNegativeBalance: z.boolean().default(false),
  allowHalfDay: z.boolean().default(true),
  countWeeklyOffs: z.boolean().default(false),
  countHolidays: z.boolean().default(false),
  minNoticeDays: z.coerce.number().int().min(0).max(365).default(0),
  maxConsecutiveDays: z
    .union([dayAmountSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  allowDuringProbation: z.boolean().default(true),
  employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default([]),
});

const nonNegative = (v: { annualQuota?: string; carryForwardMax?: string | null }) =>
  (v.annualQuota === undefined || Number(v.annualQuota) >= 0) &&
  (v.carryForwardMax === undefined || v.carryForwardMax === null || Number(v.carryForwardMax) >= 0);

export const createLeaveTypeSchema = leaveTypeFields.refine(nonNegative, {
  message: 'Quotas cannot be negative',
  path: ['annualQuota'],
});
export const updateLeaveTypeSchema = leaveTypeFields
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
  .refine(nonNegative, { message: 'Quotas cannot be negative', path: ['annualQuota'] });

const session = z.enum(['FULL', 'FIRST_HALF', 'SECOND_HALF']);

export const leaveRequestSchema = z
  .object({
    leaveTypeId: z.uuid('Select a leave type'),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    startSession: session.default('FULL'),
    endSession: session.default('FULL'),
    reason: nullableText(1000),
  })
  .superRefine((v, ctx) => {
    for (const message of validateLeaveSessions(
      v.startDate,
      v.endDate,
      v.startSession,
      v.endSession,
      true,
    ))
      ctx.addIssue({
        code: 'custom',
        message,
        path: [message.includes('end date') ? 'endDate' : 'startSession'],
      });
    if (Date.parse(v.endDate) - Date.parse(v.startDate) > 365 * 86_400_000)
      ctx.addIssue({
        code: 'custom',
        message: 'A leave cannot exceed one year',
        path: ['endDate'],
      });
  });
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;

/** HR applying on behalf of an employee. */
export const leaveRequestForSchema = z.object({ employeeId: z.uuid() });

export const leaveRequestQuerySchema = listQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  employeeId: z.uuid().optional(),
  leaveTypeId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const balanceQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2200).optional(),
});

export const balanceAdjustmentSchema = z
  .object({
    leaveTypeId: z.uuid(),
    year: z.coerce.number().int().min(2000).max(2200),
    days: dayAmountSchema,
    kind: z.enum(['OPENING', 'ADJUSTMENT']).default('ADJUSTMENT'),
    note: requiredText(500),
  })
  .refine((v) => Number(v.days) !== 0, {
    message: 'Enter a non-zero number of days',
    path: ['days'],
  });
