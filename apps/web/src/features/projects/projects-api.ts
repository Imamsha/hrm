import type {
  BillingSettingsItem,
  BoardData,
  ClientItem,
  InvoiceDetails,
  InvoiceItem,
  PortalSummary,
  PortalWorkItem,
  PortalWorkItemDetails,
  ProjectDetails,
  ProjectItem,
  TaxRateItem,
  TimeReportItem,
  TimesheetItem,
  WorkItemDetails,
  WorkItemItem,
} from '@hrm/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';

export const PROJECTS = ['projects'] as const;
type Query = Record<string, string | number | boolean | undefined>;
const q = <T>(key: string, path: string, query?: Query, enabled = true) => ({
  queryKey: [...PROJECTS, key, path, query ?? {}],
  queryFn: () => api.get<T>(path, query ? { query } : undefined),
  enabled,
});

export const useClients = () => useQuery(q<ClientItem[]>('clients', '/clients'));
export const useProjects = (query: Query = {}) =>
  useQuery(q<ProjectItem[]>('list', '/projects', query));
export const useProject = (id: string) =>
  useQuery(q<ProjectDetails>('project', `/projects/${id}`, undefined, !!id));
export const useBoard = (id: string, sprintId?: string) =>
  useQuery(
    q<BoardData>('board', `/projects/${id}/board`, sprintId ? { sprintId } : undefined, !!id),
  );
export const useItems = (id: string, query: Query) =>
  useQuery(q<WorkItemItem[]>('items', `/projects/${id}/items`, query, !!id));
export const useItem = (id: string, itemId: string) =>
  useQuery(
    q<WorkItemDetails>('item', `/projects/${id}/items/${itemId}`, undefined, !!id && !!itemId),
  );
export const useMyWork = () =>
  useQuery(
    q<(WorkItemItem & { project: { id: string; key: string; name: string } })[]>(
      'my-work',
      '/me/work',
    ),
  );

export const useMyTimesheet = (date: string) =>
  useQuery(q<TimesheetItem>('my-timesheet', '/me/timesheet', { date }));
export const useTimesheets = (query: Query, enabled = true) =>
  useQuery(q<TimesheetItem[]>('timesheets', '/timesheets', query, enabled));
export const useTimeReport = (query: Query, enabled: boolean) =>
  useQuery(q<TimeReportItem>('report', '/reports/time', query, enabled));

export const useTaxRates = () => useQuery(q<TaxRateItem[]>('tax-rates', '/billing/tax-rates'));
export const useBillingSettings = () =>
  useQuery(q<BillingSettingsItem>('billing-settings', '/billing/settings'));
export const useInvoices = (query: Query) =>
  useQuery(q<InvoiceItem[]>('invoices', '/invoices', query));
export const useInvoice = (id: string) =>
  useQuery(q<InvoiceDetails>('invoice', `/invoices/${id}`, undefined, !!id));

export const usePortal = () => useQuery(q<PortalSummary>('portal', '/portal'));
export const usePortalItems = (projectId: string) =>
  useQuery(
    q<PortalWorkItem[]>(
      'portal-items',
      `/portal/projects/${projectId}/items`,
      undefined,
      !!projectId,
    ),
  );
export const usePortalItem = (id: string) =>
  useQuery(q<PortalWorkItemDetails>('portal-item', `/portal/items/${id}`, undefined, !!id));
export const usePortalInvoice = (id: string) =>
  useQuery(q<InvoiceDetails>('portal-invoice', `/portal/invoices/${id}`, undefined, !!id));

export const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
export const VARIANT: Record<
  string,
  'neutral' | 'warning' | 'success' | 'destructive' | 'info' | 'primary'
> = {
  PLANNED: 'neutral',
  ACTIVE: 'info',
  ON_HOLD: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  TODO: 'neutral',
  IN_PROGRESS: 'warning',
  DONE: 'success',
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  ISSUED: 'info',
  PAID: 'success',
  VOID: 'neutral',
  INACTIVE: 'neutral',
  HIGHEST: 'destructive',
  HIGH: 'warning',
  MEDIUM: 'neutral',
  LOW: 'neutral',
  LOWEST: 'neutral',
  BLOCKER: 'destructive',
  CRITICAL: 'destructive',
  MAJOR: 'warning',
  MINOR: 'neutral',
};

/** Monday of the week containing `date` (local calendar). */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const todayLocal = () => {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Runs a mutation, refreshes project data and keeps the last error for display. */
export function useAct() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: PROJECTS });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return { error, setError, run };
}
