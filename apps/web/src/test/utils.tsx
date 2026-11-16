import type { Permission, SessionInfo } from '@hrm/shared-types';
import { TooltipProvider } from '@hrm/ui-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { routes } from '@/app/router';
import { useAuth } from '@/features/auth/auth-store';

export const meta = { requestId: 'req-1', timestamp: '2026-11-16T00:00:00.000Z' };

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const ok = (data: unknown, extraMeta: Record<string, unknown> = {}) =>
  json({ success: true, data, meta: { ...meta, ...extraMeta } });

export const fail = (status: number, code: string, message: string, details?: unknown[]) =>
  json({ success: false, error: { code, message, ...(details ? { details } : {}) }, meta }, status);

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Stubs the network boundary only; the real API client, query layer and UI run unchanged.
 * Returns the recorded calls for assertions.
 */
export function stubFetch(handler: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const call = { method: init?.method ?? 'GET', url, body };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

export function sessionFixture(permissions: Permission[] = []): SessionInfo {
  const active = {
    membershipId: 'm-1',
    organizationId: 'o-1',
    organizationName: 'Acme India',
    organizationSlug: 'acme-india',
    roles: [{ id: 'r-1', key: 'owner', name: 'Owner' }],
  };
  return {
    user: {
      id: 'u-1',
      email: 'asha@acme.test',
      fullName: 'Asha Rao',
      mfaEnabled: false,
      emailVerified: true,
    },
    sessionId: 's-1',
    activeOrganization: active,
    memberships: [
      active,
      {
        ...active,
        membershipId: 'm-2',
        organizationId: 'o-2',
        organizationName: 'Beta Labs',
        roles: [],
      },
    ],
    permissions,
  };
}

export function signInAs(permissions: Permission[] = []): void {
  useAuth.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    session: sessionFixture(permissions),
  });
}

export function signOutForTest(): void {
  useAuth.setState({ status: 'anonymous', accessToken: null, session: null });
}

export function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}
