import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from './auth-store';
import { LoginScreen } from './login-screen';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const meta = { requestId: 'r', timestamp: '2026-11-16T00:00:00.000Z' };
const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, meta }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const session = {
  user: {
    id: 'u',
    email: 'asha@acme.test',
    fullName: 'Asha Rao',
    mfaEnabled: true,
    emailVerified: true,
  },
  sessionId: 's',
  activeOrganization: null,
  memberships: [],
  permissions: [],
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  useAuth.setState({ status: 'loading', accessToken: null, session: null });
});

test('signs in with MFA and stores only the refresh token in the keystore', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = input instanceof Request ? input.url : input;
    if (url.endsWith('/auth/login'))
      return Promise.resolve(ok({ mfaRequired: true, mfaToken: 'mfa' }));
    if (url.endsWith('/auth/mfa/verify'))
      return Promise.resolve(ok({ accessToken: 'at', expiresIn: 900, refreshToken: 'rt-secret' }));
    return Promise.resolve(ok(session));
  });
  await render(<LoginScreen />, { wrapper });

  await fireEvent.changeText(screen.getByLabelText('Email'), 'Asha@Acme.test');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByText('Two-factor verification')).toBeOnTheScreen();
  const loginBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
    string,
    string
  >;
  expect(loginBody).toEqual({
    email: 'asha@acme.test',
    password: 'correct horse battery',
    tokenTransport: 'body',
  });

  await fireEvent.changeText(screen.getByLabelText('Authentication code'), '123456');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));

  await waitFor(() => {
    expect(useAuth.getState().status).toBe('authenticated');
  });
  expect(useAuth.getState().accessToken).toBe('at');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'hrm.auth.refreshToken',
    'rt-secret',
    expect.anything(),
  );
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

test('validates input before calling the API', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  await render(<LoginScreen />, { wrapper });
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Enter your e-mail and password')).toBeOnTheScreen();
  expect(fetchMock).not.toHaveBeenCalled();
});
