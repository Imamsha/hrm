import { toDecimal } from '@hrm/business-rules';
import { z } from 'zod';
import { isoDateSchema, listQuerySchema, requiredText } from './common.js';
import { moneySchema } from './recruitment.js';
import { nullableText } from './structure.js';

/**
 * Expenses, travel and assets (Phase 08, ADR-015). Limits are organization policy: these schemas
 * check shape and consistency only.
 */

const dec = (v: string) => toDecimal(v);
const nullableMoney = z
  .union([moneySchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));
const nullableDate = z
  .union([isoDateSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));
const positiveMoney = moneySchema.refine((v) => dec(v).gt(0), 'Must be above zero');
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,29}$/, 'Use letters, digits, - or _');
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');
/** Exchange rate to the organization's currency: positive, up to 6 decimals. */
export const exchangeRateSchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine(
    (v) => /^\d{1,6}(\.\d{1,6})?$/.test(v) && dec(v).gt(0),
    'Enter a positive rate with up to 6 decimals',
  );

// ------------------------------------------------------------------------------ expenses

export const expenseSettingsSchema = z.object({
  /** Items older than this many days cannot be claimed; null = no window. */
  claimWindowDays: z.coerce.number().int().min(1).max(3650).nullable(),
  defaultPayoutMethod: z.enum(['PAYROLL', 'EXTERNAL']),
});

export const expenseCategorySchema = z.object({
  code: codeSchema,
  name: requiredText(100),
  description: nullableText(500),
  maxPerItem: nullableMoney,
  maxPerMonth: nullableMoney,
  receiptRequiredAbove: nullableMoney,
  dailyLimit: nullableMoney,
  /** Payroll treatment of reimbursements in this category (the organization's decision). */
  taxable: z.boolean().default(false),
});
export const updateExpenseCategorySchema = expenseCategorySchema
  .omit({ code: true })
  .partial()
  .extend({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  });

export const expenseItemSchema = z.object({
  categoryId: z.uuid('Select a category'),
  date: isoDateSchema,
  days: z.coerce.number().int().min(1).max(90).default(1),
  description: requiredText(300),
  merchant: nullableText(200),
  currency: currencySchema.default('INR'),
  originalAmount: positiveMoney,
  exchangeRate: exchangeRateSchema.default('1'),
  justification: nullableText(1000),
});

export const expenseClaimSchema = z.object({
  title: requiredText(200),
  tripId: z
    .union([z.uuid(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  items: z.array(expenseItemSchema).min(1, 'Add at least one item').max(100),
});

export const managerDecisionSchema = z
  .object({ decision: z.enum(['APPROVED', 'REJECTED']), note: nullableText(1000) })
  .refine((v) => v.decision !== 'REJECTED' || !!v.note, {
    message: 'Give a reason for rejecting',
    path: ['note'],
  });

export const financeDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: nullableText(1000),
    payoutMethod: z.enum(['PAYROLL', 'EXTERNAL']).optional(),
    /** Approved amount per item (≤ claimed); omitted items are approved in full. */
    items: z
      .array(z.object({ itemId: z.uuid(), approvedAmount: moneySchema, note: nullableText(500) }))
      .max(100)
      .default([]),
  })
  .refine((v) => v.decision !== 'REJECTED' || !!v.note, {
    message: 'Give a reason for rejecting',
    path: ['note'],
  })
  .refine((v) => v.items.every((i) => dec(i.approvedAmount).gt(0) || !!i.note), {
    message: 'Explain why an item is not reimbursed',
    path: ['items'],
  });

export const markPaidSchema = z.object({
  paidOn: isoDateSchema,
  reference: requiredText(100),
});

export const expenseListQuerySchema = listQuerySchema.extend({
  status: z.string().trim().toUpperCase().max(30).optional(),
  employeeId: z.uuid().optional(),
  tripId: z.uuid().optional(),
});

// ------------------------------------------------------------------------------ travel

const legSchema = z.object({
  from: requiredText(100),
  to: requiredText(100),
  departOn: isoDateSchema,
  mode: z.enum(['FLIGHT', 'TRAIN', 'BUS', 'CAR', 'OTHER']),
});

export const travelRequestSchema = z
  .object({
    purpose: requiredText(300),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    legs: z.array(legSchema).min(1, 'Add at least one leg').max(20),
    estimatedCost: nullableMoney,
    advanceRequested: nullableMoney,
    notes: nullableText(2000),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The trip cannot end before it starts',
    path: ['endDate'],
  })
  .refine((v) => v.legs.every((l) => l.departOn >= v.startDate && l.departOn <= v.endDate), {
    message: 'Every leg must fall within the trip dates',
    path: ['legs'],
  });

export const travelDecisionSchema = managerDecisionSchema;

export const travelBookingSchema = z.object({
  type: z.enum(['FLIGHT', 'TRAIN', 'BUS', 'CAB', 'HOTEL', 'OTHER']),
  vendor: requiredText(200),
  reference: nullableText(100),
  bookedOn: isoDateSchema,
  amount: positiveMoney,
  /** Paid by the company (not reimbursed to the traveller). */
  paidByCompany: z.boolean().default(true),
  notes: nullableText(1000),
});

export const travelAdvanceSchema = z.object({
  amount: positiveMoney,
  paidOn: isoDateSchema,
  reference: requiredText(100),
});

export const travelSettleSchema = z.object({
  /** How a balance owed by the traveller is recovered. */
  recovery: z.enum(['PAYROLL', 'REPAID']).optional(),
  reference: nullableText(100),
});

// ------------------------------------------------------------------------------ assets

export const assetCategorySchema = z.object({
  code: codeSchema,
  name: requiredText(100),
  /** For informational straight-line book value; null = not depreciated. */
  usefulLifeMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
  salvagePercent: z
    .union([z.string().trim(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined || v === '' ? null : String(v)))
    .refine(
      (v) => v === null || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && dec(v).lte(100)),
      'Enter 0–100',
    ),
});

export const assetSchema = z
  .object({
    tag: codeSchema,
    name: requiredText(200),
    categoryId: z.uuid('Select a category'),
    serialNumber: nullableText(100),
    manufacturer: nullableText(100),
    model: nullableText(100),
    vendor: nullableText(200),
    purchaseDate: nullableDate,
    purchaseCost: nullableMoney,
    warrantyEnd: nullableDate,
    locationId: z
      .union([z.uuid(), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    notes: nullableText(2000),
  })
  .refine((v) => !v.warrantyEnd || !v.purchaseDate || v.warrantyEnd >= v.purchaseDate, {
    message: 'Warranty cannot end before the purchase',
    path: ['warrantyEnd'],
  });
export const updateAssetSchema = z.object({
  name: requiredText(200).optional(),
  serialNumber: nullableText(100),
  manufacturer: nullableText(100),
  model: nullableText(100),
  vendor: nullableText(200),
  // Outer .optional(): an omitted field stays untouched (the inner transform would null it).
  purchaseDate: nullableDate.optional(),
  purchaseCost: nullableMoney.optional(),
  warrantyEnd: nullableDate.optional(),
  locationId: z
    .union([z.uuid(), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  notes: nullableText(2000),
});
export const assetStatusSchema = z.object({
  status: z.enum(['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'LOST']),
  note: requiredText(500),
});

export const assetAllocationSchema = z.object({
  employeeId: z.uuid('Select an employee'),
  allocatedOn: isoDateSchema,
  expectedReturnOn: nullableDate,
  conditionNote: nullableText(500),
});

export const assetReturnSchema = z.object({
  returnedOn: isoDateSchema,
  condition: z.enum(['GOOD', 'DAMAGED', 'LOST']),
  note: nullableText(500),
  /** Where the asset goes next. */
  toStatus: z.enum(['IN_STOCK', 'IN_REPAIR', 'RETIRED', 'LOST']),
});

export const maintenanceSchema = z
  .object({
    startedOn: isoDateSchema,
    completedOn: nullableDate,
    vendor: nullableText(200),
    cost: nullableMoney,
    description: requiredText(1000),
  })
  .refine((v) => !v.completedOn || v.completedOn >= v.startedOn, {
    message: 'Cannot complete before it starts',
    path: ['completedOn'],
  });

export const softwareLicenseSchema = z.object({
  name: requiredText(200),
  vendor: nullableText(200),
  seats: z.coerce.number().int().min(1).max(100_000),
  expiresOn: nullableDate,
  cost: nullableMoney,
  notes: nullableText(2000),
});
export const updateSoftwareLicenseSchema = softwareLicenseSchema.partial().extend({
  expiresOn: nullableDate.optional(),
  cost: nullableMoney.optional(),
});
export const licenseAssignmentSchema = z.object({ employeeId: z.uuid('Select an employee') });

export const assetListQuerySchema = listQuerySchema.extend({
  status: z.string().trim().toUpperCase().max(20).optional(),
  categoryId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
});
