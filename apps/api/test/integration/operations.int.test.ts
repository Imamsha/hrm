/**
 * Phase 11b helpdesk, separation & offboarding, compliance against PostgreSQL. SLAs, notice days,
 * clearance items, questions and obligations are fictional test configuration.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HelpdeskService } from '../../src/modules/helpdesk/helpdesk.service.js';
import { runInTenantJobContext } from '../../src/infrastructure/queue/tenant-job.js';
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
type Person = { id: string; token: string; email: string };
let boss: Person;
let emp: Person;
let agent: Person;
let lead: Person;

const today = () => new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Operations');
  co = await create('/companies', { code: 'OPS', name: 'Ops Co' });
  boss = await person('Bina');
  emp = await person('Esha', boss.id);
  agent = await person('Arun');
  lead = await person('Lata');
});

afterAll(async () => {
  await app.close();
});

async function create(
  path: string,
  body: object,
  token = owner.accessToken,
): Promise<{ id: string; [k: string]: unknown }> {
  const res = await client.post(path, body, token);
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.data as { id: string };
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed accessor for response data in tests
function data<T = Record<string, unknown>>(
  res: { status: number; body: { data: unknown } },
  status = 200,
): T {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body.data as T;
}

async function person(firstName: string, managerId?: string): Promise<Person> {
  const roles = await client.get('/roles', owner.accessToken);
  const roleId = (roles.body.data as { id: string; key: string }[]).find(
    (r) => r.key === 'employee',
  )?.id;
  const email = uniqueEmail(firstName.toLowerCase());
  await client.post('/invitations', { email, roleIds: [roleId] }, owner.accessToken);
  const token = tokenFromLink((await waitForEmail(email)).text, '/accept-invitation');
  const accepted = await client.post('/invitations/accept', {
    token,
    fullName: firstName,
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  const e = await create('/employees', {
    firstName,
    dateOfJoining: '2025-01-01',
    companyId: co.id,
    employmentType: 'FULL_TIME',
    membershipId: me.body.data.activeOrganization.membershipId,
    ...(managerId ? { managerId } : {}),
  });
  return { id: e.id, token: accepted.body.data.accessToken as string, email };
}

async function sql<T extends pg.QueryResultRow>(
  text: string,
  params: unknown[],
  commit = false,
): Promise<pg.QueryResult<T>> {
  const db = new pg.Client({ connectionString: testEnv.databaseUrl });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.organization_id', $1, true)`, [owner.organizationId]);
    const r = await db.query<T>(text, params);
    await db.query(commit ? 'COMMIT' : 'ROLLBACK');
    return r;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

type Ticket = {
  id: string;
  number: string;
  status: string;
  firstResponseDue: string | null;
  resolutionDue: string | null;
  firstRespondedAt: string | null;
  escalated: boolean;
  assignee: { id: string } | null;
  comments: { body: string; internal: boolean }[];
  can: { rate: boolean; close: boolean };
};

describe('helpdesk', () => {
  let itId: string;

  it('runs a ticket from raising to rating, with internal notes hidden from the requester', async () => {
    const cats = data<{ id: string; code: string }[]>(
      await client.post(
        '/helpdesk/categories',
        {
          code: 'it',
          name: 'IT',
          agentEmployeeIds: [agent.id],
          defaultAssigneeId: agent.id,
          escalationEmployeeId: lead.id,
          sla: [{ priority: 'URGENT', firstResponseHours: 1, resolutionHours: 4 }],
        },
        owner.accessToken,
      ),
      201,
    );
    itId = cats.find((c) => c.code === 'IT')?.id ?? '';
    const t = data<Ticket>(
      await client.post(
        '/helpdesk/tickets',
        {
          categoryId: itId,
          subject: 'Laptop will not boot',
          description: 'Black screen',
          priority: 'URGENT',
        },
        emp.token,
      ),
      201,
    );
    expect(t.number).toMatch(/^HD-\d{4}-0001$/);
    expect(t.assignee?.id).toBe(agent.id);
    expect(Date.parse(t.resolutionDue ?? '') - Date.parse(t.firstResponseDue ?? '')).toBe(
      3 * 3_600_000,
    );
    expect((await client.get(`/helpdesk/tickets/${t.id}`, boss.token)).status).toBe(404);
    expect(
      data<{ id: string }[]>(await client.get('/helpdesk/tickets?scope=queue', agent.token)).map(
        (x) => x.id,
      ),
    ).toContain(t.id);

    data(
      await client.post(
        `/helpdesk/tickets/${t.id}/comments`,
        { body: 'Check the warranty first', internal: true },
        agent.token,
      ),
      201,
    );
    const replied = data<Ticket>(
      await client.post(
        `/helpdesk/tickets/${t.id}/comments`,
        { body: 'Please hold the power button for 30 s' },
        agent.token,
      ),
      201,
    );
    expect(replied.firstRespondedAt).not.toBeNull();
    const seen = data<Ticket>(await client.get(`/helpdesk/tickets/${t.id}`, emp.token));
    expect(seen.comments.map((c) => c.body)).toEqual(['Please hold the power button for 30 s']);
    expect(
      (
        await client.post(
          `/helpdesk/tickets/${t.id}/comments`,
          { body: 'x', internal: true },
          emp.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (await client.patch(`/helpdesk/tickets/${t.id}`, { status: 'RESOLVED' }, emp.token)).status,
    ).toBe(400);
    expect(
      (
        await client.patch(
          `/helpdesk/tickets/${t.id}`,
          { status: 'RESOLVED', resolution: 'Done' },
          emp.token,
        )
      ).status,
    ).toBe(403);
    const resolved = data<Ticket>(
      await client.patch(
        `/helpdesk/tickets/${t.id}`,
        { status: 'RESOLVED', resolution: 'Reset the BIOS' },
        agent.token,
      ),
    );
    expect(resolved.can).toMatchObject({ rate: false, close: true });
    const rated = data<Ticket>(
      await client.post(`/helpdesk/tickets/${t.id}/rating`, { rating: 5 }, emp.token),
    );
    expect(rated.status).toBe('RESOLVED');
    data(await client.patch(`/helpdesk/tickets/${t.id}`, { status: 'CLOSED' }, emp.token));
    await expect(sql(`UPDATE tickets SET subject = 'x' WHERE id = $1`, [t.id])).rejects.toThrow(
      /closed ticket/,
    );
    // Attachments must be PDFs or images.
    const bad = await request(server())
      .post(`/api/v1/helpdesk/tickets/${t.id}/attachments`)
      .set('Authorization', `Bearer ${emp.token}`)
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), {
        filename: 'x.pdf',
        contentType: 'application/pdf',
      });
    expect(bad.status).toBe(409); // closed
  });

  it('escalates a ticket past its resolution time to the escalation contact', async () => {
    const t = data<Ticket>(
      await client.post(
        '/helpdesk/tickets',
        {
          categoryId: itId,
          subject: 'VPN down',
          description: 'Cannot connect',
          priority: 'URGENT',
        },
        emp.token,
      ),
      201,
    );
    await sql(
      `UPDATE tickets SET resolution_due = now() - interval '1 minute' WHERE id = $1`,
      [t.id],
      true,
    );
    const helpdesk = app.get(HelpdeskService);
    expect(await helpdesk.tenantsWithBreaches()).toContain(owner.organizationId);
    expect(
      await runInTenantJobContext({ organizationId: owner.organizationId }, () =>
        helpdesk.escalate(owner.organizationId),
      ),
    ).toBe(1);
    const after = data<Ticket & { resolutionBreached: boolean }>(
      await client.get(`/helpdesk/tickets/${t.id}`, lead.token),
    );
    expect(after).toMatchObject({
      escalated: true,
      assignee: { id: lead.id },
      resolutionBreached: true,
    });
  });

  it('keeps confidential categories to their agents and suggests published articles', async () => {
    const hr = data<{ id: string; code: string }[]>(
      await client.post(
        '/helpdesk/categories',
        { code: 'hrc', name: 'HR confidential', agentEmployeeIds: [lead.id], confidential: true },
        owner.accessToken,
      ),
      201,
    ).find((c) => c.code === 'HRC');
    const t = data<Ticket>(
      await client.post(
        '/helpdesk/tickets',
        { categoryId: hr?.id, subject: 'Grievance', description: 'Private matter' },
        emp.token,
      ),
      201,
    );
    // The owner holds helpdesk.ticket.manage but is not an agent of the confidential category.
    expect((await client.get(`/helpdesk/tickets/${t.id}`, owner.accessToken)).status).toBe(404);
    expect(
      data<Ticket>(await client.get(`/helpdesk/tickets/${t.id}`, lead.token)).number,
    ).toBeTruthy();

    data(
      await client.post(
        '/helpdesk/articles',
        {
          title: 'Reset your VPN password',
          body: 'Open the portal and choose reset.',
          status: 'PUBLISHED',
        },
        owner.accessToken,
      ),
      201,
    );
    data(
      await client.post(
        '/helpdesk/articles',
        { title: 'VPN draft', body: 'Not ready', status: 'DRAFT' },
        owner.accessToken,
      ),
      201,
    );
    const found = data<{ title: string }[]>(
      await client.get('/helpdesk/articles?search=vpn%20password', emp.token),
    );
    expect(found.map((a) => a.title)).toEqual(['Reset your VPN password']);
  });
});

describe('separation', () => {
  let caseId: string;
  let resignationId: string;

  it('approves a resignation, waives notice and opens a case with clearance', async () => {
    data(
      await client.put(
        '/separation/settings',
        {
          noticeDays: 30,
          items: [{ title: 'Return ID card', ownerRoleKey: 'owner' }],
          questions: [
            { id: 'q1', type: 'RATING', text: 'How was your manager?' },
            { id: 'q2', type: 'TEXT', text: 'Anything else?' },
          ],
        },
        owner.accessToken,
      ),
    );
    const [lic] = data<{ id: string }[]>(
      await client.post('/licenses', { name: 'Design suite', seats: 2 }, owner.accessToken),
      201,
    );
    data(
      await client.post(
        `/licenses/${lic?.id ?? ''}/seats`,
        { employeeId: emp.id },
        owner.accessToken,
      ),
      201,
    );

    const r = data<{
      id: string;
      noticeLastDay: string;
      waivedNoticeDays: number;
      can: { withdraw: boolean };
    }>(
      await client.post(
        '/me/resignation',
        { reasonCategory: 'CAREER', note: 'New role', requestedLastDay: today() },
        emp.token,
      ),
      201,
    );
    resignationId = r.id;
    expect(r).toMatchObject({
      noticeLastDay: day(29),
      waivedNoticeDays: 29,
      can: { withdraw: true },
    });
    expect(
      (
        await client.post(
          '/me/resignation',
          { reasonCategory: 'CAREER', requestedLastDay: today() },
          emp.token,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await client.post(
          `/separation/resignations/${r.id}/decision`,
          { decision: 'APPROVED' },
          agent.token,
        )
      ).status,
    ).toBe(403);
    expect(
      data<{ id: string }[]>(
        await client.get('/separation/resignations?scope=approvals', boss.token),
      ).map((x) => x.id),
    ).toContain(r.id);
    const approved = data<{ status: string; caseId: string }>(
      await client.post(
        `/separation/resignations/${r.id}/decision`,
        { decision: 'APPROVED', note: 'Agreed' },
        boss.token,
      ),
    );
    expect(approved.status).toBe('APPROVED');
    caseId = approved.caseId;
    expect((await client.get(`/employees/${emp.id}`, owner.accessToken)).body.data.status).toBe(
      'ON_NOTICE',
    );
    const c = data<{
      items: { kind: string; title: string; status: string; canDecide: boolean }[];
    }>(await client.get(`/separation/cases/${caseId}`, owner.accessToken));
    expect(c.items.map((i) => i.kind).sort()).toEqual([
      'KNOWLEDGE_TRANSFER',
      'LICENSE',
      'TEMPLATE',
    ]);
    await expect(sql(`UPDATE resignations SET note = 'x' WHERE id = $1`, [r.id])).rejects.toThrow(
      /decided resignation/,
    );
  });

  it('requires clearance, keeps exit interviews to HR and completes the separation', async () => {
    type Case = {
      status: string;
      items: { id: string; kind: string; status: string; canDecide: boolean }[];
      can: { complete: boolean; interview: boolean };
    };
    // The manager sees and clears only the knowledge-transfer item.
    const asBoss = data<Case>(await client.get(`/separation/cases/${caseId}`, boss.token));
    const kt = asBoss.items.find((i) => i.kind === 'KNOWLEDGE_TRANSFER');
    const tpl = asBoss.items.find((i) => i.kind === 'TEMPLATE');
    expect([kt?.canDecide, tpl?.canDecide]).toEqual([true, false]);
    data(
      await client.post(
        `/separation/cases/${caseId}/items/${kt?.id ?? ''}`,
        { status: 'CLEARED' },
        boss.token,
      ),
    );
    data(
      await client.post(
        `/separation/cases/${caseId}/items/${tpl?.id ?? ''}`,
        { status: 'CLEARED' },
        owner.accessToken,
      ),
    );
    expect(
      (await client.post(`/separation/cases/${caseId}/complete`, {}, owner.accessToken)).body.error
        .message,
    ).toMatch(/Clear or waive/);
    // Revoking the licence seat clears its item automatically.
    const seat = (
      await sql<{ id: string; license_id: string }>(
        `SELECT id, license_id FROM license_assignments WHERE employee_id = $1`,
        [emp.id],
      )
    ).rows[0];
    data(
      await client.delete(
        `/licenses/${seat?.license_id ?? ''}/seats/${seat?.id ?? ''}`,
        owner.accessToken,
      ),
    );
    const cleared = data<Case>(await client.get(`/separation/cases/${caseId}`, owner.accessToken));
    expect(cleared.items.every((i) => i.status !== 'PENDING')).toBe(true);
    expect(cleared.can.complete).toBe(true);

    expect(
      data<Case>(await client.get(`/separation/cases/${caseId}`, emp.token)).can.interview,
    ).toBe(true);
    data(
      await client.post(
        `/separation/cases/${caseId}/interview`,
        { answers: { q1: 4, q2: 'Thanks' } },
        emp.token,
      ),
      201,
    );
    expect(
      (
        await client.post(
          `/separation/cases/${caseId}/interview`,
          { answers: { q1: 4 } },
          emp.token,
        )
      ).status,
    ).toBe(409);
    expect(
      data<{ answers: unknown }>(
        await client.get(`/separation/cases/${caseId}/interview`, boss.token),
      ).answers,
    ).toBeNull();
    expect(
      data<{ answers: { q1: number } }>(
        await client.get(`/separation/cases/${caseId}/interview`, owner.accessToken),
      ).answers.q1,
    ).toBe(4);

    expect(
      data<Case>(await client.post(`/separation/cases/${caseId}/complete`, {}, owner.accessToken))
        .status,
    ).toBe('COMPLETED');
    expect((await client.get(`/employees/${emp.id}`, owner.accessToken)).body.data.status).toBe(
      'SEPARATED',
    );
    expect((await client.get('/me/profile', emp.token)).status).toBeGreaterThanOrEqual(401);
    const a = data<{
      separations: number;
      byReason: { reason: string; count: number }[];
      ratings: { average: string | null }[];
    }>(await client.get(`/separation/analytics?from=${day(-1)}&to=${day(1)}`, owner.accessToken));
    expect(a.separations).toBe(1);
    expect(a.byReason).toEqual([{ reason: 'CAREER', count: 1 }]);
    expect(a.ratings[0]?.average).toBeNull(); // fewer than 5 answers
    expect(resignationId).toBeTruthy();
  });

  it('lets an employee withdraw a pending resignation', async () => {
    const r = data<{ id: string }>(
      await client.post(
        '/me/resignation',
        { reasonCategory: 'PERSONAL', requestedLastDay: day(40) },
        agent.token,
      ),
      201,
    );
    expect(
      data<{ status: string }>(
        await client.post(`/separation/resignations/${r.id}/withdraw`, {}, agent.token),
      ).status,
    ).toBe('WITHDRAWN');
    expect((await client.get(`/employees/${agent.id}`, owner.accessToken)).body.data.status).toBe(
      'ACTIVE',
    );
  });
});

describe('compliance', () => {
  it('rolls a recurring obligation forward and reports what expires', async () => {
    data(
      await client.post(
        '/compliance/obligations',
        {
          title: 'Monthly contribution filing',
          category: 'STATUTORY_FILING',
          ownerEmployeeId: lead.id,
          firstDueOn: day(-1),
          recurrence: 'MONTHLY',
        },
        owner.accessToken,
      ),
      201,
    );
    const mine = data<{ id: string; state: string; canComplete: boolean }[]>(
      await client.get('/compliance/tasks', lead.token),
    );
    expect(mine[0]).toMatchObject({ state: 'OVERDUE', canComplete: true });
    expect((await client.get('/compliance/tasks?scope=all', agent.token)).status).toBe(403);
    const done = await request(server())
      .post(`/api/v1/compliance/tasks/${mine[0]?.id ?? ''}/complete`)
      .set('Authorization', `Bearer ${lead.token}`)
      .field('note', 'Filed, receipt attached')
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const after = data<{ dueOn: string; status: string; evidence: unknown }[]>(
      await client.get('/compliance/tasks', lead.token),
    );
    expect(after.map((t) => t.status).sort()).toEqual(['COMPLETED', 'OPEN']);
    expect(after.find((t) => t.status === 'COMPLETED')?.evidence).toMatchObject({
      fileName: 'receipt.pdf',
    });
    await expect(
      sql(`UPDATE compliance_tasks SET note = 'x' WHERE status = 'COMPLETED'`, []),
    ).rejects.toThrow(/completed compliance task/);

    await client.post(
      '/licenses',
      { name: 'Accounting suite', seats: 5, expiresOn: day(10) },
      owner.accessToken,
    );
    const exp = data<{ kind: string; title: string; state: string }[]>(
      await client.get('/compliance/expiring?days=30', owner.accessToken),
    );
    expect(exp.find((x) => x.title === 'Accounting suite')).toMatchObject({
      kind: 'LICENCE',
      state: 'DUE_SOON',
    });
    const dash = data<{
      tasks: { overdue: number; completedThisMonth: number };
      recentAudit: unknown[] | null;
    }>(await client.get('/compliance/dashboard', owner.accessToken));
    expect(dash.tasks).toMatchObject({ overdue: 0, completedThisMonth: 1 });
    expect(dash.recentAudit?.length).toBeGreaterThan(0);
  });

  it('isolates tenants', async () => {
    const other = await registerAccount(client, 'Other ops');
    expect(data<unknown[]>(await client.get('/helpdesk/categories', other.accessToken))).toEqual(
      [],
    );
    expect(data<unknown[]>(await client.get('/compliance/obligations', other.accessToken))).toEqual(
      [],
    );
    expect(data<unknown[]>(await client.get('/separation/cases', other.accessToken))).toEqual([]);
  });
});
