/**
 * Phase 09 performance, learning and engagement against PostgreSQL. Scales, weights, pass marks
 * and minimums below are fictional test configuration.
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
let dept: { id: string };
type Person = { id: string; token: string };
let boss: Person;
let emp: Person;
let peerA: Person;
let peerB: Person;

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Talent');
  co = await create('/companies', { code: 'TAL', name: 'Talent Co' });
  dept = await create('/departments', { companyId: co.id, code: 'T-ENG', name: 'Engineering' });
  boss = await person('Bina');
  emp = await person('Esha', boss.id);
  peerA = await person('Pia', boss.id);
  peerB = await person('Pavan', boss.id);
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
    departmentId: dept.id,
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

type Review = {
  id: string;
  finalRating: string | null;
  finalLabel: string | null;
  computedRating: string | null;
  visible: { id: string; role: string; reviewer: { id: string } | null; status: string }[];
  anonymousFeedback: { role: string; responses: number; hidden: boolean; comments: string[] }[];
  can: { acknowledge: boolean };
};

describe('goals', () => {
  it('measures KPIs, rolls key results up and limits personal goals to the employee, manager and HR', async () => {
    const kpi = await create(
      '/goals',
      {
        title: 'Reduce defects',
        ownerType: 'EMPLOYEE',
        employeeId: emp.id,
        kind: 'KPI',
        measure: { start: 40, target: 10, current: 40, unit: 'bugs' },
      },
      emp.token,
    );
    const after = data<{ progress: string }>(
      await client.post(`/goals/${kpi.id}/check-ins`, { current: 25, note: 'Halfway' }, emp.token),
      201,
    );
    expect(after.progress).toBe('50');
    const objective = await create(
      '/goals',
      { title: 'Ship v2', ownerType: 'EMPLOYEE', employeeId: emp.id, kind: 'OBJECTIVE' },
      emp.token,
    );
    const kr = await create(
      '/goals',
      {
        title: 'Beta users',
        ownerType: 'EMPLOYEE',
        employeeId: emp.id,
        kind: 'KEY_RESULT',
        parentId: objective.id,
        measure: { start: 0, target: 100, current: 0 },
      },
      emp.token,
    );
    await create(
      '/goals',
      {
        title: 'Docs',
        ownerType: 'EMPLOYEE',
        employeeId: emp.id,
        kind: 'KEY_RESULT',
        parentId: objective.id,
        measure: { start: 0, target: 10, current: 10 },
      },
      emp.token,
    );
    data(
      await client.post(
        `/goals/${kr.id}/check-ins`,
        { current: 50, note: 'Half the users' },
        emp.token,
      ),
      201,
    );
    const list = data<{ id: string; progress: string }[]>(
      await client.get(`/goals?employeeId=${emp.id}`, boss.token),
    );
    expect(list.find((g) => g.id === objective.id)?.progress).toBe('75');
    expect((await client.get(`/goals?employeeId=${emp.id}`, peerA.token)).body.data).toEqual([]);
    expect(
      (
        await client.post(
          '/goals',
          { title: 'Org goal', ownerType: 'ORGANIZATION', kind: 'GOAL' },
          emp.token,
        )
      ).status,
    ).toBe(403);
    await create('/goals', { title: 'Grow revenue', ownerType: 'ORGANIZATION', kind: 'GOAL' });
    const seen = data<{ title: string }[]>(
      await client.get('/goals?ownerType=ORGANIZATION', peerA.token),
    );
    expect(seen.map((g) => g.title)).toContain('Grow revenue');
  });
});

describe('review cycle', () => {
  let cycleId: string;
  let empReview: string;

  it('launches a cycle from configured scales, templates and the department audience', async () => {
    const [scale] = data<{ id: string }[]>(
      await client.post(
        '/performance/scales',
        {
          name: 'Five point',
          points: [1, 2, 3, 4, 5].map((v) => ({ value: v, label: `L${String(v)}` })),
        },
        owner.accessToken,
      ),
      201,
    );
    const comps = data<{ id: string; code: string }[]>(
      await client.post(
        '/performance/competencies',
        { code: 'COLLAB', name: 'Collaboration' },
        owner.accessToken,
      ),
      201,
    );
    const collab = comps.find((c) => c.code === 'COLLAB')?.id ?? '';
    const [template] = data<{ id: string }[]>(
      await client.post(
        '/performance/templates',
        {
          name: 'Annual',
          ratingScaleId: scale?.id,
          goalsWeightPercent: '50',
          competencies: [{ competencyId: collab, weight: '1' }],
          questions: [{ id: 'q1', text: 'Biggest win?', required: true }],
          includeSelf: true,
          includeManager: true,
          peerMin: 1,
          peerMax: 3,
          includeUpward: false,
          anonymityMinimum: 2,
        },
        owner.accessToken,
      ),
      201,
    );
    const cycle = await create('/performance/cycles', {
      name: '2026 annual',
      templateId: template?.id,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      audience: { departmentId: dept.id },
    });
    cycleId = cycle.id;
    const open = data<{ status: string; participants: number }>(
      await client.put(
        `/performance/cycles/${cycleId}/status`,
        { status: 'OPEN' },
        owner.accessToken,
      ),
    );
    expect(open).toMatchObject({ status: 'OPEN', participants: 4 });
    const team = data<{ id: string; employee: { id: string } }[]>(
      await client.get(`/performance/cycles/${cycleId}/participants`, boss.token),
    );
    expect(team.map((p) => p.employee.id).sort()).toEqual([emp.id, peerA.id, peerB.id].sort());
    empReview = team.find((p) => p.employee.id === emp.id)?.id ?? '';
  });

  it('keeps reviews to their audience and releases only aggregated, unnamed peer feedback', async () => {
    const tasks = async (t: string) =>
      data<{ responseId: string; role: string; employee: { id: string } }[]>(
        await client.get('/me/review-tasks', t),
      );
    const mine = async (t: string, role: string, who: string) =>
      (await tasks(t)).find((x) => x.role === role && x.employee.id === who)?.responseId ?? '';
    const collab =
      data<{ template: { competencies: { competencyId: string }[] } }>(
        await client.get(`/performance/reviews/${empReview}`, emp.token),
      ).template.competencies[0]?.competencyId ?? '';

    const self = await mine(emp.token, 'SELF', emp.id);
    expect(
      (
        await client.put(
          `/performance/responses/${self}`,
          { competencies: [{ competencyId: collab, rating: '4' }], submit: true },
          emp.token,
        )
      ).status,
    ).toBe(400);
    data(
      await client.put(
        `/performance/responses/${self}`,
        {
          competencies: [{ competencyId: collab, rating: '4' }],
          answers: [{ questionId: 'q1', text: 'Shipped v2' }],
          submit: true,
        },
        emp.token,
      ),
    );
    data(
      await client.post(
        `/performance/reviews/${empReview}/peers`,
        { reviewerEmployeeIds: [peerA.id, peerB.id] },
        emp.token,
      ),
      201,
    );
    for (const [t, rating, comment] of [
      [peerA.token, '5', 'Great partner'],
      [peerB.token, '3', 'Reliable'],
    ] as const) {
      const id = await mine(t, 'PEER', emp.id);
      data(
        await client.put(
          `/performance/responses/${id}`,
          {
            competencies: [{ competencyId: collab, rating }],
            answers: [{ questionId: 'q1', text: 'Led the launch' }],
            overallComment: comment,
            submit: true,
          },
          t,
        ),
      );
    }
    // A peer sees only their own response.
    const asPeer = data<Review>(await client.get(`/performance/reviews/${empReview}`, peerA.token));
    expect(asPeer.visible.map((v) => v.reviewer?.id)).toEqual([peerA.id]);
    expect(
      (
        await client.put(
          `/performance/responses/${await mine(peerA.token, 'PEER', emp.id)}`,
          { competencies: [{ competencyId: collab, rating: '2.5' }] },
          peerA.token,
        )
      ).status,
    ).toBe(409);

    const mgr = await mine(boss.token, 'MANAGER', emp.id);
    expect(
      (
        await client.put(
          `/performance/responses/${mgr}`,
          { competencies: [{ competencyId: collab, rating: '2.5' }] },
          boss.token,
        )
      ).status,
    ).toBe(400);
    data(
      await client.put(
        `/performance/responses/${mgr}`,
        {
          competencies: [{ competencyId: collab, rating: '4' }],
          answers: [{ questionId: 'q1', text: 'Strong year' }],
          overallComment: 'Exceeded',
          promotion: 'RECOMMEND',
          promotionJustification: 'Leads the team',
          submit: true,
        },
        boss.token,
      ),
    );
    const asManager = data<Review>(
      await client.get(`/performance/reviews/${empReview}`, boss.token),
    );
    expect(asManager.computedRating).not.toBeNull();
    expect(asManager.visible.length).toBe(4);

    // Before results are released the employee sees no rating and no peer feedback.
    const early = data<Review>(await client.get(`/performance/reviews/${empReview}`, emp.token));
    expect([early.finalRating, early.computedRating]).toEqual([null, null]);
    expect(early.anonymousFeedback.every((f) => f.hidden && f.comments.length === 0)).toBe(true);

    expect(
      (
        await client.post(
          `/performance/reviews/${empReview}/calibrate`,
          { finalRating: '5', reason: 'Cross-team impact' },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    data(
      await client.put(
        `/performance/cycles/${cycleId}/status`,
        { status: 'CALIBRATION' },
        owner.accessToken,
      ),
    );
    expect(
      (
        await client.post(
          `/performance/reviews/${empReview}/calibrate`,
          { finalRating: '4.5', reason: 'x' },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
    data(
      await client.post(
        `/performance/reviews/${empReview}/calibrate`,
        { finalRating: '5', reason: 'Cross-team impact' },
        owner.accessToken,
      ),
    );
    data(
      await client.put(
        `/performance/cycles/${cycleId}/status`,
        { status: 'CLOSED' },
        owner.accessToken,
      ),
    );

    const released = data<Review>(await client.get(`/performance/reviews/${empReview}`, emp.token));
    expect(released).toMatchObject({ finalRating: '5', finalLabel: 'L5' });
    const peers = released.anonymousFeedback.find((f) => f.role === 'PEER');
    expect(peers).toMatchObject({
      responses: 2,
      hidden: false,
      comments: ['Great partner', 'Reliable'],
    });
    // Peer reviews never reach the employee with names.
    expect(released.visible.every((v) => v.role === 'SELF' || v.role === 'MANAGER')).toBe(true);
    expect(released.can.acknowledge).toBe(true);
    data(await client.post(`/performance/reviews/${empReview}/acknowledge`, {}, emp.token));

    await asApp(async (db) => {
      await expect(
        db.query(`UPDATE review_cycles SET name = 'x' WHERE id = $1`, [cycleId]),
      ).rejects.toThrow(/closed review cycle/);
    });
  });

  it('keeps improvement plans to the employee, manager and HR', async () => {
    const pip = await create(
      '/performance/pips',
      {
        employeeId: peerB.id,
        startDate: '2026-11-01',
        endDate: '2027-01-31',
        reason: 'Missed deadlines',
        objectives: [{ text: 'Deliver on time' }],
      },
      boss.token,
    );
    expect((await client.get(`/performance/pips/${pip.id}`, peerA.token)).status).toBe(404);
    expect((await client.get(`/performance/pips/${pip.id}`, peerB.token)).status).toBe(200);
    expect(
      (
        await client.post(
          '/performance/pips',
          {
            employeeId: emp.id,
            startDate: '2026-11-01',
            endDate: '2027-01-31',
            reason: 'x',
            objectives: [{ text: 'y' }],
          },
          peerA.token,
        )
      ).status,
    ).toBe(403);
    const done = data<{ status: string }>(
      await client.post(
        `/performance/pips/${pip.id}/outcome`,
        { outcome: 'PASSED', note: 'Back on track' },
        boss.token,
      ),
    );
    expect(done.status).toBe('PASSED');
  });
});

describe('learning', () => {
  it('assigns, hides quiz answers, grades attempts and issues certifications and skills on completion', async () => {
    const course = await create('/learning/courses', {
      code: 'SAFE-1',
      title: 'Workplace safety',
      format: 'ONLINE',
      passPercent: 80,
      certificationValidityMonths: 12,
      skills: ['Safety'],
      modules: [
        { title: 'Read the handbook', type: 'CONTENT', content: 'Always wear a helmet.' },
        {
          title: 'Quiz',
          type: 'QUIZ',
          questions: [
            { id: 'q1', text: 'Wear what?', options: ['Cap', 'Helmet'], correct: [1], points: 1 },
          ],
        },
      ],
    });
    expect(
      (
        await client.post(
          '/learning/assignments',
          { courseId: course.id, audience: { departmentId: dept.id } },
          owner.accessToken,
        )
      ).status,
    ).toBe(400);
    data(
      await client.patch(
        `/learning/courses/${course.id}`,
        { status: 'PUBLISHED' },
        owner.accessToken,
      ),
    );
    const assigned = data<{ employees: number }>(
      await client.post(
        '/learning/assignments',
        { courseId: course.id, audience: { departmentId: dept.id }, dueOn: '2027-01-31' },
        owner.accessToken,
      ),
      201,
    );
    expect(assigned.employees).toBe(4);
    expect(
      (
        await client.post(
          '/learning/assignments',
          { courseId: course.id, employeeIds: [boss.id] },
          emp.token,
        )
      ).status,
    ).toBe(403);

    const asLearner = data<{
      modules: { id: string; type: string; questions: Record<string, unknown>[] }[];
    }>(await client.get(`/learning/courses/${course.id}`, emp.token));
    const quiz = asLearner.modules.find((m) => m.type === 'QUIZ');
    expect(quiz?.questions.every((q) => !('correct' in q))).toBe(true);
    const [enrollment] = data<{ id: string; status: string }[]>(
      await client.get('/me/learning', emp.token),
    );
    const content = asLearner.modules.find((m) => m.type === 'CONTENT')?.id ?? '';
    data(
      await client.post(
        `/me/learning/${enrollment?.id ?? ''}/modules/${content}/complete`,
        {},
        emp.token,
      ),
    );
    const fail = data<{ passed: boolean; enrollment: { status: string } }>(
      await client.post(
        `/me/learning/${enrollment?.id ?? ''}/quizzes/${quiz?.id ?? ''}`,
        { answers: { q1: [0] } },
        emp.token,
      ),
    );
    expect(fail).toMatchObject({ passed: false, enrollment: { status: 'IN_PROGRESS' } });
    const pass = data<{
      passed: boolean;
      enrollment: { status: string; progress: number; certificationExpiresOn: string | null };
    }>(
      await client.post(
        `/me/learning/${enrollment?.id ?? ''}/quizzes/${quiz?.id ?? ''}`,
        { answers: { q1: [1] } },
        emp.token,
      ),
    );
    expect(pass).toMatchObject({
      passed: true,
      enrollment: { status: 'COMPLETED', progress: 100 },
    });
    expect(pass.enrollment.certificationExpiresOn).not.toBeNull();
    const profile = data<{ skills?: { name: string }[] }>(
      await client.get(`/employees/${emp.id}/skills`, owner.accessToken),
    );
    expect(JSON.stringify(profile)).toMatch(/Safety/);
    const matrix = data<{ skills: string[] }>(
      await client.get('/learning/skill-matrix', owner.accessToken),
    );
    expect(matrix.skills).toContain('safety');
  });
});

describe('engagement', () => {
  it('stores no identity on anonymous responses and hides results below the minimum group size', async () => {
    const opensAt = new Date(Date.now() - 60_000).toISOString();
    const closesAt = new Date(Date.now() + 86_400_000).toISOString();
    const survey = await create('/engagement/surveys', {
      title: 'Pulse',
      kind: 'PULSE',
      anonymous: true,
      minimumGroupSize: 2,
      audience: { departmentId: dept.id },
      opensAt,
      closesAt,
      questions: [
        { id: 'r', type: 'RATING', text: 'How are you?', required: true },
        { id: 'n', type: 'ENPS', text: 'Recommend us?', required: true },
      ],
    });
    data(await client.post(`/engagement/surveys/${survey.id}/publish`, {}, owner.accessToken));
    expect(
      (
        await client.post(
          `/engagement/surveys/${survey.id}/responses`,
          { answers: { r: 6, n: 10 } },
          emp.token,
        )
      ).status,
    ).toBe(400);
    data(
      await client.post(
        `/engagement/surveys/${survey.id}/responses`,
        { answers: { r: 4, n: 10 } },
        emp.token,
      ),
      201,
    );
    expect(
      (
        await client.post(
          `/engagement/surveys/${survey.id}/responses`,
          { answers: { r: 4, n: 10 } },
          emp.token,
        )
      ).status,
    ).toBe(409);
    expect(
      data<{ hidden: boolean; questions: unknown[] }>(
        await client.get(`/engagement/surveys/${survey.id}/results`, owner.accessToken),
      ),
    ).toMatchObject({ hidden: true, questions: [] });
    data(
      await client.post(
        `/engagement/surveys/${survey.id}/responses`,
        { answers: { r: 2, n: 5 } },
        peerA.token,
      ),
      201,
    );
    const results = data<{
      hidden: boolean;
      questions: { id: string; average?: string; enps?: string }[];
    }>(await client.get(`/engagement/surveys/${survey.id}/results`, owner.accessToken));
    expect(results.hidden).toBe(false);
    expect(results.questions.find((q) => q.id === 'n')?.enps).toBe('0.0');
    await asApp(async (db) => {
      const rows = await db.query<{ employee_id: string | null }>(
        'SELECT employee_id FROM survey_responses WHERE survey_id = $1',
        [survey.id],
      );
      expect(rows.rows.map((r) => r.employee_id)).toEqual([null, null]);
      await expect(
        db.query(
          `INSERT INTO survey_responses (id, organization_id, survey_id, employee_id, answers) VALUES (gen_random_uuid(), $1, $2, $3, '{}'::jsonb)`,
          [owner.organizationId, survey.id, emp.id],
        ),
      ).rejects.toThrow(/anonymous survey/);
    });
    expect((await client.get(`/engagement/surveys/${survey.id}/results`, emp.token)).status).toBe(
      403,
    );
  });

  it('awards points, redeems rewards against the balance and limits events to capacity', async () => {
    const [badge] = data<{ id: string }[]>(
      await client.post(
        '/engagement/badges',
        { name: 'Team player', points: 10 },
        owner.accessToken,
      ),
      201,
    );
    expect(
      (
        await client.post(
          '/engagement/recognitions',
          { toEmployeeId: boss.id, badgeId: badge?.id, message: 'Thanks' },
          boss.token,
        )
      ).status,
    ).toBe(400);
    await create(
      '/engagement/recognitions',
      { toEmployeeId: emp.id, badgeId: badge?.id, message: 'Great release' },
      boss.token,
    );
    expect(data<{ balance: number }>(await client.get('/me/recognition', emp.token)).balance).toBe(
      10,
    );
    const [reward] = data<{ id: string }[]>(
      await client.post(
        '/engagement/rewards',
        { name: 'Coffee voucher', pointsCost: 10, stock: 1 },
        owner.accessToken,
      ),
      201,
    );
    const after = data<{ balance: number; redemptions: { id: string }[] }>(
      await client.post(`/engagement/rewards/${reward?.id ?? ''}/redeem`, {}, emp.token),
    );
    expect(after.balance).toBe(0);
    expect(
      (await client.post(`/engagement/rewards/${reward?.id ?? ''}/redeem`, {}, emp.token)).status,
    ).toBe(409);
    data(
      await client.post(
        `/engagement/redemptions/${after.redemptions[0]?.id ?? ''}/decision`,
        { status: 'REJECTED', note: 'Out of vouchers' },
        owner.accessToken,
      ),
    );
    expect(data<{ balance: number }>(await client.get('/me/recognition', emp.token)).balance).toBe(
      10,
    );

    const [event] = data<{ id: string }[]>(
      await client.post(
        '/engagement/events',
        {
          title: 'Offsite',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          capacity: 1,
          audience: { departmentId: dept.id },
        },
        owner.accessToken,
      ),
      201,
    );
    data(
      await client.post(
        `/engagement/events/${event?.id ?? ''}/rsvp`,
        { response: 'GOING' },
        emp.token,
      ),
    );
    expect(
      (
        await client.post(
          `/engagement/events/${event?.id ?? ''}/rsvp`,
          { response: 'GOING' },
          peerA.token,
        )
      ).status,
    ).toBe(409);
    data(
      await client.post(
        `/engagement/events/${event?.id ?? ''}/rsvp`,
        { response: 'MAYBE' },
        peerA.token,
      ),
    );
  });

  it('keeps anonymous suggestions authorless and tracks announcement acknowledgements', async () => {
    const list = data<{ title: string; author: unknown; anonymous: boolean }[]>(
      await client.post(
        '/engagement/suggestions',
        { title: 'Quiet room', body: 'Please add one', anonymous: true },
        emp.token,
      ),
      201,
    );
    expect(list.find((s) => s.title === 'Quiet room')).toMatchObject({
      anonymous: true,
      author: null,
    });
    await asApp(async (db) => {
      await expect(
        db.query(`UPDATE suggestions SET author_employee_id = $1 WHERE anonymous`, [emp.id]),
      ).rejects.toThrow(/suggestions_author_chk/);
    });
    const [a] = data<{ id: string }[]>(
      await client.post(
        '/engagement/announcements',
        {
          title: 'Policy update',
          body: 'Read the new leave policy.',
          requiresAcknowledgement: true,
        },
        owner.accessToken,
      ),
      201,
    );
    const read = data<{ id: string; acknowledgedAt: string | null }[]>(
      await client.post(`/engagement/announcements/${a?.id ?? ''}/acknowledge`, {}, emp.token),
    );
    expect(read.find((x) => x.id === a?.id)?.acknowledgedAt).not.toBeNull();
    const stats = data<{ id: string; stats: { acknowledged: number } | null }[]>(
      await client.get('/engagement/announcements?all=true', owner.accessToken),
    );
    expect(stats.find((x) => x.id === a?.id)?.stats?.acknowledged).toBe(1);
  });

  it('isolates tenants', async () => {
    const outsider = await registerAccount(client, 'Other Talent');
    expect(data<unknown[]>(await client.get('/engagement/surveys', outsider.accessToken))).toEqual(
      [],
    );
    expect(data<unknown[]>(await client.get('/performance/cycles', outsider.accessToken))).toEqual(
      [],
    );
  });
});
