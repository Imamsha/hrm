import { ApiClientError, createApiClient } from '@hrm/api-client';
import type { AuthTokens } from '@hrm/shared-types';
import { QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-store';
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

let refreshInFlight: Promise<boolean> | null = null;

/** Rotates the keystore refresh token; concurrent callers share one request (rotation is single-use). */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = await secureTokens.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const tokens = await api.post<AuthTokens>(
        '/auth/refresh',
        { refreshToken, tokenTransport: 'body' },
        { skipAuthRefresh: true },
      );
      await storeTokens(tokens);
      return true;
    } catch (err) {
      // Only a definitive rejection ends the session; network errors keep the stored token.
      if (err instanceof ApiClientError && err.status === 401) {
        await secureTokens.clear();
        useAuth.getState().clear();
      }
      return false;
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function storeTokens(tokens: AuthTokens): Promise<void> {
  useAuth.getState().setAccessToken(tokens.accessToken);
  if (tokens.refreshToken) await secureTokens.setRefreshToken(tokens.refreshToken);
}

export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => useAuth.getState().accessToken,
  onUnauthorized: () => refreshAccessToken(),
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
