import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Account,
  type Api,
  api,
  login,
  OTHER_PASSWORD,
  registerAccount,
  startApp,
  tokenFromLink,
  uniqueEmail,
  waitForEmail,
} from './helpers.js';

let app: NestExpressApplication;
let client: Api;

beforeAll(async () => {
  app = await startApp();
  client = api(app);
});

afterAll(async () => {
  await app.close();
});

async function roleId(owner: Account, key: string): Promise<string> {
  const roles = await client.get('/roles', owner.accessToken);
  const role = (roles.body.data as { id: string; key: string }[]).find((r) => r.key === key);
  if (!role) throw new Error(`role ${key} missing`);
  return role.id;
}

/** Invites a brand-new person with the given role and accepts the e-mailed invitation. */
async function inviteNewMember(owner: Account, roleKey: string) {
  const email = uniqueEmail(roleKey);
  const invite = await client.post(
    '/invitations',
    { email, roleIds: [await roleId(owner, roleKey)] },
    owner.accessToken,
  );
  expect(invite.status, JSON.stringify(invite.body)).toBe(201);
  const mail = await waitForEmail(email);
  const token = tokenFromLink(mail.text, '/accept-invitation');

  const preview = await client.get(`/invitations/preview?token=${encodeURIComponent(token)}`);
  expect(preview.body.data).toMatchObject({ email, accountExists: false });

  const accepted = await client.post('/invitations/accept', {
    token,
    fullName: 'New Member',
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  const accessToken = accepted.body.data.accessToken as string;
  const me = await client.get('/auth/me', accessToken);
  return {
    email,
    token,
    accessToken,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

describe('role-based access control', () => {
  it('lets an invited employee in with employee permissions only', async () => {
    const owner = await registerAccount(client);
    const employee = await inviteNewMember(owner, 'employee');

    const me = await client.get('/auth/me', employee.accessToken);
    expect(me.body.data.activeOrganization.organizationId).toBe(owner.organizationId);
    expect(me.body.data.permissions).toEqual(['organization.settings.read']);
    expect(me.body.data.user.emailVerified).toBe(true);

    expect((await client.get('/organizations/current', employee.accessToken)).status).toBe(200);
    expect(
      (await client.patch('/organizations/current', { name: 'Hacked' }, employee.accessToken))
        .status,
    ).toBe(403);
    expect((await client.get('/members', employee.accessToken)).status).toBe(403);
    expect((await client.get('/audit-logs', employee.accessToken)).status).toBe(403);
    expect(
      (
        await client.post(
          '/roles',
          { key: 'x_role', name: 'X', permissions: [] },
          employee.accessToken,
        )
      ).status,
    ).toBe(403);
  });

  it('invitation links are single use', async () => {
    const owner = await registerAccount(client);
    const employee = await inviteNewMember(owner, 'employee');
    const again = await client.post('/invitations/accept', {
      token: employee.token,
      fullName: 'Again',
      password: OTHER_PASSWORD,
    });
    expect(again.status).toBe(400);
  });

  it('applies role changes immediately (permission cache invalidation)', async () => {
    const owner = await registerAccount(client);
    const employee = await inviteNewMember(owner, 'employee');
    expect((await client.get('/members', employee.accessToken)).status).toBe(403);

    const custom = await client.post(
      '/roles',
      { key: 'directory_viewer', name: 'Directory viewer', permissions: ['users.member.read'] },
      owner.accessToken,
    );
    expect(custom.status).toBe(201);
    const set = await client.put(
      `/members/${employee.membershipId}/roles`,
      { roleIds: [await roleId(owner, 'employee'), custom.body.data.id] },
      owner.accessToken,
    );
    expect(set.status).toBe(200);
    expect((await client.get('/members', employee.accessToken)).status).toBe(200);
  });

  it('suspension blocks access at once; reactivation restores it', async () => {
    const owner = await registerAccount(client);
    const employee = await inviteNewMember(owner, 'employee');
    expect(
      (
        await client.patch(
          `/members/${employee.membershipId}`,
          { status: 'SUSPENDED' },
          owner.accessToken,
        )
      ).status,
    ).toBe(200);
    const blocked = await client.get('/organizations/current', employee.accessToken);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/no longer a member/);
    expect(
      (
        await client.patch(
          `/members/${employee.membershipId}`,
          { status: 'ACTIVE' },
          owner.accessToken,
        )
      ).status,
    ).toBe(200);
    expect((await client.get('/organizations/current', employee.accessToken)).status).toBe(200);
  });

  it('HR admins can invite but cannot grant the owner role', async () => {
    const owner = await registerAccount(client);
    const hr = await inviteNewMember(owner, 'hr_admin');
    const asEmployee = await client.post(
      '/invitations',
      { email: uniqueEmail('e'), roleIds: [await roleId(owner, 'employee')] },
      hr.accessToken,
    );
    expect(asEmployee.status).toBe(201);
    const asOwner = await client.post(
      '/invitations',
      { email: uniqueEmail('o'), roleIds: [await roleId(owner, 'owner')] },
      hr.accessToken,
    );
    expect(asOwner.status).toBe(403);
  });
});

describe('owner protections', () => {
  it('keeps at least one active owner', async () => {
    const owner = await registerAccount(client);
    const demote = await client.put(
      `/members/${owner.membershipId}/roles`,
      { roleIds: [await roleId(owner, 'admin')] },
      owner.accessToken,
    );
    expect(demote.status).toBe(409);
    expect((await client.delete(`/members/${owner.membershipId}`, owner.accessToken)).status).toBe(
      400,
    );
    expect(
      (
        await client.patch(
          `/members/${owner.membershipId}`,
          { status: 'SUSPENDED' },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
  });

  it('system roles are immutable; assigned roles cannot be deleted', async () => {
    const owner = await registerAccount(client);
    const ownerRole = await roleId(owner, 'owner');
    expect(
      (await client.patch(`/roles/${ownerRole}`, { name: 'Boss' }, owner.accessToken)).status,
    ).toBe(403);
    expect((await client.delete(`/roles/${ownerRole}`, owner.accessToken)).status).toBe(403);

    const custom = await client.post(
      '/roles',
      { key: 'auditor', name: 'Auditor', permissions: ['audit.log.read'] },
      owner.accessToken,
    );
    const employee = await inviteNewMember(owner, 'employee');
    await client.put(
      `/members/${employee.membershipId}/roles`,
      { roleIds: [custom.body.data.id] },
      owner.accessToken,
    );
    expect((await client.delete(`/roles/${custom.body.data.id}`, owner.accessToken)).status).toBe(
      409,
    );
    expect(
      (
        await client.post(
          '/roles',
          { key: 'auditor', name: 'Dup', permissions: [] },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await client.post(
          '/roles',
          { key: 'bad', name: 'Bad', permissions: ['payroll.run.delete'] },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
  });
});

describe('invitations for existing accounts', () => {
  it('requires signing in as the invited e-mail, then adds the organization', async () => {
    const ownerA = await registerAccount(client, 'Alpha');
    const ownerB = await registerAccount(client, 'Beta');
    await client.post(
      '/invitations',
      { email: ownerB.email, roleIds: [await roleId(ownerA, 'manager')] },
      ownerA.accessToken,
    );
    const token = tokenFromLink((await waitForEmail(ownerB.email)).text, '/accept-invitation');

    expect(
      (await client.get(`/invitations/preview?token=${encodeURIComponent(token)}`)).body.data
        .accountExists,
    ).toBe(true);
    expect((await client.post('/invitations/accept', { token })).status).toBe(401);
    // Signed in as someone else: still refused.
    expect((await client.post('/invitations/accept', { token }, ownerA.accessToken)).status).toBe(
      401,
    );

    const accepted = await client.post('/invitations/accept', { token }, ownerB.accessToken);
    expect(accepted.status).toBe(200);
    const me = await client.get('/auth/me', ownerB.accessToken);
    expect(me.body.data.memberships).toHaveLength(2);

    const switched = await client.post(
      '/auth/switch-organization',
      { organizationId: ownerA.organizationId },
      ownerB.accessToken,
    );
    expect(switched.status).toBe(200);
    const meA = await client.get('/auth/me', switched.body.data.accessToken);
    expect(meA.body.data.activeOrganization.organizationId).toBe(ownerA.organizationId);
    expect(meA.body.data.permissions).toEqual(['organization.settings.read', 'users.member.read']);
  });

  it('rejects inviting an existing member or a duplicate pending invitation', async () => {
    const owner = await registerAccount(client);
    const employee = await roleId(owner, 'employee');
    expect(
      (
        await client.post(
          '/invitations',
          { email: owner.email, roleIds: [employee] },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    const email = uniqueEmail('dup');
    expect(
      (await client.post('/invitations', { email, roleIds: [employee] }, owner.accessToken)).status,
    ).toBe(201);
    expect(
      (await client.post('/invitations', { email, roleIds: [employee] }, owner.accessToken)).status,
    ).toBe(409);
  });
});

describe('organization settings and audit', () => {
  it('updates settings with validation and records a field-level audit entry', async () => {
    const owner = await registerAccount(client);
    expect(
      (
        await client.patch(
          '/organizations/current',
          { defaultTimezone: 'Mars/Base' },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
    const ok = await client.patch(
      '/organizations/current',
      { legalName: 'Acme Private Limited', defaultCurrency: 'usd' },
      owner.accessToken,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      legalName: 'Acme Private Limited',
      defaultCurrency: 'USD',
    });

    const audit = await client.get('/audit-logs?action=organization.updated', owner.accessToken);
    expect(audit.body.data[0]).toMatchObject({
      action: 'organization.updated',
      actorName: 'Olivia Owner',
      changes: { defaultCurrency: { from: 'INR', to: 'USD' } },
    });
  });

  it('lets a user create a second organization and become its owner', async () => {
    const owner = await registerAccount(client);
    const created = await client.post(
      '/organizations',
      { name: 'Second Company' },
      owner.accessToken,
    );
    expect(created.status).toBe(201);
    const me = await client.get('/auth/me', created.body.data.accessToken);
    expect(me.body.data.memberships).toHaveLength(2);
    expect(me.body.data.activeOrganization.organizationName).toBe('Second Company');
    expect((await login(client, owner.email, owner.password)).status).toBe(200);
  });

  it('paginates and searches members on the server', async () => {
    const owner = await registerAccount(client);
    await inviteNewMember(owner, 'employee');
    await inviteNewMember(owner, 'manager');
    const page = await client.get(
      '/members?page=1&pageSize=2&sortBy=email&sortDir=asc',
      owner.accessToken,
    );
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta.pagination).toMatchObject({ total: 3, totalPages: 2 });
    const search = await client.get('/members?search=olivia', owner.accessToken);
    expect(search.body.data).toHaveLength(1);
    expect((await client.get('/members?sortBy=password', owner.accessToken)).status).toBe(400);
  });
});
