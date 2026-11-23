/**
 * Phase 07 payroll, end to end against PostgreSQL. Every statutory value below is a FICTIONAL
 * round number for testing (state "IN-XX" does not exist) — not a real rate or threshold.
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
let finance: { token: string };
let co: { id: string };
let asha: { id: string; token: string };
let ravi: { id: string };
let structureId: string;
let firstSalaryId: string;
let aprilRun: { id: string };

const rounding = { scale: 0, mode: 'HALF_UP' };
const FY = '2026-27';

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Payroll');
  co = await create('/companies', { code: 'PAY', name: 'Pay Co' });
  finance = await invite('finance');
  const m = await invite('employee');
  asha = {
    ...(await create('/employees', {
      firstName: 'Asha',
      dateOfJoining: '2025-01-01',
      companyId: co.id,
      employmentType: 'FULL_TIME',
      membershipId: m.membershipId,
      gender: 'FEMALE',
    })),
    token: m.token,
  };
  ravi = await create('/employees', {
    firstName: 'Ravi',
    dateOfJoining: '2025-01-01',
    companyId: co.id,
    employmentType: 'FULL_TIME',
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
function ok<T = Record<string, unknown>>(
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
    fullName: `Payroll ${roleKey}`,
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  return {
    token: accepted.body.data.accessToken as string,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

async function activeRule(body: object) {
  const r = await create('/payroll/rule-sets', body);
  expect(r.status).toBe('DRAFT');
  return ok(
    await client.put(`/payroll/rule-sets/${r.id}/status`, { status: 'ACTIVE' }, owner.accessToken),
  );
}

describe('payroll configuration', () => {
  it('builds components and an immutable structure', async () => {
    const flags = { taxable: true, esiWage: true, ptWage: true, prorate: true };
    const basic = await create('/payroll/components', {
      code: 'BASIC',
      name: 'Basic',
      kind: 'EARNING',
      ...flags,
      pfWage: true,
      payslipOrder: 1,
    });
    const hra = await create('/payroll/components', {
      code: 'HRA',
      name: 'House rent allowance',
      kind: 'EARNING',
      ...flags,
      payslipOrder: 2,
    });
    const special = await create('/payroll/components', {
      code: 'SPECIAL',
      name: 'Special allowance',
      kind: 'EARNING',
      ...flags,
      payslipOrder: 3,
    });
    const reserved = await client.post(
      '/payroll/components',
      { code: 'TDS', name: 'x', kind: 'DEDUCTION' },
      owner.accessToken,
    );
    expect(reserved.status).toBe(400);
    const s = await create('/payroll/structures', {
      name: 'Standard',
      components: [
        { componentId: basic.id, calc: { type: 'PERCENT_OF_CTC', percent: '40' } },
        {
          componentId: hra.id,
          calc: { type: 'PERCENT_OF_COMPONENT', percent: '50', componentCode: 'BASIC' },
        },
        { componentId: special.id, calc: { type: 'BALANCING' } },
      ],
    });
    structureId = s.id;
    expect((s.components as unknown[]).length).toBe(3);
  });

  it('keeps statutory rule sets as sourced drafts until activated, then frozen and non-overlapping', async () => {
    const epf = {
      type: 'EPF',
      name: 'EPF (test values)',
      effectiveFrom: '2025-04-01',
      sourceReference: 'Fictional test notification 1/2025',
      config: {
        employeeRatePercent: '10',
        employerRatePercent: '10',
        epsRatePercent: '6',
        epsWageCeiling: '20000',
        wageCeiling: '20000',
        rounding,
      },
    };
    const noSource = await client.post(
      '/payroll/rule-sets',
      { ...epf, sourceReference: '' },
      owner.accessToken,
    );
    expect(noSource.status).toBe(400);
    const active = await activeRule(epf);
    expect(active).toMatchObject({ status: 'ACTIVE', stateCode: null });
    const id = String(active.id);
    const edit = await client.put(
      `/payroll/rule-sets/${id}`,
      { ...epf, name: 'Changed' },
      owner.accessToken,
    );
    expect(edit.status).toBe(409);
    // A second active EPF rule set over the same dates is refused by the database.
    const dup = await create('/payroll/rule-sets', { ...epf, name: 'EPF duplicate' });
    expect(
      (
        await client.put(
          `/payroll/rule-sets/${dup.id}/status`,
          { status: 'ACTIVE' },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    expect((await client.delete(`/payroll/rule-sets/${dup.id}`, owner.accessToken)).status).toBe(
      204,
    );
    expect((await client.delete(`/payroll/rule-sets/${id}`, owner.accessToken)).status).toBe(409);

    // Even direct SQL as the application role cannot change an active rule set's config.
    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.organization_id', $1, true)`, [owner.organizationId]);
      await expect(
        db.query(`UPDATE statutory_rule_sets SET config = '{}'::jsonb WHERE id = $1`, [id]),
      ).rejects.toThrow(/cannot be edited/);
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }

    await activeRule({
      type: 'PT',
      name: 'PT IN-XX (test values)',
      effectiveFrom: '2025-04-01',
      sourceReference: 'Fictional test schedule',
      config: {
        stateCode: 'IN-XX',
        slabs: [
          { minWage: '0', maxWage: '9999', amount: '0' },
          { minWage: '10000', maxWage: null, amount: '200' },
        ],
      },
    });
    await activeRule({
      type: 'INCOME_TAX',
      name: 'Income tax new regime (test values)',
      effectiveFrom: '2026-04-01',
      effectiveTo: '2027-03-31',
      sourceReference: 'Fictional test schedule',
      config: {
        financialYear: FY,
        regime: 'NEW',
        slabs: [
          { upTo: '300000', ratePercent: '0' },
          { upTo: null, ratePercent: '10' },
        ],
        standardDeduction: '50000',
        rebate: null,
        surcharge: [],
        surchargeMarginalRelief: false,
        cessPercent: '0',
        deductionLimits: {},
        employeePfSection: null,
        professionalTaxDeductible: false,
        hra: null,
        incomeRoundingMultiple: '1',
        taxRoundingMultiple: '1',
      },
    });
    await activeRule({
      type: 'GRATUITY',
      name: 'Gratuity (test values)',
      effectiveFrom: '2025-04-01',
      sourceReference: 'Fictional test schedule',
      config: {
        daysPerYear: '15',
        monthDivisor: '26',
        minYears: '5',
        roundUpMonths: 6,
        cap: null,
        wageComponentCodes: ['BASIC'],
      },
    });
    ok(
      await client.put(
        '/payroll/settings',
        {
          payableDaysMethod: 'CALENDAR_DAYS',
          absentIsLossOfPay: false,
          basicComponentCodes: ['BASIC'],
          defaultTaxRegime: 'NEW',
        },
        owner.accessToken,
      ),
    );
  });

  it('sets salaries and payroll profiles', async () => {
    for (const e of [asha, ravi]) {
      const item = await create(`/payroll/employees/${e.id}/salaries`, {
        structureId,
        annualCtc: '600000',
        effectiveFrom: '2025-01-01',
        reason: 'JOINING',
      });
      const current = item.current as { breakdown: { lines: { code: string; monthly: string }[] } };
      expect(current.breakdown.lines.map((l) => [l.code, l.monthly])).toEqual([
        ['BASIC', '20000.00'],
        ['HRA', '10000.00'],
        ['SPECIAL', '20000.00'],
      ]);
      ok(
        await client.put(
          `/payroll/employees/${e.id}/profile`,
          { pfApplicable: true, esiApplicable: false, ptStateCode: 'IN-XX', metroCity: false },
          owner.accessToken,
        ),
      );
    }
    const asha0 = ok<{ salaries: { id: string }[] }>(
      await client.get(`/payroll/employees/${asha.id}`, owner.accessToken),
    );
    firstSalaryId = asha0.salaries[0]?.id ?? '';
    // Salaries are payroll data, not visible to employees through HR endpoints.
    expect((await client.get(`/payroll/employees/${asha.id}`, asha.token)).status).toBe(403);
  });
});

describe('payroll runs', () => {
  it('calculates, needs a second person to approve, and finalizes into payslips', async () => {
    aprilRun = await create('/payroll/runs', { companyId: co.id, year: 2026, month: 4 });
    expect(
      (
        await client.post(
          '/payroll/runs',
          { companyId: co.id, year: 2026, month: 4 },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    const run = ok<{
      status: string;
      employeeCount: number;
      problemCount: number;
      totals: { net: string };
      canApprove: boolean;
    }>(await client.post(`/payroll/runs/${aprilRun.id}/calculate`, {}, owner.accessToken));
    expect(run).toMatchObject({
      status: 'CALCULATED',
      employeeCount: 2,
      problemCount: 0,
      canApprove: false,
    });
    const results = ok<
      {
        employee: { id: string };
        gross: string;
        netPay: string;
        lines: { code: string; amount: string }[];
      }[]
    >(await client.get(`/payroll/runs/${aprilRun.id}/results`, owner.accessToken));
    const a = results.find((r) => r.employee.id === asha.id);
    // Gross 50000; PF 10 % of 20000 = 2000; PT 200; TDS (600000 − 50000 − 300000) × 10 % ÷ 12 = 2083
    expect(a?.gross).toBe('50000.00');
    expect(Object.fromEntries((a?.lines ?? []).map((l) => [l.code, l.amount]))).toMatchObject({
      EPF_EE: '2000.00',
      EPF_ER: '800.00',
      EPS_ER: '1200.00',
      PT: '200.00',
      TDS: '2083.00',
    });
    expect(a?.netPay).toBe('45717.00');
    expect(run.totals.net).toBe('91434.00');

    expect(
      (
        await client.post(
          `/payroll/runs/${aprilRun.id}/decision`,
          { decision: 'APPROVED' },
          owner.accessToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await client.post(`/payroll/runs/${aprilRun.id}/finalize`, {}, owner.accessToken)).status,
    ).toBe(409);
    ok(
      await client.post(
        `/payroll/runs/${aprilRun.id}/decision`,
        { decision: 'APPROVED' },
        finance.token,
      ),
    );
    const final = ok<{ status: string }>(
      await client.post(`/payroll/runs/${aprilRun.id}/finalize`, {}, owner.accessToken),
    );
    expect(final.status).toBe('FINALIZED');
    expect(
      (await client.post(`/payroll/runs/${aprilRun.id}/calculate`, {}, owner.accessToken)).status,
    ).toBe(409);

    const slips = ok<{ resultId: string; netPay: string; month: number }[]>(
      await client.get('/me/payslips', asha.token),
    );
    expect(slips).toMatchObject([{ month: 4, netPay: '45717.00' }]);
    const slip = ok<{ taxRegime: string; annualTaxProjection: string; bankAccount: unknown }>(
      await client.get(`/me/payslips/${slips[0]?.resultId ?? ''}`, asha.token),
    );
    expect(slip).toMatchObject({
      taxRegime: 'NEW',
      annualTaxProjection: '25000.00',
      bankAccount: null,
    });
    expect((await client.get('/payroll/runs', asha.token)).status).toBe(403);
  });

  it('keeps finalized results immutable and exports an audited bank file', async () => {
    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.organization_id', $1, true)`, [owner.organizationId]);
      await expect(
        db.query(
          `UPDATE payroll_results SET net_pay = 1, gross = 1, total_deductions = 0 WHERE run_id = $1`,
          [aprilRun.id],
        ),
      ).rejects.toThrow(/finalized/);
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
    const file = await client.get(`/payroll/runs/${aprilRun.id}/bank-file`, owner.accessToken);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/text\/csv/);
    const csv = file.text.trim().split('\r\n');
    expect(csv[0]).toBe(
      'employee_number,employee_name,account_holder,bank_name,ifsc,account_type,account_number,amount,reference,status',
    );
    expect(csv.slice(1).every((l) => l.endsWith('SALARY 2026-04,NO_PRIMARY_BANK_ACCOUNT'))).toBe(
      true,
    );
    const audit = await client.get('/audit-logs?action=payroll.bank_file', owner.accessToken);
    expect((audit.body.data as unknown[]).length).toBeGreaterThan(0);
  });

  it('pays arrears for a back-dated revision and protects salaries used by finalized runs', async () => {
    expect(
      (
        await client.delete(
          `/payroll/employees/${asha.id}/salaries/${firstSalaryId}`,
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    await create(`/payroll/employees/${asha.id}/salaries`, {
      structureId,
      annualCtc: '720000',
      effectiveFrom: '2026-04-01',
      reason: 'REVISION',
    });
    const may = await create('/payroll/runs', { companyId: co.id, year: 2026, month: 5 });
    ok(await client.post(`/payroll/runs/${may.id}/calculate`, {}, owner.accessToken));
    const results = ok<
      {
        employee: { id: string };
        gross: string;
        lines: { code: string; amount: string; forYear: number | null; forMonth: number | null }[];
      }[]
    >(await client.get(`/payroll/runs/${may.id}/results`, owner.accessToken));
    const a = results.find((r) => r.employee.id === asha.id);
    // May at 60000 plus April arrears 24000−20000, 12000−10000, 24000−20000.
    expect(a?.gross).toBe('70000.00');
    const arrears = (a?.lines ?? []).filter((l) => l.code.startsWith('ARR_'));
    expect(arrears.map((l) => [l.code, l.amount, l.forYear, l.forMonth])).toEqual([
      ['ARR_BASIC', '4000.00', 2026, 4],
      ['ARR_HRA', '2000.00', 2026, 4],
      ['ARR_SPECIAL', '4000.00', 2026, 4],
    ]);
    const ravis = results.find((r) => r.employee.id === ravi.id);
    expect(ravis?.lines.some((l) => l.code.startsWith('ARR_'))).toBe(false);
    ok(
      await client.post(
        `/payroll/runs/${may.id}/decision`,
        { decision: 'APPROVED' },
        finance.token,
      ),
    );
    ok(await client.post(`/payroll/runs/${may.id}/finalize`, {}, owner.accessToken));
  });

  it('reports missing statutory rules as problems and blocks approval', async () => {
    const other = await create('/companies', { code: 'PAY2', name: 'Pay Two' });
    const e = await create('/employees', {
      firstName: 'Esi',
      dateOfJoining: '2025-01-01',
      companyId: other.id,
      employmentType: 'FULL_TIME',
    });
    await create(`/payroll/employees/${e.id}/salaries`, {
      structureId,
      annualCtc: '240000',
      effectiveFrom: '2025-01-01',
      reason: 'JOINING',
    });
    ok(
      await client.put(
        `/payroll/employees/${e.id}/profile`,
        { pfApplicable: false, esiApplicable: true, ptStateCode: 'IN-YY' },
        owner.accessToken,
      ),
    );
    const run = await create('/payroll/runs', { companyId: other.id, year: 2026, month: 4 });
    const calc = ok<{ problemCount: number }>(
      await client.post(`/payroll/runs/${run.id}/calculate`, {}, owner.accessToken),
    );
    expect(calc.problemCount).toBe(1);
    const [r] = ok<{ problems: { code: string }[] }[]>(
      await client.get(`/payroll/runs/${run.id}/results?problemsOnly=true`, owner.accessToken),
    );
    expect(r?.problems.map((p) => p.code).sort()).toEqual(['ESI_RULE_MISSING', 'PT_RULE_MISSING']);
    expect(
      (
        await client.post(
          `/payroll/runs/${run.id}/decision`,
          { decision: 'APPROVED' },
          finance.token,
        )
      ).status,
    ).toBe(409);
  });

  it('lets employees declare their regime and investments for the year', async () => {
    const before = ok<{ regime: string; updatedAt: string | null }>(
      await client.get(`/me/tax-declarations/${FY}`, asha.token),
    );
    expect(before).toMatchObject({ regime: 'NEW', updatedAt: null });
    const saved = ok<{ regime: string; deductions: Record<string, string> }>(
      await client.put(
        '/me/tax-declarations',
        {
          financialYear: FY,
          regime: 'OLD',
          rentPaidAnnual: '120000',
          deductions: { '80c': '50000' },
        },
        asha.token,
      ),
    );
    expect(saved).toMatchObject({ regime: 'OLD', deductions: { '80C': '50000.00' } });
    expect(
      (
        await client.put(
          '/me/tax-declarations',
          { financialYear: '2026-28', regime: 'OLD' },
          asha.token,
        )
      ).status,
    ).toBe(400);
  });
});

describe('full & final settlement', () => {
  it('settles the final month with leave encashment, excluded from the regular run', async () => {
    ok(
      await client.post(
        `/employees/${ravi.id}/separation`,
        {
          separationType: 'RESIGNATION',
          resignationDate: '2026-05-15',
          lastWorkingDate: '2026-06-15',
        },
        owner.accessToken,
      ),
    );
    const s = await create('/payroll/settlements', {
      employeeId: ravi.id,
      leaveEncashmentDays: '10',
      encashmentComponentCodes: ['BASIC'],
      encashmentDivisor: 30,
    });
    // 10 days × 20000 ÷ 30; 1.5 years of service is below the configured gratuity minimum.
    expect(s).toMatchObject({
      status: 'CALCULATED',
      leaveEncashment: '6666.67',
      gratuity: '0.00',
      problems: [],
    });
    const lines = s.lines as { code: string; amount: string }[];
    expect(lines.find((l) => l.code === 'LEAVE_ENCASH')?.amount).toBe('6666.67');
    expect(lines.find((l) => l.code === 'BASIC')?.amount).toBe('10000.00');
    expect(
      (
        await client.post(
          `/payroll/settlements/${s.id}/decision`,
          { decision: 'APPROVED' },
          owner.accessToken,
        )
      ).status,
    ).toBe(403);
    ok(
      await client.post(
        `/payroll/settlements/${s.id}/decision`,
        { decision: 'APPROVED' },
        finance.token,
      ),
    );
    const done = ok<{ status: string }>(
      await client.post(`/payroll/settlements/${s.id}/finalize`, {}, owner.accessToken),
    );
    expect(done.status).toBe('FINALIZED');

    const june = await create('/payroll/runs', { companyId: co.id, year: 2026, month: 6 });
    const calc = ok<{ employeeCount: number }>(
      await client.post(`/payroll/runs/${june.id}/calculate`, {}, owner.accessToken),
    );
    expect(calc.employeeCount).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('hides another organization’s payroll', async () => {
    const outsider = await registerAccount(client, 'Other Payroll');
    expect((await client.get(`/payroll/runs/${aprilRun.id}`, outsider.accessToken)).status).toBe(
      404,
    );
    const list = ok<unknown[]>(await client.get('/payroll/rule-sets', outsider.accessToken));
    expect(list).toEqual([]);
  });
});
