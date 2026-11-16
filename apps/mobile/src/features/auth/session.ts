import type { AuthTokens, LoginResult, SessionInfo } from '@hrm/shared-types';
import { api, refreshAccessToken, storeTokens } from '@/lib/api';
import { secureTokens } from '@/lib/secure-storage';
import { useAuth } from './auth-store';

export async function loadSession(): Promise<SessionInfo> {
  const session = await api.get<SessionInfo>('/auth/me');
  useAuth.getState().setSession(session);
  return session;
}

/** App start: restore the session from the keystore refresh token, if any. */
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

/** Returns an MFA token when a second factor is required, otherwise completes sign-in. */
export async function signIn(
  email: string,
  password: string,
): Promise<{ mfaToken: string } | null> {
  const result = await api.post<LoginResult>(
    '/auth/login',
    { email, password, tokenTransport: 'body' },
    { skipAuthRefresh: true },
  );
  if (result.mfaRequired) return { mfaToken: result.mfaToken };
  await storeTokens(result);
  await loadSession();
  return null;
}

export async function verifyMfa(mfaToken: string, code: string): Promise<void> {
  const tokens = await api.post<AuthTokens>(
    '/auth/mfa/verify',
    { mfaToken, code, tokenTransport: 'body' },
    { skipAuthRefresh: true },
  );
  await storeTokens(tokens);
  await loadSession();
}

export async function signOut(): Promise<void> {
  try {
    await api.post('/auth/logout', {}, { skipAuthRefresh: true });
  } finally {
    await secureTokens.clear();
    useAuth.getState().clear();
  }
}
