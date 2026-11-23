import type {
  EmployeePayrollItem,
  PaginatedResult,
  PayrollAdjustmentItem,
  PayrollResultItem,
  PayrollRunItem,
  PayrollSettingsItem,
  PayslipItem,
  PayslipSummary,
  SalaryComponentItem,
  SalaryStructureItem,
  SettlementItem,
  StatutoryRuleSetItem,
  TaxDeclarationItem,
} from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const PAYROLL = ['payroll'] as const;

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const monthName = (m: number) => MONTHS[m - 1] ?? String(m);
export const period = (year: number, month: number) => `${monthName(month)} ${String(year)}`;

/** Financial year (April–March) of a date, e.g. "2026-27". */
export function financialYearOf(date = new Date()): string {
  const y = date.getFullYear();
  const start = date.getMonth() + 1 >= 4 ? y : y - 1;
  return `${String(start)}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** ₹ amounts with Indian digit grouping, from decimal strings (no float conversion). */
export function inr(amount: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = '00'] = amount.replace('-', '').split('.');
  const grouped = whole.replace(/(\d)(?=(\d\d)+\d$)/g, '$1,');
  return `${negative ? '−' : ''}₹${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

export const RUN_VARIANT: Record<
  string,
  'neutral' | 'warning' | 'success' | 'destructive' | 'info' | 'primary'
> = {
  DRAFT: 'neutral',
  CALCULATED: 'info',
  APPROVED: 'warning',
  FINALIZED: 'success',
  CANCELLED: 'neutral',
  ACTIVE: 'success',
  RETIRED: 'neutral',
};

export const RULE_TYPE_LABEL: Record<string, string> = {
  EPF: 'Provident fund (EPF)',
  ESI: 'State insurance (ESI)',
  PT: 'Professional tax',
  INCOME_TAX: 'Income tax',
  GRATUITY: 'Gratuity',
};

export const useSettings = () =>
  useQuery({
    queryKey: [...PAYROLL, 'settings'],
    queryFn: () => api.get<PayrollSettingsItem>('/payroll/settings'),
  });
export const useComponents = () =>
  useQuery({
    queryKey: [...PAYROLL, 'components'],
    queryFn: () => api.get<SalaryComponentItem[]>('/payroll/components'),
  });
export const useStructures = () =>
  useQuery({
    queryKey: [...PAYROLL, 'structures'],
    queryFn: () => api.get<SalaryStructureItem[]>('/payroll/structures'),
  });
export const useRuleSets = (q: { type?: string; status?: string }) =>
  useQuery({
    queryKey: [...PAYROLL, 'rule-sets', q],
    queryFn: () => api.get<StatutoryRuleSetItem[]>('/payroll/rule-sets', { query: q }),
  });
export const useEmployeePayroll = (id: string) =>
  useQuery({
    queryKey: [...PAYROLL, 'employee', id],
    queryFn: () => api.get<EmployeePayrollItem>(`/payroll/employees/${id}`),
    enabled: !!id,
  });
export const useDeclaration = (employeeId: string | null, fy: string) =>
  useQuery({
    queryKey: [...PAYROLL, 'declaration', employeeId ?? 'me', fy],
    queryFn: () =>
      api.get<TaxDeclarationItem | null>(
        employeeId
          ? `/payroll/employees/${employeeId}/declarations/${fy}`
          : `/me/tax-declarations/${fy}`,
      ),
  });
export const useRuns = (q: Record<string, string | number | undefined>) =>
  useQuery<PaginatedResult<PayrollRunItem>>({
    queryKey: [...PAYROLL, 'runs', q],
    queryFn: () => api.getPage<PayrollRunItem>('/payroll/runs', { query: q }),
    placeholderData: keepPreviousData,
  });
export const useRun = (id: string) =>
  useQuery({
    queryKey: [...PAYROLL, 'run', id],
    queryFn: () => api.get<PayrollRunItem>(`/payroll/runs/${id}`),
  });
export const useResults = (id: string, problemsOnly: boolean) =>
  useQuery({
    queryKey: [...PAYROLL, 'results', id, problemsOnly],
    queryFn: () =>
      api.get<PayrollResultItem[]>(`/payroll/runs/${id}/results`, {
        query: problemsOnly ? { problemsOnly: 'true' } : {},
      }),
  });
export const useAdjustments = (id: string) =>
  useQuery({
    queryKey: [...PAYROLL, 'adjustments', id],
    queryFn: () => api.get<PayrollAdjustmentItem[]>(`/payroll/runs/${id}/adjustments`),
  });
export const useSettlements = (status?: string) =>
  useQuery({
    queryKey: [...PAYROLL, 'settlements', status],
    queryFn: () => api.get<SettlementItem[]>('/payroll/settlements', { query: { status } }),
  });
export const useMySalary = () =>
  useQuery({
    queryKey: [...PAYROLL, 'my-salary'],
    queryFn: () => api.get<EmployeePayrollItem>('/me/salary'),
  });
export const useMyPayslips = () =>
  useQuery({
    queryKey: [...PAYROLL, 'my-payslips'],
    queryFn: () => api.get<PayslipSummary[]>('/me/payslips'),
  });
export const usePayslip = (resultId: string, self: boolean) =>
  useQuery({
    queryKey: [...PAYROLL, 'payslip', resultId, self],
    queryFn: () =>
      api.get<PayslipItem>(self ? `/me/payslips/${resultId}` : `/payroll/payslips/${resultId}`),
  });
