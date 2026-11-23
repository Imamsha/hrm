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
let orgSlug: string;
let co: { id: string };
let eng: { id: string };
let hr: { token: string; membershipId: string };
let interviewerA: { token: string; employeeId: string };
let interviewerB: { token: string; employeeId: string };

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const server = () => app.getHttpServer() as Parameters<typeof request>[0];

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Hiring');
  orgSlug = (await client.get('/organizations/current', owner.accessToken)).body.data
    .slug as string;
  co = await create('/companies', { code: 'HIRE', name: 'Hire Co' });
  eng = await create('/departments', { companyId: co.id, code: 'H-ENG', name: 'Engineering' });
  hr = await invite('hr_admin');
  interviewerA = await employeeWithLogin('Iris');
  interviewerB = await employeeWithLogin('Ivan');
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
    fullName: 'Hiring Person',
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  return {
    token: accepted.body.data.accessToken as string,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

async function employeeWithLogin(firstName: string) {
  const m = await invite('employee');
  const e = await create('/employees', {
    firstName,
    dateOfJoining: '2024-01-01',
    companyId: co.id,
    departmentId: eng.id,
    employmentType: 'FULL_TIME',
    membershipId: m.membershipId,
  });
  return { token: m.token, employeeId: e.id };
}

function portalApply(
  slug: string,
  fields: Record<string, string>,
  file: Buffer | null,
  org = orgSlug,
) {
  let r = request(server()).post(`/api/v1/careers/${org}/jobs/${slug}/applications`);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return file
    ? r.attach('resume', file, { filename: 'resume.pdf', contentType: 'application/pdf' })
    : r;
}

const applicant = (email: string) => ({
  firstName: 'Kavya',
  lastName: 'Iyer',
  email,
  phone: '+91 98450 11111',
  totalExperienceMonths: '48',
  consent: 'true',
});

describe('requisitions and openings', () => {
  it('requires approval by someone else before an opening can use the requisition', async () => {
    const req = await create('/recruitment/requisitions', {
      title: 'Backend engineers',
      companyId: co.id,
      departmentId: eng.id,
      employmentType: 'FULL_TIME',
      headcount: 1,
      budgetMin: '1200000',
      budgetMax: '1800000',
    });
    expect(req).toMatchObject({
      status: 'DRAFT',
      budget: { min: '1200000.00', max: '1800000.00', currency: 'INR' },
    });
    const early = await client.post(
      '/recruitment/openings',
      {
        title: 'Backend Engineer',
        companyId: co.id,
        employmentType: 'FULL_TIME',
        description: 'Build APIs',
        requisitionId: req.id,
      },
      owner.accessToken,
    );
    expect(early.status).toBe(400);
    expect(early.body.error.details[0].path).toBe('requisitionId');

    await client.post(`/recruitment/requisitions/${req.id}/submit`, {}, owner.accessToken);
    expect(
      (
        await client.post(
          `/recruitment/requisitions/${req.id}/decision`,
          { decision: 'APPROVED' },
          owner.accessToken,
        )
      ).status,
    ).toBe(403);
    const approved = await client.post(
      `/recruitment/requisitions/${req.id}/decision`,
      { decision: 'APPROVED', note: 'Budgeted' },
      hr.token,
    );
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', decisionNote: 'Budgeted' });
    expect(
      (
        await client.patch(
          `/recruitment/requisitions/${req.id}`,
          { headcount: 3 },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);

    const opening = await create('/recruitment/openings', {
      title: 'Senior Backend Engineer',
      requisitionId: req.id,
      companyId: co.id,
      departmentId: eng.id,
      employmentType: 'FULL_TIME',
      description: 'Build and operate our APIs.',
      salaryMin: '1500000',
      salaryMax: '2000000',
      experienceMinYears: 3,
    });
    expect(opening).toMatchObject({
      status: 'DRAFT',
      slug: expect.stringMatching(/^senior-backend-engineer-[0-9a-f]{6}$/),
    });

    // Drafts are not public; publishing makes them visible without salary unless enabled.
    expect(
      (await request(server()).get(`/api/v1/careers/${orgSlug}/jobs`)).body.data.openings,
    ).toEqual([]);
    await client.put(
      `/recruitment/openings/${opening.id}/status`,
      { status: 'PUBLISHED' },
      owner.accessToken,
    );
    const careers = await request(server()).get(`/api/v1/careers/${orgSlug}/jobs`);
    expect(careers.body.data.openings).toMatchObject([
      { title: 'Senior Backend Engineer', company: 'Hire Co', salary: null },
    ]);
    expect(JSON.stringify(careers.body)).not.toContain('requisition');
    expect((await request(server()).get('/api/v1/careers/no-such-org/jobs')).status).toBe(404);
  });
});

describe('career portal, pipeline, interviews, offer and hire', () => {
  let openingId: string;
  let slug: string;
  let applicationId: string;

  it('accepts portal applications with consent and a real resume, deduplicating by e-mail', async () => {
    const list = await client.get('/recruitment/openings?status=PUBLISHED', owner.accessToken);
    openingId = list.body.data[0].id;
    slug = list.body.data[0].slug;
    const email = uniqueEmail('kavya');
    expect((await portalApply(slug, { ...applicant(email), consent: 'false' }, PDF)).status).toBe(
      400,
    );
    const fake = await portalApply(slug, applicant(email), Buffer.from('MZ not a pdf'));
    expect(fake.status).toBe(400);
    expect(fake.body.error.details[0].path).toBe('resume');
    const ok = await portalApply(slug, applicant(email), PDF);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data).toEqual({ received: true });
    // Re-applying updates the profile but does not duplicate the application.
    expect(
      (await portalApply(slug, { ...applicant(email), firstName: 'Kavya R.' }, PDF)).status,
    ).toBe(201);

    const candidates = await client.get(
      `/recruitment/candidates?search=${encodeURIComponent(email)}`,
      owner.accessToken,
    );
    expect(candidates.body.data).toHaveLength(1);
    expect(candidates.body.data[0]).toMatchObject({
      source: 'CAREER_PORTAL',
      hasResume: true,
      firstName: 'Kavya R.',
    });
    expect(candidates.body.data[0].consentAt).not.toBeNull();
    const apps = await client.get(
      `/recruitment/applications?openingId=${openingId}`,
      owner.accessToken,
    );
    expect(apps.body.data).toHaveLength(1);
    applicationId = apps.body.data[0].id;

    const resume = await request(server())
      .get(`/api/v1/recruitment/candidates/${candidates.body.data[0].id}/resume`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      });
    expect((resume.body as Buffer).equals(PDF)).toBe(true);
    // Employees without recruitment access see nothing.
    expect((await client.get('/recruitment/candidates', interviewerA.token)).status).toBe(403);
  });

  it('moves through the pipeline only by allowed, human decisions', async () => {
    const skip = await client.post(
      `/recruitment/applications/${applicationId}/stage`,
      { stage: 'HIRED' },
      owner.accessToken,
    );
    expect(skip.status).toBe(400);
    const noReason = await client.post(
      `/recruitment/applications/${applicationId}/stage`,
      { stage: 'REJECTED' },
      owner.accessToken,
    );
    expect(noReason.body.error.details[0].path).toBe('rejectionReason');
    await client.post(
      `/recruitment/applications/${applicationId}/stage`,
      { stage: 'REJECTED', rejectionReason: 'Role mismatch' },
      owner.accessToken,
    );
    const back = await client.post(
      `/recruitment/applications/${applicationId}/stage`,
      { stage: 'SCREENING', note: 'Reconsidered' },
      owner.accessToken,
    );
    expect(back.body.data).toMatchObject({ stage: 'SCREENING', rejectionReason: null });
    const bad = await client.post(
      `/recruitment/applications/${applicationId}/assessments`,
      { name: 'Coding test', score: '11', maxScore: '10', assessedOn: '2026-11-10' },
      owner.accessToken,
    );
    expect(bad.status).toBe(400);
    const assessed = await client.post(
      `/recruitment/applications/${applicationId}/assessments`,
      { name: 'Coding test', score: '8.5', maxScore: '10', assessedOn: '2026-11-10' },
      owner.accessToken,
    );
    expect(assessed.body.data.assessments[0]).toMatchObject({ score: '8.50', maxScore: '10.00' });
    const moved = await client.post(
      `/recruitment/applications/${applicationId}/stage`,
      { stage: 'INTERVIEW' },
      owner.accessToken,
    );
    expect(moved.body.data.events.map((e: { toStage: string }) => e.toStage)).toEqual([
      'APPLIED',
      'REJECTED',
      'SCREENING',
      'INTERVIEW',
    ]);
  });

  it('keeps panel feedback independent until each panelist submits', async () => {
    const scheduled = await client.post(
      `/recruitment/applications/${applicationId}/interviews`,
      {
        roundName: 'Technical',
        scheduledAt: '2026-11-25T10:00:00+05:30',
        durationMinutes: 60,
        mode: 'VIDEO',
        locationOrLink: 'https://meet.example.test/abc',
        panelEmployeeIds: [interviewerA.employeeId, interviewerB.employeeId],
      },
      owner.accessToken,
    );
    expect(scheduled.status).toBe(201);
    const interviewId = scheduled.body.data.interviews[0].id as string;

    const mine = await client.get('/me/interviews', interviewerA.token);
    expect(mine.body.data.map((i: { id: string }) => i.id)).toContain(interviewId);
    await client.post(
      `/me/interviews/${interviewId}/feedback`,
      { rating: 4, recommendation: 'YES', notes: 'Solid design skills' },
      interviewerA.token,
    );
    // B has not submitted: A's feedback stays hidden from B.
    const forB = (await client.get('/me/interviews', interviewerB.token)).body.data.find(
      (i: { id: string }) => i.id === interviewId,
    );
    expect(
      forB.panel.find(
        (p: { employee: { id: string } }) => p.employee.id === interviewerA.employeeId,
      ),
    ).toMatchObject({ rating: null, notes: null });
    await client.post(
      `/me/interviews/${interviewId}/feedback`,
      { rating: 5, recommendation: 'STRONG_YES', notes: 'Excellent' },
      interviewerB.token,
    );
    const recruiterView = await client.get(
      `/recruitment/applications/${applicationId}`,
      owner.accessToken,
    );
    expect(recruiterView.body.data.feedback).toEqual({ submitted: 2, averageRating: 4.5 });
    // Non-panelists cannot submit feedback.
    expect(
      (
        await client.post(
          `/me/interviews/${interviewId}/feedback`,
          { rating: 1, recommendation: 'NO', notes: 'x' },
          hr.token,
        )
      ).status,
    ).toBe(404);
  });

  it('offers, hires into an employee and starts onboarding atomically', async () => {
    const template = await create('/onboarding/templates', {
      name: 'Engineering joiner',
      isDefault: true,
      tasks: [
        {
          title: 'Upload identity proof',
          assignee: 'EMPLOYEE',
          dueOffsetDays: -3,
          documentCategory: 'IDENTITY',
        },
        { title: 'Prepare laptop', assignee: 'IT', dueOffsetDays: -1 },
        { title: 'Introduce to the team', assignee: 'MANAGER', dueOffsetDays: 1 },
      ],
    });
    expect(
      (
        await client.post(
          `/recruitment/applications/${applicationId}/offers`,
          { joiningDate: '2026-12-01', annualCtc: '1800000' },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    await client.post(
      `/recruitment/applications/${applicationId}/stage`,
      { stage: 'OFFER' },
      owner.accessToken,
    );
    const offered = await client.post(
      `/recruitment/applications/${applicationId}/offers`,
      { joiningDate: '2026-12-01', annualCtc: '1800000.00', notes: 'Includes joining bonus' },
      owner.accessToken,
    );
    expect(offered.body.data.offers[0]).toMatchObject({ status: 'DRAFT', annualCtc: '1800000.00' });
    const second = await client.post(
      `/recruitment/applications/${applicationId}/offers`,
      { joiningDate: '2026-12-01', annualCtc: '1' },
      owner.accessToken,
    );
    expect(second.status).toBe(409);
    const offerId = offered.body.data.offers[0].id as string;
    expect(
      (
        await client.put(
          `/recruitment/offers/${offerId}/status`,
          { status: 'ACCEPTED' },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    await client.put(
      `/recruitment/offers/${offerId}/status`,
      { status: 'SENT' },
      owner.accessToken,
    );
    const audit = await client.get('/audit-logs?search=offer.', owner.accessToken);
    expect(JSON.stringify(audit.body)).not.toContain('1800000');

    const notAccepted = await client.post(
      `/recruitment/applications/${applicationId}/hire`,
      { companyId: co.id, employmentType: 'FULL_TIME' },
      owner.accessToken,
    );
    expect(notAccepted.status).toBe(409);
    await client.put(
      `/recruitment/offers/${offerId}/status`,
      { status: 'ACCEPTED' },
      owner.accessToken,
    );
    const hired = await client.post(
      `/recruitment/applications/${applicationId}/hire`,
      {
        companyId: co.id,
        employmentType: 'FULL_TIME',
        departmentId: eng.id,
        managerId: interviewerA.employeeId,
        onboardingTemplateId: template.id,
      },
      owner.accessToken,
    );
    expect(hired.status, JSON.stringify(hired.body)).toBe(201);
    expect(hired.body.data).toMatchObject({
      firstName: 'Kavya R.',
      dateOfJoining: '2026-12-01',
      status: 'ACTIVE',
    });
    const details = await client.get(
      `/recruitment/applications/${applicationId}`,
      owner.accessToken,
    );
    expect(details.body.data).toMatchObject({
      stage: 'HIRED',
      employee: { id: hired.body.data.id },
    });
    expect(
      (
        await client.post(
          `/recruitment/applications/${applicationId}/hire`,
          { companyId: co.id, employmentType: 'FULL_TIME' },
          owner.accessToken,
        )
      ).status,
    ).toBe(409);
    const reqs = await client.get('/recruitment/requisitions', owner.accessToken);
    expect(reqs.body.data[0].status).toBe('FILLED');

    // Onboarding: tasks resolved to the joiner and their manager.
    const plans = await client.get('/onboarding/plans', owner.accessToken);
    const plan = plans.body.data.find(
      (p: { employee: { id: string } }) => p.employee.id === hired.body.data.id,
    );
    expect(plan.tasks.map((t: { title: string; dueDate: string }) => [t.title, t.dueDate])).toEqual(
      [
        ['Upload identity proof', '2026-11-28'],
        ['Prepare laptop', '2026-11-30'],
        ['Introduce to the team', '2026-12-02'],
      ],
    );
    const managerTask = plan.tasks.find((t: { assignee: string }) => t.assignee === 'MANAGER');
    expect(managerTask.assigneeEmployee.id).toBe(interviewerA.employeeId);

    // The manager sees and completes their task; they cannot touch the joiner's.
    const mgrTasks = await client.get('/me/onboarding/tasks', interviewerA.token);
    expect(mgrTasks.body.data.map((t: { title: string }) => t.title)).toEqual([
      'Introduce to the team',
    ]);
    const joinerTask = plan.tasks.find((t: { assignee: string }) => t.assignee === 'EMPLOYEE');
    expect(
      (
        await client.put(
          `/onboarding/tasks/${joinerTask.id}/status`,
          { status: 'DONE' },
          interviewerA.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await client.put(
          `/onboarding/tasks/${managerTask.id}/status`,
          { status: 'DONE' },
          interviewerA.token,
        )
      ).body.data.progress.closed,
    ).toBe(1);

    // The joiner signs in, uploads the requested document, which completes the task.
    const joiner = await invite('employee');
    await client.put(
      `/employees/${hired.body.data.id}/member`,
      { membershipId: joiner.membershipId },
      owner.accessToken,
    );
    const myPlan = await client.get('/me/onboarding', joiner.token);
    expect(myPlan.body.data.id).toBe(plan.id);
    expect(
      (
        await client.put(
          `/onboarding/tasks/${joinerTask.id}/status`,
          { status: 'DONE' },
          joiner.token,
        )
      ).status,
    ).toBe(409);
    const upload = await request(server())
      .post(`/api/v1/me/onboarding/tasks/${joinerTask.id}/document`)
      .set('Authorization', `Bearer ${joiner.token}`)
      .attach('file', PDF, { filename: 'aadhaar-masked.pdf', contentType: 'application/pdf' });
    expect(upload.status, JSON.stringify(upload.body)).toBe(200);
    expect(upload.body.data.progress.closed).toBe(2);
    const docs = await client.get(`/employees/${hired.body.data.id}/documents`, owner.accessToken);
    expect(docs.body.data[0]).toMatchObject({
      category: 'IDENTITY',
      title: 'Upload identity proof',
    });
    const itTask = plan.tasks.find((t: { assignee: string }) => t.assignee === 'IT');
    const done = await client.put(
      `/onboarding/tasks/${itTask.id}/status`,
      { status: 'DONE' },
      owner.accessToken,
    );
    expect(done.body.data.status).toBe('COMPLETED');
  });
});

describe('isolation and integrity', () => {
  it('keeps candidates per tenant and history append-only', async () => {
    const other = await registerAccount(client, 'Other hiring');
    const mine = await client.get('/recruitment/candidates', owner.accessToken);
    const candidateId = mine.body.data[0].id as string;
    expect(
      (await client.get(`/recruitment/candidates/${candidateId}`, other.accessToken)).status,
    ).toBe(404);
    expect((await client.get('/recruitment/candidates', other.accessToken)).body.data).toEqual([]);
    const otherSlug = (await client.get('/organizations/current', other.accessToken)).body.data
      .slug as string;
    const ourOpening = (await client.get('/recruitment/openings', owner.accessToken)).body.data[0];
    // Our opening is not reachable through the other organization's portal.
    expect(
      (
        await request(server()).get(
          `/api/v1/careers/${otherSlug}/jobs/${ourOpening.slug as string}`,
        )
      ).status,
    ).toBe(404);

    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    try {
      for (const t of [
        'candidates',
        'job_applications',
        'job_openings',
        'offers',
        'onboarding_plans',
      ]) {
        const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`);
        expect(rows[0]?.n, t).toBe('0');
      }
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.organization_id', $1, true)", [owner.organizationId]);
      await expect(db.query("UPDATE application_events SET note = 'x'")).rejects.toThrow();
      await db.query('ROLLBACK');
    } finally {
      await db.end();
    }
  });
});
