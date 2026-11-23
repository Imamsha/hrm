/**
 * Payroll engine tests. All rule values below are FICTIONAL round numbers chosen to make the
 * arithmetic easy to check by hand — they are not statutory rates and must never be used as such.
 */
import { describe, expect, it } from 'vitest';
import {
  computeAnnualTax,
  hraExemption,
  type IncomeTaxConfig,
  monthlyTds,
  remainingFyMonths,
  slabTax,
} from './income-tax.js';
import { computeMonthlyPay } from './payroll-run.js';
import {
  breakdownFromCtc,
  lossOfPayDays,
  payableDays,
  periodDays,
  prorateLines,
  type StructureComponent,
} from './payroll-salary.js';
import {
  computeEpf,
  computeEsi,
  computePt,
  esiCovered,
  esiPeriodFor,
  type EpfConfig,
  type EsiConfig,
  type PtConfig,
} from './payroll-statutory.js';
import {
  arrearsFor,
  computeGratuity,
  leaveEncashment,
  noticePay,
  serviceYears,
} from './settlement.js';

const flags = { taxable: true, pfWage: false, esiWage: true, ptWage: true, prorate: true };
const structure: StructureComponent[] = [
  {
    code: 'BASIC',
    name: 'Basic',
    kind: 'EARNING',
    calc: { type: 'PERCENT_OF_CTC', percent: '40' },
    ...flags,
    pfWage: true,
  },
  {
    code: 'HRA',
    name: 'House rent allowance',
    kind: 'EARNING',
    calc: { type: 'PERCENT_OF_COMPONENT', percent: '50', componentCode: 'BASIC' },
    ...flags,
  },
  {
    code: 'CONV',
    name: 'Conveyance',
    kind: 'EARNING',
    calc: { type: 'FIXED', monthlyAmount: '1600' },
    ...flags,
  },
  {
    code: 'SPECIAL',
    name: 'Special allowance',
    kind: 'EARNING',
    calc: { type: 'BALANCING' },
    ...flags,
  },
];
const amounts = (lines: { code: string; amount: { toFixed: (n: number) => string } }[]) =>
  Object.fromEntries(lines.map((l) => [l.code, l.amount.toFixed(2)]));

const epf: EpfConfig = {
  employeeRatePercent: '10',
  employerRatePercent: '10',
  epsRatePercent: '6',
  epsWageCeiling: '20000',
  wageCeiling: '20000',
  rounding: { scale: 0, mode: 'HALF_UP' },
};
const esi: EsiConfig = {
  employeeRatePercent: '1',
  employerRatePercent: '3',
  wageThreshold: '25000',
  contributionPeriods: [
    [4, 9],
    [10, 3],
  ],
  rounding: { scale: 0, mode: 'CEIL' },
};
const pt: PtConfig = {
  stateCode: 'IN-XX',
  slabs: [
    { minWage: '0', maxWage: '9999', amount: '0' },
    { minWage: '10000', maxWage: null, amount: '200', monthAmounts: { '2': '300' } },
    { minWage: '10000', maxWage: '24999', amount: '0', gender: 'FEMALE' },
  ],
};
const tax: IncomeTaxConfig = {
  financialYear: 'TEST',
  regime: 'OLD',
  slabs: [
    { upTo: '100000', ratePercent: '0' },
    { upTo: '200000', ratePercent: '10' },
    { upTo: '500000', ratePercent: '20' },
    { upTo: null, ratePercent: '30' },
  ],
  seniorSlabs: [
    {
      minAge: 60,
      slabs: [
        { upTo: '150000', ratePercent: '0' },
        { upTo: '200000', ratePercent: '10' },
        { upTo: '500000', ratePercent: '20' },
        { upTo: null, ratePercent: '30' },
      ],
    },
  ],
  standardDeduction: '50000',
  rebate: { maxTaxableIncome: '300000', maxRebate: '20000', marginalRelief: true },
  surcharge: [{ above: '1000000', ratePercent: '10' }],
  surchargeMarginalRelief: true,
  cessPercent: '4',
  deductionLimits: { '80C': '100000', '80D': null },
  employeePfSection: '80C',
  professionalTaxDeductible: true,
  hra: { metroPercentOfBasic: '50', nonMetroPercentOfBasic: '40', rentExcessPercentOfBasic: '10' },
  incomeRoundingMultiple: '10',
  taxRoundingMultiple: '10',
};

describe('salary structure', () => {
  it('splits CTC by percentages, fixed amounts and a balancing component', () => {
    const r = breakdownFromCtc('600000', structure);
    expect(r.problems).toEqual([]);
    expect(r.monthlyCtc.toFixed(2)).toBe('50000.00');
    expect(amounts(r.lines)).toEqual({
      BASIC: '20000.00',
      HRA: '10000.00',
      CONV: '1600.00',
      SPECIAL: '18400.00',
    });
  });

  it('keeps a reserved amount (employer statutory cost in CTC) out of the balance', () => {
    const r = breakdownFromCtc('600000', structure, '1800');
    expect(amounts(r.lines).SPECIAL).toBe('16600.00');
  });

  it('reports cycles and components exceeding CTC instead of guessing', () => {
    const cyclic: StructureComponent[] = [
      {
        code: 'A',
        name: 'A',
        kind: 'EARNING',
        calc: { type: 'PERCENT_OF_COMPONENT', percent: '10', componentCode: 'B' },
        ...flags,
      },
      {
        code: 'B',
        name: 'B',
        kind: 'EARNING',
        calc: { type: 'PERCENT_OF_COMPONENT', percent: '10', componentCode: 'A' },
        ...flags,
      },
    ];
    expect(breakdownFromCtc('120000', cyclic).problems.map((p) => p.code)).toContain('CYCLE');
    const [, , conv, special] = structure;
    if (!conv || !special) throw new Error('fixture');
    const over = [{ ...conv, calc: { type: 'FIXED' as const, monthlyAmount: '60000' } }, special];
    const r = breakdownFromCtc('600000', over);
    expect(r.problems.map((p) => p.code)).toEqual(['NEGATIVE_BALANCE']);
    expect(amounts(r.lines).SPECIAL).toBe('0.00');
  });

  it('computes payable days and prorates flagged components only', () => {
    expect(
      payableDays({ denominator: 30, employedDays: 30, lossOfPayDays: '2.5' }).toString(),
    ).toBe('27.5');
    expect(payableDays({ denominator: 30, employedDays: 40, lossOfPayDays: 0 }).toString()).toBe(
      '30',
    );
    expect(payableDays({ denominator: 30, employedDays: 10, lossOfPayDays: 35 }).toString()).toBe(
      '0',
    );
    expect(periodDays('CALENDAR_DAYS', 31)).toBe(31);
    expect(periodDays('FIXED_DAYS', 31, { fixedDays: 30 })).toBe(30);
    expect(() => periodDays('FIXED_DAYS', 31)).toThrow();
    const lines = breakdownFromCtc('600000', structure).lines.map((l) =>
      l.code === 'CONV' ? { ...l, prorate: false } : l,
    );
    expect(amounts(prorateLines(lines, 20, 30))).toEqual({
      BASIC: '13333.33',
      HRA: '6666.67',
      CONV: '1600.00',
      SPECIAL: '12266.67',
    });
  });
});

describe('EPF', () => {
  it('applies the wage ceiling and carves the pension share out of the employer contribution', () => {
    const r = computeEpf({ pfWages: '30000', config: epf, epsEligible: true });
    expect([r.employee, r.employerEpf, r.employerEps].map(String)).toEqual(['2000', '800', '1200']);
  });
  it('supports voluntary contribution on full wages, members outside the pension scheme and no ceiling', () => {
    expect(
      computeEpf({
        pfWages: '30000',
        config: epf,
        epsEligible: true,
        voluntaryFullWages: true,
      }).employee.toString(),
    ).toBe('3000');
    const noEps = computeEpf({ pfWages: '30000', config: epf, epsEligible: false });
    expect([noEps.employerEpf, noEps.employerEps].map(String)).toEqual(['2000', '0']);
    const open = computeEpf({
      pfWages: '30000',
      config: { ...epf, wageCeiling: null },
      epsEligible: true,
    });
    expect([open.employee, open.employerEpf, open.employerEps].map(String)).toEqual([
      '3000',
      '1800',
      '1200',
    ]);
    const odd = computeEpf({ pfWages: '15333', config: epf, epsEligible: true });
    expect([odd.employee, odd.employerEpf, odd.employerEps].map(String)).toEqual([
      '1533',
      '613',
      '920',
    ]);
  });
});

describe('ESI', () => {
  it('finds contribution periods, including one that wraps the year end', () => {
    expect(esiPeriodFor(11, esi.contributionPeriods)).toEqual([10, 3]);
    expect(esiPeriodFor(2, esi.contributionPeriods)).toEqual([10, 3]);
    expect(esiPeriodFor(5, esi.contributionPeriods)).toEqual([4, 9]);
  });
  it('decides coverage from period-start wages and rounds as configured', () => {
    expect(esiCovered('25000', esi)).toBe(true);
    expect(esiCovered('25001', esi)).toBe(false);
    const r = computeEsi({ esiWages: '20010', covered: true, config: esi });
    expect([r.employee, r.employer].map(String)).toEqual(['201', '601']);
    expect(computeEsi({ esiWages: '20010', covered: false, config: esi }).employee.toString()).toBe(
      '0',
    );
  });
});

describe('Professional tax', () => {
  it('picks gender-specific slabs first and month-specific amounts', () => {
    const at = (wages: string, month: number, gender: 'MALE' | 'FEMALE') =>
      computePt({ ptWages: wages, month, gender, config: pt }).amount.toString();
    expect(at('15000', 5, 'MALE')).toBe('200');
    expect(at('15000', 2, 'MALE')).toBe('300');
    expect(at('15000', 5, 'FEMALE')).toBe('0');
    expect(at('30000', 5, 'FEMALE')).toBe('200');
    expect(at('5000', 5, 'MALE')).toBe('0');
  });
  it('deducts only in configured months', () => {
    const half = { ...pt, deductionMonths: [9, 3] };
    expect(
      computePt({ ptWages: '15000', month: 5, gender: 'MALE', config: half }).amount.toString(),
    ).toBe('0');
    expect(
      computePt({ ptWages: '15000', month: 9, gender: 'MALE', config: half }).amount.toString(),
    ).toBe('200');
  });
});

describe('income tax', () => {
  const total = (gross: string, extra: Partial<Parameters<typeof computeAnnualTax>[0]> = {}) =>
    computeAnnualTax({ grossSalary: gross, config: tax, ...extra }).totalTax.toString();

  it('applies slabs progressively', () => {
    expect(slabTax('290000', tax.slabs).toString()).toBe('28000');
  });
  it('gives the rebate up to its limit and marginal relief just above it', () => {
    // 340000 − 50000 = 290000 → 28000 − rebate 20000 = 8000 + 4 % cess = 8320
    expect(total('340000')).toBe('8320');
    // 302000 → 30400 on slabs, but tax may not exceed the 2000 above the limit → 2000 + 80 cess
    expect(total('352000')).toBe('2080');
    // taxable income is rounded down to the multiple first
    expect(total('340005')).toBe('8320');
  });
  it('applies surcharge with marginal relief and cess', () => {
    // 1010000 → 223000; surcharge 22300 limited to 7000 (230000 at threshold + 10000 − 223000); cess 9200
    expect(total('1060000')).toBe('239200');
  });
  it('counts only allowed sections up to their caps, including employee PF and professional tax', () => {
    // 80C: 150000 + PF 20000 capped at 100000; 80D 30000 uncapped; 80G not allowed; PT 2400
    const r = computeAnnualTax({
      grossSalary: '600000',
      deductions: { '80C': '150000', '80D': '30000', '80G': '5000' },
      employeePf: '20000',
      professionalTax: '2400',
      config: tax,
    });
    expect(r.taxableIncome.toString()).toBe('417600');
    // 10000 + 217600 × 20 % = 53520 + 4 % = 55660.8 → rounded to 10
    expect(r.totalTax.toString()).toBe('55660');
    const newRegime = computeAnnualTax({
      grossSalary: '600000',
      deductions: { '80C': '150000' },
      config: { ...tax, regime: 'NEW', deductionLimits: {}, employeePfSection: null },
    });
    expect(newRegime.deductions.toString()).toBe('0');
  });
  it('uses age-specific slabs', () => {
    // 290000 on senior slabs → 23000 − 20000 rebate = 3000 + 120 cess
    expect(total('340000', { ageYears: 65 })).toBe('3120');
    expect(total('340000', { ageYears: 59 })).toBe('8320');
  });
  it('computes the HRA exemption as the least of the three limits', () => {
    const rule = tax.hra;
    if (!rule) throw new Error('fixture');
    expect(
      hraExemption({
        hraReceived: '240000',
        basic: '480000',
        rentPaid: '300000',
        metro: true,
        rule,
      }).toString(),
    ).toBe('240000');
    expect(
      hraExemption({
        hraReceived: '240000',
        basic: '480000',
        rentPaid: '300000',
        metro: false,
        rule,
      }).toString(),
    ).toBe('192000');
    expect(
      hraExemption({
        hraReceived: '240000',
        basic: '480000',
        rentPaid: '100000',
        metro: true,
        rule,
      }).toString(),
    ).toBe('52000');
    expect(
      hraExemption({
        hraReceived: '240000',
        basic: '480000',
        rentPaid: '10000',
        metro: true,
        rule,
      }).toString(),
    ).toBe('0');
  });
  it('spreads the remaining tax over the remaining months of the year', () => {
    expect(
      monthlyTds({
        annualTax: '36000',
        deductedToDate: '6000',
        remainingMonthsIncludingCurrent: 10,
      }).toString(),
    ).toBe('3000');
    expect(
      monthlyTds({
        annualTax: '36000',
        deductedToDate: '40000',
        remainingMonthsIncludingCurrent: 3,
      }).toString(),
    ).toBe('0');
    expect([4, 3, 1, 12].map((m) => remainingFyMonths(m))).toEqual([12, 1, 3, 4]);
  });
});

describe('settlement', () => {
  const gratuity = {
    daysPerYear: '15',
    monthDivisor: '26',
    minYears: '5',
    roundUpMonths: 6,
    cap: '1000000',
  };
  it('counts service years with the configured round-up', () => {
    expect(serviceYears('2018-01-15', '2026-08-10', 6)).toBe(9);
    expect(serviceYears('2018-01-15', '2026-07-10', 6)).toBe(8);
    expect(serviceYears('2018-01-15', '2026-07-10', null)).toBe(8);
    expect(serviceYears('2026-01-15', '2025-01-15', 6)).toBe(0);
  });
  it('computes gratuity with eligibility and cap', () => {
    expect(computeGratuity({ monthlyWages: '26000', years: 9, config: gratuity })).toMatchObject({
      eligible: true,
    });
    expect(
      computeGratuity({ monthlyWages: '26000', years: 9, config: gratuity }).amount.toString(),
    ).toBe('135000');
    expect(computeGratuity({ monthlyWages: '26000', years: 4, config: gratuity }).eligible).toBe(
      false,
    );
    expect(
      computeGratuity({
        monthlyWages: '26000',
        years: 4,
        config: gratuity,
        waiveMinimum: true,
      }).amount.toString(),
    ).toBe('60000');
    expect(
      computeGratuity({ monthlyWages: '5000000', years: 10, config: gratuity }).amount.toString(),
    ).toBe('1000000');
  });
  it('computes encashment, notice pay and arrears', () => {
    expect(leaveEncashment({ days: 10, monthlyBasis: '30000', divisor: 30 }).toString()).toBe(
      '10000',
    );
    expect(
      noticePay({
        requiredDays: 60,
        servedDays: 30,
        monthlyBasis: '30000',
        divisor: 30,
        waivedByEmployer: false,
      }).toString(),
    ).toBe('-30000');
    expect(
      noticePay({
        requiredDays: 60,
        servedDays: 30,
        monthlyBasis: '30000',
        divisor: 30,
        waivedByEmployer: true,
      }).toString(),
    ).toBe('30000');
    expect(
      noticePay({
        requiredDays: 60,
        servedDays: 60,
        monthlyBasis: '30000',
        divisor: 30,
        waivedByEmployer: false,
      }).toString(),
    ).toBe('0');
    const arrears = arrearsFor(
      [
        { code: 'BASIC', name: 'Basic', amount: '20000' },
        { code: 'HRA', name: 'HRA', amount: '10000' },
        { code: 'OLD', name: 'Old', amount: '100' },
      ],
      [
        { code: 'BASIC', name: 'Basic', amount: '22000' },
        { code: 'HRA', name: 'HRA', amount: '10000' },
        { code: 'NEW', name: 'New', amount: '500' },
      ],
    );
    expect(arrears.map((a) => [a.code, a.amount.toString()])).toEqual([
      ['BASIC', '2000'],
      ['NEW', '500'],
      ['OLD', '-100'],
    ]);
  });
});

describe('monthly pay', () => {
  const lines = breakdownFromCtc('600000', structure).lines;
  const base = {
    month: 5,
    structure: lines,
    payableDays: 30,
    denominator: 30,
    adjustments: [],
    arrears: [],
  };

  it('combines salary, EPF and PT into net pay and employer cost', () => {
    const r = computeMonthlyPay({
      ...base,
      epf: { config: epf, epsEligible: true },
      esi: { config: esi, covered: false },
      pt: { config: pt, gender: 'MALE' },
      tax: null,
    });
    expect(r.problems).toEqual([]);
    expect([r.gross, r.totalDeductions, r.netPay, r.employerCost].map((d) => d.toFixed(2))).toEqual(
      ['50000.00', '2200.00', '47800.00', '52000.00'],
    );
    expect(r.wages.pf.toFixed(2)).toBe('20000.00');
  });

  it('reports missing rule sets instead of assuming values', () => {
    const r = computeMonthlyPay({
      ...base,
      epf: { config: null, epsEligible: true },
      esi: { config: null, covered: true },
      pt: { config: null, gender: null },
      tax: {
        config: null,
        month: 5,
        ageYears: null,
        declarations: {},
        rentPaidAnnual: 0,
        metro: false,
        hraComponentCode: null,
        basicComponentCodes: [],
        ytdTaxableGross: 0,
        ytdTds: 0,
        ytdEmployeePf: 0,
        ytdProfessionalTax: 0,
        ytdByComponent: {},
      },
    });
    expect(r.problems.map((p) => p.code)).toEqual([
      'EPF_RULE_MISSING',
      'ESI_RULE_MISSING',
      'PT_RULE_MISSING',
      'TAX_RULE_MISSING',
    ]);
  });

  it('projects the year and deducts TDS', () => {
    const r = computeMonthlyPay({
      ...base,
      month: 4,
      epf: { config: epf, epsEligible: true },
      esi: null,
      pt: { config: pt, gender: 'MALE' },
      tax: {
        config: tax,
        month: 4,
        ageYears: 30,
        declarations: {},
        rentPaidAnnual: 0,
        metro: false,
        hraComponentCode: 'HRA',
        basicComponentCodes: ['BASIC'],
        ytdTaxableGross: 0,
        ytdTds: 0,
        ytdEmployeePf: 0,
        ytdProfessionalTax: 0,
        ytdByComponent: {},
      },
    });
    // 600000 − 50000 − PF 24000 − PT 2400 = 523600 → 77080 + cess 3083.2 → 80160 → 6680 a month
    expect(r.tax?.annualTax.toString()).toBe('80160');
    expect(r.lines.find((l) => l.code === 'TDS')?.amount.toString()).toBe('6680');
    expect(r.netPay.toFixed(2)).toBe('41120.00');
  });

  it('adds arrears and one-time adjustments and flags negative net pay', () => {
    const r = computeMonthlyPay({
      ...base,
      arrears: [{ code: 'BASIC', name: 'Basic', amount: '2000', taxable: true, pfWage: true }],
      adjustments: [
        {
          code: 'RECOVERY',
          name: 'Advance recovery',
          category: 'DEDUCTION',
          amount: '60000',
          taxable: false,
        },
      ],
      epf: { config: epf, epsEligible: true },
      esi: null,
      pt: null,
      tax: null,
    });
    expect(r.lines.map((l) => l.code)).toEqual(expect.arrayContaining(['ARR_BASIC', 'RECOVERY']));
    // Arrears count towards PF wages (the ceiling is applied inside the EPF calculation).
    expect(r.wages.pf.toFixed(2)).toBe('22000.00');
    expect(r.problems.map((p) => p.code)).toEqual(['NEGATIVE_NET_PAY']);
  });
});

describe('loss of pay', () => {
  const day = (over: Partial<Parameters<typeof lossOfPayDays>[0][number]>) => ({
    status: 'PRESENT' as const,
    leaveSession: null,
    unpaidLeaveDays: 0,
    halfWorkingDay: false,
    ...over,
  });
  it('counts unpaid leave always and absences only when configured', () => {
    const days = [
      day({ status: 'ABSENT' }),
      day({ status: 'HALF_DAY' }),
      day({ status: 'ON_LEAVE', leaveSession: 'FULL', unpaidLeaveDays: 1 }),
      day({ status: 'ON_LEAVE', leaveSession: 'FULL', unpaidLeaveDays: 0 }),
      day({ status: 'ABSENT', leaveSession: 'FIRST_HALF', unpaidLeaveDays: 0 }),
      day({ status: 'PRESENT', leaveSession: 'SECOND_HALF', unpaidLeaveDays: 0.5 }),
      day({ status: 'ABSENT', halfWorkingDay: true }),
      day({ status: 'WEEKLY_OFF' }),
      day({ status: 'PENDING' }),
    ];
    // 1 + 0.5 + 1 + 0 + 0.5 + 0.5 + 0.5 = 4
    expect(lossOfPayDays(days, true).toString()).toBe('4');
    // only unpaid leave: 1 + 0.5
    expect(lossOfPayDays(days, false).toString()).toBe('1.5');
  });
});
