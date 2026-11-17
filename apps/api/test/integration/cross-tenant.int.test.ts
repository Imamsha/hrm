import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ALL_PERMISSIONS } from '@hrm/shared-types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { testEnv } from './env.js';
import {
  type Account,
  type Api,
  api,
  registerAccount,
  startApp,
  systemRolePermissions,
} from './helpers.js';

let app: NestExpressApplication;
let client: Api;
let a: Account;
let b: Account;
let bEmployeeRoleId: string;

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  a = await registerAccount(client, 'Tenant A');
  b = await registerAccount(client, 'Tenant B');
  const roles = await client.get('/roles', b.accessToken);
  bEmployeeRoleId =
    (roles.body.data as { id: string; key: string }[]).find((r) => r.key === 'employee')?.id ?? '';
});

afterAll(async () => {
  await app.close();
});

describe('cross-tenant access through the API is always denied', () => {
  it('lists only the caller’s own members, roles and audit entries', async () => {
    const members = await client.get('/members', a.accessToken);
    expect(members.body.data.map((m: { userId: string }) => m.userId)).toEqual([a.userId]);
    const roles = await client.get('/roles', a.accessToken);
    expect(roles.body.data.map((r: { id: string }) => r.id)).not.toContain(bEmployeeRoleId);
  });

  it('treats another tenant’s ids as non-existent', async () => {
    expect(
      (await client.patch(`/members/${b.membershipId}`, { status: 'SUSPENDED' }, a.accessToken))
        .status,
    ).toBe(404);
    expect((await client.delete(`/members/${b.membershipId}`, a.accessToken)).status).toBe(404);
    expect(
      (await client.patch(`/roles/${bEmployeeRoleId}`, { name: 'x' }, a.accessToken)).status,
    ).toBe(404);
    // Assigning a foreign role to one's own member fails validation.
    expect(
      (
        await client.put(
          `/members/${a.membershipId}/roles`,
          { roleIds: [bEmployeeRoleId] },
          a.accessToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/invitations',
          { email: 'x@example.test', roleIds: [bEmployeeRoleId] },
          a.accessToken,
        )
      ).status,
    ).toBe(400);
  });

  it('cannot switch into an organization without membership', async () => {
    const res = await client.post(
      '/auth/switch-organization',
      { organizationId: b.organizationId },
      a.accessToken,
    );
    expect(res.status).toBe(403);
  });

  it('ignores client-supplied tenant headers and body fields', async () => {
    const res = await client
      .get('/members', a.accessToken)
      .set('X-Organization-Id', b.organizationId)
      .set('X-Tenant-Id', b.organizationId);
    expect(res.body.data.map((m: { userId: string }) => m.userId)).toEqual([a.userId]);
    const org = await client.patch(
      '/organizations/current',
      { name: 'Renamed A', organizationId: b.organizationId },
      a.accessToken,
    );
    expect(org.status).toBe(200);
    const bOrg = await client.get('/organizations/current', b.accessToken);
    expect(bOrg.body.data.name).not.toBe('Renamed A');
  });
});

describe('row-level security on access-control tables', () => {
  let prisma: PrismaService;
  beforeAll(() => {
    prisma = app.get(PrismaService);
  });

  it('exposes nothing without context', async () => {
    expect(await prisma.membership.count()).toBe(0);
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.invitation.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('user context shows only the user’s own memberships and organizations', async () => {
    const rows = await prisma.withUser(a.userId, async (tx) => ({
      memberships: await tx.membership.findMany({ select: { organizationId: true } }),
      orgs: await tx.organization.findMany({ select: { id: true } }),
      roles: await tx.role.count(),
    }));
    expect(rows.memberships).toEqual([{ organizationId: a.organizationId }]);
    expect(rows.orgs).toEqual([{ id: a.organizationId }]);
    expect(rows.roles).toBe(0);
  });

  it('tenant context never includes the user’s memberships in other organizations', async () => {
    // b joins a's organization, so b now has memberships in two tenants.
    const roles = await client.get('/roles', a.accessToken);
    const employee = (roles.body.data as { id: string; key: string }[]).find(
      (r) => r.key === 'employee',
    );
    const pgOwner = new pg.Client({ connectionString: testEnv.migrationDatabaseUrl });
    await pgOwner.connect();
    try {
      const membershipId = randomUUID();
      await pgOwner.query(
        `INSERT INTO memberships (id, organization_id, user_id, updated_at) VALUES ($1, $2, $3, now())`,
        [membershipId, a.organizationId, b.userId],
      );
      await pgOwner.query(
        `INSERT INTO membership_roles (id, organization_id, membership_id, role_id) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), a.organizationId, membershipId, employee?.id],
      );
    } finally {
      await pgOwner.end();
    }
    const inA = await prisma.withTenant(
      (tx) => tx.membership.findMany({ where: { userId: b.userId } }),
      {
        organizationId: a.organizationId,
        userId: b.userId,
      },
    );
    expect(inA.map((m) => m.organizationId)).toEqual([a.organizationId]);
    const members = await client.get('/members', a.accessToken);
    expect(members.body.data).toHaveLength(2);
    // Effective permissions in A come from the A membership only.
    const switched = await client.post(
      '/auth/switch-organization',
      { organizationId: a.organizationId },
      b.accessToken,
    );
    const me = await client.get('/auth/me', switched.body.data.accessToken);
    expect(me.body.data.permissions).toEqual(systemRolePermissions('employee'));
  });

  it('blocks writing access rows into another tenant', async () => {
    await expect(
      prisma.withTenant(
        (tx) =>
          tx.role.create({ data: { organizationId: b.organizationId, key: 'evil', name: 'Evil' } }),
        { organizationId: a.organizationId },
      ),
    ).rejects.toThrow();
    await expect(
      prisma.withTenant(
        (tx) =>
          tx.membershipRole.create({
            data: {
              organizationId: a.organizationId,
              membershipId: a.membershipId,
              roleId: bEmployeeRoleId,
            },
          }),
        { organizationId: a.organizationId },
      ),
    ).rejects.toThrow(); // composite FK (organization_id, role_id) has no match
  });

  it('the invitation token lookup reveals no tenant for unknown tokens', async () => {
    const rows = await prisma.$queryRaw<
      { org: string | null }[]
    >`SELECT app.invitation_tenant(${'0'.repeat(64)}) AS org`;
    expect(rows[0]?.org).toBeNull();
  });

  it('catalog tables are read-only and auth_events is append-only for the runtime role', async () => {
    await expect(
      prisma.permission.create({ data: { key: 'x.y.z', module: 'x', description: 'x' } }),
    ).rejects.toThrow();
    await expect(prisma.authEvent.deleteMany({})).rejects.toThrow();
  });

  it('the seeded permission catalog matches @hrm/shared-types', async () => {
    const owner = new pg.Client({ connectionString: testEnv.migrationDatabaseUrl });
    await owner.connect();
    try {
      const { rows } = await owner.query<{ key: string }>(
        'SELECT key FROM permissions ORDER BY key',
      );
      expect(rows.map((r) => r.key)).toEqual([...ALL_PERMISSIONS].sort());
    } finally {
      await owner.end();
    }
  });

  it('organization registration cannot create a tenant other than its own context', async () => {
    await expect(
      prisma.withTenant(
        (tx) =>
          tx.organization.create({
            data: { id: randomUUID(), slug: `x-${randomUUID().slice(0, 6)}`, name: 'X' },
          }),
        { organizationId: a.organizationId },
      ),
    ).rejects.toThrow();
  });
});
