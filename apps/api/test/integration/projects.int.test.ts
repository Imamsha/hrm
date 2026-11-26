/**
 * Phase 10 clients & projects against PostgreSQL. Rates and the tax rate below are fictional
 * test configuration (round numbers), not real tax rules.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
type Person = { id: string; token: string };
let boss: Person;
let emp: Person;
let outsider: Person;
let acme: { id: string };
let project: { id: string };
let internal: { id: string };

const WEEK = '2026-11-16';

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Projects');
  co = await create('/companies', { code: 'PRJ', name: 'Projects Co' });
  boss = await person('Bina');
  emp = await person('Esha', boss.id);
  outsider = await person('Omar', boss.id);
  acme = await create('/clients', {
    code: 'ACME',
    name: 'Acme Ltd',
    currency: 'INR',
    paymentTermsDays: 30,
  });
  project = await create('/projects', {
    key: 'WEB',
    name: 'Website',
    clientId: acme.id,
    billingType: 'TIME_AND_MATERIALS',
    portalEnabled: true,
  });
  internal = await create('/projects', {
    key: 'OPS',
    name: 'Internal ops',
    billingType: 'NON_BILLABLE',
  });
  data(
    await client.post(
      `/projects/${project.id}/members`,
      { employeeId: boss.id, role: 'MANAGER' },
      owner.accessToken,
    ),
    201,
  );
  data(
    await client.post(
      `/projects/${project.id}/members`,
      { employeeId: emp.id, role: 'MEMBER' },
      owner.accessToken,
    ),
    201,
  );
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

async function invite(
  firstName: string,
  roleKey: string,
): Promise<{ token: string; membershipId: string }> {
  const roles = await client.get('/roles', owner.accessToken);
  const roleId = (roles.body.data as { id: string; key: string }[]).find(
    (r) => r.key === roleKey,
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
  return {
    token: accepted.body.data.accessToken as string,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

async function person(firstName: string, managerId?: string): Promise<Person> {
  const m = await invite(firstName, 'employee');
  const e = await create('/employees', {
    firstName,
    dateOfJoining: '2025-01-01',
    companyId: co.id,
    employmentType: 'FULL_TIME',
    membershipId: m.membershipId,
    ...(managerId ? { managerId } : {}),
  });
  return { id: e.id, token: m.token };
}

async function asApp<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: testEnv.databaseUrl });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.organization_id', $1, true)`, [owner.organizationId]);
    return await fn(db);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
}

type Item = {
  id: string;
  key: string;
  column: { id: string; name: string; category: string };
  history: { field: string; from: string | null; to: string | null }[];
};
type Details = {
  columns: { id: string; category: string }[];
  members: { id: string; employee: { id: string }; billingRate: string | null }[];
  sprints: {
    id: string;
    status: string;
    committedPoints: string | null;
    completedPoints: string | null;
  }[];
};

describe('projects and work items', () => {
  it('limits projects to members and readers, with default board columns', async () => {
    const d = data<Details>(await client.get(`/projects/${project.id}`, emp.token));
    expect(d.columns.map((c) => c.category)).toEqual(['TODO', 'IN_PROGRESS', 'DONE']);
    // Members do not see rates; only people who manage the project do.
    expect(d.members.every((m) => m.billingRate === null)).toBe(true);
    expect((await client.get(`/projects/${project.id}`, outsider.token)).status).toBe(404);
    const mine = data<{ key: string }[]>(await client.get('/projects', emp.token));
    expect(mine.map((p) => p.key)).toEqual(['WEB']);
    expect(
      data<{ key: string }[]>(await client.get('/projects', owner.accessToken))
        .map((p) => p.key)
        .sort(),
    ).toEqual(['OPS', 'WEB']);
    // Only project managers (or project.manage) change members.
    expect(
      (
        await client.post(
          `/projects/${project.id}/members`,
          { employeeId: outsider.id, role: 'MEMBER' },
          emp.token,
        )
      ).status,
    ).toBe(403);
    // A non-billable project never needs a client; a billable one does.
    expect(
      (
        await client.post(
          '/projects',
          { key: 'BAD', name: 'x', billingType: 'FIXED_FEE' },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
  });

  it('numbers items per project, enforces the hierarchy and records history', async () => {
    const base = `/projects/${project.id}/items`;
    const epic = data<Item>(
      await client.post(base, { type: 'EPIC', title: 'Checkout' }, emp.token),
      201,
    );
    const story = data<Item>(
      await client.post(
        base,
        {
          type: 'STORY',
          title: 'Pay by card',
          parentId: epic.id,
          storyPoints: 5,
          assigneeId: emp.id,
        },
        emp.token,
      ),
      201,
    );
    const task = data<Item>(
      await client.post(base, { type: 'TASK', title: 'Card form', parentId: story.id }, emp.token),
      201,
    );
    expect([epic.key, story.key, task.key]).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);
    expect(
      (await client.post(base, { type: 'TASK', title: 'Wrong', parentId: epic.id }, emp.token)).body
        .error.message,
    ).toMatch(/task cannot sit under a epic/);
    expect((await client.post(base, { type: 'SUBTASK', title: 'Orphan' }, emp.token)).status).toBe(
      400,
    );
    expect((await client.post(base, { type: 'BUG', title: 'Crash' }, emp.token)).status).toBe(400); // severity required
    expect(
      (await client.post(base, { type: 'TASK', title: 'x', assigneeId: outsider.id }, emp.token))
        .body.error.message,
    ).toMatch(/member of the project/);

    const d = data<Details>(await client.get(`/projects/${project.id}`, emp.token));
    const doing = d.columns.find((c) => c.category === 'IN_PROGRESS')?.id ?? '';
    const moved = data<Item>(
      await client.patch(`${base}/${story.id}`, { columnId: doing }, emp.token),
    );
    expect(moved.column.category).toBe('IN_PROGRESS');
    expect(moved.history.map((h) => [h.field, h.from, h.to])).toContainEqual([
      'status',
      'To do',
      'In progress',
    ]);

    // The database keeps parents within the project and the history append-only.
    await asApp(async (db) => {
      const other = await db.query<{ id: string; column: string }>(
        `SELECT w.id, w.column_id AS column FROM work_items w WHERE w.project_id = $1 LIMIT 1`,
        [project.id],
      );
      const col = await db.query<{ id: string }>(
        `SELECT id FROM board_columns WHERE project_id = $1 LIMIT 1`,
        [internal.id],
      );
      await expect(
        db.query(
          `INSERT INTO work_items (id, organization_id, project_id, number, type, title, column_id, parent_id, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 99, 'STORY', 'x', $3, $4, now())`,
          [owner.organizationId, internal.id, col.rows[0]?.id, other.rows[0]?.id],
        ),
      ).rejects.toThrow(/parent belongs to another project/);
    });
    await asApp(async (db) => {
      await expect(db.query(`UPDATE work_item_events SET field = 'x'`)).rejects.toThrow();
    });
  });

  it('runs one sprint at a time and carries unfinished work to the backlog', async () => {
    const base = `/projects/${project.id}`;
    const s1 = data<Details['sprints']>(
      await client.post(
        `${base}/sprints`,
        { name: 'Sprint 1', startDate: '2026-11-16', endDate: '2026-11-27' },
        boss.token,
      ),
      201,
    )[0];
    const s2 = data<Details['sprints']>(
      await client.post(
        `${base}/sprints`,
        { name: 'Sprint 2', startDate: '2026-11-30', endDate: '2026-12-11' },
        boss.token,
      ),
      201,
    )[1];
    expect(
      (
        await client.post(
          `${base}/sprints`,
          { name: 'x', startDate: '2026-11-16', endDate: '2026-11-27' },
          emp.token,
        )
      ).status,
    ).toBe(403);
    const d = data<Details>(await client.get(base, boss.token));
    const done = d.columns.find((c) => c.category === 'DONE')?.id ?? '';
    const a = data<Item>(
      await client.post(
        `${base}/items`,
        { type: 'TASK', title: 'Finish', sprintId: s1?.id, storyPoints: 3 },
        emp.token,
      ),
      201,
    );
    const b = data<Item>(
      await client.post(
        `${base}/items`,
        { type: 'TASK', title: 'Leftover', sprintId: s1?.id, storyPoints: 2 },
        emp.token,
      ),
      201,
    );
    data(await client.patch(`${base}/items/${a.id}`, { columnId: done }, emp.token));
    data(await client.post(`${base}/sprints/${s1?.id ?? ''}/start`, {}, boss.token), 201);
    expect(
      (await client.post(`${base}/sprints/${s2?.id ?? ''}/start`, {}, boss.token)).status,
    ).toBe(409);
    const board = data<{ sprint: { id: string }; columns: { items: { id: string }[] }[] }>(
      await client.get(`${base}/board`, emp.token),
    );
    expect(board.sprint.id).toBe(s1?.id);
    expect(board.columns.flatMap((c) => c.items.map((i) => i.id)).sort()).toEqual(
      [a.id, b.id].sort(),
    );

    const after = data<Details['sprints']>(
      await client.post(
        `${base}/sprints/${s1?.id ?? ''}/complete`,
        { moveToSprintId: null },
        boss.token,
      ),
      201,
    );
    expect(after.find((s) => s.id === s1?.id)).toMatchObject({
      status: 'COMPLETED',
      committedPoints: '5',
      completedPoints: '3',
    });
    const leftover = data<{ sprintId: string | null; history: { field: string; to: string }[] }>(
      await client.get(`${base}/items/${b.id}`, emp.token),
    );
    expect(leftover.sprintId).toBeNull();
    expect(leftover.history.at(-1)).toMatchObject({ field: 'sprint', to: 'backlog' });
  });
});

type Sheet = {
  id: string;
  status: string;
  totalHours: string;
  billableHours: string;
  approver: { id: string } | null;
  can: { decide: boolean };
};
type Invoice = {
  id: string;
  number: string | null;
  status: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  balance: string;
  lines: { quantity: string; unitPrice: string; tax: string }[];
};

describe('timesheets and billing', () => {
  it('routes timesheets to the reporting manager and freezes them once approved', async () => {
    expect(
      (
        await client.put(
          '/me/timesheet',
          { weekStart: WEEK, entries: [{ date: '2026-11-17', projectId: internal.id, hours: 2 }] },
          emp.token,
        )
      ).body.error.message,
    ).toMatch(/not a member/);
    data(
      await client.post(
        `/projects/${internal.id}/members`,
        { employeeId: emp.id, role: 'MEMBER' },
        owner.accessToken,
      ),
      201,
    );
    const saved = data<Sheet>(
      await client.put(
        '/me/timesheet',
        {
          weekStart: WEEK,
          entries: [
            { date: '2026-11-17', projectId: project.id, hours: '7.5' },
            { date: '2026-11-18', projectId: project.id, hours: '2.25', note: 'Review' },
            { date: '2026-11-18', projectId: internal.id, hours: 1, billable: true },
          ],
        },
        emp.token,
      ),
    );
    // Time on a non-billable project is never billable.
    expect([saved.totalHours, saved.billableHours]).toEqual(['10.75', '9.75']);
    const submitted = data<Sheet>(
      await client.post(`/timesheets/${saved.id}/submit`, {}, emp.token),
      201,
    );
    expect(submitted.approver?.id).toBe(boss.id);
    expect(
      (await client.post(`/timesheets/${saved.id}/decision`, { decision: 'APPROVED' }, emp.token))
        .status,
    ).toBe(403);
    expect(
      (
        await client.post(
          `/timesheets/${saved.id}/decision`,
          { decision: 'APPROVED' },
          outsider.token,
        )
      ).status,
    ).toBe(403);
    const queue = data<Sheet[]>(await client.get('/timesheets?scope=approvals', boss.token));
    expect(queue.map((s) => s.id)).toContain(saved.id);
    expect(
      data<Sheet>(
        await client.post(`/timesheets/${saved.id}/decision`, { decision: 'APPROVED' }, boss.token),
        201,
      ).status,
    ).toBe('APPROVED');
    expect(
      (await client.put('/me/timesheet', { weekStart: WEEK, entries: [] }, emp.token)).status,
    ).toBe(409);
    await asApp(async (db) => {
      await expect(
        db.query(`UPDATE time_entries SET hours = 1 WHERE timesheet_id = $1`, [saved.id]),
      ).rejects.toThrow(/submitted or approved/);
    });
    await asApp(async (db) => {
      await expect(
        db.query(`UPDATE timesheets SET decision_note = 'x' WHERE id = $1`, [saved.id]),
      ).rejects.toThrow(/approved timesheet/);
    });
  });

  it('bills approved time at configured rates, numbers on issue and tracks payments', async () => {
    const tax = data<{ id: string; name: string }[]>(
      await client.post(
        '/billing/tax-rates',
        { name: 'Test tax', ratePercent: '10', effectiveFrom: '2026-01-01' },
        owner.accessToken,
      ),
      201,
    ).find((t) => t.name === 'Test tax');
    const period = {
      clientId: acme.id,
      timeFrom: '2026-11-16',
      timeTo: '2026-11-22',
      timeTaxRateId: tax?.id,
    };
    // No rate anywhere: the draft is refused with the people to configure.
    expect((await client.post('/invoices', period, owner.accessToken)).body.error.message).toMatch(
      /Set a billing rate first: WEB — Esha/,
    );
    const d = data<Details>(await client.get(`/projects/${project.id}`, owner.accessToken));
    const member = d.members.find((m) => m.employee.id === emp.id);
    data(
      await client.patch(
        `/projects/${project.id}/members/${member?.id ?? ''}`,
        { billingRate: '1000' },
        owner.accessToken,
      ),
    );

    const draft = data<Invoice>(await client.post('/invoices', period, owner.accessToken), 201);
    expect(draft).toMatchObject({
      status: 'DRAFT',
      number: null,
      subtotal: '9750.00',
      taxTotal: '975.00',
      total: '10725.00',
    });
    expect(draft.lines[0]).toMatchObject({ quantity: '9.75', unitPrice: '1000.00', tax: '975.00' });
    // The same time cannot be billed twice.
    expect((await client.post('/invoices', period, owner.accessToken)).status).toBe(400);

    const issued = data<Invoice>(
      await client.post(
        `/invoices/${draft.id}/issue`,
        { issuedOn: '2026-11-24' },
        owner.accessToken,
      ),
      201,
    );
    expect(issued).toMatchObject({
      status: 'ISSUED',
      number: 'INV-2026-0001',
      dueOn: '2026-12-24',
    });
    // The invoice PDF is rendered from the stored figures (Phase 11a).
    const pdf = await client.get(`/invoices/${draft.id}/pdf`, owner.accessToken);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await asApp(async (db) => {
      await expect(
        db.query(`UPDATE invoices SET total = 1, subtotal = 1, tax_total = 0 WHERE id = $1`, [
          draft.id,
        ]),
      ).rejects.toThrow(/issued invoice cannot be edited/);
    });
    await asApp(async (db) => {
      await expect(
        db.query(`UPDATE invoice_lines SET unit_price = 1 WHERE invoice_id = $1`, [draft.id]),
      ).rejects.toThrow(/issued invoice/);
    });
    expect(
      (
        await client.post(
          `/invoices/${draft.id}/payments`,
          { amount: '20000', receivedOn: '2026-11-25' },
          owner.accessToken,
        )
      ).body.error.message,
    ).toMatch(/balance is 10725.00/);
    expect(
      data<Invoice>(
        await client.post(
          `/invoices/${draft.id}/payments`,
          { amount: '725', receivedOn: '2026-11-25' },
          owner.accessToken,
        ),
        201,
      ),
    ).toMatchObject({ status: 'ISSUED', balance: '10000.00' });
    expect(
      data<Invoice>(
        await client.post(
          `/invoices/${draft.id}/payments`,
          { amount: '10000', receivedOn: '2026-11-26' },
          owner.accessToken,
        ),
        201,
      ),
    ).toMatchObject({ status: 'PAID', balance: '0.00' });
    expect(
      (await client.post(`/invoices/${draft.id}/void`, { reason: 'x' }, owner.accessToken)).status,
    ).toBe(409);

    // Voiding an unpaid invoice releases its time for a new one.
    const manual = data<Invoice>(
      await client.post(
        '/invoices',
        {
          clientId: acme.id,
          lines: [{ description: 'Milestone 1', quantity: 1, unitPrice: '50000' }],
        },
        owner.accessToken,
      ),
      201,
    );
    data(
      await client.post(
        `/invoices/${manual.id}/issue`,
        { issuedOn: '2026-11-24' },
        owner.accessToken,
      ),
      201,
    );
    const voided = data<Invoice>(
      await client.post(
        `/invoices/${manual.id}/void`,
        { reason: 'Raised twice' },
        owner.accessToken,
      ),
      201,
    );
    expect(voided).toMatchObject({ status: 'VOID', number: 'INV-2026-0002' });
    // Employees never reach billing.
    expect((await client.get('/invoices', emp.token)).status).toBe(403);
  });
});

describe('client portal', () => {
  it('shows a client only its portal projects, shared items and issued invoices', async () => {
    const contact = await invite('Carla', 'client');
    // Staff logins can never be portal users.
    expect(
      (
        await client.post(
          `/clients/${acme.id}/portal-users`,
          { membershipId: (await invite('Sam', 'employee')).membershipId },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
    data(
      await client.post(
        `/clients/${acme.id}/portal-users`,
        { membershipId: contact.membershipId },
        owner.accessToken,
      ),
      201,
    );

    const base = `/projects/${project.id}/items`;
    const shared = data<Item>(
      await client.post(
        base,
        { type: 'STORY', title: 'Shared story', clientVisible: true },
        emp.token,
      ),
      201,
    );
    data(await client.post(base, { type: 'STORY', title: 'Internal story' }, emp.token), 201);
    data(
      await client.post(`${base}/${shared.id}/comments`, { body: 'Internal note' }, emp.token),
      201,
    );
    data(
      await client.post(
        `${base}/${shared.id}/comments`,
        { body: 'Ready for review', clientVisible: true },
        emp.token,
      ),
      201,
    );
    await create('/invoices', {
      clientId: acme.id,
      lines: [{ description: 'Draft only', quantity: 1, unitPrice: '1' }],
    });

    const summary = data<{
      client: { code: string };
      projects: { key: string }[];
      invoices: { status: string }[];
    }>(await client.get('/portal', contact.token));
    expect(summary.client.code).toBe('ACME');
    expect(summary.projects.map((p) => p.key)).toEqual(['WEB']);
    // Drafts and voided invoices stay internal.
    expect(summary.invoices.map((i) => i.status)).toEqual(['PAID']);
    const items = data<{ title: string }[]>(
      await client.get(`/portal/projects/${project.id}/items`, contact.token),
    );
    expect(items.map((i) => i.title)).toEqual(['Shared story']);
    const one = data<{ comments: { body: string }[] }>(
      await client.get(`/portal/items/${shared.id}`, contact.token),
    );
    expect(one.comments.map((c) => c.body)).toEqual(['Ready for review']);
    expect((await client.get(`/portal/projects/${internal.id}/items`, contact.token)).status).toBe(
      404,
    );

    const bug = data<{ key: string; fromClient: boolean; type: string }>(
      await client.post(
        '/portal/requests',
        {
          projectId: project.id,
          type: 'BUG',
          title: 'Login fails',
          description: 'On Safari',
          severity: 'MAJOR',
        },
        contact.token,
      ),
      201,
    );
    expect(bug).toMatchObject({ fromClient: true, type: 'BUG' });
    const replied = data<{ comments: { body: string; fromClient: boolean }[] }>(
      await client.post(
        `/portal/items/${shared.id}/comments`,
        { body: 'Looks good' },
        contact.token,
      ),
      201,
    );
    expect(replied.comments.at(-1)).toMatchObject({ body: 'Looks good', fromClient: true });
    // The team sees the client's reply and the raised bug.
    const internalView = data<{ comments: { body: string; fromClient: boolean }[] }>(
      await client.get(`/projects/${project.id}/items/${shared.id}`, emp.token),
    );
    expect(internalView.comments.map((c) => c.body)).toEqual([
      'Internal note',
      'Ready for review',
      'Looks good',
    ]);

    // The client role reaches nothing else; staff without a portal link reach no portal.
    expect((await client.get('/projects', contact.token)).status).toBe(403);
    expect((await client.get('/employees', contact.token)).status).toBe(403);
    expect((await client.get('/me/timesheet', contact.token)).status).toBe(403);
    expect((await client.get('/portal', owner.accessToken)).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = await registerAccount(client, 'Other');
    expect((await client.get(`/projects/${project.id}`, other.accessToken)).status).toBe(404);
    expect(data<unknown[]>(await client.get('/clients', other.accessToken))).toEqual([]);
    expect((await client.get(`/invoices`, other.accessToken)).body.data).toEqual([]);
  });
});
