import { validateWorkWeek, type WorkWeekRule } from '@hrm/business-rules';
import { z } from 'zod';
import { timezoneSchema, currencySchema } from './access.js';
import { isoDateSchema, listQuerySchema, requiredText } from './common.js';

/** Short business code: upper-cased, letters/digits/underscore/hyphen, max 20. */
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Use 1–20 letters, digits, "-" or "_"');

/** Optional text that may be cleared: "" and null become null; undefined means "unchanged". */
export const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

/** Optional reference that may be cleared ("" → null). */
export const nullableId = z
  .union([z.uuid(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a 2-letter ISO country code');

const upperOptional = (re: RegExp, message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || v === undefined || re.test(v), message);

/** India: PAN (AAAAA9999A). */
export const panSchema = upperOptional(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN format is AAAAA9999A');
/** India: TAN (AAAA99999A). */
export const tanSchema = upperOptional(/^[A-Z]{4}[0-9]{5}[A-Z]$/, 'TAN format is AAAA99999A');
/** India: GSTIN (state code + PAN + entity + Z + check character). */
export const gstinSchema = upperOptional(
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  'GSTIN must be 15 characters: state code, PAN, entity number, Z, check character',
);
/** India: CIN (21 characters). */
export const cinSchema = upperOptional(
  /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/,
  'CIN must be 21 characters, e.g. U72200KA2020PTC123456',
);

const status = z.enum(['ACTIVE', 'INACTIVE']);

export const structureListQuerySchema = listQuerySchema.extend({
  status: status.optional(),
  companyId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  /** `root` = top-level departments only. */
  parentId: z.union([z.uuid(), z.literal('root')]).optional(),
  jobGradeId: z.uuid().optional(),
});
export type StructureListQuery = z.output<typeof structureListQuerySchema>;

// ---------------------------------------------------------------- companies

export const createCompanySchema = z.object({
  code: codeSchema,
  name: requiredText(200),
  countryCode: countryCodeSchema.default('IN'),
  defaultCurrency: currencySchema.nullable().optional(),
  timezone: timezoneSchema.nullable().optional(),
});
export const updateCompanySchema = createCompanySchema
  .partial()
  .extend({ status: status.optional() });

// ---------------------------------------------------------------- legal entities

const legalEntityFields = z.object({
  code: codeSchema,
  legalName: requiredText(300),
  countryCode: countryCodeSchema.default('IN'),
  pan: panSchema,
  tan: tanSchema,
  gstin: gstinSchema,
  cin: cinSchema,
  registrationNumber: nullableText(50),
  registeredLocationId: nullableId,
});

const gstinMatchesPan = (v: { pan?: string | null; gstin?: string | null }) =>
  !v.pan || !v.gstin || v.gstin.slice(2, 12) === v.pan;

export const createLegalEntitySchema = legalEntityFields
  .extend({ companyId: z.uuid() })
  .refine(gstinMatchesPan, {
    message: 'GSTIN must contain the PAN (characters 3–12)',
    path: ['gstin'],
  });
export const updateLegalEntitySchema = legalEntityFields
  .partial()
  .extend({ status: status.optional() })
  .refine(gstinMatchesPan, {
    message: 'GSTIN must contain the PAN (characters 3–12)',
    path: ['gstin'],
  });

// ---------------------------------------------------------------- locations

const decimalCoordinate = (min: number, max: number) =>
  z
    .union([z.string().trim(), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v))
    .refine(
      (v) =>
        v === null ||
        v === undefined ||
        (/^-?\d{1,3}(\.\d{1,6})?$/.test(v) && Number(v) >= min && Number(v) <= max),
      `Must be a number between ${String(min)} and ${String(max)} with up to 6 decimals`,
    );

const locationFields = z.object({
  code: codeSchema,
  name: requiredText(200),
  addressLine1: requiredText(200),
  addressLine2: nullableText(200),
  city: requiredText(100),
  state: nullableText(100),
  postalCode: nullableText(20),
  countryCode: countryCodeSchema.default('IN'),
  timezone: timezoneSchema.nullable().optional(),
  latitude: decimalCoordinate(-90, 90),
  longitude: decimalCoordinate(-180, 180),
});
const isBlank = (x: string | null | undefined) => x === null || x === undefined;
/** On create both are absent or both present; on update only fields being changed are checked. */
const bothOrNeitherCoordinate = (v: { latitude?: string | null; longitude?: string | null }) =>
  (v.latitude === undefined && v.longitude === undefined) ||
  isBlank(v.latitude) === isBlank(v.longitude);
export const createLocationSchema = locationFields.refine(bothOrNeitherCoordinate, {
  message: 'Provide both latitude and longitude, or neither',
  path: ['longitude'],
});
export const updateLocationSchema = locationFields
  .partial()
  .extend({ status: status.optional() })
  .refine(bothOrNeitherCoordinate, {
    message: 'Provide both latitude and longitude, or neither',
    path: ['longitude'],
  });

// ---------------------------------------------------------------- branches

const branchFields = z.object({
  code: codeSchema,
  name: requiredText(200),
  legalEntityId: nullableId,
  locationId: nullableId,
  timezone: timezoneSchema.nullable().optional(),
  workWeekId: nullableId,
  holidayCalendarId: nullableId,
});
export const createBranchSchema = branchFields.extend({ companyId: z.uuid() });
export const updateBranchSchema = branchFields.partial().extend({ status: status.optional() });

// ---------------------------------------------------------------- cost centers

export const createCostCenterSchema = z.object({
  code: codeSchema,
  name: requiredText(200),
  companyId: nullableId,
});
export const updateCostCenterSchema = createCostCenterSchema
  .partial()
  .extend({ status: status.optional() });

// ---------------------------------------------------------------- departments & teams

const departmentFields = z.object({
  code: codeSchema,
  name: requiredText(200),
  parentId: nullableId,
  costCenterId: nullableId,
});
export const createDepartmentSchema = departmentFields.extend({ companyId: z.uuid() });
export const updateDepartmentSchema = departmentFields
  .partial()
  .extend({ status: status.optional() });

export const createTeamSchema = z.object({
  code: codeSchema,
  name: requiredText(200),
  departmentId: z.uuid(),
});
export const updateTeamSchema = createTeamSchema.partial().extend({ status: status.optional() });

// ---------------------------------------------------------------- job catalog

export const createJobGradeSchema = z.object({
  code: codeSchema,
  name: requiredText(100),
  rank: z.coerce.number().int().min(1).max(1000),
  description: nullableText(500),
});
export const updateJobGradeSchema = createJobGradeSchema
  .partial()
  .extend({ status: status.optional() });

export const createDesignationSchema = z.object({
  code: codeSchema,
  name: requiredText(200),
  description: nullableText(1000),
  jobGradeId: nullableId,
});
export const updateDesignationSchema = createDesignationSchema
  .partial()
  .extend({ status: status.optional() });

// ---------------------------------------------------------------- calendars

export const workWeekRuleSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  occurrence: z.number().int().min(0).max(5).default(0),
  dayType: z.enum(['FULL', 'HALF', 'OFF']),
});

const workWeekRulesSchema = z
  .array(workWeekRuleSchema)
  .min(1)
  .max(42)
  .superRefine((rules, ctx) => {
    for (const message of validateWorkWeek(rules as WorkWeekRule[]))
      ctx.addIssue({ code: 'custom', message });
  });

export const createWorkWeekSchema = z.object({
  name: requiredText(100),
  description: nullableText(500),
  isDefault: z.boolean().default(false),
  rules: workWeekRulesSchema,
});
export const updateWorkWeekSchema = z.object({
  name: requiredText(100).optional(),
  description: nullableText(500),
  isDefault: z.boolean().optional(),
  rules: workWeekRulesSchema.optional(),
});

export const createHolidayCalendarSchema = z.object({
  name: requiredText(100),
  description: nullableText(500),
  isDefault: z.boolean().default(false),
});
export const updateHolidayCalendarSchema = createHolidayCalendarSchema.partial();

export const holidaySchema = z.object({
  date: isoDateSchema,
  name: requiredText(200),
  kind: z.enum(['PUBLIC', 'OPTIONAL']).default('PUBLIC'),
});
export const bulkHolidaysSchema = z.object({
  holidays: z
    .array(holidaySchema)
    .min(1)
    .max(200)
    .superRefine((list, ctx) => {
      const seen = new Set<string>();
      list.forEach((h, i) => {
        if (seen.has(h.date))
          ctx.addIssue({ code: 'custom', message: 'Duplicate date', path: [i, 'date'] });
        seen.add(h.date);
      });
    }),
});
export const updateHolidaySchema = holidaySchema.partial();

export const holidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200).optional(),
});

export const calendarResolveQuerySchema = z
  .object({
    branchId: z.uuid().optional(),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((v) => v.from <= v.to, { message: '`to` must not be before `from`', path: ['to'] });

// ---------------------------------------------------------------- scoped role assignments

export const scopedRoleAssignmentSchema = z
  .object({
    roleId: z.uuid(),
    scopeType: z.enum(['ORGANIZATION', 'COMPANY', 'BRANCH', 'DEPARTMENT', 'TEAM']),
    scopeId: z.uuid().optional(),
  })
  .refine((v) => (v.scopeType === 'ORGANIZATION') === (v.scopeId === undefined), {
    message: 'Select the company, branch, department or team this role applies to',
    path: ['scopeId'],
  });
export type ScopedRoleAssignmentInput = z.input<typeof scopedRoleAssignmentSchema>;
