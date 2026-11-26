/**
 * Phase 11a approval workflows against PostgreSQL. Chains and thresholds are fictional test
 * configuration.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInTenantJobContext } from '../../src/infrastructure/queue/tenant-job.js';
import { WorkflowsService } from '../../src/modules/workflows/workflows.service.js';
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
let bigboss: Person;
let boss: Person;
let emp: Person;
let fin: Person;
let deputy: Person;

/** A Monday about three weeks ahead (plus n days), so leave covers working days. */
const monday = (n = 0) => {
  const d = new Date(Date.now() + 21 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - (d.getUTCDay() || 7)) % 7) + n);
  return d.toISOString().slice(0, 10);
};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Workflows');
  co = await create('/companies', { code: 'WF', name: 'Workflow Co' });
  await create('/work-weeks', {
    name: 'Mon–Fri',
    isDefault: true,
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'FULL' })),
  });
  bigboss = await person('Bharat');
  boss = await person('Bina', bigboss.id);
  emp = await person('Esha', boss.id);
  deputy = await person('Dev', bigboss.id);
  fin = await person('Farah', bigboss.id, 'finance');
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

async function person(
  firstName: string,
  managerId?: string,
  roleKey = 'employee',
): Promise<Person> {
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
  const e = await create('/employees', {
    firstName,
    dateOfJoining: '2025-01-01',
    companyId: co.id,
    employmentType: 'FULL_TIME',
    membershipId: me.body.data.activeOrganization.membershipId,
    ...(managerId ? { managerId } : {}),
  });
  return { id: e.id, token: accepted.body.data.accessToken as string };
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

type Task = {
  id: string;
  subjectId: string;
  stepName: string;
  stepNumber: number;
  stepCount: number;
  onBehalfOf: { id: string } | null;
  escalatedFrom: { id: string } | null;
  summary: string;
};
type Trip = { id: string; status: string; can: { decide: boolean } };

const trip = (cost: string, token = emp.token) =>
  create(
    '/me/trips',
    {
      purpose: 'Client visit',
      startDate: day(10),
      endDate: day(12),
      legs: [{ from: 'Pune', to: 'Delhi', departOn: day(10), mode: 'FLIGHT' }],
      estimatedCost: cost,
    },
    token,
  );
const inbox = async (p: Person) => data<Task[]>(await client.get('/me/approval-tasks', p.token));

describe('travel workflow', () => {
  let definitionId: string;

  it('validates and activates one definition per process', async () => {
    expect(
      (
        await client.post(
          '/workflows',
          {
            process: 'TRAVEL_REQUEST',
            name: 'Bad',
            steps: [{ name: 'x', approver: { type: 'ROLE', roleKey: 'nope' } }],
          },
          owner.accessToken,
        )
      ).body.error.message,
    ).toMatch(/role nope does not exist/);
    const defs = data<{ id: string; status: string }[]>(
      await client.post(
        '/workflows',
        {
          process: 'TRAVEL_REQUEST',
          name: 'Travel',
          steps: [
            { name: 'Manager', approver: { type: 'REPORTING_MANAGER' } },
            {
              name: 'Finance',
              approver: { type: 'ROLE', roleKey: 'finance' },
              minMeasure: '50000',
              slaHours: 24,
              escalateTo: { type: 'NEXT_MANAGER' },
            },
          ],
        },
        owner.accessToken,
      ),
      201,
    );
    definitionId = defs[0]?.id ?? '';
    expect(defs[0]?.status).toBe('INACTIVE');
    data(
      await client.put(
        `/workflows/${definitionId}/status`,
        { status: 'ACTIVE' },
        owner.accessToken,
      ),
    );
    await asApp(async (db) => {
      await expect(
        db.query(
          `INSERT INTO workflow_definitions (id, organization_id, process, name, status, steps, updated_at)
           VALUES (gen_random_uuid(), $1, 'TRAVEL_REQUEST', 'Second', 'ACTIVE', '[{"name":"x","approver":{"type":"REPORTING_MANAGER"}}]', now())`,
          [owner.organizationId],
        ),
      ).rejects.toThrow(/workflow_definitions_one_active_key/);
    });
  });

  it('adds the finance step only above the threshold and finishes on the last approval', async () => {
    const small = await trip('20000');
    const big = await trip('80000');
    const bossTasks = await inbox(boss);
    expect(bossTasks.map((t) => t.subjectId).sort()).toEqual([small.id, big.id].sort());
    expect(bossTasks.find((t) => t.subjectId === big.id)).toMatchObject({
      stepName: 'Manager',
      stepNumber: 1,
      stepCount: 2,
    });
    // Finance does not see the trip before the manager approves it.
    expect(await inbox(fin)).toEqual([]);

    // The small trip completes on the manager's approval, from the inbox.
    const smallTask = bossTasks.find((t) => t.subjectId === small.id);
    data(
      await client.post(
        `/approvals/${smallTask?.id ?? ''}/decision`,
        { decision: 'APPROVED' },
        boss.token,
      ),
      201,
    );
    expect(data<Trip>(await client.get(`/trips/${small.id}`, emp.token)).status).toBe('APPROVED');

    // The big one moves to finance, through the module's own endpoint.
    const afterManager = data<Trip>(
      await client.post(`/trips/${big.id}/decision`, { decision: 'APPROVED' }, boss.token),
    );
    expect(afterManager.status).toBe('SUBMITTED');
    expect(
      (await client.post(`/trips/${big.id}/decision`, { decision: 'APPROVED' }, boss.token)).status,
    ).toBe(403);
    const finTask = (await inbox(fin))[0];
    expect(finTask).toMatchObject({ subjectId: big.id, stepName: 'Finance', stepNumber: 2 });
    expect(data<Trip>(await client.get(`/trips/${big.id}`, fin.token)).can.decide).toBe(true);
    data(
      await client.post(
        `/approvals/${finTask?.id ?? ''}/decision`,
        { decision: 'APPROVED' },
        fin.token,
      ),
      201,
    );
    expect(data<Trip>(await client.get(`/trips/${big.id}`, emp.token)).status).toBe('APPROVED');

    const history = data<
      { status: string; steps: { name: string; status: string; decidedBy: string | null }[] }[]
    >(await client.get(`/approvals/history?process=TRAVEL_REQUEST&subjectId=${big.id}`, emp.token));
    expect(history[0]).toMatchObject({ status: 'APPROVED' });
    expect(history[0]?.steps.map((s) => [s.name, s.status, s.decidedBy])).toEqual([
      ['Manager', 'APPROVED', 'Bina'],
      ['Finance', 'APPROVED', 'Farah'],
    ]);
    expect(
      (
        await client.get(
          `/approvals/history?process=TRAVEL_REQUEST&subjectId=${big.id}`,
          deputy.token,
        )
      ).status,
    ).toBe(404);

    // A decided step never changes.
    await asApp(async (db) => {
      await expect(
        db.query(
          `UPDATE workflow_tasks SET note = 'x' WHERE instance_id IN (SELECT id FROM workflow_instances WHERE subject_id = $1)`,
          [big.id],
        ),
      ).rejects.toThrow(/decided approval step|finished approval/);
    });
  });

  it('rejects on any step and never asks the requester to approve', async () => {
    const t = await trip('90000');
    data(await client.post(`/trips/${t.id}/decision`, { decision: 'APPROVED' }, boss.token));
    expect(
      (await client.post(`/trips/${t.id}/decision`, { decision: 'REJECTED' }, fin.token)).status,
    ).toBe(400); // reason required
    expect(
      data<Trip>(
        await client.post(
          `/trips/${t.id}/decision`,
          { decision: 'REJECTED', note: 'Over budget' },
          fin.token,
        ),
      ).status,
    ).toBe('REJECTED');

    // Finance's own big trip: the finance role step has nobody else, so it is skipped.
    const own = await trip('90000', fin.token);
    const bigbossTask = (await inbox(bigboss)).find((x) => x.subjectId === own.id);
    expect(bigbossTask?.stepName).toBe('Manager');
    data(
      await client.post(
        `/approvals/${bigbossTask?.id ?? ''}/decision`,
        { decision: 'APPROVED' },
        bigboss.token,
      ),
      201,
    );
    expect(data<Trip>(await client.get(`/trips/${own.id}`, fin.token)).status).toBe('APPROVED');
    const h = data<{ steps: { status: string; skippedReason: string | null }[] }[]>(
      await client.get(`/approvals/history?process=TRAVEL_REQUEST&subjectId=${own.id}`, fin.token),
    );
    expect(h[0]?.steps[1]).toMatchObject({
      status: 'SKIPPED',
      skippedReason: 'the approver is the requester',
    });
  });

  it('hands steps to a delegate and escalates late steps', async () => {
    const given = data<{ given: { id: string }[] }>(
      await client.post(
        '/me/delegations',
        { delegateEmployeeId: deputy.id, from: day(0), to: day(5) },
        boss.token,
      ),
      201,
    );
    expect(
      (
        await client.post(
          '/me/delegations',
          { delegateEmployeeId: deputy.id, from: day(1), to: day(2) },
          boss.token,
        )
      ).status,
    ).toBe(409);
    const t = await trip('80000');
    const task = (await inbox(deputy)).find((x) => x.subjectId === t.id);
    expect(task?.onBehalfOf?.id).toBe(boss.id);
    expect((await inbox(boss)).some((x) => x.subjectId === t.id)).toBe(false);
    data(
      await client.post(
        `/approvals/${task?.id ?? ''}/decision`,
        { decision: 'APPROVED' },
        deputy.token,
      ),
      201,
    );

    // The finance step has a 24 h SLA: once overdue, the sweep moves it to Farah's manager.
    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.organization_id', $1, true)`, [owner.organizationId]);
    await db.query(
      `UPDATE workflow_tasks SET due_at = now() - interval '1 hour'
       WHERE status = 'PENDING' AND instance_id IN (SELECT id FROM workflow_instances WHERE subject_id = $1)`,
      [t.id],
    );
    await db.query('COMMIT');
    await db.end();
    const workflows = app.get(WorkflowsService);
    expect(await workflows.tenantsWithOverdue()).toContain(owner.organizationId);
    const n = await runInTenantJobContext({ organizationId: owner.organizationId }, () =>
      workflows.escalate(owner.organizationId),
    );
    expect(n).toBe(1);
    const escalated = (await inbox(bigboss)).find((x) => x.subjectId === t.id);
    expect(escalated).toMatchObject({ stepName: 'Finance', escalatedFrom: { id: fin.id } });
    expect((await inbox(fin)).some((x) => x.subjectId === t.id)).toBe(false);
    data(
      await client.post(
        `/approvals/${escalated?.id ?? ''}/decision`,
        { decision: 'APPROVED' },
        bigboss.token,
      ),
      201,
    );
    expect(data<Trip>(await client.get(`/trips/${t.id}`, emp.token)).status).toBe('APPROVED');
    // Revoking ends the delegation; new steps go to the delegator again.
    const left = data<{ given: unknown[] }>(
      await client.delete(`/me/delegations/${given.given[0]?.id ?? ''}`, boss.token),
    );
    expect(left.given).toEqual([]);
  });

  it('keeps the built-in rule when the workflow is switched off, and isolates tenants', async () => {
    data(
      await client.put(
        `/workflows/${definitionId}/status`,
        { status: 'INACTIVE' },
        owner.accessToken,
      ),
    );
    const t = await trip('80000');
    expect(await inbox(boss)).toEqual([]);
    expect(
      data<Trip>(await client.post(`/trips/${t.id}/decision`, { decision: 'APPROVED' }, boss.token))
        .status,
    ).toBe('APPROVED');
    const other = await registerAccount(client, 'Other WF');
    expect(data<unknown[]>(await client.get('/workflows', other.accessToken))).toEqual([]);
  });
});

describe('leave workflow', () => {
  it('books leave only when the last step approves', async () => {
    const type = await create('/leave/types', {
      code: 'CL',
      name: 'Casual leave',
      accrualMethod: 'YEARLY',
      annualQuota: '12',
    });
    data(
      await client.post(
        '/workflows',
        {
          process: 'LEAVE_REQUEST',
          name: 'Leave',
          steps: [
            { name: 'Manager', approver: { type: 'REPORTING_MANAGER' } },
            { name: 'Skip level', approver: { type: 'MANAGER_LEVEL', level: 2 }, minMeasure: '2' },
          ],
        },
        owner.accessToken,
      ),
      201,
    );
    const defs = data<{ id: string; process: string; status: string }[]>(
      await client.get('/workflows', owner.accessToken),
    );
    const leaveDef = defs.find((d) => d.process === 'LEAVE_REQUEST');
    data(
      await client.put(
        `/workflows/${leaveDef?.id ?? ''}/status`,
        { status: 'ACTIVE' },
        owner.accessToken,
      ),
    );
    const req = await create(
      '/me/leave/requests',
      {
        leaveTypeId: type.id,
        startDate: monday(),
        endDate: monday(1),
        startSession: 'FULL',
        endSession: 'FULL',
      },
      emp.token,
    );
    const r1 = data<{ status: string }>(
      await client.post(`/leave/requests/${req.id}/decision`, { decision: 'APPROVED' }, boss.token),
    );
    expect(r1.status).toBe('PENDING');
    expect((await inbox(bigboss)).find((t) => t.subjectId === req.id)?.summary).toMatch(
      /Casual leave, 2\.00 day\(s\)/,
    );
    const r2 = data<{ status: string }>(
      await client.post(
        `/leave/requests/${req.id}/decision`,
        { decision: 'APPROVED' },
        bigboss.token,
      ),
    );
    expect(r2.status).toBe('APPROVED');
  });
});
