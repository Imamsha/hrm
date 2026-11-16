import { ApiClientError, createApiClient } from '@hrm/api-client';
import type { AuthTokens } from '@hrm/shared-types';
import { QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-store';
import { env } from './env';

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers share one
 * request: refresh tokens rotate, so parallel refreshes would trip reuse detection.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= api
    .post<AuthTokens>('/auth/refresh', {}, { skipAuthRefresh: true })
    .then((tokens) => {
      useAuth.getState().setAccessToken(tokens.accessToken);
      return true;
    })
    .catch(() => {
      useAuth.getState().clear();
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Single API client for the web app. */
export const api = createApiClient({
  baseUrl: env.apiBaseUrl,
  credentials: 'include',
  getAccessToken: () => useAuth.getState().accessToken,
  onUnauthorized: () =>
    useAuth.getState().status === 'authenticated' ? refreshAccessToken() : Promise.resolve(false),
});

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Do not retry client errors (4xx); retry network/5xx twice.
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500)
            return false;
          return failureCount < 2;
        },
      },
    },
  });
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.isNetworkError
      ? `Cannot reach the API at ${env.apiBaseUrl}. ${error.message}.`
      : error.message;
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}
