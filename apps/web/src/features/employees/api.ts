import type {
  BankAccountItem,
  EmployeeDetails,
  EmployeeDocumentItem,
  EmployeeListItem,
  EmployeeSettingsItem,
  EmploymentRecordItem,
  PaginatedResult,
  StatutoryIdsItem,
} from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-store';
import { env } from '@/lib/env';

export type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * Where a profile's data lives: HR paths (`/employees/:id`) or self-service (`/me/employee`).
 * Every profile section takes this base, so one UI serves both.
 */
export interface ProfileBase {
  base: string;
  self: boolean;
}

export const hrBase = (id: string): ProfileBase => ({ base: `/employees/${id}`, self: false });
export const SELF_BASE: ProfileBase = { base: '/me/employee', self: true };

export const employeeKeys = {
  all: ['employees'] as const,
  base: (b: string) => ['employees', b] as const,
};

export function useEmployeesPage(query: QueryParams) {
  return useQuery<PaginatedResult<EmployeeListItem>>({
    queryKey: ['employees', 'directory', query],
    queryFn: ({ signal }) => api.getPage<EmployeeListItem>('/employees', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useEmployee(p: ProfileBase) {
  return useQuery({
    queryKey: [...employeeKeys.base(p.base), 'profile'],
    queryFn: () => api.get<EmployeeDetails>(p.base),
  });
}

export function useEmploymentHistory(p: ProfileBase) {
  return useQuery({
    queryKey: [...employeeKeys.base(p.base), 'history'],
    queryFn: () => api.get<EmploymentRecordItem[]>(`${p.base}/employment-history`),
  });
}

export function useCollection<T>(p: ProfileBase, collection: string, enabled = true) {
  return useQuery({
    queryKey: [...employeeKeys.base(p.base), collection],
    queryFn: () => api.get<T[]>(`${p.base}/${collection}`),
    enabled,
  });
}

export function useBankAccounts(p: ProfileBase, enabled = true) {
  return useQuery({
    queryKey: [...employeeKeys.base(p.base), 'bank-accounts'],
    queryFn: () => api.get<BankAccountItem[]>(`${p.base}/bank-accounts`),
    enabled,
  });
}

export function useStatutoryIds(p: ProfileBase, enabled = true) {
  return useQuery({
    queryKey: [...employeeKeys.base(p.base), 'statutory-ids'],
    queryFn: () => api.get<StatutoryIdsItem>(`${p.base}/statutory-ids`),
    enabled,
  });
}

export function useDocuments(p: ProfileBase, enabled = true) {
  return useQuery({
    queryKey: [...employeeKeys.base(p.base), 'documents'],
    queryFn: () => api.get<EmployeeDocumentItem[]>(`${p.base}/documents`),
    enabled,
  });
}

export function useReports(p: ProfileBase) {
  const path = p.self ? `${p.base}/team` : `${p.base}/direct-reports`;
  return useQuery({
    queryKey: [...employeeKeys.base(p.base), 'reports'],
    queryFn: () => api.get<EmployeeListItem[]>(path),
  });
}

export function useEmployeeSettings(enabled: boolean) {
  return useQuery({
    queryKey: ['employees', 'settings'],
    queryFn: () => api.get<EmployeeSettingsItem>('/employees/settings'),
    enabled,
  });
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useAuth.getState().accessToken;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${env.apiBaseUrl}${path}`, { ...init, credentials: 'include', headers });
  if (!res.ok) {
    let message = `Request failed (${String(res.status)})`;
    try {
      const body = (await res.json()) as {
        error?: { message?: string; details?: { path: string; message: string }[] };
      };
      message = body.error?.details?.[0]?.message ?? body.error?.message ?? message;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  return res;
}

/** Uploads a document (multipart; the shared JSON client does not handle files). */
export async function uploadDocument(
  base: string,
  file: File,
  fields: { category: string; title: string },
): Promise<EmployeeDocumentItem> {
  const form = new FormData();
  form.append('category', fields.category);
  form.append('title', fields.title);
  form.append('file', file);
  const res = await authorizedFetch(`${base}/documents`, { method: 'POST', body: form });
  return ((await res.json()) as { data: EmployeeDocumentItem }).data;
}

/** Downloads a document through the authorized API stream and saves it in the browser. */
export async function downloadDocument(base: string, doc: EmployeeDocumentItem): Promise<void> {
  const res = await authorizedFetch(`${base}/documents/${doc.id}/download`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
