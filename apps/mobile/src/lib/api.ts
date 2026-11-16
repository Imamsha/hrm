import { ApiClientError, createApiClient } from '@hrm/api-client';
import { QueryClient } from '@tanstack/react-query';
import { secureTokens } from './secure-storage';

/**
 * Android emulators reach the host machine at 10.0.2.2; physical devices need the host's LAN IP.
 * Configure via EXPO_PUBLIC_API_BASE_URL.
 */
const configuredBaseUrl: unknown = process.env.EXPO_PUBLIC_API_BASE_URL;
export const apiBaseUrl: string =
  typeof configuredBaseUrl === 'string' && configuredBaseUrl.length > 0
    ? configuredBaseUrl
    : 'http://localhost:3100/api/v1';

export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => secureTokens.getAccessToken(),
});

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) =>
          !(error instanceof ApiClientError && error.status >= 400 && error.status < 500) &&
          count < 2,
      },
    },
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.isNetworkError)
    return `Cannot reach the API at ${apiBaseUrl}.`;
  return error instanceof Error ? error.message : 'Unexpected error';
}
