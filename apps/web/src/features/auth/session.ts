import type { AuthTokens, SessionInfo } from '@hrm/shared-types';
import type { QueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken } from '@/lib/api';
import { useAuth } from './auth-store';

export async function loadSession(): Promise<SessionInfo> {
  const session = await api.get<SessionInfo>('/auth/me');
  useAuth.getState().setSession(session);
  return session;
}

/** On page load: restore the session from the refresh cookie, if any. */
export async function bootstrapSession(): Promise<void> {
  if (await refreshAccessToken()) {
    try {
      await loadSession();
      return;
    } catch {
      /* fall through */
    }
  }
  useAuth.getState().clear();
}

export async function establishSession(tokens: AuthTokens): Promise<SessionInfo> {
  useAuth.getState().setAccessToken(tokens.accessToken);
  return loadSession();
}

export async function signOut(queryClient: QueryClient, everywhere = false): Promise<void> {
  try {
    await api.post(everywhere ? '/auth/logout-all' : '/auth/logout', {}, { skipAuthRefresh: true });
  } finally {
    useAuth.getState().clear();
    queryClient.clear();
  }
}

/** Switches the active organization; every cached query belongs to the previous tenant. */
export async function switchOrganization(
  queryClient: QueryClient,
  organizationId: string,
): Promise<void> {
  const tokens = await api.post<AuthTokens>('/auth/switch-organization', { organizationId });
  queryClient.clear();
  await establishSession(tokens);
}
