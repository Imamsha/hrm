import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HealthScreen } from './health-screen';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const meta = { requestId: 'r', timestamp: '2026-11-16T00:00:00.000Z' };
const up = { status: 'up', latencyMs: 4 };

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

test('shows live dependency status from the API', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          status: 'degraded',
          version: '0.1.0',
          environment: 'test',
          uptimeSeconds: 5,
          checks: {
            database: up,
            redis: up,
            queue: up,
            storage: { status: 'down', latencyMs: 9, error: 'ECONNREFUSED' },
          },
        },
        meta,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  await render(<HealthScreen />, { wrapper });

  expect(await screen.findByText('Degraded')).toBeOnTheScreen();
  expect(screen.getByText('PostgreSQL')).toBeOnTheScreen();
  expect(screen.getAllByLabelText('Up')).toHaveLength(3);
  expect(screen.getByLabelText('Down')).toBeOnTheScreen();
});

test('shows an error with retry when the API is unreachable', async () => {
  jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
  await render(<HealthScreen />, { wrapper });

  expect(await screen.findByText('API unreachable')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
});
