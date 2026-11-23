/** Rule values here are FICTIONAL test numbers, not statutory rates. */
import { describe, expect, it } from 'vitest';
import {
  componentCodeSchema,
  esiConfigSchema,
  financialYearSchema,
  incomeTaxConfigSchema,
  payrollSettingsSchema,
  percentSchema,
  ptConfigSchema,
  salaryStructureSchema,
  statutoryRuleSetSchema,
} from './payroll.js';

const ok = (r: { success: boolean }) => r.success;
const rounding = { scale: 0, mode: 'HALF_UP' } as const;

describe('payroll primitives', () => {
  it('accepts percentages from 0 to 100 as strings', () => {
    expect(percentSchema.parse(12)).toBe('12');
    expect(ok(percentSchema.safeParse('8.3333'))).toBe(true);
    expect(ok(percentSchema.safeParse('100.01'))).toBe(false);
    expect(ok(percentSchema.safeParse('-1'))).toBe(false);
  });
  it('reserves computed line codes and requires consecutive financial years', () => {
    expect(componentCodeSchema.parse('basic')).toBe('BASIC');
    expect(ok(componentCodeSchema.safeParse('TDS'))).toBe(false);
    expect(ok(componentCodeSchema.safeParse('ARR_BASIC'))).toBe(false);
    expect(ok(financialYearSchema.safeParse('2026-27'))).toBe(true);
    expect(ok(financialYearSchema.safeParse('2026-28'))).toBe(false);
    expect(ok(financialYearSchema.safeParse('2099-00'))).toBe(true);
  });
});

describe('statutory configs', () => {
  it('requires ESI contribution periods to cover each month exactly once', () => {
    const base = {
      employeeRatePercent: '1',
      employerRatePercent: '3',
      wageThreshold: '25000',
      rounding,
    };
    expect(
      ok(
        esiConfigSchema.safeParse({
          ...base,
          contributionPeriods: [
            [4, 9],
            [10, 3],
          ],
        }),
      ),
    ).toBe(true);
    expect(ok(esiConfigSchema.safeParse({ ...base, contributionPeriods: [[4, 9]] }))).toBe(false);
    expect(
      ok(
        esiConfigSchema.safeParse({
          ...base,
          contributionPeriods: [
            [4, 9],
            [9, 3],
          ],
        }),
      ),
    ).toBe(false);
  });
  it('rejects overlapping PT slabs within a group but allows gender-specific ones', () => {
    const slabs = [
      { minWage: '0', maxWage: '9999', amount: '0' },
      { minWage: '10000', maxWage: null, amount: '200' },
      { minWage: '10000', maxWage: '24999', amount: '0', gender: 'FEMALE' },
    ];
    expect(ok(ptConfigSchema.safeParse({ stateCode: 'in-xx', slabs }))).toBe(true);
    expect(
      ok(
        ptConfigSchema.safeParse({
          stateCode: 'IN-XX',
          slabs: [...slabs, { minWage: '5000', maxWage: '12000', amount: '100' }],
        }),
      ),
    ).toBe(false);
    expect(ok(ptConfigSchema.safeParse({ stateCode: 'Karnataka', slabs }))).toBe(false);
  });
  it('requires ascending tax bands with only the last open-ended', () => {
    const cfg = {
      financialYear: '2026-27',
      regime: 'NEW',
      slabs: [
        { upTo: '100000', ratePercent: '0' },
        { upTo: null, ratePercent: '10' },
      ],
      standardDeduction: '0',
      rebate: null,
      surcharge: [],
      surchargeMarginalRelief: false,
      cessPercent: '0',
      deductionLimits: {},
      employeePfSection: null,
      professionalTaxDeductible: false,
      hra: null,
      incomeRoundingMultiple: '1',
      taxRoundingMultiple: '1',
    };
    expect(ok(incomeTaxConfigSchema.safeParse(cfg))).toBe(true);
    const bad = {
      ...cfg,
      slabs: [
        { upTo: '200000', ratePercent: '0' },
        { upTo: '100000', ratePercent: '5' },
        { upTo: null, ratePercent: '10' },
      ],
    };
    expect(ok(incomeTaxConfigSchema.safeParse(bad))).toBe(false);
    expect(
      ok(
        incomeTaxConfigSchema.safeParse({ ...cfg, slabs: [{ upTo: '100000', ratePercent: '0' }] }),
      ),
    ).toBe(false);
  });
  it('requires an official source and consistent dates on every rule set', () => {
    const epf = {
      type: 'EPF',
      name: 'EPF test',
      effectiveFrom: '2026-04-01',
      config: {
        employeeRatePercent: '10',
        employerRatePercent: '10',
        epsRatePercent: '6',
        epsWageCeiling: '20000',
        wageCeiling: '20000',
        rounding,
      },
    };
    expect(ok(statutoryRuleSetSchema.safeParse(epf))).toBe(false);
    expect(
      ok(statutoryRuleSetSchema.safeParse({ ...epf, sourceReference: 'Test notification 1/2026' })),
    ).toBe(true);
    expect(
      ok(
        statutoryRuleSetSchema.safeParse({
          ...epf,
          sourceReference: 'Test notification 1/2026',
          effectiveTo: '2026-03-31',
        }),
      ),
    ).toBe(false);
    const share = {
      ...epf,
      sourceReference: 'Test notification 1/2026',
      config: { ...epf.config, epsRatePercent: '11' },
    };
    expect(ok(statutoryRuleSetSchema.safeParse(share))).toBe(false);
  });
});

describe('structures and settings', () => {
  const id = (n: number) => `0195f1d2-0000-7000-8000-${String(n).padStart(12, '0')}`;
  it('allows at most one balancing component and no duplicates', () => {
    const s = {
      name: 'Standard',
      components: [
        { componentId: id(1), calc: { type: 'PERCENT_OF_CTC', percent: '40' } },
        { componentId: id(2), calc: { type: 'BALANCING' } },
      ],
    };
    expect(ok(salaryStructureSchema.safeParse(s))).toBe(true);
    expect(
      ok(
        salaryStructureSchema.safeParse({
          ...s,
          components: [...s.components, { componentId: id(3), calc: { type: 'BALANCING' } }],
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        salaryStructureSchema.safeParse({
          ...s,
          components: [
            ...s.components,
            { componentId: id(1), calc: { type: 'FIXED', monthlyAmount: '100' } },
          ],
        }),
      ),
    ).toBe(false);
  });
  it('needs the fixed day count when payable days are fixed', () => {
    expect(
      ok(
        payrollSettingsSchema.safeParse({
          payableDaysMethod: 'FIXED_DAYS',
          absentIsLossOfPay: true,
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        payrollSettingsSchema.safeParse({
          payableDaysMethod: 'FIXED_DAYS',
          fixedDays: 30,
          absentIsLossOfPay: true,
        }),
      ),
    ).toBe(true);
  });
});
