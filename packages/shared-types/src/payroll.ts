import type { EmployeeRef } from './employees.js';
import type { Ref } from './structure.js';

/** Money and rates travel as decimal strings, never JS numbers. */
export type MoneyString = string;

export type StatutoryRuleTypeValue = 'EPF' | 'ESI' | 'PT' | 'INCOME_TAX' | 'GRATUITY';
export type RuleSetStatusValue = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type TaxRegimeValue = 'OLD' | 'NEW';
export type ComponentKindValue = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
export type PayrollRunStatusValue = 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'FINALIZED' | 'CANCELLED';
export type SettlementStatusValue = PayrollRunStatusValue;
export type PayLineCategoryValue = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
export type PayLineSourceValue =
  'STRUCTURE' | 'ADJUSTMENT' | 'ARREARS' | 'STATUTORY' | 'SETTLEMENT';

export interface PayrollSettingsItem {
  payableDaysMethod: 'CALENDAR_DAYS' | 'FIXED_DAYS' | 'WORKING_DAYS';
  fixedDays: number | null;
  absentIsLossOfPay: boolean;
  hraComponentCode: string | null;
  basicComponentCodes: string[];
  defaultTaxRegime: TaxRegimeValue | null;
}

export interface StatutoryRuleSetItem {
  id: string;
  type: StatutoryRuleTypeValue;
  name: string;
  stateCode: string | null;
  regime: TaxRegimeValue | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: RuleSetStatusValue;
  sourceReference: string;
  notes: string | null;
  /** Shape depends on `type` (see @hrm/validation statutory config schemas). */
  config: Record<string, unknown>;
  createdBy: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export interface SalaryComponentItem {
  id: string;
  code: string;
  name: string;
  kind: ComponentKindValue;
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
  ptWage: boolean;
  prorate: boolean;
  payslipOrder: number;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export type ComponentCalcItem =
  | { type: 'FIXED'; monthlyAmount: MoneyString }
  | { type: 'PERCENT_OF_CTC'; percent: string }
  | { type: 'PERCENT_OF_COMPONENT'; percent: string; componentCode: string }
  | { type: 'BALANCING' };

export interface SalaryStructureItem {
  id: string;
  name: string;
  description: string | null;
  employerStatutoryInCtc: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  components: {
    componentId: string;
    code: string;
    name: string;
    kind: ComponentKindValue;
    calc: ComponentCalcItem;
  }[];
  employeeCount: number;
}

export interface SalaryLineItem {
  code: string;
  name: string;
  kind: ComponentKindValue;
  monthly: MoneyString;
  annual: MoneyString;
}

export interface EmployeeSalaryItem {
  id: string;
  structure: { id: string; name: string };
  annualCtc: MoneyString;
  effectiveFrom: string;
  reason: 'JOINING' | 'REVISION' | 'PROMOTION' | 'CORRECTION';
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  breakdown: {
    monthlyCtc: MoneyString;
    lines: SalaryLineItem[];
    problems: { code: string; message: string }[];
  };
}

export interface PayrollProfileItem {
  pfApplicable: boolean;
  voluntaryPfFullWages: boolean;
  epsEligible: boolean;
  esiApplicable: boolean;
  esiNumber: string | null;
  ptStateCode: string | null;
  metroCity: boolean;
  taxApplicable: boolean;
}

export interface TaxDeclarationItem {
  financialYear: string;
  regime: TaxRegimeValue;
  rentPaidAnnual: MoneyString;
  deductions: Record<string, MoneyString>;
  updatedAt: string | null;
}

export interface EmployeePayrollItem {
  employee: EmployeeRef;
  profile: PayrollProfileItem | null;
  salaries: EmployeeSalaryItem[];
  current: EmployeeSalaryItem | null;
}

export interface PayrollRunItem {
  id: string;
  company: Ref;
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  status: PayrollRunStatusValue;
  employeeCount: number;
  problemCount: number;
  totals: {
    gross: MoneyString;
    deductions: MoneyString;
    net: MoneyString;
    employerCost: MoneyString;
  };
  note: string | null;
  createdBy: string | null;
  calculatedBy: string | null;
  calculatedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  finalizedBy: string | null;
  finalizedAt: string | null;
  createdAt: string;
  /** The caller may approve (has the permission and did not calculate it). */
  canApprove: boolean;
}

export interface PayLineItem {
  code: string;
  name: string;
  category: PayLineCategoryValue;
  source: PayLineSourceValue;
  amount: MoneyString;
  forYear: number | null;
  forMonth: number | null;
}

export interface PayrollProblem {
  code: string;
  message: string;
}

export interface PayrollResultItem {
  id: string;
  employee: EmployeeRef;
  payableDays: string;
  periodDays: string;
  lossOfPayDays: string;
  gross: MoneyString;
  totalDeductions: MoneyString;
  netPay: MoneyString;
  employerCost: MoneyString;
  problems: PayrollProblem[];
  lines: PayLineItem[];
}

export interface PayrollAdjustmentItem {
  id: string;
  employee: EmployeeRef;
  code: string;
  name: string;
  category: 'EARNING' | 'DEDUCTION';
  amount: MoneyString;
  taxable: boolean;
  note: string | null;
  createdAt: string;
}

export interface PayslipSummary {
  resultId: string;
  year: number;
  month: number;
  company: string;
  gross: MoneyString;
  netPay: MoneyString;
  finalizedAt: string;
}

export interface PayslipItem extends PayrollResultItem {
  runId: string;
  year: number;
  month: number;
  company: { name: string; legalName: string | null };
  finalizedAt: string;
  taxRegime: TaxRegimeValue | null;
  annualTaxProjection: MoneyString | null;
  taxTrace: { label: string; amount: MoneyString }[] | null;
  bankAccount: { bankName: string; last4: string } | null;
}

export interface SettlementItem {
  id: string;
  employee: EmployeeRef;
  lastWorkingDate: string;
  status: SettlementStatusValue;
  gratuity: MoneyString;
  leaveEncashment: MoneyString;
  noticePay: MoneyString;
  totalEarnings: MoneyString;
  totalDeductions: MoneyString;
  netPayable: MoneyString;
  lines: PayLineItem[];
  problems: PayrollProblem[];
  inputs: Record<string, unknown>;
  note: string | null;
  calculatedBy: string | null;
  approvedBy: string | null;
  finalizedAt: string | null;
  createdAt: string;
  canApprove: boolean;
}
