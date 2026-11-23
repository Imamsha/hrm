import { STATUTORY_CODES, toDecimal } from '@hrm/business-rules';
import { z } from 'zod';
import { isoDateSchema, listQuerySchema, requiredText } from './common.js';
import { moneySchema } from './recruitment.js';
import { nullableText } from './structure.js';

/**
 * Payroll validation. Statutory values are the organization's configuration (ADR-014): these
 * schemas check shape and internal consistency only — never whether a rate is "correct".
 */

const dec = (v: string) => toDecimal(v);

/** Percentage 0–100 with up to 4 decimals, as a string. */
export const percentSchema = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine(
    (v) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && dec(v).lte(100),
    'Enter a percentage from 0 to 100',
  );

const nullableMoney = z
  .union([moneySchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

const month = z.coerce.number().int().min(1).max(12);
export const roundingRuleSchema = z.object({
  scale: z.union([z.literal(0), z.literal(2)]),
  mode: z.enum(['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'CEIL', 'FLOOR']),
});
const stateCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^IN-[A-Z]{2}$/, 'Use an ISO 3166-2:IN code such as IN-KA');

// ----------------------------------------------------------------------- statutory configs

export const epfConfigSchema = z
  .object({
    employeeRatePercent: percentSchema,
    employerRatePercent: percentSchema,
    epsRatePercent: percentSchema,
    epsWageCeiling: nullableMoney,
    wageCeiling: nullableMoney,
    edliRatePercent: percentSchema.nullable().optional(),
    adminChargesPercent: percentSchema.nullable().optional(),
    /** Age from which a member no longer contributes to the pension scheme; null = not applied. */
    epsMaxAgeYears: z.coerce.number().int().min(1).max(100).nullable().optional(),
    rounding: roundingRuleSchema,
  })
  .refine((c) => dec(c.epsRatePercent).lte(dec(c.employerRatePercent)), {
    message: 'The pension share cannot exceed the employer rate',
    path: ['epsRatePercent'],
  });

export const esiConfigSchema = z
  .object({
    employeeRatePercent: percentSchema,
    employerRatePercent: percentSchema,
    wageThreshold: moneySchema,
    contributionPeriods: z
      .array(z.tuple([month, month]))
      .min(1)
      .max(12),
    rounding: roundingRuleSchema,
  })
  .refine(
    (c) => {
      // Every month must belong to exactly one period.
      const seen = new Map<number, number>();
      for (const [s, e] of c.contributionPeriods) {
        for (let m = s, i = 0; i < 12; i++, m = (m % 12) + 1) {
          seen.set(m, (seen.get(m) ?? 0) + 1);
          if (m === e) break;
        }
      }
      return seen.size === 12 && [...seen.values()].every((n) => n === 1);
    },
    {
      message: 'Contribution periods must cover each month exactly once',
      path: ['contributionPeriods'],
    },
  );

const ptSlabSchema = z.object({
  minWage: moneySchema,
  maxWage: nullableMoney,
  amount: moneySchema,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
  monthAmounts: z.record(z.string().regex(/^(1[0-2]|[1-9])$/), moneySchema).optional(),
});
export const ptConfigSchema = z
  .object({
    stateCode: stateCodeSchema,
    slabs: z.array(ptSlabSchema).min(1).max(50),
    deductionMonths: z.array(month).max(12).optional(),
  })
  .refine((c) => c.slabs.every((s) => s.maxWage === null || dec(s.maxWage).gte(dec(s.minWage))), {
    message: 'A slab maximum cannot be below its minimum',
    path: ['slabs'],
  })
  .refine(
    (c) => {
      // Slabs for the same gender (or for everyone) must not overlap.
      const groups = new Map<string, { min: string; max: string | null }[]>();
      for (const s of c.slabs) {
        const k = s.gender ?? '*';
        groups.set(k, [...(groups.get(k) ?? []), { min: s.minWage, max: s.maxWage }]);
      }
      for (const list of groups.values()) {
        const sorted = [...list].sort((a, b) => dec(a.min).comparedTo(dec(b.min)));
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const cur = sorted[i];
          if (prev && cur && (prev.max === null || dec(cur.min).lte(dec(prev.max)))) return false;
        }
      }
      return true;
    },
    { message: 'Slabs for the same group overlap', path: ['slabs'] },
  );

const taxSlabsSchema = z
  .array(z.object({ upTo: nullableMoney, ratePercent: percentSchema }))
  .min(1)
  .max(20)
  .refine(
    (slabs) =>
      slabs.every((s, i) => (i === slabs.length - 1 ? s.upTo === null : s.upTo !== null)) &&
      slabs.every((s, i) => {
        const prev = slabs[i - 1];
        return i === 0 || !prev?.upTo || !s.upTo || dec(s.upTo).gt(dec(prev.upTo));
      }),
    'Bands must be in ascending order and only the last band may be open-ended',
  );

const sectionSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z()]{1,20}$/, 'Use a section code such as 80C');

export const incomeTaxConfigSchema = z.object({
  financialYear: z.string().regex(/^\d{4}-\d{2}$/, 'Use the form 2026-27'),
  regime: z.enum(['OLD', 'NEW']),
  slabs: taxSlabsSchema,
  seniorSlabs: z
    .array(z.object({ minAge: z.coerce.number().int().min(1).max(120), slabs: taxSlabsSchema }))
    .max(5)
    .optional(),
  standardDeduction: moneySchema,
  rebate: z
    .object({ maxTaxableIncome: moneySchema, maxRebate: moneySchema, marginalRelief: z.boolean() })
    .nullable(),
  surcharge: z.array(z.object({ above: moneySchema, ratePercent: percentSchema })).max(10),
  surchargeMarginalRelief: z.boolean(),
  cessPercent: percentSchema,
  deductionLimits: z.record(sectionSchema, moneySchema.nullable()),
  employeePfSection: sectionSchema.nullable(),
  professionalTaxDeductible: z.boolean(),
  hra: z
    .object({
      metroPercentOfBasic: percentSchema,
      nonMetroPercentOfBasic: percentSchema,
      rentExcessPercentOfBasic: percentSchema,
    })
    .nullable(),
  incomeRoundingMultiple: moneySchema,
  taxRoundingMultiple: moneySchema,
});

export const gratuityConfigSchema = z.object({
  daysPerYear: moneySchema,
  monthDivisor: moneySchema.refine((v) => dec(v).gt(0), 'Must be above zero'),
  minYears: moneySchema,
  roundUpMonths: z.coerce.number().int().min(1).max(11).nullable(),
  cap: nullableMoney,
  /** Salary component codes whose last monthly amount is the gratuity wage (e.g. basic, DA). */
  wageComponentCodes: z.array(z.string().trim().toUpperCase()).min(1).max(10),
});

const ruleSetBase = {
  name: requiredText(200),
  effectiveFrom: isoDateSchema,
  effectiveTo: z
    .union([isoDateSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  sourceReference: z
    .string()
    .trim()
    .min(5, 'Cite the official source (notification, circular, Act section)')
    .max(1000),
  notes: nullableText(2000),
};
const datesOk = (v: { effectiveFrom: string; effectiveTo: string | null }) =>
  !v.effectiveTo || v.effectiveTo >= v.effectiveFrom;

export const statutoryRuleSetSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('EPF'), ...ruleSetBase, config: epfConfigSchema }),
    z.object({ type: z.literal('ESI'), ...ruleSetBase, config: esiConfigSchema }),
    z.object({ type: z.literal('PT'), ...ruleSetBase, config: ptConfigSchema }),
    z.object({ type: z.literal('INCOME_TAX'), ...ruleSetBase, config: incomeTaxConfigSchema }),
    z.object({ type: z.literal('GRATUITY'), ...ruleSetBase, config: gratuityConfigSchema }),
  ])
  .refine(datesOk, {
    message: 'The end date cannot be before the start date',
    path: ['effectiveTo'],
  });
export type StatutoryRuleSetInput = z.infer<typeof statutoryRuleSetSchema>;
export const ruleSetStatusSchema = z.object({ status: z.enum(['ACTIVE', 'RETIRED']) });

// ------------------------------------------------------------------- components & structures

const RESERVED = new Set<string>(Object.values(STATUTORY_CODES));
export const componentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use 2–20 letters, digits or _ starting with a letter')
  .refine(
    (c) => !RESERVED.has(c) && !c.startsWith('ARR_'),
    'This code is reserved for computed lines',
  );

export const salaryComponentSchema = z.object({
  code: componentCodeSchema,
  name: requiredText(100),
  kind: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION']),
  taxable: z.boolean().default(true),
  pfWage: z.boolean().default(false),
  esiWage: z.boolean().default(false),
  ptWage: z.boolean().default(false),
  prorate: z.boolean().default(true),
  payslipOrder: z.coerce.number().int().min(0).max(999).default(100),
  description: nullableText(500),
});
export const updateSalaryComponentSchema = salaryComponentSchema
  .omit({ code: true })
  .partial()
  .extend({
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  });

const calcSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('FIXED'), monthlyAmount: moneySchema }),
  z.object({ type: z.literal('PERCENT_OF_CTC'), percent: percentSchema }),
  z.object({
    type: z.literal('PERCENT_OF_COMPONENT'),
    percent: percentSchema,
    componentCode: componentCodeSchema,
  }),
  z.object({ type: z.literal('BALANCING') }),
]);

export const salaryStructureSchema = z
  .object({
    name: requiredText(100),
    description: nullableText(500),
    /** The employer's EPF/ESI contributions are part of CTC (reserved from the balancing component). */
    employerStatutoryInCtc: z.boolean().default(false),
    components: z
      .array(z.object({ componentId: z.uuid(), calc: calcSchema }))
      .min(1)
      .max(50),
  })
  .refine((s) => new Set(s.components.map((c) => c.componentId)).size === s.components.length, {
    message: 'A component can appear only once',
    path: ['components'],
  })
  .refine((s) => s.components.filter((c) => c.calc.type === 'BALANCING').length <= 1, {
    message: 'Only one component can be balancing',
    path: ['components'],
  });
export const updateSalaryStructureSchema = z.object({
  name: requiredText(100).optional(),
  description: nullableText(500),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// ----------------------------------------------------------------------- employee salary

export const employeeSalarySchema = z.object({
  structureId: z.uuid('Select a salary structure'),
  annualCtc: moneySchema.refine((v) => dec(v).gt(0), 'CTC must be above zero'),
  effectiveFrom: isoDateSchema,
  reason: z.enum(['JOINING', 'REVISION', 'PROMOTION', 'CORRECTION']),
  note: nullableText(1000),
});

export const payrollProfileSchema = z.object({
  pfApplicable: z.boolean(),
  voluntaryPfFullWages: z.boolean().default(false),
  epsEligible: z.boolean().default(true),
  esiApplicable: z.boolean(),
  esiNumber: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d{10,17}$/, 'Digits only'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  ptStateCode: z
    .union([stateCodeSchema, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  metroCity: z.boolean().default(false),
  taxApplicable: z.boolean().default(true),
});

export const financialYearSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Use the form 2026-27')
  .refine((v) => {
    const start = Number(v.slice(0, 4));
    return (start + 1) % 100 === Number(v.slice(5));
  }, 'The two years must be consecutive');

export const taxDeclarationSchema = z.object({
  financialYear: financialYearSchema,
  regime: z.enum(['OLD', 'NEW']),
  rentPaidAnnual: moneySchema.default('0'),
  deductions: z.record(sectionSchema, moneySchema).default({}),
});

// ----------------------------------------------------------------------- settings & runs

export const payrollSettingsSchema = z
  .object({
    payableDaysMethod: z.enum(['CALENDAR_DAYS', 'FIXED_DAYS', 'WORKING_DAYS']),
    fixedDays: z.coerce.number().int().min(1).max(31).nullable().optional(),
    /** Absent days (attendance) are loss of pay; unpaid leave always is. */
    absentIsLossOfPay: z.boolean(),
    hraComponentCode: componentCodeSchema.nullable().optional(),
    basicComponentCodes: z.array(componentCodeSchema).max(5).default([]),
    /** Regime used when an employee has not chosen one — the organization's decision. */
    defaultTaxRegime: z.enum(['OLD', 'NEW']).nullable().optional(),
  })
  .refine((s) => s.payableDaysMethod !== 'FIXED_DAYS' || !!s.fixedDays, {
    message: 'Enter the fixed number of days',
    path: ['fixedDays'],
  });

export const createPayrollRunSchema = z.object({
  companyId: z.uuid('Select a company'),
  year: z.coerce.number().int().min(2000).max(2100),
  month,
});
export const payrollRunListQuerySchema = listQuerySchema.extend({
  status: z.string().trim().toUpperCase().max(20).optional(),
  companyId: z.uuid().optional(),
  year: z.coerce.number().int().optional(),
});

export const payrollAdjustmentSchema = z.object({
  employeeId: z.uuid('Select an employee'),
  code: componentCodeSchema,
  name: requiredText(100),
  category: z.enum(['EARNING', 'DEDUCTION']),
  amount: moneySchema.refine((v) => dec(v).gt(0), 'Amount must be above zero'),
  taxable: z.boolean().default(true),
  pfWage: z.boolean().default(false),
  esiWage: z.boolean().default(false),
  ptWage: z.boolean().default(false),
  note: nullableText(500),
});

export const runDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: nullableText(1000),
});

// ----------------------------------------------------------------------- full & final

export const settlementSchema = z.object({
  employeeId: z.uuid('Select an employee'),
  leaveEncashmentDays: moneySchema.default('0'),
  encashmentComponentCodes: z.array(componentCodeSchema).max(5).default([]),
  encashmentDivisor: z.coerce.number().int().min(1).max(31).default(30),
  noticeRequiredDays: z.coerce.number().int().min(0).max(365).default(0),
  noticeServedDays: z.coerce.number().int().min(0).max(365).default(0),
  noticeWaivedByEmployer: z.boolean().default(false),
  noticeDivisor: z.coerce.number().int().min(1).max(31).default(30),
  includeGratuity: z.boolean().default(true),
  /**
   * Tax treatment chosen by the preparer: exemption limits for gratuity and leave encashment are
   * statutory values this system does not compute, so an exempt part must be adjusted manually.
   */
  gratuityTaxable: z.boolean().default(true),
  encashmentTaxable: z.boolean().default(true),
  waiveGratuityMinimum: z.boolean().default(false),
  adjustments: z
    .array(
      z.object({
        code: componentCodeSchema,
        name: requiredText(100),
        category: z.enum(['EARNING', 'DEDUCTION']),
        amount: moneySchema,
      }),
    )
    .max(30)
    .default([]),
  note: nullableText(1000),
});
