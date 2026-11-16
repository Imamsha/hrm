import { ApiClientError, createApiClient } from '@hrm/api-client';
import { QueryClient } from '@tanstack/react-query';
import { env } from './env';

/** Single API client for the web app. Authentication is attached in Phase 02. */
export const api = createApiClient({ baseUrl: env.apiBaseUrl });

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
