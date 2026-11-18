import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MyProfileScreen } from './my-profile-screen';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const meta = { requestId: 'r', timestamp: '2026-11-18T00:00:00.000Z' };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('shows the linked employee profile', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          id: 'e-1',
          employeeNumber: 'EMP-0001',
          displayName: 'Asha Rao',
          dateOfJoining: '2025-01-06',
          workEmail: 'asha@acme.test',
          workPhone: null,
          job: {
            company: { id: 'c', code: 'ACME', name: 'Acme India' },
            department: { id: 'd', code: 'ENG', name: 'Engineering' },
            designation: null,
            manager: null,
          },
          personal: null,
        },
        meta,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  await render(<MyProfileScreen />, { wrapper });
  expect(await screen.findByText('Asha Rao')).toBeOnTheScreen();
  expect(screen.getByText('Engineering')).toBeOnTheScreen();
});

test('explains when no employee record is linked', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
        meta,
      }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ),
  );
  await render(<MyProfileScreen />, { wrapper });
  expect(await screen.findByText('No employee record')).toBeOnTheScreen();
});
