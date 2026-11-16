import type { HealthReport } from '@hrm/shared-types';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json as jsonRaw, meta, renderAt, signInAs, stubFetch as stubCalls } from '@/test/utils';
import { formatUptime } from './use-health';

function report(overrides: Partial<HealthReport['checks']> = {}): HealthReport {
  const up = { status: 'up' as const, latencyMs: 3 };
  const checks = { database: up, redis: up, storage: up, queue: up, ...overrides };
  return {
    status: Object.values(checks).every((c) => c.status === 'up') ? 'ok' : 'degraded',
    version: '0.1.0',
    environment: 'test',
    uptimeSeconds: 3725,
    checks,
  };
}

const json = jsonRaw;
const stubFetch = (handler: (url: string) => Response) => stubCalls((c) => handler(c.url));

beforeEach(() => {
  signInAs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('System status page', () => {
  it('renders every dependency from the health report', async () => {
    stubFetch((url) =>
      url.endsWith('/health/live')
        ? json({ success: true, data: { status: 'ok', uptimeSeconds: 1 }, meta })
        : json({ success: true, data: report(), meta }),
    );
    renderAt('/system/status');

    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Dependency health' });
    for (const name of ['PostgreSQL', 'Redis', 'Job queue', 'Object storage']) {
      expect(within(table).getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText('1h 2m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'System status' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('highlights degraded dependencies', async () => {
    stubFetch(() =>
      json({
        success: true,
        data: report({ storage: { status: 'down', latencyMs: 9, error: 'ECONNREFUSED' } }),
        meta,
      }),
    );
    renderAt('/system/status');

    expect(await screen.findByText('1 of 4 dependencies down')).toBeInTheDocument();
    expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
  });

  it('shows an actionable error when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    renderAt('/system/status');

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Cannot reach the API/);
  });
});

describe('routing', () => {
  it('renders the not-found page inside the shell', async () => {
    stubFetch(() => json({ success: true, data: report(), meta }));
    renderAt('/does-not-exist');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});

describe('formatUptime', () => {
  it.each([
    [42, '42s'],
    [600, '10m'],
    [3725, '1h 2m'],
    [190_000, '2d 4h'],
  ])('%d -> %s', (s, expected) => {
    expect(formatUptime(s)).toBe(expected);
  });
});
