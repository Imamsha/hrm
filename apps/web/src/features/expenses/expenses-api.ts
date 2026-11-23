import type {
  AssetCategoryItem,
  AssetDetails,
  AssetItem,
  ExpenseCategoryItem,
  ExpenseClaimDetails,
  ExpenseClaimItem,
  ExpenseSettingsItem,
  MyAssetsItem,
  PaginatedResult,
  SoftwareLicenseItem,
  TravelRequestDetails,
  TravelRequestItem,
} from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const SPEND = ['spend'] as const;
type Q = Record<string, string | number | undefined>;

const page = <T>(path: string, q: Q) =>
  ({
    queryKey: [...SPEND, path, q],
    queryFn: () => api.getPage<T>(path, { query: q }),
    placeholderData: keepPreviousData,
  }) as const;

export const useExpenseSettings = () =>
  useQuery({
    queryKey: [...SPEND, 'settings'],
    queryFn: () => api.get<ExpenseSettingsItem>('/expenses/settings'),
  });
export const useExpenseCategories = (includeInactive = false) =>
  useQuery({
    queryKey: [...SPEND, 'categories', includeInactive],
    queryFn: () =>
      api.get<ExpenseCategoryItem[]>('/expenses/categories', {
        query: includeInactive ? { includeInactive: 'true' } : {},
      }),
  });
export const useMyClaims = (q: Q) =>
  useQuery<PaginatedResult<ExpenseClaimItem>>(page<ExpenseClaimItem>('/me/expense-claims', q));
export const useClaims = (q: Q) =>
  useQuery<PaginatedResult<ExpenseClaimItem>>(page<ExpenseClaimItem>('/expense-claims', q));
export const useClaim = (id: string) =>
  useQuery({
    queryKey: [...SPEND, 'claim', id],
    queryFn: () => api.get<ExpenseClaimDetails>(`/expense-claims/${id}`),
    enabled: !!id,
  });

export const useMyTrips = (q: Q) =>
  useQuery<PaginatedResult<TravelRequestItem>>(page<TravelRequestItem>('/me/trips', q));
export const useTrips = (q: Q) =>
  useQuery<PaginatedResult<TravelRequestItem>>(page<TravelRequestItem>('/trips', q));
export const useTrip = (id: string) =>
  useQuery({
    queryKey: [...SPEND, 'trip', id],
    queryFn: () => api.get<TravelRequestDetails>(`/trips/${id}`),
  });

export const useAssetCategories = () =>
  useQuery({
    queryKey: [...SPEND, 'asset-categories'],
    queryFn: () => api.get<AssetCategoryItem[]>('/assets/categories'),
  });
export const useAssets = (q: Q) =>
  useQuery<PaginatedResult<AssetItem>>(page<AssetItem>('/assets', q));
export const useAsset = (id: string) =>
  useQuery({
    queryKey: [...SPEND, 'asset', id],
    queryFn: () => api.get<AssetDetails>(`/assets/${id}`),
  });
export const useLicenses = () =>
  useQuery({
    queryKey: [...SPEND, 'licenses'],
    queryFn: () => api.get<SoftwareLicenseItem[]>('/licenses'),
  });
export const useMyAssets = () =>
  useQuery({
    queryKey: [...SPEND, 'my-assets'],
    queryFn: () => api.get<MyAssetsItem>('/me/assets'),
  });

export const CLAIM_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'With manager',
  MANAGER_APPROVED: 'With finance',
  FINANCE_APPROVED: 'Approved',
  REIMBURSED: 'Reimbursed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};
export const SPEND_VARIANT: Record<
  string,
  'neutral' | 'warning' | 'success' | 'destructive' | 'info' | 'primary'
> = {
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  MANAGER_APPROVED: 'info',
  FINANCE_APPROVED: 'primary',
  REIMBURSED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'neutral',
  APPROVED: 'success',
  SETTLED: 'success',
  IN_STOCK: 'success',
  ALLOCATED: 'info',
  IN_REPAIR: 'warning',
  RETIRED: 'neutral',
  LOST: 'destructive',
};

/** Amount with Indian digit grouping in the given currency, from a decimal string. */
export function amount(value: string | null | undefined, currency = 'INR'): string {
  if (value === null || value === undefined || value === '') return '—';
  const negative = value.startsWith('-');
  const [whole = '0', fraction = '00'] = value.replace('-', '').split('.');
  const grouped =
    currency === 'INR'
      ? whole.replace(/(\d)(?=(\d\d)+\d$)/g, '$1,')
      : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${negative ? '−' : ''}${symbol}${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);
