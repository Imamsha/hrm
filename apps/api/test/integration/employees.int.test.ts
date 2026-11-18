import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
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
let co: { id: string };
let co2: { id: string };
let eng: { id: string };
let platform: { id: string };
let sales: { id: string };
let blr: { id: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromToday = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Employees');
  co = await create('/companies', { code: 'ACME', name: 'Acme India' });
  co2 = await create('/companies', { code: 'BETA', name: 'Beta Co' });
  eng = await create('/departments', { companyId: co.id, code: 'ENG', name: 'Engineering' });
  platform = await create('/departments', {
    companyId: co.id,
    code: 'PLAT',
    name: 'Platform',
    parentId: eng.id,
  });
  sales = await create('/departments', { companyId: co.id, code: 'SALES', name: 'Sales' });
  blr = await create('/branches', { companyId: co.id, code: 'BLR', name: 'Bengaluru' });
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

async function hire(body: Record<string, unknown> = {}, token = owner.accessToken) {
  const res = await client.post(
    '/employees',
    {
      firstName: 'Asha',
      lastName: 'Rao',
      dateOfJoining: '2025-01-06',
      companyId: co.id,
      employmentType: 'FULL_TIME',
      departmentId: eng.id,
      ...body,
    },
    token,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; employeeNumber: string; [k: string]: unknown };
}

async function inviteMember(roleKey: string, email = uniqueEmail(roleKey)) {
  const roles = await client.get('/roles', owner.accessToken);
  const roleId = (roles.body.data as { id: string; key: string }[]).find(
    (r) => r.key === roleKey,
  )?.id;
  await client.post('/invitations', { email, roleIds: [roleId] }, owner.accessToken);
  const token = tokenFromLink((await waitForEmail(email)).text, '/accept-invitation');
  const accepted = await client.post('/invitations/accept', {
    token,
    fullName: 'Invited Person',
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  return {
    email,
    accessToken: accepted.body.data.accessToken as string,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

function migrator() {
  return new pg.Client({ connectionString: testEnv.migrationDatabaseUrl });
}

describe('joining and numbering', () => {
  it('generates numbers from settings, validates placement and rejects duplicates', async () => {
    const settings = await client.put(
      '/employees/settings',
      { numberPrefix: 'AC-', numberPadding: 3, nextNumber: 7 },
      owner.accessToken,
    );
    expect(settings.body.data.preview).toBe('AC-007');

    const a = await hire({ workEmail: 'asha@acme.test', probationEndDate: '2025-07-06' });
    expect(a).toMatchObject({
      employeeNumber: 'AC-007',
      status: 'ACTIVE',
      probationStatus: 'ON_PROBATION',
      job: { company: { id: co.id }, department: { id: eng.id }, employmentType: 'FULL_TIME' },
    });
    expect((await hire({ firstName: 'Ben' })).employeeNumber).toBe('AC-008');

    // A manual number that collides with the sequence is skipped by the generator.
    await hire({ firstName: 'Manual', employeeNumber: 'ac-009' });
    expect((await hire({ firstName: 'Next' })).employeeNumber).toBe('AC-010');

    const dupNumber = await client.post(
      '/employees',
      {
        firstName: 'X',
        dateOfJoining: '2025-01-01',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        employeeNumber: 'AC-007',
      },
      owner.accessToken,
    );
    expect(dupNumber.status).toBe(409);
    expect(dupNumber.body.error.details[0].path).toBe('employeeNumber');
    const dupEmail = await client.post(
      '/employees',
      {
        firstName: 'X',
        dateOfJoining: '2025-01-01',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        workEmail: 'ASHA@acme.test',
      },
      owner.accessToken,
    );
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.details[0].path).toBe('workEmail');

    // Placement must be consistent: department of another company, team of another department.
    const otherDept = await create('/departments', {
      companyId: co2.id,
      code: 'B-OPS',
      name: 'Ops',
    });
    const bad = await client.post(
      '/employees',
      {
        firstName: 'X',
        dateOfJoining: '2025-01-01',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        departmentId: otherDept.id,
      },
      owner.accessToken,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('departmentId');
    const team = await create('/teams', {
      departmentId: sales.id,
      code: 'S-IN',
      name: 'Inside sales',
    });
    const badTeam = await client.post(
      '/employees',
      {
        firstName: 'X',
        dateOfJoining: '2025-01-01',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        departmentId: eng.id,
        teamId: team.id,
      },
      owner.accessToken,
    );
    expect(badTeam.body.error.details[0].path).toBe('teamId');

    // The database enforces the same rule even if the service were bypassed.
    const prisma = app.get(PrismaService);
    await expect(
      prisma.withTenant(
        (tx) =>
          tx.employmentRecord.create({
            data: {
              organizationId: owner.organizationId,
              employeeId: a.id,
              effectiveFrom: new Date('2030-01-01'),
              changeType: 'TRANSFER',
              employmentType: 'FULL_TIME',
              companyId: co.id,
              departmentId: otherDept.id,
            },
          }),
        { organizationId: owner.organizationId },
      ),
    ).rejects.toThrow(/department must belong/);

    const invalid = await client.post(
      '/employees',
      {
        firstName: '',
        dateOfJoining: '2025-01-01',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        probationEndDate: '2024-12-01',
      },
      owner.accessToken,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['firstName', 'probationEndDate']),
    );
  });
});

describe('directory', () => {
  it('filters by department subtree, status and search, with server sort', async () => {
    const p1 = await hire({
      firstName: 'Priya',
      lastName: 'Platform',
      departmentId: platform.id,
      branchId: blr.id,
    });
    await hire({ firstName: 'Sam', lastName: 'Sales', departmentId: sales.id });

    const engTree = await client.get(
      `/employees?departmentId=${eng.id}&pageSize=200`,
      owner.accessToken,
    );
    const names = (engTree.body.data as { displayName: string }[]).map((e) => e.displayName);
    expect(names).toContain('Priya Platform');
    expect(names).not.toContain('Sam Sales');

    const byBranch = await client.get(`/employees?branchId=${blr.id}`, owner.accessToken);
    expect(byBranch.body.data.map((e: { id: string }) => e.id)).toEqual([p1.id]);

    const search = await client.get('/employees?search=priya', owner.accessToken);
    expect(search.body.data).toHaveLength(1);
    const sorted = await client.get(
      '/employees?sortBy=employeeNumber&sortDir=desc&pageSize=3',
      owner.accessToken,
    );
    const numbers = (sorted.body.data as { employeeNumber: string }[]).map((e) => e.employeeNumber);
    expect([...numbers].sort().reverse()).toEqual(numbers);
    expect((await client.get('/employees?sortBy=salary', owner.accessToken)).status).toBe(400);
  });
});

describe('job history and lifecycle', () => {
  it('records effective-dated changes and keeps history immutable', async () => {
    const mgr = await hire({ firstName: 'Meera', lastName: 'Manager' });
    const e = await hire({
      firstName: 'Ravi',
      lastName: 'Kumar',
      dateOfJoining: '2024-04-01',
      managerId: mgr.id,
    });

    const early = await client.post(
      `/employees/${e.id}/job-changes`,
      {
        effectiveFrom: '2024-03-01',
        changeType: 'TRANSFER',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        departmentId: sales.id,
      },
      owner.accessToken,
    );
    expect(early.status).toBe(400);
    expect(early.body.error.details[0].path).toBe('effectiveFrom');

    const transfer = await client.post(
      `/employees/${e.id}/job-changes`,
      {
        effectiveFrom: '2025-06-01',
        changeType: 'TRANSFER',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        departmentId: sales.id,
        managerId: mgr.id,
        remarks: 'Moved to sales',
      },
      owner.accessToken,
    );
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
    expect(transfer.body.data.job.department.id).toBe(sales.id);

    const history = await client.get(`/employees/${e.id}/employment-history`, owner.accessToken);
    expect(history.body.data).toMatchObject([
      {
        changeType: 'TRANSFER',
        effectiveFrom: '2025-06-01',
        effectiveTo: null,
        department: { id: sales.id },
      },
      {
        changeType: 'JOINING',
        effectiveFrom: '2024-04-01',
        effectiveTo: '2025-05-31',
        department: { id: eng.id },
      },
    ]);

    // A future-dated change may be scheduled once; a second waits for it to take effect.
    const future = daysFromToday(30);
    expect(
      (
        await client.post(
          `/employees/${e.id}/job-changes`,
          {
            effectiveFrom: future,
            changeType: 'PROMOTION',
            companyId: co.id,
            employmentType: 'FULL_TIME',
            departmentId: sales.id,
          },
          owner.accessToken,
        )
      ).status,
    ).toBe(201);
    const second = await client.post(
      `/employees/${e.id}/job-changes`,
      {
        effectiveFrom: daysFromToday(60),
        changeType: 'PROMOTION',
        companyId: co.id,
        employmentType: 'FULL_TIME',
      },
      owner.accessToken,
    );
    expect(second.status).toBe(409);
    // The current placement is still the transfer (the promotion has not started yet).
    const now = await client.get(`/employees/${e.id}`, owner.accessToken);
    expect(now.body.data.job.department.id).toBe(sales.id);

    // Circular reporting is rejected.
    const cycle = await client.post(
      `/employees/${mgr.id}/job-changes`,
      {
        effectiveFrom: daysFromToday(-1),
        changeType: 'MANAGER_CHANGE',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        managerId: e.id,
      },
      owner.accessToken,
    );
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.details[0].path).toBe('managerId');

    const reports = await client.get(`/employees/${mgr.id}/direct-reports`, owner.accessToken);
    expect(reports.body.data.map((r: { id: string }) => r.id)).toContain(e.id);

    // History is append-only in the database: no edits (other than closing) and no deletes.
    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.organization_id', $1, true)", [owner.organizationId]);
      await expect(
        db.query("UPDATE employment_records SET remarks = 'rewritten' WHERE employee_id = $1", [
          e.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await db.query('ROLLBACK');
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.organization_id', $1, true)", [owner.organizationId]);
      await expect(
        db.query('DELETE FROM employment_records WHERE employee_id = $1', [e.id]),
      ).rejects.toThrow();
      await db.query('ROLLBACK');
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.organization_id', $1, true)", [owner.organizationId]);
      await expect(db.query('DELETE FROM employees WHERE id = $1', [e.id])).rejects.toThrow(
        /permission denied/,
      );
      await db.query('ROLLBACK');
    } finally {
      await db.end();
    }

    // Overlapping periods are impossible (exclusion constraint).
    const m = migrator();
    await m.connect();
    try {
      await expect(
        m.query(
          `INSERT INTO employment_records (id, organization_id, employee_id, effective_from, change_type, employment_type, company_id)
           VALUES (gen_random_uuid(), $1, $2, '2025-07-01', 'TRANSFER', 'FULL_TIME', $3)`,
          [owner.organizationId, e.id, co.id],
        ),
      ).rejects.toThrow(/employment_records_no_overlap|one_open/);
    } finally {
      await m.end();
    }
  });

  it('confirms probation, separates, suspends access and rejoins', async () => {
    const member = await inviteMember('employee');
    const e = await hire({
      firstName: 'Lena',
      lastName: 'Leaver',
      dateOfJoining: '2024-01-15',
      probationEndDate: '2024-07-15',
      membershipId: member.membershipId,
    });
    expect((await client.get('/auth/me', member.accessToken)).status).toBe(200);

    const ext = await client.post(
      `/employees/${e.id}/probation-extension`,
      { probationEndDate: '2024-06-01' },
      owner.accessToken,
    );
    expect(ext.status).toBe(400);
    expect(
      (
        await client.post(
          `/employees/${e.id}/probation-extension`,
          { probationEndDate: '2024-09-15' },
          owner.accessToken,
        )
      ).body.data.probationEndDate,
    ).toBe('2024-09-15');
    const confirmed = await client.post(
      `/employees/${e.id}/confirmation`,
      { confirmationDate: '2024-09-16' },
      owner.accessToken,
    );
    expect(confirmed.body.data).toMatchObject({
      probationStatus: 'CONFIRMED',
      confirmationDate: '2024-09-16',
    });
    expect(
      (
        await client.post(
          `/employees/${e.id}/confirmation`,
          { confirmationDate: '2024-09-17' },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);

    // Notice with a future last day: cannot complete yet; can withdraw.
    const notice = await client.post(
      `/employees/${e.id}/separation`,
      {
        separationType: 'RESIGNATION',
        resignationDate: daysFromToday(0),
        lastWorkingDate: daysFromToday(30),
      },
      owner.accessToken,
    );
    expect(notice.body.data.status).toBe('ON_NOTICE');
    expect(
      (await client.post(`/employees/${e.id}/separation/complete`, {}, owner.accessToken)).status,
    ).toBe(409);
    expect(
      (await client.delete(`/employees/${e.id}/separation`, owner.accessToken)).body.data.status,
    ).toBe('ACTIVE');

    // Past last working day: completing closes the record and suspends the login.
    await client.post(
      `/employees/${e.id}/separation`,
      {
        separationType: 'RESIGNATION',
        resignationDate: daysFromToday(-40),
        lastWorkingDate: daysFromToday(-10),
        reason: 'Relocating',
      },
      owner.accessToken,
    );
    const done = await client.post(`/employees/${e.id}/separation/complete`, {}, owner.accessToken);
    expect(done.body.data).toMatchObject({
      status: 'SEPARATED',
      lastWorkingDate: daysFromToday(-10),
    });
    const history = await client.get(`/employees/${e.id}/employment-history`, owner.accessToken);
    expect(history.body.data[0].effectiveTo).toBe(daysFromToday(-10));
    expect((await client.get('/auth/me', member.accessToken)).status).toBe(403);

    // Separated employees cannot be transferred; they can rejoin after the last day.
    expect(
      (
        await client.post(
          `/employees/${e.id}/job-changes`,
          {
            effectiveFrom: daysFromToday(1),
            changeType: 'TRANSFER',
            companyId: co.id,
            employmentType: 'FULL_TIME',
          },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    const tooEarly = await client.post(
      `/employees/${e.id}/rejoin`,
      { dateOfJoining: daysFromToday(-20), companyId: co.id, employmentType: 'CONTRACT' },
      owner.accessToken,
    );
    expect(tooEarly.status).toBe(400);
    const rejoined = await client.post(
      `/employees/${e.id}/rejoin`,
      {
        dateOfJoining: daysFromToday(-1),
        companyId: co.id,
        employmentType: 'CONTRACT',
        departmentId: sales.id,
      },
      owner.accessToken,
    );
    expect(rejoined.body.data).toMatchObject({
      status: 'ACTIVE',
      probationStatus: 'NOT_APPLICABLE',
      lastWorkingDate: null,
      job: { employmentType: 'CONTRACT', department: { id: sales.id } },
    });
    const all = await client.get(`/employees/${e.id}/employment-history`, owner.accessToken);
    expect(all.body.data.map((r: { changeType: string }) => r.changeType)).toEqual([
      'REJOINING',
      'JOINING',
    ]);

    const audit = await client.get('/audit-logs?search=employee.&pageSize=200', owner.accessToken);
    const actions = (audit.body.data as { action: string }[]).map((x) => x.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'employee.joined',
        'employee.confirmed',
        'employee.separated',
        'employee.rejoined',
      ]),
    );
  });
});

describe('profile collections, bank and statutory data', () => {
  it('manages background records with validation and uniqueness', async () => {
    const e = await hire({ firstName: 'Kiran' });
    const base = `/employees/${e.id}`;
    const addr = await client.post(
      `${base}/addresses`,
      { type: 'CURRENT', line1: '1 MG Road', city: 'Bengaluru' },
      owner.accessToken,
    );
    expect(addr.status).toBe(201);
    expect(addr.body.data).toMatchObject({ type: 'CURRENT', countryCode: 'IN' });
    const dup = await client.post(
      `${base}/addresses`,
      { type: 'CURRENT', line1: 'x', city: 'y' },
      owner.accessToken,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error.details[0].path).toBe('type');

    const c1 = await client.post(
      `${base}/emergency-contacts`,
      { name: 'A', relationship: 'Spouse', phone: '+91 98450 00001', isPrimary: true },
      owner.accessToken,
    );
    await client.post(
      `${base}/emergency-contacts`,
      { name: 'B', relationship: 'Sibling', phone: '+91 98450 00002', isPrimary: true },
      owner.accessToken,
    );
    const contacts = await client.get(`${base}/emergency-contacts`, owner.accessToken);
    expect(
      contacts.body.data
        .filter((c: { isPrimary: boolean }) => c.isPrimary)
        .map((c: { name: string }) => c.name),
    ).toEqual(['B']);
    expect(contacts.body.data.find((c: { id: string }) => c.id === c1.body.data.id).isPrimary).toBe(
      false,
    );

    const exp = await client.post(
      `${base}/experience`,
      { employer: 'Old Co', jobTitle: 'Engineer', startDate: '2020-01-01', endDate: '2023-12-31' },
      owner.accessToken,
    );
    expect(exp.body.data).toMatchObject({ startDate: '2020-01-01', endDate: '2023-12-31' });
    // A partial update is validated against the merged record.
    const badMerge = await client.patch(
      `${base}/experience/${exp.body.data.id}`,
      { endDate: '2019-01-01' },
      owner.accessToken,
    );
    expect(badMerge.status).toBe(400);
    await client.post(
      `${base}/skills`,
      { name: 'TypeScript', level: 'EXPERT', years: 6 },
      owner.accessToken,
    );
    expect(
      (
        await client.post(
          `${base}/skills`,
          { name: 'typescript', level: 'BEGINNER' },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    expect((await client.get(`${base}/unknown-things`, owner.accessToken)).status).toBe(404);
    expect(
      (await client.delete(`${base}/experience/${exp.body.data.id}`, owner.accessToken)).status,
    ).toBe(204);
  });

  it('encrypts bank and statutory data, masks it and audits reveals', async () => {
    const e = await hire({ firstName: 'Bala' });
    const base = `/employees/${e.id}`;
    const acc = await client.post(
      `${base}/bank-accounts`,
      {
        accountHolderName: 'Bala K',
        bankName: 'HDFC Bank',
        ifsc: 'hdfc0001234',
        accountNumber: '50100012345678',
        accountType: 'SAVINGS',
      },
      owner.accessToken,
    );
    expect(acc.status).toBe(201);
    expect(acc.body.data).toMatchObject({
      ifsc: 'HDFC0001234',
      isPrimary: true,
      accountNumberMasked: '••••••••5678',
    });
    expect(JSON.stringify(acc.body)).not.toContain('50100012345678');
    const badIfsc = await client.post(
      `${base}/bank-accounts`,
      {
        accountHolderName: 'x',
        bankName: 'x',
        ifsc: 'HDFC1001234',
        accountNumber: '123456',
        accountType: 'SAVINGS',
      },
      owner.accessToken,
    );
    expect(badIfsc.body.error.details[0].path).toBe('ifsc');

    const reveal = await client.post(
      `${base}/bank-accounts/${acc.body.data.id}/reveal`,
      {},
      owner.accessToken,
    );
    expect(reveal.body.data.accountNumber).toBe('50100012345678');

    const stat = await client.put(
      `${base}/statutory-ids`,
      { pan: 'abcpe1234f', uan: '100200300400' },
      owner.accessToken,
    );
    expect(stat.body.data).toEqual({ panMasked: '••••••234F', uanMasked: '••••••••0400' });
    expect(
      (await client.put(`${base}/statutory-ids`, { uan: '12345' }, owner.accessToken)).status,
    ).toBe(400);
    expect(
      (await client.post(`${base}/statutory-ids/reveal`, {}, owner.accessToken)).body.data,
    ).toEqual({
      pan: 'ABCPE1234F',
      uan: '100200300400',
    });

    // At rest only ciphertext exists.
    const m = migrator();
    await m.connect();
    try {
      const { rows } = await m.query<{ n: string; p: string }>(
        `SELECT b.account_number_encrypted AS n, s.pan_encrypted AS p
           FROM employee_bank_accounts b JOIN employee_statutory_ids s ON s.employee_id = b.employee_id
          WHERE b.employee_id = $1`,
        [e.id],
      );
      expect(rows[0]?.n).toMatch(/^v1:/);
      expect(rows[0]?.n).not.toContain('5678');
      expect(rows[0]?.p).not.toContain('ABCPE');
    } finally {
      await m.end();
    }
    const audit = await client.get('/audit-logs?search=sensitive_revealed', owner.accessToken);
    expect(audit.body.data.length).toBeGreaterThanOrEqual(2);
  });
});

describe('documents', () => {
  it('uploads, sniffs content, streams downloads and deletes', async () => {
    const e = await hire({ firstName: 'Dev' });
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    const up = await request(server)
      .post(`/api/v1/employees/${e.id}/documents`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('category', 'IDENTITY')
      .field('title', 'PAN card')
      .attach('file', pdf, { filename: '../../evil/pan card.pdf', contentType: 'application/pdf' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.data).toMatchObject({
      title: 'PAN card',
      fileName: 'pan card.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
    });

    const fake = await request(server)
      .post(`/api/v1/employees/${e.id}/documents`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('category', 'OTHER')
      .field('title', 'Not a PDF')
      .attach('file', Buffer.from('MZ\x90\x00 executable'), {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      });
    expect(fake.status).toBe(400);
    expect(fake.body.error.details[0].path).toBe('file');

    const dl = await request(server)
      .get(`/api/v1/employees/${e.id}/documents/${up.body.data.id}/download`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toContain('attachment;');
    expect((dl.body as Buffer).equals(pdf)).toBe(true);

    const list = await client.get(`/employees/${e.id}/documents`, owner.accessToken);
    expect(list.body.data[0]).toMatchObject({ category: 'IDENTITY', uploadedBy: 'Olivia Owner' });
    expect(
      (await client.delete(`/employees/${e.id}/documents/${up.body.data.id}`, owner.accessToken))
        .status,
    ).toBe(204);
    expect((await client.get(`/employees/${e.id}/documents`, owner.accessToken)).body.data).toEqual(
      [],
    );
  });
});

describe('self-service and scoped (ABAC) access', () => {
  it('lets employees see and edit only their own profile', async () => {
    const member = await inviteMember('employee');
    const me = await hire({
      firstName: 'Self',
      lastName: 'Service',
      membershipId: member.membershipId,
    });
    const other = await hire({ firstName: 'Someone', lastName: 'Else' });

    const profile = await client.get('/me/employee', member.accessToken);
    expect(profile.body.data).toMatchObject({ id: me.id, access: { self: true, update: false } });
    expect(profile.body.data.personal).not.toBeNull();
    const patched = await client.patch(
      '/me/employee',
      { personalPhone: '+91 90000 00000', firstName: 'Hacker' },
      member.accessToken,
    );
    expect(patched.body.data).toMatchObject({
      firstName: 'Self',
      personal: { personalPhone: '+91 90000 00000' },
    });
    expect(
      (
        await client.post(
          '/me/employee/addresses',
          { type: 'PERMANENT', line1: 'Home', city: 'Mysuru' },
          member.accessToken,
        )
      ).status,
    ).toBe(201);
    expect((await client.get('/me/employee/addresses', member.accessToken)).body.data).toHaveLength(
      1,
    );
    expect((await client.get('/me/employee/bank-accounts', member.accessToken)).status).toBe(200);

    // No HR access: directory and other profiles are closed.
    expect((await client.get('/employees', member.accessToken)).status).toBe(403);
    expect((await client.get(`/employees/${other.id}`, member.accessToken)).status).toBe(403);

    // A member without an employee record gets a clear 404.
    const unlinked = await inviteMember('employee');
    expect((await client.get('/me/employee', unlinked.accessToken)).status).toBe(404);
  });

  it('limits a department-scoped manager to that department subtree', async () => {
    const member = await inviteMember('employee');
    const roles = await client.get('/roles', owner.accessToken);
    const hrId = (roles.body.data as { id: string; key: string }[]).find(
      (r) => r.key === 'hr_admin',
    )?.id;
    await client.post(
      `/members/${member.membershipId}/role-assignments`,
      { roleId: hrId, scopeType: 'DEPARTMENT', scopeId: eng.id },
      owner.accessToken,
    );
    const inPlatform = await hire({
      firstName: 'Scoped',
      lastName: 'Inside',
      departmentId: platform.id,
    });
    const inSales = await hire({
      firstName: 'Scoped',
      lastName: 'Outside',
      departmentId: sales.id,
    });

    const list = await client.get('/employees?search=Scoped', member.accessToken);
    expect(list.status).toBe(200);
    expect(list.body.data.map((e: { id: string }) => e.id)).toEqual([inPlatform.id]);
    expect((await client.get(`/employees/${inPlatform.id}`, member.accessToken)).status).toBe(200);
    expect((await client.get(`/employees/${inSales.id}`, member.accessToken)).status).toBe(404);
    expect(
      (await client.patch(`/employees/${inSales.id}`, { preferredName: 'x' }, member.accessToken))
        .status,
    ).toBe(404);
    expect(
      (
        await client.patch(
          `/employees/${inPlatform.id}`,
          { preferredName: 'Insider' },
          member.accessToken,
        )
      ).status,
    ).toBe(200);

    // Hiring is limited to the scope too.
    const outside = await client.post(
      '/employees',
      {
        firstName: 'X',
        dateOfJoining: '2025-01-01',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        departmentId: sales.id,
      },
      member.accessToken,
    );
    expect(outside.status).toBe(403);
    expect(
      (
        await hire(
          { firstName: 'Scoped', lastName: 'Hire', departmentId: eng.id },
          member.accessToken,
        )
      ).id,
    ).toBeDefined();
    // Organization-wide-only endpoints stay closed for scoped grants.
    expect(
      (
        await client.put(
          '/employees/settings',
          { numberPrefix: 'X', numberPadding: 2, nextNumber: 1 },
          member.accessToken,
        )
      ).status,
    ).toBe(403);
  });
});

describe('cross-tenant isolation for employees', () => {
  it('never exposes or links another tenant’s employees or structure', async () => {
    const other = await registerAccount(client, 'Other employees');
    const theirCo = await create(
      '/companies',
      { code: 'THEIRS', name: 'Theirs' },
      other.accessToken,
    );
    const theirs = await hire(
      { companyId: theirCo.id, departmentId: null, firstName: 'Foreign' },
      other.accessToken,
    );

    expect((await client.get(`/employees/${theirs.id}`, owner.accessToken)).status).toBe(404);
    expect(
      (await client.get(`/employees/${theirs.id}/bank-accounts`, owner.accessToken)).status,
    ).toBe(404);
    expect(
      (
        await client.post(
          `/employees/${theirs.id}/addresses`,
          { type: 'CURRENT', line1: 'x', city: 'y' },
          owner.accessToken,
        )
      ).status,
    ).toBe(404);
    const search = await client.get('/employees?search=Foreign', owner.accessToken);
    expect(search.body.data).toEqual([]);
    const crossCompany = await client.post(
      '/employees',
      {
        firstName: 'X',
        dateOfJoining: '2025-01-01',
        companyId: theirCo.id,
        employmentType: 'FULL_TIME',
      },
      owner.accessToken,
    );
    expect(crossCompany.status).toBe(400);
    const mine = await hire({ firstName: 'Mine' });
    const crossManager = await client.post(
      `/employees/${mine.id}/job-changes`,
      {
        effectiveFrom: daysFromToday(-1),
        changeType: 'MANAGER_CHANGE',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        managerId: theirs.id,
      },
      owner.accessToken,
    );
    expect(crossManager.status).toBe(400);

    // RLS: without a tenant context the runtime role sees no employee rows at all.
    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    try {
      for (const t of [
        'employees',
        'employment_records',
        'employee_bank_accounts',
        'employee_documents',
        'employee_settings',
      ]) {
        const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`);
        expect(rows[0]?.n, t).toBe('0');
      }
    } finally {
      await db.end();
    }
  });
});
