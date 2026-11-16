import type { Permission, SessionInfo } from '@hrm/shared-types';
import { create } from 'zustand';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  /** Access token lives in memory only (never localStorage); the refresh token is an httpOnly cookie. */
  accessToken: string | null;
  session: SessionInfo | null;
  setAccessToken: (token: string | null) => void;
  setSession: (session: SessionInfo) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
  status: 'loading',
  accessToken: null,
  session: null,
  setAccessToken: (accessToken) => {
    set({ accessToken });
  },
  setSession: (session) => {
    set({ session, status: 'authenticated' });
  },
  clear: () => {
    set({ accessToken: null, session: null, status: 'anonymous' });
  },
}));

export function hasPermission(session: SessionInfo | null, permission: Permission): boolean {
  return session?.permissions.includes(permission) ?? false;
}

/** Re-renders when the active organization's permissions change. */
export function usePermission(permission: Permission): boolean {
  return useAuth((s) => hasPermission(s.session, permission));
}
