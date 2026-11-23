import type {
  ApplicationDetails,
  ApplicationItem,
  ApplicationStageValue,
  CandidateItem,
  InterviewItem,
  OnboardingPlanItem,
  OnboardingTaskItem,
  OnboardingTemplateItem,
  OpeningItem,
  PaginatedResult,
  RequisitionItem,
} from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-store';
import { api } from '@/lib/api';
import { env } from '@/lib/env';

export type Params = Record<string, string | number | boolean | undefined>;
export const RECRUIT = ['recruit'] as const;

function usePage<T>(path: string, q: Params) {
  return useQuery<PaginatedResult<T>>({
    queryKey: [...RECRUIT, path, q],
    queryFn: () => api.getPage<T>(path, { query: q }),
    placeholderData: keepPreviousData,
  });
}

export const useRequisitions = (q: Params) =>
  usePage<RequisitionItem>('/recruitment/requisitions', q);
export const useOpenings = (q: Params) => usePage<OpeningItem>('/recruitment/openings', q);
export const useCandidates = (q: Params) => usePage<CandidateItem>('/recruitment/candidates', q);
export const useApplications = (q: Params) =>
  usePage<ApplicationItem>('/recruitment/applications', q);

export const useOpening = (id: string) =>
  useQuery({
    queryKey: [...RECRUIT, 'opening', id],
    queryFn: () => api.get<OpeningItem>(`/recruitment/openings/${id}`),
  });

export const useApplication = (id: string) =>
  useQuery({
    queryKey: [...RECRUIT, 'application', id],
    queryFn: () => api.get<ApplicationDetails>(`/recruitment/applications/${id}`),
  });

export const useMyInterviews = () =>
  useQuery({
    queryKey: [...RECRUIT, 'my-interviews'],
    queryFn: () => api.get<InterviewItem[]>('/me/interviews'),
  });

export const useTemplates = (enabled = true) =>
  useQuery({
    queryKey: [...RECRUIT, 'templates'],
    queryFn: () => api.get<OnboardingTemplateItem[]>('/onboarding/templates'),
    enabled,
  });

export const usePlans = (status?: string) =>
  useQuery({
    queryKey: [...RECRUIT, 'plans', status],
    queryFn: () => api.get<OnboardingPlanItem[]>('/onboarding/plans', { query: { status } }),
  });

export const useMyOnboarding = () =>
  useQuery({
    queryKey: [...RECRUIT, 'my-onboarding'],
    queryFn: () => api.get<OnboardingPlanItem | null>('/me/onboarding'),
  });

export const useMyOnboardingTasks = () =>
  useQuery({
    queryKey: [...RECRUIT, 'my-onboarding-tasks'],
    queryFn: () =>
      api.get<(OnboardingTaskItem & { planId: string; employee: string })[]>(
        '/me/onboarding/tasks',
      ),
  });

export const STAGES: ApplicationStageValue[] = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'HIRED',
];
export const STAGE_LABEL: Record<ApplicationStageValue, string> = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  ASSESSMENT: 'Assessment',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const STATUS_VARIANT: Record<
  string,
  'neutral' | 'warning' | 'success' | 'destructive' | 'info' | 'primary'
> = {
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'neutral',
  FILLED: 'primary',
  PUBLISHED: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'neutral',
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  WITHDRAWN: 'neutral',
  SCHEDULED: 'info',
  COMPLETED: 'success',
  NO_SHOW: 'destructive',
  IN_PROGRESS: 'info',
  PENDING: 'warning',
  DONE: 'success',
  SKIPPED: 'neutral',
};

export function formatMoney(amount: string | null, currency: string): string {
  if (!amount) return '—';
  const [whole = '0', fraction = ''] = amount.split('.');
  // Grouping without floating-point conversion (Indian grouping for INR).
  const grouped =
    currency === 'INR'
      ? whole.replace(/(\d)(?=(\d\d)+\d$)/g, '$1,')
      : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${grouped}${fraction && fraction !== '00' ? `.${fraction}` : ''}`;
}

/** Multipart upload / file download through the authorized API (the JSON client does not do files). */
export async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useAuth.getState().accessToken;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${env.apiBaseUrl}${path}`, { ...init, credentials: 'include', headers });
  if (!res.ok) {
    let message = `Request failed (${String(res.status)})`;
    try {
      const body = (await res.json()) as {
        error?: { message?: string; details?: { message: string }[] };
      };
      message = body.error?.details?.[0]?.message ?? body.error?.message ?? message;
    } catch {
      // non-JSON body
    }
    throw new Error(message);
  }
  return res;
}

export async function saveDownload(path: string, fileName: string): Promise<void> {
  const blob = await (await authorizedFetch(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
