#!/usr/bin/env node
/**
 * Demo data for manual testing (development only).
 *
 * Creates ONE demo organization through the real API, so every record passes the same
 * validation, permissions and business rules as data entered in the UI. Nothing is written to
 * the database directly and nothing is added to migrations.
 *
 * Needs: `pnpm infra:up`, `pnpm db:deploy`, the API running (`pnpm dev`) and Mailpit (for
 * invitation e-mails). Run: `pnpm seed:demo`. Re-running with the same DEMO_TAG stops early;
 * set DEMO_TAG=2 (etc.) for another demo organization.
 *
 * All names, rates and dates are fictional demo values. No statutory payroll rule is seeded:
 * statutory values must come from sourced configuration (owner decision, Phase 07).
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';

const API = (process.env.DEMO_API_URL ?? 'http://localhost:3100/api/v1').replace(/\/$/, '');
const MAILPIT = (process.env.DEMO_MAILPIT_URL ?? 'http://localhost:8025').replace(/\/$/, '');
const TAG = (process.env.DEMO_TAG ?? '').trim();
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Pass-2026';
const DOMAIN = `hrm-demo${TAG ? `-${TAG}` : ''}.test`;

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${API}/`)) {
  console.error(`Refusing to seed ${API}: demo data is for a local development API only.`);
  process.exit(1);
}

// ------------------------------------------------------------------------------ helpers

const iso = (d) => d.toISOString().slice(0, 10);
const day = (n) => iso(new Date(Date.now() + n * 86_400_000));
/** The Monday on or after `n` days from today (keeps leave on working days). */
const monday = (n = 0) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - (d.getUTCDay() || 7)) % 7));
  return d;
};
const weekStart = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1));
  return iso(d);
};

async function call(method, path, body, token, { expect = [200, 201, 204], form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    // Sign-in endpoints are rate limited (AUTH_RATE_LIMIT_MAX per minute): wait and retry.
    if (res.status !== 429 || attempt >= 8) break;
    process.stdout.write('(rate limited, waiting) ');
    await new Promise((r) => setTimeout(r, 10_000));
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!expect.includes(res.status)) {
    const msg = json?.error?.details?.[0]?.message ?? json?.error?.message ?? text;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return json.data;
}
const post = (p, b, t, o) => call('POST', p, b, t, o);
const put = (p, b, t) => call('PUT', p, b, t);
const patch = (p, b, t) => call('PATCH', p, b, t);
const get = (p, t) => call('GET', p, undefined, t);

async function mailToken(email, path) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
    );
    if (res.ok) {
      const id = (await res.json()).messages?.[0]?.ID;
      if (id) {
        const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
        const m = new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`).exec(msg.Text);
        if (m?.[1]) return decodeURIComponent(m[1]);
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No invitation e-mail for ${email} in Mailpit (${MAILPIT}). Is Mailpit running?`);
}

let stepNo = 0;
async function step(name, fn) {
  stepNo++;
  process.stdout.write(`${String(stepNo).padStart(2)}. ${name} … `);
  try {
    const r = await fn();
    console.log('ok');
    return r;
  } catch (err) {
    console.log('FAILED');
    throw err;
  }
}

async function pdf(title, lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 56, y: 780, size: 18, font });
  lines.forEach((l, i) => page.drawText(l, { x: 56, y: 740 - i * 18, size: 11, font }));
  page.drawText('Demo document for manual testing — not a real policy.', {
    x: 56,
    y: 60,
    size: 8,
    font,
  });
  return doc.save();
}

// ------------------------------------------------------------------------------ people

const PEOPLE = [
  {
    key: 'admin',
    first: 'Arjun',
    last: 'Mehta',
    role: 'admin',
    dept: 'MGMT',
    desig: 'OPSM',
    manager: 'owner',
  },
  {
    key: 'hr',
    first: 'Kavitha',
    last: 'Rao',
    role: 'hr_admin',
    dept: 'HR',
    desig: 'HRBP',
    manager: 'owner',
  },
  {
    key: 'finance',
    first: 'Rohan',
    last: 'Iyer',
    role: 'finance',
    dept: 'FIN',
    desig: 'ACCT',
    manager: 'owner',
  },
  {
    key: 'manager',
    first: 'Vikram',
    last: 'Singh',
    role: 'manager',
    dept: 'ENG',
    desig: 'EM',
    manager: 'owner',
  },
  {
    key: 'ananya',
    first: 'Ananya',
    last: 'Das',
    role: 'employee',
    dept: 'ENG',
    desig: 'SWE',
    manager: 'manager',
  },
  {
    key: 'rahul',
    first: 'Rahul',
    last: 'Verma',
    role: 'employee',
    dept: 'ENG',
    desig: 'SWE',
    manager: 'manager',
  },
  {
    key: 'sneha',
    first: 'Sneha',
    last: 'Kapoor',
    role: 'employee',
    dept: 'HR',
    desig: 'HREX',
    manager: 'hr',
  },
];
const email = (key) => `${key}@${DOMAIN}`;

async function main() {
  console.log(`Seeding demo data into ${API} (users @${DOMAIN})\n`);
  const ids = {};
  const tok = {};

  // ---------------------------------------------------------------- organization & owner
  const reg = await step('Register the demo organization (owner Priya Sharma)', async () => {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: `Acme Demo Pvt Ltd${TAG ? ` ${TAG}` : ''}`,
        fullName: 'Priya Sharma',
        email: email('owner'),
        password: PASSWORD,
        tokenTransport: 'body',
      }),
    });
    const json = await res.json();
    if (res.status === 409 || /already/i.test(json?.error?.message ?? '')) {
      console.log(
        '\n\nThe demo organization already exists. Sign in as',
        email('owner'),
        'with',
        PASSWORD,
      );
      console.log('Set DEMO_TAG=2 (or another value) to create a second demo organization.');
      process.exit(0);
    }
    if (!res.ok) throw new Error(`register → ${res.status}: ${json?.error?.message}`);
    return json.data;
  });
  tok.owner = reg.accessToken;
  const O = () => tok.owner;

  // ---------------------------------------------------------------- structure
  const co = await step('Company, branch, departments, grades, designations', async () => {
    const company = await post(
      '/companies',
      { code: 'ACME', name: 'Acme Demo Pvt Ltd', timezone: 'Asia/Kolkata' },
      O(),
    );
    ids.branch = (
      await post('/branches', { companyId: company.id, code: 'BLR', name: 'Bengaluru HQ' }, O())
    ).id;
    ids.dept = {};
    for (const [code, name] of [
      ['MGMT', 'Management'],
      ['ENG', 'Engineering'],
      ['HR', 'People & HR'],
      ['FIN', 'Finance'],
      ['SALES', 'Sales'],
    ])
      ids.dept[code] = (await post('/departments', { companyId: company.id, code, name }, O())).id;
    const g1 = await post('/job-grades', { code: 'G1', name: 'Associate', rank: 1 }, O());
    const g2 = await post('/job-grades', { code: 'G2', name: 'Senior', rank: 2 }, O());
    const g3 = await post('/job-grades', { code: 'G3', name: 'Lead', rank: 3 }, O());
    ids.desig = {};
    for (const [code, name, g] of [
      ['CEO', 'Chief Executive', g3],
      ['OPSM', 'Operations Manager', g3],
      ['HRBP', 'HR Business Partner', g2],
      ['HREX', 'HR Executive', g1],
      ['ACCT', 'Accountant', g2],
      ['EM', 'Engineering Manager', g3],
      ['SWE', 'Software Engineer', g1],
    ])
      ids.desig[code] = (await post('/designations', { code, name, jobGradeId: g.id }, O())).id;
    return company;
  });

  await step('Work week, holiday calendar and shift', async () => {
    await post(
      '/work-weeks',
      {
        name: 'Mon–Fri',
        isDefault: true,
        rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'FULL' })),
      },
      O(),
    );
    const cal = await post('/holiday-calendars', { name: 'Demo holidays', isDefault: true }, O());
    await post(
      `/holiday-calendars/${cal.id}/holidays`,
      { holidays: [{ date: day(40), name: 'Demo company holiday' }] },
      O(),
    );
    await post(
      '/shifts',
      {
        code: 'GEN',
        name: 'General',
        startTime: '09:30',
        endTime: '18:30',
        breakMinutes: 60,
        graceInMinutes: 10,
        fullDayMinutes: 480,
        halfDayMinutes: 240,
        overtimeAfterMinutes: 30,
        isDefault: true,
      },
      O(),
    );
  });

  // ---------------------------------------------------------------- people
  await step('Owner as employee (Priya, CEO)', async () => {
    const me = await get('/auth/me', O());
    ids.owner = (
      await post(
        '/employees',
        {
          firstName: 'Priya',
          lastName: 'Sharma',
          dateOfJoining: '2023-04-03',
          companyId: co.id,
          branchId: ids.branch,
          departmentId: ids.dept.MGMT,
          designationId: ids.desig.CEO,
          employmentType: 'FULL_TIME',
          workEmail: email('owner'),
          membershipId: me.activeOrganization.membershipId,
        },
        O(),
      )
    ).id;
  });

  const roles = await get('/roles', O());
  const roleId = (key) => roles.find((r) => r.key === key)?.id;
  for (const p of PEOPLE) {
    await step(`${p.first} ${p.last} (${p.role})`, async () => {
      await post('/invitations', { email: email(p.key), roleIds: [roleId(p.role)] }, O());
      const token = await mailToken(email(p.key), '/accept-invitation');
      const accepted = await post('/invitations/accept', {
        token,
        fullName: `${p.first} ${p.last}`,
        password: PASSWORD,
        tokenTransport: 'body',
      });
      tok[p.key] = accepted.accessToken;
      const me = await get('/auth/me', tok[p.key]);
      ids[p.key] = (
        await post(
          '/employees',
          {
            firstName: p.first,
            lastName: p.last,
            dateOfJoining: '2024-06-03',
            companyId: co.id,
            branchId: ids.branch,
            departmentId: ids.dept[p.dept],
            designationId: ids.desig[p.desig],
            employmentType: 'FULL_TIME',
            workEmail: email(p.key),
            managerId: ids[p.manager],
            membershipId: me.activeOrganization.membershipId,
          },
          O(),
        )
      ).id;
    });
  }
  const T = (k) => tok[k];

  // ---------------------------------------------------------------- time & leave
  await step('Leave types, a pending and an approved leave, a clock-in', async () => {
    const cl = await post(
      '/leave/types',
      { code: 'CL', name: 'Casual leave', accrualMethod: 'YEARLY', annualQuota: '12' },
      O(),
    );
    const sl = await post(
      '/leave/types',
      { code: 'SL', name: 'Sick leave', accrualMethod: 'MONTHLY', annualQuota: '12' },
      O(),
    );
    const mon = monday(7);
    const tue = new Date(mon.getTime() + 86_400_000);
    await post(
      '/me/leave/requests',
      {
        leaveTypeId: cl.id,
        startDate: iso(mon),
        endDate: iso(tue),
        startSession: 'FULL',
        endSession: 'FULL',
        reason: 'Family function',
      },
      T('ananya'),
    );
    const wed = new Date(mon.getTime() + 2 * 86_400_000);
    const r = await post(
      '/me/leave/requests',
      {
        leaveTypeId: sl.id,
        startDate: iso(wed),
        endDate: iso(wed),
        startSession: 'FULL',
        endSession: 'FULL',
        reason: 'Doctor appointment',
      },
      T('rahul'),
    );
    await post(
      `/leave/requests/${r.id}/decision`,
      { decision: 'APPROVED', note: 'Get well soon' },
      T('manager'),
    );
    await post('/me/attendance/punches', { direction: 'IN', source: 'WEB' }, T('ananya'), {
      expect: [200, 201, 400, 409],
    });
  });

  // ---------------------------------------------------------------- recruitment
  await step('Job opening, candidates and applications', async () => {
    const opening = await post(
      '/recruitment/openings',
      {
        title: 'Backend Engineer',
        companyId: co.id,
        departmentId: ids.dept.ENG,
        employmentType: 'FULL_TIME',
        description: 'Build and run our APIs (demo opening).',
        salaryMin: '1200000',
        salaryMax: '1800000',
        experienceMinYears: 2,
      },
      O(),
    );
    await put(`/recruitment/openings/${opening.id}/status`, { status: 'PUBLISHED' }, O());
    for (const [first, last, stage] of [
      ['Meera', 'Nair', 'SCREENING'],
      ['Kabir', 'Khan', null],
    ]) {
      const c = await post(
        '/recruitment/candidates',
        { firstName: first, lastName: last, email: `${first.toLowerCase()}.candidate@${DOMAIN}` },
        O(),
      );
      const a = await post(
        '/recruitment/applications',
        { candidateId: c.id, openingId: opening.id },
        O(),
      );
      if (stage) await post(`/recruitment/applications/${a.id}/stage`, { stage }, O());
    }
  });

  // ---------------------------------------------------------------- workflows (before requests that use them)
  await step('Approval workflow: claims → manager, then finance from 10,000', async () => {
    const defs = await post(
      '/workflows',
      {
        process: 'EXPENSE_CLAIM',
        name: 'Expense claims',
        steps: [
          { name: 'Reporting manager', approver: { type: 'REPORTING_MANAGER' } },
          {
            name: 'Finance',
            approver: { type: 'ROLE', roleKey: 'finance' },
            minMeasure: '10000',
            slaHours: 48,
            escalateTo: { type: 'NEXT_MANAGER' },
          },
        ],
      },
      O(),
    );
    await put(`/workflows/${defs[0].id}/status`, { status: 'ACTIVE' }, O());
  });

  // ---------------------------------------------------------------- expenses & assets
  await step('Expense categories and a submitted 12,000 claim', async () => {
    const meals = await post(
      '/expenses/categories',
      { code: 'MEALS', name: 'Meals', maxPerItem: '3000' },
      O(),
    );
    const travel = await post(
      '/expenses/categories',
      { code: 'TRAVEL', name: 'Local travel' },
      O(),
    );
    const claim = await post(
      '/me/expense-claims',
      {
        title: 'Client workshop, Chennai',
        items: [
          {
            categoryId: meals.id,
            date: day(-3),
            description: 'Team lunch with client',
            originalAmount: '1500',
          },
          {
            categoryId: travel.id,
            date: day(-3),
            description: 'Cab and train',
            originalAmount: '10500',
          },
        ],
      },
      T('ananya'),
    );
    await post(`/expense-claims/${claim.id}/submit`, {}, T('ananya'), { expect: [200, 201] });
  });

  await step('Assets and a software licence', async () => {
    const cats = await post(
      '/assets/categories',
      { code: 'LAPTOP', name: 'Laptops', usefulLifeMonths: 36, salvagePercent: '10' },
      O(),
    );
    const cat = cats.find((c) => c.code === 'LAPTOP');
    const asset = await post(
      '/assets',
      {
        tag: 'LAP-001',
        name: 'Laptop 14"',
        categoryId: cat.id,
        serialNumber: 'DEMO-SN-001',
        purchaseDate: '2025-01-15',
        purchaseCost: '95000',
      },
      O(),
    );
    await post(
      `/assets/${asset.id}/allocate`,
      { employeeId: ids.rahul, allocatedOn: day(-30) },
      O(),
    );
    await post(
      '/assets',
      {
        tag: 'LAP-002',
        name: 'Laptop 14"',
        categoryId: cat.id,
        serialNumber: 'DEMO-SN-002',
        purchaseDate: '2025-01-15',
        purchaseCost: '95000',
      },
      O(),
    );
    const [lic] = await post(
      '/licenses',
      { name: 'Design suite', seats: 5, expiresOn: day(20) },
      O(),
    );
    await post(`/licenses/${lic.id}/seats`, { employeeId: ids.ananya }, O());
  });

  // ---------------------------------------------------------------- performance
  await step('Rating scale, template, goals and a launched review cycle', async () => {
    const [scale] = await post(
      '/performance/scales',
      {
        name: 'Five point',
        points: [
          ['1', 'Needs improvement'],
          ['2', 'Developing'],
          ['3', 'Meets expectations'],
          ['4', 'Exceeds'],
          ['5', 'Outstanding'],
        ].map(([value, label]) => ({ value, label })),
      },
      O(),
    );
    const comps = await post(
      '/performance/competencies',
      { code: 'COLLAB', name: 'Collaboration' },
      O(),
    );
    const more = await post(
      '/performance/competencies',
      { code: 'DELIVERY', name: 'Delivery' },
      O(),
    );
    const [template] = await post(
      '/performance/templates',
      {
        name: 'Annual review',
        ratingScaleId: scale.id,
        goalsWeightPercent: '50',
        competencies: [
          { competencyId: comps.find((c) => c.code === 'COLLAB').id, weight: '1' },
          { competencyId: more.find((c) => c.code === 'DELIVERY').id, weight: '1' },
        ],
        questions: [{ id: 'q1', text: 'What went best this year?', required: true }],
        includeSelf: true,
        includeManager: true,
        peerMin: 0,
        peerMax: 2,
        includeUpward: false,
        anonymityMinimum: 2,
      },
      O(),
    );
    await post(
      '/goals',
      { title: 'Grow revenue 20%', ownerType: 'ORGANIZATION', kind: 'GOAL' },
      O(),
    );
    await post(
      '/goals',
      {
        title: 'Close support tickets',
        ownerType: 'EMPLOYEE',
        employeeId: ids.ananya,
        kind: 'KPI',
        measure: { start: '0', target: '200', current: '40', unit: 'tickets' },
      },
      T('ananya'),
    );
    const cycle = await post(
      '/performance/cycles',
      {
        name: `${new Date().getFullYear()} annual review`,
        templateId: template.id,
        periodStart: `${new Date().getFullYear()}-01-01`,
        periodEnd: `${new Date().getFullYear()}-12-31`,
        audience: { departmentId: ids.dept.ENG },
      },
      O(),
    );
    await put(`/performance/cycles/${cycle.id}/status`, { status: 'OPEN' }, O());
  });

  // ---------------------------------------------------------------- learning & engagement
  await step('A published course assigned to Engineering', async () => {
    const course = await post(
      '/learning/courses',
      {
        code: 'SEC-101',
        title: 'Security basics',
        format: 'ONLINE',
        passPercent: 80,
        certificationValidityMonths: 12,
        skills: ['Security'],
        modules: [
          {
            title: 'Read the guide',
            type: 'CONTENT',
            content: 'Lock your screen. Use a password manager. Report phishing.',
          },
          {
            title: 'Check yourself',
            type: 'QUIZ',
            questions: [
              {
                id: 'q1',
                text: 'What do you do with a phishing e-mail?',
                options: ['Reply', 'Report it'],
                correct: [1],
                points: 1,
              },
            ],
          },
        ],
      },
      O(),
    );
    await patch(`/learning/courses/${course.id}`, { status: 'PUBLISHED' }, O());
    await post(
      '/learning/assignments',
      { courseId: course.id, audience: { departmentId: ids.dept.ENG }, dueOn: day(21) },
      O(),
    );
  });

  await step('Announcement, recognition and a pulse survey', async () => {
    await post(
      '/engagement/announcements',
      {
        title: 'Welcome to the demo',
        body: 'This organization is filled with demo data for manual testing.',
        pinned: true,
        requiresAcknowledgement: true,
      },
      O(),
    );
    const badges = await post('/engagement/badges', { name: 'Team player', points: 10 }, O());
    await post('/engagement/rewards', { name: 'Coffee voucher', pointsCost: 10, stock: 20 }, O());
    await post(
      '/engagement/recognitions',
      { toEmployeeId: ids.ananya, badgeId: badges[0].id, message: 'Great work on the release!' },
      T('manager'),
    );
    const survey = await post(
      '/engagement/surveys',
      {
        title: 'Monthly pulse',
        kind: 'PULSE',
        anonymous: true,
        minimumGroupSize: 3,
        opensAt: new Date(Date.now() - 60_000).toISOString(),
        closesAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        questions: [
          { id: 'r', type: 'RATING', text: 'How was your month?', required: true },
          { id: 'n', type: 'ENPS', text: 'Would you recommend us?', required: true },
        ],
      },
      O(),
    );
    await post(`/engagement/surveys/${survey.id}/publish`, {}, O());
  });

  // ---------------------------------------------------------------- projects & client portal
  await step('Client, project, board items, sprint and a submitted timesheet', async () => {
    const client = await post(
      '/clients',
      { code: 'GLOBEX', name: 'Globex Corporation', currency: 'INR', paymentTermsDays: 30 },
      O(),
    );
    ids.client = client.id;
    const project = await post(
      '/projects',
      {
        key: 'WEB',
        name: 'Globex website',
        clientId: client.id,
        billingType: 'TIME_AND_MATERIALS',
        hourlyRate: '1500',
        budgetHours: '400',
        portalEnabled: true,
      },
      O(),
    );
    ids.project = project.id;
    await post(
      `/projects/${project.id}/members`,
      { employeeId: ids.manager, role: 'MANAGER', billingRate: '2500' },
      O(),
    );
    for (const k of ['ananya', 'rahul'])
      await post(
        `/projects/${project.id}/members`,
        { employeeId: ids[k], role: 'MEMBER', billingRate: '1500' },
        O(),
      );
    const items = `/projects/${project.id}/items`;
    const epic = await post(
      items,
      { type: 'EPIC', title: 'Checkout', clientVisible: true },
      T('manager'),
    );
    const story = await post(
      items,
      {
        type: 'STORY',
        title: 'Pay by card',
        parentId: epic.id,
        storyPoints: 5,
        assigneeId: ids.ananya,
        clientVisible: true,
      },
      T('manager'),
    );
    await post(
      items,
      { type: 'TASK', title: 'Card form UI', parentId: story.id, assigneeId: ids.ananya },
      T('manager'),
    );
    await post(
      items,
      { type: 'TASK', title: 'Payment API', parentId: story.id, assigneeId: ids.rahul },
      T('manager'),
    );
    await post(
      items,
      {
        type: 'BUG',
        title: 'Total shows wrong tax',
        severity: 'MAJOR',
        assigneeId: ids.rahul,
        clientVisible: true,
      },
      T('manager'),
    );
    const sprints = await post(
      `/projects/${project.id}/sprints`,
      { name: 'Sprint 1', startDate: weekStart(), endDate: day(10) },
      T('manager'),
    );
    const s1 = sprints[0];
    await patch(`${items}/${story.id}`, { sprintId: s1.id }, T('manager'));
    await post(`/projects/${project.id}/sprints/${s1.id}/start`, {}, T('manager'));
    const week = weekStart();
    const sheet = await put(
      '/me/timesheet',
      {
        weekStart: week,
        entries: [
          { date: week, projectId: project.id, hours: '7.5', note: 'Card form' },
          { date: week, projectId: project.id, hours: '1', note: 'Stand-up and review' },
        ],
      },
      T('ananya'),
    );
    await post(`/timesheets/${sheet.id}/submit`, {}, T('ananya'));
    await post(
      '/invoices',
      {
        clientId: client.id,
        lines: [{ description: 'Discovery workshop (fixed fee)', quantity: 1, unitPrice: '75000' }],
      },
      O(),
    );
  });

  await step('Client portal login (Maria, Globex)', async () => {
    await post('/invitations', { email: email('client'), roleIds: [roleId('client')] }, O());
    const token = await mailToken(email('client'), '/accept-invitation');
    const accepted = await post('/invitations/accept', {
      token,
      fullName: 'Maria Fernandes',
      password: PASSWORD,
      tokenTransport: 'body',
    });
    const me = await get('/auth/me', accepted.accessToken);
    await post(
      `/clients/${ids.client}/portal-users`,
      { membershipId: me.activeOrganization.membershipId },
      O(),
    );
  });

  // ---------------------------------------------------------------- documents
  await step('Letter template, a letter awaiting acceptance, a company policy', async () => {
    const templates = await post(
      '/documents/templates',
      {
        name: 'Appointment letter',
        category: 'APPOINTMENT_LETTER',
        title: 'Appointment letter — {{employee.name}}',
        body: 'Dear {{employee.firstName}},\n\nWelcome to {{organization.name}} as {{employee.designation}} in {{employee.department}}, from {{employee.dateOfJoining}}.\n\n(Demo template text.)',
      },
      O(),
    );
    await post(
      '/documents',
      {
        templateId: templates[0].id,
        employeeId: ids.sneha,
        signers: [{ kind: 'EMPLOYEE', employeeId: ids.sneha }],
      },
      O(),
    );
    const form = new FormData();
    form.append('title', 'Code of conduct');
    form.append('category', 'Policies');
    form.append('requiresAcknowledgement', 'true');
    form.append(
      'file',
      new Blob(
        [
          await pdf('Code of conduct', [
            '1. Be respectful.',
            '2. Protect company data.',
            '3. Report concerns.',
          ]),
        ],
        { type: 'application/pdf' },
      ),
      'code-of-conduct.pdf',
    );
    await post('/library', undefined, O(), { form });
  });

  // ---------------------------------------------------------------- helpdesk
  await step('Helpdesk categories, tickets and knowledge base', async () => {
    const cats = await post(
      '/helpdesk/categories',
      {
        code: 'IT',
        name: 'IT support',
        agentEmployeeIds: [ids.admin],
        defaultAssigneeId: ids.admin,
        escalationEmployeeId: ids.owner,
        sla: [
          { priority: 'URGENT', firstResponseHours: 2, resolutionHours: 8 },
          { priority: 'HIGH', firstResponseHours: 4, resolutionHours: 24 },
        ],
      },
      O(),
    );
    await post(
      '/helpdesk/categories',
      {
        code: 'HRQ',
        name: 'HR & payroll questions',
        agentEmployeeIds: [ids.hr],
        defaultAssigneeId: ids.hr,
      },
      O(),
    );
    const it = cats.find((c) => c.code === 'IT');
    const t = await post(
      '/helpdesk/tickets',
      {
        categoryId: it.id,
        subject: 'Laptop is very slow',
        description: 'It takes 10 minutes to start.',
        priority: 'HIGH',
      },
      T('rahul'),
    );
    await post(
      `/helpdesk/tickets/${t.id}/comments`,
      { body: 'I will look at it this afternoon.' },
      T('admin'),
    );
    await post(
      '/helpdesk/articles',
      {
        title: 'Reset your VPN password',
        body: 'Open the self-service portal, choose "Forgot password" and follow the e-mail link.',
        status: 'PUBLISHED',
      },
      O(),
    );
    await post(
      '/helpdesk/articles',
      {
        title: 'How to request a new laptop',
        body: 'Raise an IT ticket with priority Medium and your manager in copy.',
        status: 'PUBLISHED',
      },
      O(),
    );
  });

  // ---------------------------------------------------------------- separation & compliance
  await step('Separation settings and a pending resignation', async () => {
    await put(
      '/separation/settings',
      {
        noticeDays: 30,
        items: [
          { title: 'Return ID card', ownerRoleKey: 'hr_admin', ownerEmployeeId: null },
          { title: 'Settle advances', ownerRoleKey: 'finance', ownerEmployeeId: null },
        ],
        questions: [
          { id: 'q1', type: 'RATING', text: 'How was your manager?' },
          { id: 'q2', type: 'TEXT', text: 'What could we do better?' },
        ],
      },
      O(),
    );
    await post(
      '/me/resignation',
      { reasonCategory: 'CAREER', note: 'Moving to a new role (demo).', requestedLastDay: day(30) },
      T('sneha'),
    );
  });

  await step('Compliance obligations (fictional demo examples)', async () => {
    await post(
      '/compliance/obligations',
      {
        title: 'Demo: monthly payroll filing review',
        category: 'STATUTORY_FILING',
        ownerEmployeeId: ids.finance,
        firstDueOn: day(5),
        recurrence: 'MONTHLY',
        description: 'Example obligation for testing. Replace with your real filings.',
      },
      O(),
    );
    await post(
      '/compliance/obligations',
      {
        title: 'Demo: annual policy review',
        category: 'POLICY_REVIEW',
        ownerEmployeeId: ids.hr,
        firstDueOn: day(-2),
        recurrence: 'YEARLY',
      },
      O(),
    );
  });

  // ---------------------------------------------------------------- summary
  console.log(
    '\nDemo data is ready. Sign in at the web app with any of these (password for all:',
    PASSWORD + '):\n',
  );
  const rows = [
    ['Owner (everything)', 'Priya Sharma', email('owner')],
    ['Organization admin', 'Arjun Mehta (IT helpdesk agent)', email('admin')],
    ['HR admin', 'Kavitha Rao (HR helpdesk, separations)', email('hr')],
    ['Finance', 'Rohan Iyer (claims finance step, billing)', email('finance')],
    ['Manager', 'Vikram Singh (approves Ananya & Rahul)', email('manager')],
    ['Employee', 'Ananya Das (leave, claim, timesheet pending)', email('ananya')],
    ['Employee', 'Rahul Verma (laptop, ticket raised)', email('rahul')],
    ['Employee', 'Sneha Kapoor (letter to accept, resignation)', email('sneha')],
    ['Client portal', 'Maria Fernandes (Globex)', email('client')],
  ];
  for (const [r, n, e] of rows) console.log(`  ${r.padEnd(20)} ${n.padEnd(46)} ${e}`);
  console.log(
    '\nNot seeded on purpose: payroll statutory rules and runs (configure them under Payroll with sourced values).',
  );
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  console.error(
    'Make sure Docker (infra:up), the migrated database and the API (pnpm dev) are running.',
  );
  process.exit(1);
});
