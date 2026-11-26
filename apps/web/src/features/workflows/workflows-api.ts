import type {
  ApprovalInstanceItem,
  ApprovalTaskItem,
  DelegationItem,
  DocumentTemplateItem,
  GeneratedDocumentItem,
  LibraryDocumentItem,
  WorkflowDefinitionItem,
  WorkflowProcessValue,
} from '@hrm/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';

export const WF = ['workflows'] as const;
type Query = Record<string, string | number | boolean | undefined>;
const q = <T>(key: string, path: string, query?: Query, enabled = true) => ({
  queryKey: [...WF, key, path, query ?? {}],
  queryFn: () => api.get<T>(path, query ? { query } : undefined),
  enabled,
});

export const useInbox = () => useQuery(q<ApprovalTaskItem[]>('inbox', '/me/approval-tasks'));
export const useDefinitions = () =>
  useQuery(q<WorkflowDefinitionItem[]>('definitions', '/workflows'));
export const useDelegations = () =>
  useQuery(
    q<{ given: DelegationItem[]; received: DelegationItem[] }>('delegations', '/me/delegations'),
  );
export const useHistory = (process: WorkflowProcessValue, subjectId: string) =>
  useQuery(
    q<ApprovalInstanceItem[]>('history', '/approvals/history', { process, subjectId }, !!subjectId),
  );
export const useTemplates = (enabled = true) =>
  useQuery(q<DocumentTemplateItem[]>('templates', '/documents/templates', undefined, enabled));
export const useDocuments = (query: Query = {}) =>
  useQuery(q<GeneratedDocumentItem[]>('documents', '/documents', query));
export const useLibrary = () => useQuery(q<LibraryDocumentItem[]>('library', '/library'));

export const PROCESS_LABEL: Record<WorkflowProcessValue, string> = {
  LEAVE_REQUEST: 'Leave requests',
  EXPENSE_CLAIM: 'Expense claims (manager stage)',
  TRAVEL_REQUEST: 'Travel requests',
  TIMESHEET: 'Timesheets',
  RESIGNATION: 'Resignations',
};
export const MEASURE_LABEL: Record<WorkflowProcessValue, string> = {
  LEAVE_REQUEST: 'days',
  EXPENSE_CLAIM: 'claimed amount',
  TRAVEL_REQUEST: 'estimated cost',
  TIMESHEET: 'hours',
  RESIGNATION: 'waived notice days',
};
export const CATEGORY_LABEL: Record<string, string> = {
  OFFER_LETTER: 'Offer letter',
  APPOINTMENT_LETTER: 'Appointment letter',
  EXPERIENCE_LETTER: 'Experience letter',
  RELIEVING_LETTER: 'Relieving letter',
  SALARY_CERTIFICATE: 'Salary certificate',
  POLICY: 'Policy',
  OTHER: 'Other',
};
export const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/** Runs a mutation, refreshes workflow/document data and keeps the last error for display. */
export function useAct() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: WF });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return { error, setError, run };
}
