import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AttendanceScreen } from './attendance-screen';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const meta = { requestId: 'r', timestamp: '2026-11-19T00:00:00.000Z' };
const today = (over: object = {}) => ({
  day: {
    date: '2026-11-19',
    status: 'PENDING',
    shift: { code: 'GEN', name: 'General' },
    scheduledStart: null,
    scheduledEnd: null,
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
  },
  punches: [],
  nextDirection: 'IN',
  timeZone: 'Asia/Kolkata',
  allowed: { web: true, mobile: true, qr: true, geolocationRequired: false },
  ...over,
});
const json = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, meta }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

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

test('clocks in from the phone', async () => {
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) =>
      Promise.resolve(
        init?.method === 'POST' ? json(today({ nextDirection: 'OUT' })) : json(today()),
      ),
    );
  await render(<AttendanceScreen />, { wrapper });
  await fireEvent.press(await screen.findByRole('button', { name: 'Clock in' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeOnTheScreen();
  });
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(post?.[1]?.body as string)).toEqual({ source: 'MOBILE' });
});

test('explains when location is required', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      json(today({ allowed: { web: true, mobile: true, qr: true, geolocationRequired: true } })),
    );
  await render(<AttendanceScreen />, { wrapper });
  expect(await screen.findByText(/requires your location/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Clock in' })).toBeNull();
});
