import type { SessionInfo } from '@hrm/shared-types';
import { create } from 'zustand';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  /** Access token is kept in memory only; the refresh token lives in the OS keystore. */
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
