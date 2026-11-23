/**
 * Phase 08 expenses, travel and assets against PostgreSQL. Policy limits below are fictional test
 * values — every real limit is the organization's own policy.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
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
let finance: { token: string };
let co: { id: string };
let boss: { id: string; token: string };
let emp: { id: string; token: string };
let meals: { id: string };
let allowance: { id: string };
let claimId: string;

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Spend');
  co = await create('/companies', { code: 'SPD', name: 'Spend Co' });
  finance = await invite('finance');
  const bm = await invite('employee');
  boss = {
    ...(await create('/employees', {
      firstName: 'Bina',
      dateOfJoining: '2025-01-01',
      companyId: co.id,
      employmentType: 'FULL_TIME',
      membershipId: bm.membershipId,
    })),
    token: bm.token,
  };
  const em = await invite('employee');
  emp = {
    ...(await create('/employees', {
      firstName: 'Esha',
      dateOfJoining: '2025-01-01',
      companyId: co.id,
      employmentType: 'FULL_TIME',
      membershipId: em.membershipId,
      managerId: boss.id,
    })),
    token: em.token,
  };
  meals = await create('/expenses/categories', {
    code: 'MEALS',
    name: 'Meals',
    maxPerItem: '1000',
    receiptRequiredAbove: '500',
  });
  allowance = await create('/expenses/categories', {
    code: 'ALLOW',
    name: 'Daily allowance',
    taxable: true,
  });
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

async function invite(roleKey: string) {
  const roles = await client.get('/roles', owner.accessToken);
  const roleId = (roles.body.data as { id: string; key: string }[]).find(
    (r) => r.key === roleKey,
  )?.id;
  const email = uniqueEmail(roleKey);
  await client.post('/invitations', { email, roleIds: [roleId] }, owner.accessToken);
  const token = tokenFromLink((await waitForEmail(email)).text, '/accept-invitation');
  const accepted = await client.post('/invitations/accept', {
    token,
    fullName: `Spend ${roleKey}`,
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  return {
    token: accepted.body.data.accessToken as string,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

const recent = (daysAgo: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
};

type Claim = {
  id: string;
  status: string;
  totalClaimed: string;
  totalApproved: string | null;
  items: { id: string; amount: string; approvedAmount: string | null }[];
  issues: { code: string; severity: string }[];
  approver: { id: string } | null;
};

describe('expense claims', () => {
  it('checks the policy, routes to the manager, then finance verifies amounts', async () => {
    const draft = await create(
      '/me/expense-claims',
      {
        title: 'Customer visit',
        items: [
          { categoryId: meals.id, date: recent(3), description: 'Lunch', originalAmount: '600' },
          {
            categoryId: meals.id,
            date: recent(2),
            description: 'Dinner',
            originalAmount: '1200',
            justification: 'Client dinner',
          },
          {
            categoryId: allowance.id,
            date: recent(2),
            days: 2,
            description: 'Allowance',
            currency: 'USD',
            originalAmount: '10',
            exchangeRate: '83.5',
          },
        ],
      },
      emp.token,
    );
    claimId = draft.id;
    const claim = draft as unknown as Claim;
    expect(claim).toMatchObject({ status: 'DRAFT', totalClaimed: '2635.00' });
    // Two receipts missing (both over 500); the over-limit dinner is justified.
    expect(claim.issues.map((i) => `${i.code}:${i.severity}`)).toEqual([
      'RECEIPT_REQUIRED:BLOCK',
      'RECEIPT_REQUIRED:BLOCK',
    ]);
    expect((await client.post(`/expense-claims/${claimId}/submit`, {}, emp.token)).status).toBe(
      400,
    );

    for (const item of claim.items.slice(0, 2)) {
      const up = await request(server())
        .post(`/api/v1/expense-claims/${claimId}/items/${item.id}/receipt`)
        .set('Authorization', `Bearer ${emp.token}`)
        .attach('file', PDF, { filename: 'bill.pdf', contentType: 'application/pdf' });
      expect(up.status, JSON.stringify(up.body)).toBe(201);
    }
    const submitted = data<Claim>(
      await client.post(`/expense-claims/${claimId}/submit`, {}, emp.token),
    );
    expect(submitted).toMatchObject({ status: 'SUBMITTED', approver: { id: boss.id } });

    // Not the claimant, not finance: only the reporting manager decides this step.
    expect(
      (
        await client.post(
          `/expense-claims/${claimId}/manager-decision`,
          { decision: 'APPROVED' },
          emp.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await client.post(
          `/expense-claims/${claimId}/manager-decision`,
          { decision: 'APPROVED' },
          finance.token,
        )
      ).status,
    ).toBe(403);
    const inbox = data<{ id: string }[]>(
      await client.get('/expense-claims?scope=approvals', boss.token),
    );
    expect(inbox.map((c) => c.id)).toContain(claimId);
    data(
      await client.post(
        `/expense-claims/${claimId}/manager-decision`,
        { decision: 'APPROVED' },
        boss.token,
      ),
    );

    const dinner = claim.items[1]?.id ?? '';
    const verified = data<Claim>(
      await client.post(
        `/expense-claims/${claimId}/finance-decision`,
        {
          decision: 'APPROVED',
          payoutMethod: 'PAYROLL',
          items: [{ itemId: dinner, approvedAmount: '1000', note: 'Policy limit' }],
        },
        finance.token,
      ),
    );
    expect(verified).toMatchObject({ status: 'FINANCE_APPROVED', totalApproved: '2435.00' });
    expect(verified.items.map((i) => i.approvedAmount)).toEqual(['600.00', '1000.00', '835.00']);
  });

  it('freezes submitted items in the database and hides claims from other tenants', async () => {
    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.organization_id', $1, true)`, [owner.organizationId]);
      await expect(
        db.query(`UPDATE expense_items SET amount = 1 WHERE claim_id = $1`, [claimId]),
      ).rejects.toThrow(/cannot change/);
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
    const outsider = await registerAccount(client, 'Other Spend');
    expect((await client.get(`/expense-claims/${claimId}`, outsider.accessToken)).status).toBe(404);
    expect((await client.get(`/expense-claims/${claimId}`, boss.token)).status).toBe(200);
  });

  it('pays approved claims through payroll and marks them reimbursed when the run is finalized', async () => {
    const basic = await create('/payroll/components', {
      code: 'BASIC',
      name: 'Basic',
      kind: 'EARNING',
    });
    const structure = await create('/payroll/structures', {
      name: 'Flat',
      components: [{ componentId: basic.id, calc: { type: 'BALANCING' } }],
    });
    for (const e of [emp, boss]) {
      await create(`/payroll/employees/${e.id}/salaries`, {
        structureId: structure.id,
        annualCtc: '120000',
        effectiveFrom: '2025-01-01',
        reason: 'JOINING',
      });
      data(
        await client.put(
          `/payroll/employees/${e.id}/profile`,
          { pfApplicable: false, esiApplicable: false, taxApplicable: false },
          owner.accessToken,
        ),
      );
    }
    data(
      await client.put(
        '/payroll/settings',
        { payableDaysMethod: 'CALENDAR_DAYS', absentIsLossOfPay: false },
        owner.accessToken,
      ),
    );
    const run = await create('/payroll/runs', { companyId: co.id, year: 2026, month: 10 });
    data(await client.post(`/payroll/runs/${run.id}/calculate`, {}, owner.accessToken));
    const results = data<{ employee: { id: string }; lines: { code: string; amount: string }[] }[]>(
      await client.get(`/payroll/runs/${run.id}/results`, owner.accessToken),
    );
    const lines = Object.fromEntries(
      (results.find((r) => r.employee.id === emp.id)?.lines ?? []).map((l) => [l.code, l.amount]),
    );
    // 600 + 1000 meals are not taxable; the 835 allowance category is taxable.
    expect(lines).toMatchObject({
      BASIC: '10000.00',
      EXP_REIMB: '1600.00',
      EXP_REIMB_TX: '835.00',
    });
    expect(
      (
        await client.post(
          `/expense-claims/${claimId}/mark-paid`,
          { paidOn: recent(0), reference: 'X' },
          finance.token,
        )
      ).status,
    ).toBe(409);
    data(
      await client.post(
        `/payroll/runs/${run.id}/decision`,
        { decision: 'APPROVED' },
        finance.token,
      ),
    );
    data(await client.post(`/payroll/runs/${run.id}/finalize`, {}, owner.accessToken));
    const paid = data<{ status: string; paidReference: string }>(
      await client.get(`/expense-claims/${claimId}`, emp.token),
    );
    expect(paid).toMatchObject({ status: 'REIMBURSED', paidReference: 'Payroll 2026-10' });
  });
});

describe('travel', () => {
  it('approves, books, advances and settles a trip net of claims, recovering the balance through payroll', async () => {
    const start = recent(10);
    const trip = await create(
      '/me/trips',
      {
        purpose: 'Site audit',
        startDate: start,
        endDate: recent(8),
        legs: [{ from: 'Bengaluru', to: 'Chennai', departOn: start, mode: 'TRAIN' }],
        advanceRequested: '5000',
      },
      emp.token,
    );
    expect(
      (await client.post(`/trips/${trip.id}/decision`, { decision: 'APPROVED' }, emp.token)).status,
    ).toBe(403);
    data(await client.post(`/trips/${trip.id}/decision`, { decision: 'APPROVED' }, boss.token));
    await create(
      `/trips/${trip.id}/bookings`,
      { type: 'TRAIN', vendor: 'Railways', bookedOn: start, amount: '1500' },
      finance.token,
    );
    await create(
      `/trips/${trip.id}/advances`,
      { amount: '5000', paidOn: start, reference: 'ADV-1' },
      finance.token,
    );

    const claim = await create(
      '/me/expense-claims',
      {
        title: 'Audit trip',
        tripId: trip.id,
        items: [
          {
            categoryId: allowance.id,
            date: start,
            days: 3,
            description: 'Allowance',
            originalAmount: '3000',
          },
        ],
      },
      emp.token,
    );
    data(await client.post(`/expense-claims/${claim.id}/submit`, {}, emp.token));
    expect(
      (await client.post(`/trips/${trip.id}/settle`, { recovery: 'PAYROLL' }, finance.token))
        .status,
    ).toBe(409);
    data(
      await client.post(
        `/expense-claims/${claim.id}/manager-decision`,
        { decision: 'APPROVED' },
        boss.token,
      ),
    );
    data(
      await client.post(
        `/expense-claims/${claim.id}/finance-decision`,
        { decision: 'APPROVED', payoutMethod: 'PAYROLL' },
        finance.token,
      ),
    );

    const before = data<{ settlement: { balance: string; direction: string } }>(
      await client.get(`/trips/${trip.id}`, emp.token),
    );
    expect(before.settlement).toMatchObject({ balance: '-2000.00', direction: 'RECOVERABLE' });
    const settled = data<{ status: string; settlementBalance: string; recoveryMethod: string }>(
      await client.post(`/trips/${trip.id}/settle`, { recovery: 'PAYROLL' }, finance.token),
    );
    expect(settled).toMatchObject({
      status: 'SETTLED',
      settlementBalance: '-2000.00',
      recoveryMethod: 'PAYROLL',
    });
    const c = data<{ status: string; paidReference: string }>(
      await client.get(`/expense-claims/${claim.id}`, emp.token),
    );
    expect(c).toMatchObject({ status: 'REIMBURSED', paidReference: 'Trip settlement' });

    const run = await create('/payroll/runs', { companyId: co.id, year: 2026, month: 11 });
    data(await client.post(`/payroll/runs/${run.id}/calculate`, {}, owner.accessToken));
    const results = data<
      { employee: { id: string }; lines: { code: string; amount: string; category: string }[] }[]
    >(await client.get(`/payroll/runs/${run.id}/results`, owner.accessToken));
    const lines = results.find((r) => r.employee.id === emp.id)?.lines ?? [];
    expect(lines.find((l) => l.code === 'TRAVEL_RECOVERY')).toMatchObject({
      amount: '2000.00',
      category: 'DEDUCTION',
    });
    // The trip claim was settled with the trip, so it is not reimbursed again.
    expect(lines.some((l) => l.code.startsWith('EXP_REIMB'))).toBe(false);
  });
});

describe('assets and licences', () => {
  it('allocates one asset at a time, records acknowledgement and return, and limits licence seats', async () => {
    const cat = data<{ id: string; code: string }[]>(
      await client.post(
        '/assets/categories',
        { code: 'LAPTOP', name: 'Laptops', usefulLifeMonths: 36, salvagePercent: '10' },
        owner.accessToken,
      ),
      201,
    ).find((x) => x.code === 'LAPTOP');
    const asset = await create('/assets', {
      tag: 'lap-001',
      name: 'Laptop 14"',
      categoryId: cat?.id,
      serialNumber: 'SN1',
      purchaseDate: '2025-01-15',
      purchaseCost: '120000',
    });
    expect(asset).toMatchObject({ tag: 'LAP-001', status: 'IN_STOCK' });
    const allocated = data<{ status: string; holder: { id: string } }>(
      await client.post(
        `/assets/${asset.id}/allocate`,
        { employeeId: emp.id, allocatedOn: recent(5) },
        owner.accessToken,
      ),
    );
    expect(allocated).toMatchObject({ status: 'ALLOCATED', holder: { id: emp.id } });
    expect(
      (
        await client.post(
          `/assets/${asset.id}/allocate`,
          { employeeId: boss.id, allocatedOn: recent(4) },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);

    const mine = data<{
      assets: { allocationId: string; tag: string; acknowledgedAt: string | null }[];
    }>(await client.get('/me/assets', emp.token));
    expect(mine.assets.map((a) => a.tag)).toEqual(['LAP-001']);
    const ack = data<{ assets: { acknowledgedAt: string | null }[] }>(
      await client.post(
        `/me/assets/${mine.assets[0]?.allocationId ?? ''}/acknowledge`,
        {},
        emp.token,
      ),
    );
    expect(ack.assets[0]?.acknowledgedAt).not.toBeNull();
    expect((await client.get('/assets', emp.token)).status).toBe(403);

    const back = data<{ status: string; holder: null; allocations: { returnCondition: string }[] }>(
      await client.post(
        `/assets/${asset.id}/return`,
        {
          returnedOn: recent(1),
          condition: 'DAMAGED',
          note: 'Cracked hinge',
          toStatus: 'IN_REPAIR',
        },
        owner.accessToken,
      ),
    );
    expect(back).toMatchObject({ status: 'IN_REPAIR', holder: null });
    expect(back.allocations[0]?.returnCondition).toBe('DAMAGED');

    const [lic] = data<{ id: string; seats: number }[]>(
      await client.post('/licenses', { name: 'Design suite', seats: 1 }, owner.accessToken),
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
    expect(
      (
        await client.post(
          `/licenses/${lic?.id ?? ''}/seats`,
          { employeeId: boss.id },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    expect(
      (await client.patch(`/licenses/${lic?.id ?? ''}`, { seats: 0 }, owner.accessToken)).status,
    ).toBe(400);
  });

  it('flags unreturned assets and licence seats in the full & final settlement', async () => {
    data(
      await client.post(
        `/employees/${emp.id}/separation`,
        { separationType: 'RESIGNATION', resignationDate: recent(1), lastWorkingDate: recent(0) },
        owner.accessToken,
      ),
    );
    const s = await create('/payroll/settlements', { employeeId: emp.id, includeGratuity: false });
    const codes = (s.problems as { code: string }[]).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['LICENSES_ASSIGNED']));
  });
});
