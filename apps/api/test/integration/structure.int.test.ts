import type { NestExpressApplication } from '@nestjs/platform-express';
import { SYSTEM_ROLES } from '@hrm/shared-types';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { AccessService } from '../../src/modules/access/access.service.js';
import { testEnv } from './env.js';
import {
  type Account,
  type Api,
  api,
  OTHER_PASSWORD,
  registerAccount,
  startApp,
  tokenFromLink,
  uniqueEmail,
  waitForEmail,
} from './helpers.js';

let app: NestExpressApplication;
let client: Api;
let owner: Account;

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Structure');
});

afterAll(async () => {
  await app.close();
});

async function create(
  path: string,
  body: object,
  token = owner.accessToken,
): Promise<{ id: string }> {
  const res = await client.post(path, body, token);
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.data as { id: string };
}

async function inviteMember(
  roleKey: string,
): Promise<{ accessToken: string; membershipId: string }> {
  const roles = await client.get('/roles', owner.accessToken);
  const roleId = (roles.body.data as { id: string; key: string }[]).find(
    (r) => r.key === roleKey,
  )?.id;
  const email = uniqueEmail(roleKey);
  await client.post('/invitations', { email, roleIds: [roleId] }, owner.accessToken);
  const token = tokenFromLink((await waitForEmail(email)).text, '/accept-invitation');
  const accepted = await client.post('/invitations/accept', {
    token,
    fullName: 'Structure Member',
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  return {
    accessToken: accepted.body.data.accessToken as string,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

describe('companies, legal entities, locations and branches', () => {
  it('runs the full lifecycle with validation and audit', async () => {
    const company = await create('/companies', { code: 'acme-in', name: 'Acme India' });
    const fetched = await client.get(`/companies/${company.id}`, owner.accessToken);
    expect(fetched.body.data).toMatchObject({
      code: 'ACME-IN',
      countryCode: 'IN',
      status: 'ACTIVE',
    });

    const dup = await client.post(
      '/companies',
      { code: 'ACME-IN', name: 'Dup' },
      owner.accessToken,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error.details[0].path).toBe('code');

    const hq = await create('/locations', {
      code: 'BLR-HQ',
      name: 'Bengaluru HQ',
      addressLine1: '1 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      latitude: '12.975',
      longitude: '77.6',
    });
    const loc = await client.get(`/locations/${hq.id}`, owner.accessToken);
    expect(loc.body.data).toMatchObject({ latitude: '12.975000', longitude: '77.600000' });

    // GSTIN must embed the PAN; Indian identifiers only for Indian entities.
    expect(
      (
        await client.post(
          '/legal-entities',
          {
            companyId: company.id,
            code: 'LE-X',
            legalName: 'X',
            pan: 'AAACR1234K',
            gstin: '29BBBCR1234K1Z5',
          },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(
          '/legal-entities',
          {
            companyId: company.id,
            code: 'LE-US',
            legalName: 'Acme US',
            countryCode: 'US',
            pan: 'AAACR1234K',
          },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
    const le = await create('/legal-entities', {
      companyId: company.id,
      code: 'LE-IN',
      legalName: 'Acme India Private Limited',
      pan: 'AAACR1234K',
      gstin: '29AAACR1234K1Z5',
      registeredLocationId: hq.id,
    });

    const branch = await create('/branches', {
      companyId: company.id,
      code: 'BLR',
      name: 'Bengaluru',
      legalEntityId: le.id,
      locationId: hq.id,
    });
    const b = await client.get(`/branches/${branch.id}`, owner.accessToken);
    expect(b.body.data).toMatchObject({ legalEntity: { id: le.id }, location: { id: hq.id } });

    // A legal entity of another company cannot be attached to this company's branch.
    const other = await create('/companies', { code: 'OTHER', name: 'Other Co' });
    const otherLe = await create('/legal-entities', {
      companyId: other.id,
      code: 'LE-O',
      legalName: 'Other Pvt Ltd',
    });
    const wrong = await client.patch(
      `/branches/${branch.id}`,
      { legalEntityId: otherLe.id },
      owner.accessToken,
    );
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('legalEntityId');

    // In-use records cannot be deleted, but can be archived.
    expect((await client.delete(`/companies/${company.id}`, owner.accessToken)).status).toBe(409);
    const archived = await client.patch(
      `/companies/${company.id}`,
      { status: 'INACTIVE' },
      owner.accessToken,
    );
    expect(archived.body.data.status).toBe('INACTIVE');
    const activeOnly = await client.get('/companies?status=ACTIVE', owner.accessToken);
    expect(activeOnly.body.data.map((c: { id: string }) => c.id)).not.toContain(company.id);

    // Unused records can be deleted.
    expect((await client.delete(`/legal-entities/${otherLe.id}`, owner.accessToken)).status).toBe(
      204,
    );

    const audit = await client.get('/audit-logs?search=company', owner.accessToken);
    const actions = (audit.body.data as { action: string }[]).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['company.created', 'company.updated']));
  });
});

describe('departments, teams and cost centers', () => {
  it('builds a department tree and rejects cycles and cross-company parents', async () => {
    const co = await create('/companies', { code: 'TREE', name: 'Tree Co' });
    const co2 = await create('/companies', { code: 'TREE2', name: 'Tree Co 2' });
    const cc = await create('/cost-centers', {
      code: 'CC-ENG',
      name: 'Engineering',
      companyId: co.id,
    });
    const eng = await create('/departments', {
      companyId: co.id,
      code: 'ENG',
      name: 'Engineering',
      costCenterId: cc.id,
    });
    const platform = await create('/departments', {
      companyId: co.id,
      code: 'PLAT',
      name: 'Platform',
      parentId: eng.id,
    });
    const sre = await create('/departments', {
      companyId: co.id,
      code: 'SRE',
      name: 'SRE',
      parentId: platform.id,
    });
    await create('/teams', { departmentId: sre.id, code: 'ONCALL', name: 'On-call' });

    const cycle = await client.patch(
      `/departments/${eng.id}`,
      { parentId: sre.id },
      owner.accessToken,
    );
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.details[0].path).toBe('parentId');
    const self = await client.patch(
      `/departments/${eng.id}`,
      { parentId: eng.id },
      owner.accessToken,
    );
    expect(self.status).toBe(400);
    const crossCompany = await client.post(
      '/departments',
      { companyId: co2.id, code: 'X', name: 'X', parentId: eng.id },
      owner.accessToken,
    );
    expect(crossCompany.status).toBe(400);

    const roots = await client.get(
      `/departments?companyId=${co.id}&parentId=root`,
      owner.accessToken,
    );
    expect(roots.body.data.map((d: { code: string }) => d.code)).toEqual(['ENG']);
    expect(roots.body.data[0].counts).toEqual({ children: 1, teams: 0 });

    const chart = await client.get('/org-chart', owner.accessToken);
    const node = (chart.body.data.companies as { id: string; departments: unknown[] }[]).find(
      (c) => c.id === co.id,
    );
    expect(node?.departments).toMatchObject([
      {
        code: 'ENG',
        children: [{ code: 'PLAT', children: [{ code: 'SRE', teams: [{ code: 'ONCALL' }] }] }],
      },
    ]);
  });

  it('enforces the cycle and same-company rules in the database too', async () => {
    const prisma = app.get(PrismaService);
    const co = await create('/companies', { code: 'DBTREE', name: 'DB Tree' });
    const a = await create('/departments', { companyId: co.id, code: 'DB-A', name: 'A' });
    const b = await create('/departments', {
      companyId: co.id,
      code: 'DB-B',
      name: 'B',
      parentId: a.id,
    });
    await expect(
      prisma.withTenant(
        (tx) => tx.department.update({ where: { id: a.id }, data: { parentId: b.id } }),
        {
          organizationId: owner.organizationId,
        },
      ),
    ).rejects.toThrow();
  });
});

describe('job catalog', () => {
  it('ranks grades uniquely and links designations', async () => {
    const g1 = await create('/job-grades', { code: 'G1', name: 'Associate', rank: 1 });
    await create('/job-grades', { code: 'G2', name: 'Senior', rank: 2 });
    const dupRank = await client.post(
      '/job-grades',
      { code: 'G9', name: 'Dup', rank: 2 },
      owner.accessToken,
    );
    expect(dupRank.status).toBe(409);
    expect(dupRank.body.error.details[0].path).toBe('rank');

    const d = await create('/designations', {
      code: 'SWE',
      name: 'Software Engineer',
      jobGradeId: g1.id,
    });
    const list = await client.get('/designations?sortBy=grade', owner.accessToken);
    expect(list.body.data.find((x: { id: string }) => x.id === d.id).jobGrade).toMatchObject({
      code: 'G1',
      rank: 1,
    });
    expect((await client.delete(`/job-grades/${g1.id}`, owner.accessToken)).status).toBe(409);
  });
});

describe('work weeks, holiday calendars and calendar resolution', () => {
  it('resolves working days from the default pattern and holidays', async () => {
    const week = await create('/work-weeks', {
      name: 'Mon–Sat, 2nd/4th Sat off',
      isDefault: true,
      rules: [1, 2, 3, 4, 5, 6]
        .map((weekday) => ({ weekday, dayType: 'FULL' }))
        .concat([
          { weekday: 6, occurrence: 2, dayType: 'OFF' } as never,
          { weekday: 6, occurrence: 4, dayType: 'OFF' } as never,
        ]),
    });
    const cal = await create('/holiday-calendars', { name: 'India 2026', isDefault: true });
    const added = await client.post(
      `/holiday-calendars/${cal.id}/holidays`,
      {
        holidays: [
          { date: '2026-11-10', name: 'Company Day', kind: 'PUBLIC' },
          { date: '2026-11-12', name: 'Regional festival', kind: 'OPTIONAL' },
        ],
      },
      owner.accessToken,
    );
    expect(added.status).toBe(201);
    const clash = await client.post(
      `/holiday-calendars/${cal.id}/holidays`,
      { holidays: [{ date: '2026-11-10', name: 'Again' }] },
      owner.accessToken,
    );
    expect(clash.status).toBe(409);

    const res = await client.get(
      '/calendar/resolve?from=2026-11-09&to=2026-11-15',
      owner.accessToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.workWeek.id).toBe(week.id);
    expect(res.body.data.days.map((d: { kind: string }) => d.kind)).toEqual([
      'WORKING',
      'HOLIDAY',
      'WORKING',
      'OPTIONAL_HOLIDAY',
      'WORKING',
      'WEEKLY_OFF',
      'WEEKLY_OFF',
    ]);
    expect(res.body.data.workingDays).toBe(4);

    // A branch with its own five-day week resolves differently.
    const fiveDay = await create('/work-weeks', {
      name: 'Mon–Fri',
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'FULL' })),
    });
    const co = await create('/companies', { code: 'CAL', name: 'Calendar Co' });
    const branch = await create('/branches', {
      companyId: co.id,
      code: 'CAL-1',
      name: 'Cal',
      workWeekId: fiveDay.id,
    });
    const branchRes = await client.get(
      `/calendar/resolve?branchId=${branch.id}&from=2026-11-21&to=2026-11-21`,
      owner.accessToken,
    );
    expect(branchRes.body.data.days[0].kind).toBe('WEEKLY_OFF'); // 3rd Saturday: off on Mon–Fri

    // Only one default per organization.
    const second = await create('/work-weeks', {
      name: 'Another default',
      isDefault: true,
      rules: [{ weekday: 1, dayType: 'FULL' }],
    });
    const weeks = await client.get('/work-weeks', owner.accessToken);
    const defaults = (weeks.body.data as { id: string; isDefault: boolean }[]).filter(
      (w) => w.isDefault,
    );
    expect(defaults.map((w) => w.id)).toEqual([second.id]);

    expect((await client.delete(`/work-weeks/${fiveDay.id}`, owner.accessToken)).status).toBe(409);
  });

  it('rejects invalid work-week patterns and over-long ranges', async () => {
    const invalid = await client.post(
      '/work-weeks',
      { name: 'Nothing', rules: [{ weekday: 6, occurrence: 2, dayType: 'FULL' }] },
      owner.accessToken,
    );
    expect(invalid.status).toBe(400);
    const tooLong = await client.get(
      '/calendar/resolve?from=2026-01-01&to=2027-12-31',
      owner.accessToken,
    );
    expect(tooLong.status).toBe(400);
  });
});

describe('permissions for structure endpoints', () => {
  it('lets employees read structure and calendars but not manage them', async () => {
    const employee = await inviteMember('employee');
    expect((await client.get('/companies', employee.accessToken)).status).toBe(200);
    expect((await client.get('/org-chart', employee.accessToken)).status).toBe(200);
    expect((await client.get('/holiday-calendars', employee.accessToken)).status).toBe(200);
    expect((await client.get('/job-grades', employee.accessToken)).status).toBe(403);
    expect(
      (await client.post('/companies', { code: 'NOPE', name: 'Nope' }, employee.accessToken))
        .status,
    ).toBe(403);
    expect(
      (await client.post('/holiday-calendars', { name: 'Nope' }, employee.accessToken)).status,
    ).toBe(403);
  });
});

describe('scoped role assignments (ABAC)', () => {
  it('grants a role for a department subtree and keeps the cache in sync', async () => {
    const co = await create('/companies', { code: 'ABAC', name: 'ABAC Co' });
    const eng = await create('/departments', {
      companyId: co.id,
      code: 'ABAC-ENG',
      name: 'Engineering',
    });
    const member = await inviteMember('employee');
    const roles = await client.get('/roles', owner.accessToken);
    const byKey = (k: string) =>
      (roles.body.data as { id: string; key: string }[]).find((r) => r.key === k)?.id;

    const assigned = await client.post(
      `/members/${member.membershipId}/role-assignments`,
      { roleId: byKey('manager'), scopeType: 'DEPARTMENT', scopeId: eng.id },
      owner.accessToken,
    );
    expect(assigned.status).toBe(201);
    expect(assigned.body.data).toMatchObject({ scopeType: 'DEPARTMENT', scope: { id: eng.id } });
    expect(
      (
        await client.post(
          `/members/${member.membershipId}/role-assignments`,
          { roleId: byKey('manager'), scopeType: 'DEPARTMENT', scopeId: eng.id },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await client.post(
          `/members/${member.membershipId}/role-assignments`,
          { roleId: byKey('owner'), scopeType: 'DEPARTMENT', scopeId: eng.id },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);

    // Scoped grants do not satisfy organization-wide endpoint permissions.
    expect((await client.get('/members', member.accessToken)).status).toBe(403);

    const access = app.get(AccessService);
    const before = await access.resolve(
      owner.organizationId,
      (await client.get('/auth/me', member.accessToken)).body.data.user.id,
    );
    const deptGrant = new Map(before?.grants)
      .get('users.member.read')
      ?.find((g) => g.scopeType === 'DEPARTMENT');
    expect(deptGrant?.coveredIds).toEqual([eng.id]);

    // A new sub-department is covered immediately (cache invalidated on tree changes).
    const sub = await create('/departments', {
      companyId: co.id,
      code: 'ABAC-SUB',
      name: 'Sub',
      parentId: eng.id,
    });
    const userId = (await client.get('/auth/me', member.accessToken)).body.data.user.id as string;
    const after = await access.resolve(owner.organizationId, userId);
    const grantAfter = new Map(after?.grants)
      .get('users.member.read')
      ?.find((g) => g.scopeType === 'DEPARTMENT');
    expect(grantAfter?.coveredIds?.sort()).toEqual([eng.id, sub.id].sort());

    // A department referenced by a scope cannot be deleted; removing the assignment frees it.
    expect((await client.delete(`/departments/${eng.id}`, owner.accessToken)).status).toBe(409);
    const list = await client.get(
      `/members/${member.membershipId}/role-assignments`,
      owner.accessToken,
    );
    const scoped = (list.body.data as { id: string; scopeType: string }[]).find(
      (a) => a.scopeType === 'DEPARTMENT',
    );
    expect(
      (
        await client.delete(
          `/members/${member.membershipId}/role-assignments/${scoped?.id ?? ''}`,
          owner.accessToken,
        )
      ).status,
    ).toBe(204);
  });
});

describe('cross-tenant isolation for structure', () => {
  it('never exposes or links another tenant’s structure', async () => {
    const other = await registerAccount(client, 'Other tenant');
    const theirs = await create(
      '/companies',
      { code: 'THEIRS', name: 'Theirs' },
      other.accessToken,
    );
    const theirLe = await create(
      '/legal-entities',
      { companyId: theirs.id, code: 'T-LE', legalName: 'Theirs Pvt Ltd' },
      other.accessToken,
    );

    expect((await client.get(`/companies/${theirs.id}`, owner.accessToken)).status).toBe(404);
    expect(
      (await client.patch(`/companies/${theirs.id}`, { name: 'x' }, owner.accessToken)).status,
    ).toBe(404);
    const viaApi = await client.post(
      '/branches',
      { companyId: theirs.id, code: 'X1', name: 'X' },
      owner.accessToken,
    );
    expect(viaApi.status).toBe(400);
    const list = await client.get('/companies?search=THEIRS', owner.accessToken);
    expect(list.body.data).toEqual([]);

    // Even bypassing the service checks, the database refuses a cross-tenant optional reference.
    const mine = await create('/companies', { code: 'MINE', name: 'Mine' });
    const prisma = app.get(PrismaService);
    await expect(
      prisma.withTenant(
        (tx) =>
          tx.branch.create({
            data: {
              organizationId: owner.organizationId,
              companyId: mine.id,
              code: 'SNEAKY',
              name: 'Sneaky',
              legalEntityId: theirLe.id,
            },
          }),
        { organizationId: owner.organizationId },
      ),
    ).rejects.toThrow(/same organization|legal entity/);

    // Scoped role assignments cannot target another tenant's structure.
    const roles = await client.get('/roles', owner.accessToken);
    const managerId = (roles.body.data as { id: string; key: string }[]).find(
      (r) => r.key === 'manager',
    )?.id;
    const scoped = await client.post(
      `/members/${owner.membershipId}/role-assignments`,
      { roleId: managerId, scopeType: 'COMPANY', scopeId: theirs.id },
      owner.accessToken,
    );
    expect(scoped.status).toBe(400);
  });
});

describe('permission catalog migration', () => {
  it('every organization’s system roles match SYSTEM_ROLES (registration and data migration)', async () => {
    const db = new pg.Client({ connectionString: testEnv.migrationDatabaseUrl });
    await db.connect();
    try {
      const { rows } = await db.query<{ organization_id: string; key: string; perms: string[] }>(
        `SELECT r.organization_id, r.key, coalesce(array_agg(rp.permission_key ORDER BY rp.permission_key)
                  FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS perms
           FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
          WHERE r.is_system GROUP BY r.organization_id, r.key`,
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const def = SYSTEM_ROLES.find((r) => r.key === row.key);
        expect(
          [...(def?.permissions ?? [])].sort(),
          `${row.key} in ${row.organization_id}`,
        ).toEqual(row.perms);
      }
    } finally {
      await db.end();
    }
  });
});
