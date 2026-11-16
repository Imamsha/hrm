import type { MemberListItem, RoleDetails } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, sessionFixture, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const member = (i: number, overrides: Partial<MemberListItem> = {}): MemberListItem => ({
  membershipId: `m-${String(i)}`,
  userId: `u-${String(i)}`,
  email: `person${String(i)}@acme.test`,
  fullName: `Person ${String(i)}`,
  status: 'ACTIVE',
  mfaEnabled: false,
  lastLoginAt: null,
  joinedAt: '2026-11-01T00:00:00.000Z',
  roles: [{ id: '0195f1d2-0000-7000-8000-00000000e001', key: 'employee', name: 'Employee' }],
  ...overrides,
});

const roles: RoleDetails[] = [
  {
    id: '0195f1d2-0000-7000-8000-00000000a001',
    key: 'owner',
    name: 'Owner',
    description: null,
    isSystem: true,
    permissions: [],
    memberCount: 1,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: '0195f1d2-0000-7000-8000-00000000e001',
    key: 'employee',
    name: 'Employee',
    description: 'Self-service access.',
    isSystem: true,
    permissions: [],
    memberCount: 3,
    createdAt: '',
    updatedAt: '',
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('navigation and page permissions', () => {
  it('hides administration screens the user cannot use', async () => {
    signInAs(['organization.settings.read']);
    stubFetch(() => ok(null));
    renderAt('/admin/members');
    expect(await screen.findByText('You don’t have access to this page')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Members' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Organization' })).toBeInTheDocument();
  });
});

describe('members page', () => {
  it('loads a server page and sends search/sort/pagination to the API', async () => {
    signInAs([
      'users.member.read',
      'users.member.invite',
      'users.member.update',
      'users.member.remove',
    ]);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.includes('/members')) {
        return ok([member(1), member(2, { status: 'SUSPENDED' })], {
          pagination: { page: 1, pageSize: 25, total: 60, totalPages: 3 },
        });
      }
      if (c.url.endsWith('/roles')) return ok(roles);
      if (c.url.endsWith('/invitations')) return ok([]);
      return ok(null);
    });
    renderAt('/admin/members');

    const table = await screen.findByRole('table', { name: 'Members' });
    expect(await within(table).findByText('Person 1')).toBeInTheDocument();
    expect(within(table).getByText('Suspended')).toBeInTheDocument();
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search members' }), 'asha');
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('search=asha'))).toBe(true);
    });
    const last = new URL(calls.filter((c) => c.url.includes('/members')).at(-1)?.url ?? '');
    expect(Object.fromEntries(last.searchParams)).toMatchObject({
      page: '1',
      pageSize: '25',
      sortBy: 'fullName',
      sortDir: 'asc',
      search: 'asha',
    });
  });

  it('invites a member with explicitly chosen roles', async () => {
    signInAs(['users.member.read', 'users.member.invite']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.method === 'POST' && c.url.endsWith('/invitations')) return ok({ id: 'i-1' });
      if (c.url.includes('/members'))
        return ok([], { pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
      if (c.url.endsWith('/roles')) return ok(roles);
      if (c.url.endsWith('/invitations')) return ok([]);
      return ok(null);
    });
    renderAt('/admin/members');
    await user.click(await screen.findByRole('button', { name: /Invite member/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Email/), 'new.hire@acme.test');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('Select at least one role')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: /Employee/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/invitations'))?.body).toEqual({
      email: 'new.hire@acme.test',
      roleIds: ['0195f1d2-0000-7000-8000-00000000e001'],
    });
  });

  it('offers only permitted row actions and never on the current user', async () => {
    signInAs(['users.member.read']);
    stubFetch((c) => {
      if (c.url.includes('/members')) {
        return ok([member(1, { membershipId: 'm-1' }), member(2)], {
          pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
        });
      }
      if (c.url.endsWith('/roles')) return ok(roles);
      return ok([]);
    });
    renderAt('/admin/members');
    expect(await screen.findByText('(you)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invite member/ })).not.toBeInTheDocument();
  });
});

describe('organization switcher', () => {
  it('switches the active organization through the API', async () => {
    signInAs(['organization.settings.read']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.endsWith('/auth/switch-organization'))
        return ok({ accessToken: 'at-o2', expiresIn: 900 });
      if (c.url.endsWith('/auth/me')) return ok(sessionFixture());
      return ok({ status: 'ok', version: '0', environment: 'test', uptimeSeconds: 1, checks: {} });
    });
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Switch organization' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Beta Labs' }));
    await waitFor(() => {
      expect(calls.find((c) => c.url.endsWith('/auth/switch-organization'))?.body).toEqual({
        organizationId: 'o-2',
      });
    });
  });
});
