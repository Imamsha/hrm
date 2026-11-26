import type {
  ArticleItem,
  ComplianceDashboardItem,
  ComplianceTaskItem,
  ExitAnalyticsItem,
  ExitQuestionItem,
  ExpiryItem,
  HelpdeskCategoryItem,
  ObligationItem,
  ResignationItem,
  SeparationCaseDetails,
  SeparationCaseItem,
  TicketDetails,
  TicketItem,
} from '@hrm/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';

export const OPS = ['operations'] as const;
type Query = Record<string, string | number | boolean | undefined>;
const q = <T>(key: string, path: string, query?: Query, enabled = true) => ({
  queryKey: [...OPS, key, path, query ?? {}],
  queryFn: () => api.get<T>(path, query ? { query } : undefined),
  enabled,
});

export const useCategories = () =>
  useQuery(q<HelpdeskCategoryItem[]>('categories', '/helpdesk/categories'));
export const useTickets = (query: Query) =>
  useQuery(q<TicketItem[]>('tickets', '/helpdesk/tickets', query));
export const useTicket = (id: string) =>
  useQuery(q<TicketDetails>('ticket', `/helpdesk/tickets/${id}`, undefined, !!id));
export const useArticles = (search?: string) =>
  useQuery(q<ArticleItem[]>('articles', '/helpdesk/articles', search ? { search } : undefined));

export const useSeparationSettings = (enabled: boolean) =>
  useQuery(
    q<{
      noticeDays: number | null;
      clearanceTemplate: {
        title: string;
        ownerRoleKey: string | null;
        ownerEmployeeId: string | null;
      }[];
      exitQuestions: ExitQuestionItem[];
    }>('separation-settings', '/separation/settings', undefined, enabled),
  );
export const useResignations = (scope: 'mine' | 'approvals' | 'all', enabled = true) =>
  useQuery(q<ResignationItem[]>('resignations', '/separation/resignations', { scope }, enabled));
export const useCases = (status?: string) =>
  useQuery(q<SeparationCaseItem[]>('cases', '/separation/cases', status ? { status } : undefined));
export const useCase = (id: string) =>
  useQuery(q<SeparationCaseDetails>('case', `/separation/cases/${id}`, undefined, !!id));
export const useInterview = (id: string, enabled: boolean) =>
  useQuery(
    q<{ questions: ExitQuestionItem[]; answers: Record<string, unknown> | null }>(
      'interview',
      `/separation/cases/${id}/interview`,
      undefined,
      enabled && !!id,
    ),
  );
export const useExitAnalytics = (from: string, to: string, enabled: boolean) =>
  useQuery(q<ExitAnalyticsItem>('exit-analytics', '/separation/analytics', { from, to }, enabled));

export const useObligations = (enabled: boolean) =>
  useQuery(q<ObligationItem[]>('obligations', '/compliance/obligations', undefined, enabled));
export const useComplianceTasks = (scope: 'mine' | 'all', enabled = true) =>
  useQuery(q<ComplianceTaskItem[]>('compliance-tasks', '/compliance/tasks', { scope }, enabled));
export const useExpiring = (days: number, enabled: boolean) =>
  useQuery(q<ExpiryItem[]>('expiring', '/compliance/expiring', { days }, enabled));
export const useComplianceDashboard = (enabled: boolean) =>
  useQuery(
    q<ComplianceDashboardItem>('compliance-dashboard', '/compliance/dashboard', undefined, enabled),
  );

export const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
export const VARIANT: Record<
  string,
  'neutral' | 'warning' | 'success' | 'destructive' | 'info' | 'primary'
> = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  WAITING_ON_REQUESTER: 'neutral',
  RESOLVED: 'success',
  CLOSED: 'neutral',
  LOW: 'neutral',
  MEDIUM: 'neutral',
  HIGH: 'warning',
  URGENT: 'destructive',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'neutral',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  CLEARED: 'success',
  WAIVED: 'neutral',
  OVERDUE: 'destructive',
  DUE_SOON: 'warning',
  LATER: 'neutral',
  DONE: 'success',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  DRAFT: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
};

/** Runs a mutation, refreshes operations data and keeps the last error for display. */
export function useAct() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: OPS });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return { error, setError, run };
}
