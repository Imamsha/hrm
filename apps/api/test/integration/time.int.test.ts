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
let branch: { id: string };
let dept: { id: string };
let manager: { token: string; employeeId: string; number: string };
let worker: { token: string; employeeId: string; number: string };

// Times are local to Asia/Kolkata (UTC+05:30).
const IST = (date: string, hhmm: string) => `${date}T${hhmm}:00+05:30`;

// All dates are relative to today so the suite keeps working as time passes.
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const todayUtc = Date.parse(`${iso(Date.now())}T00:00:00Z`);
const isoDow = ((new Date(todayUtc).getUTCDay() + 6) % 7) + 1; // 1 = Monday
// The attendance week: Monday two weeks ago … Sunday (Thursday is a holiday).
const weekStart = todayUtc - (isoDow - 1) * DAY - 14 * DAY;
const [MON, TUE, WED, THU, FRI, SAT, SUN] = [0, 1, 2, 3, 4, 5, 6].map((i) =>
  iso(weekStart + i * DAY),
) as [string, string, string, string, string, string, string];
// Leave: the leave year starts ~6 months before today, so there is room ahead in it.
const curMonth = new Date(todayUtc).getUTCMonth() + 1;
const START_MONTH = ((curMonth + 5) % 12) + 1;
const MONTHS_STARTED = ((curMonth - START_MONTH + 12) % 12) + 1;
const LEAVE_YEAR =
  curMonth >= START_MONTH
    ? new Date(todayUtc).getUTCFullYear()
    : new Date(todayUtc).getUTCFullYear() - 1;
const yearEnd = Date.parse(
  `${String(START_MONTH === 1 ? LEAVE_YEAR : LEAVE_YEAR + 1)}-${String(START_MONTH === 1 ? 12 : START_MONTH - 1).padStart(2, '0')}-01T00:00:00Z`,
);
const lastOfYear = Date.UTC(
  new Date(yearEnd).getUTCFullYear(),
  new Date(yearEnd).getUTCMonth() + 1,
  0,
);
// Next Thursday at least a week ahead: Thu, Fri, (Sat, Sun off), Mon.
const nextThu = todayUtc + (((4 - isoDow + 7) % 7) + 7) * DAY;
const L = (n: number) => iso(nextThu + n * DAY);
const SPAN_FROM = iso(lastOfYear - DAY);
const SPAN_TO = iso(lastOfYear + 4 * DAY);
const SOON = iso(todayUtc + 7 * DAY);
const FUTURE = iso(todayUtc + 30 * DAY);
const ASSIGN_A = iso(todayUtc + 40 * DAY);
const ASSIGN_B = iso(todayUtc + 20 * DAY);

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Time');
  co = await create('/companies', { code: 'TIME', name: 'Time Co', timezone: 'Asia/Kolkata' });
  branch = await create('/branches', { companyId: co.id, code: 'T-BLR', name: 'Bengaluru' });
  dept = await create('/departments', { companyId: co.id, code: 'T-ENG', name: 'Engineering' });
  await create('/work-weeks', {
    name: 'Mon–Fri',
    isDefault: true,
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'FULL' })),
  });
  const cal = await create('/holiday-calendars', { name: 'Holidays', isDefault: true });
  await client.post(
    `/holiday-calendars/${cal.id}/holidays`,
    { holidays: [{ date: THU, name: 'Festival' }] },
    owner.accessToken,
  );
  await create('/shifts', {
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
  });
  manager = await person('Meera', null);
  worker = await person('Ravi', manager.employeeId);
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

async function invite(roleKey = 'employee') {
  const roles = await client.get('/roles', owner.accessToken);
  const roleId = (roles.body.data as { id: string; key: string }[]).find(
    (r) => r.key === roleKey,
  )?.id;
  const email = uniqueEmail(roleKey);
  await client.post('/invitations', { email, roleIds: [roleId] }, owner.accessToken);
  const token = tokenFromLink((await waitForEmail(email)).text, '/accept-invitation');
  const accepted = await client.post('/invitations/accept', {
    token,
    fullName: 'Time Person',
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  return {
    token: accepted.body.data.accessToken as string,
    membershipId: me.body.data.activeOrganization.membershipId as string,
  };
}

async function person(firstName: string, managerId: string | null) {
  const m = await invite();
  const e = await create('/employees', {
    firstName,
    dateOfJoining: '2025-01-06',
    companyId: co.id,
    branchId: branch.id,
    departmentId: dept.id,
    employmentType: 'FULL_TIME',
    membershipId: m.membershipId,
    ...(managerId ? { managerId } : {}),
  });
  return {
    token: m.token,
    employeeId: e.id,
    number: (e as unknown as { employeeNumber: string }).employeeNumber,
  };
}

describe('shifts and rosters', () => {
  it('validates shifts, keeps one default, and assigns effective-dated shifts', async () => {
    const bad = await client.post(
      '/shifts',
      {
        code: 'BAD',
        name: 'Bad',
        startTime: '09:00',
        endTime: '13:00',
        fullDayMinutes: 200,
        halfDayMinutes: 300,
      },
      owner.accessToken,
    );
    expect(bad.status).toBe(400);
    const dup = await client.post(
      '/shifts',
      {
        code: 'GEN',
        name: 'Dup',
        startTime: '09:00',
        endTime: '18:00',
        fullDayMinutes: 480,
        halfDayMinutes: 240,
      },
      owner.accessToken,
    );
    expect(dup.status).toBe(409);
    const night = await create('/shifts', {
      code: 'NIGHT',
      name: 'Night',
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 60,
      fullDayMinutes: 420,
      halfDayMinutes: 210,
    });
    const list = await client.get('/shifts', owner.accessToken);
    const n = (list.body.data as { id: string; crossesMidnight: boolean }[]).find(
      (s) => s.id === night.id,
    );
    expect(n?.crossesMidnight).toBe(true);

    const a1 = await client.post(
      '/shift-assignments',
      { employeeIds: [manager.employeeId], shiftId: night.id, effectiveFrom: ASSIGN_A },
      owner.accessToken,
    );
    expect(a1.status).toBe(201);
    const later = await client.post(
      '/shift-assignments',
      { employeeIds: [manager.employeeId], shiftId: night.id, effectiveFrom: ASSIGN_B },
      owner.accessToken,
    );
    expect(later.status).toBe(409);
    const assigned = await client.get(
      `/shift-assignments?employeeId=${manager.employeeId}`,
      owner.accessToken,
    );
    expect(assigned.body.data[0]).toMatchObject({
      effectiveFrom: ASSIGN_A,
      shift: { code: 'NIGHT' },
    });

    const roster = await client.put(
      '/roster',
      {
        entries: [{ employeeId: worker.employeeId, date: TUE, shiftId: null, note: 'Comp off' }],
      },
      owner.accessToken,
    );
    expect(roster.status).toBe(200);
    const r = await client.get(
      `/roster?from=${MON}&to=${SUN}&employeeId=${worker.employeeId}`,
      owner.accessToken,
    );
    expect(r.body.data).toMatchObject([{ date: TUE, shift: null, note: 'Comp off' }]);
    // Employees cannot manage shifts.
    expect((await client.post('/shifts', { code: 'X' }, worker.token)).status).toBe(403);
  });
});

describe('attendance', () => {
  it('imports device punches idempotently and evaluates the week', async () => {
    const punches = [
      { employeeNumber: worker.number, punchedAt: IST(MON, '09:55'), direction: 'IN' },
      { employeeNumber: worker.number, punchedAt: IST(MON, '18:45'), direction: 'OUT' },
      { employeeNumber: worker.number, punchedAt: IST(WED, '09:30'), direction: 'IN' },
      { employeeNumber: worker.number, punchedAt: IST(WED, '14:00'), direction: 'OUT' },
      { employeeNumber: worker.number, punchedAt: IST(FRI, '09:30'), direction: 'IN' },
      { employeeNumber: 'NOPE-1', punchedAt: IST(MON, '09:30'), direction: 'IN' },
    ];
    const first = await client.post('/attendance/punches/import', { punches }, owner.accessToken);
    expect(first.body.data).toMatchObject({ imported: 5, duplicates: 0, errors: [{ row: 5 }] });
    const again = await client.post(
      '/attendance/punches/import',
      { punches: punches.slice(0, 2) },
      owner.accessToken,
    );
    expect(again.body.data).toMatchObject({ imported: 0, duplicates: 2 });
    expect(
      (await client.post('/attendance/punches/import', { punches }, worker.token)).status,
    ).toBe(403);

    const week = await client.get(
      `/employees/${worker.employeeId}/attendance/days?from=${MON}&to=${SUN}`,
      owner.accessToken,
    );
    expect(week.status).toBe(200);
    const byDate = Object.fromEntries(
      (week.body.data.days as { date: string }[]).map((d) => [d.date, d]),
    );
    expect(byDate[MON]).toMatchObject({
      status: 'PRESENT',
      lateMinutes: 15,
      workedMinutes: 530,
      overtimeMinutes: 20,
    });
    expect(byDate[TUE]).toMatchObject({ status: 'WEEKLY_OFF' }); // rostered day off
    expect(byDate[WED]).toMatchObject({ status: 'HALF_DAY', earlyExitMinutes: 270 });
    expect(byDate[THU]).toMatchObject({ status: 'HOLIDAY', holidayName: 'Festival' });
    expect(byDate[FRI]).toMatchObject({ status: 'ABSENT', missingPunch: true });
    expect(byDate[SAT]).toMatchObject({ status: 'WEEKLY_OFF' });
    expect(week.body.data.totals).toMatchObject({
      present: 1,
      halfDay: 1,
      absent: 1,
      holiday: 1,
      weeklyOff: 3,
      lateDays: 1,
    });

    // The employee sees the same; another employee cannot.
    expect(
      (await client.get(`/me/attendance?from=${MON}&to=${SUN}`, worker.token)).body.data.totals
        .present,
    ).toBe(1);
    expect(
      (
        await client.get(
          `/employees/${worker.employeeId}/attendance/days?from=${MON}&to=${SUN}`,
          manager.token,
        )
      ).status,
    ).toBe(403);
  });

  it('clocks in and out with toggling, duplicate protection and settings', async () => {
    const before = await client.get('/me/attendance/today', worker.token);
    const first = await client.post('/me/attendance/punches', {}, worker.token);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.data.nextDirection).toBe(
      before.body.data.nextDirection === 'IN' ? 'OUT' : 'IN',
    );
    const dup = await client.post(
      '/me/attendance/punches',
      { direction: first.body.data.punches.at(-1).direction },
      worker.token,
    );
    expect(dup.status).toBe(409);

    await client.put(
      '/attendance/settings',
      {
        leaveYearStartMonth: 1,
        webPunchEnabled: false,
        mobilePunchEnabled: true,
        qrPunchEnabled: true,
        geolocationRequired: true,
        qrRotationSeconds: 30,
      },
      owner.accessToken,
    );
    expect(
      (await client.post('/me/attendance/punches', { source: 'WEB' }, manager.token)).status,
    ).toBe(403);
    const noGeo = await client.post('/me/attendance/punches', { source: 'MOBILE' }, manager.token);
    expect(noGeo.status).toBe(400);
    expect(noGeo.body.error.details[0].path).toBe('latitude');
    const geo = await client.post(
      '/me/attendance/punches',
      { source: 'MOBILE', latitude: '12.971599', longitude: '77.594566' },
      manager.token,
    );
    expect(geo.status).toBe(201);
    expect(geo.body.data.punches.at(-1)).toMatchObject({ source: 'MOBILE', latitude: '12.971599' });

    // QR: a kiosk token proves presence; tampering is rejected.
    const kiosk = await client.get(`/attendance/kiosk/${branch.id}/token`, owner.accessToken);
    expect(kiosk.body.data.url).toContain('/attendance/qr?t=');
    expect((await client.get(`/attendance/kiosk/${branch.id}/token`, worker.token)).status).toBe(
      403,
    );
    const tampered = await client.post(
      '/me/attendance/punches',
      { qrToken: `${kiosk.body.data.token}x` },
      manager.token,
    );
    expect(tampered.status).toBe(400);
    const qr = await client.post(
      '/me/attendance/punches',
      { qrToken: kiosk.body.data.token },
      manager.token,
    );
    expect(qr.status).toBe(201);
    expect(qr.body.data.punches.at(-1).source).toBe('QR');

    await client.put(
      '/attendance/settings',
      {
        leaveYearStartMonth: 1,
        webPunchEnabled: true,
        mobilePunchEnabled: true,
        qrPunchEnabled: true,
        geolocationRequired: false,
        qrRotationSeconds: 30,
      },
      owner.accessToken,
    );
  });

  it('routes regularizations to the reporting manager', async () => {
    const req = await client.post(
      '/me/attendance/regularizations',
      {
        date: FRI,
        requestedIn: IST(FRI, '09:30'),
        requestedOut: IST(FRI, '18:30'),
        reason: 'Forgot to clock out',
      },
      worker.token,
    );
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const again = await client.post(
      '/me/attendance/regularizations',
      {
        date: FRI,
        requestedIn: IST(FRI, '09:30'),
        requestedOut: IST(FRI, '18:00'),
        reason: 'Again',
      },
      worker.token,
    );
    expect(again.status).toBe(409);
    const future = await client.post(
      '/me/attendance/regularizations',
      {
        date: FUTURE,
        requestedIn: IST(FUTURE, '09:30'),
        requestedOut: IST(FUTURE, '18:30'),
        reason: 'x',
      },
      worker.token,
    );
    expect(future.status).toBe(400);

    const week = await client.get(`/me/attendance?from=${FRI}&to=${FRI}`, worker.token);
    expect(week.body.data.days[0]).toMatchObject({ pendingRegularization: true, status: 'ABSENT' });

    expect(
      (
        await client.post(
          `/attendance/regularizations/${req.body.data.id}/decision`,
          { decision: 'APPROVED' },
          worker.token,
        )
      ).status,
    ).toBe(403);
    const inbox = await client.get('/me/approvals', manager.token);
    expect(inbox.body.data.regularizations.map((r: { id: string }) => r.id)).toContain(
      req.body.data.id,
    );
    const decided = await client.post(
      `/attendance/regularizations/${req.body.data.id}/decision`,
      { decision: 'APPROVED', note: 'OK' },
      manager.token,
    );
    expect(decided.body.data).toMatchObject({ status: 'APPROVED', decisionNote: 'OK' });
    const after = await client.get(`/me/attendance?from=${FRI}&to=${FRI}`, worker.token);
    expect(after.body.data.days[0]).toMatchObject({
      status: 'PRESENT',
      regularized: true,
      missingPunch: false,
    });
  });

  it('records audited manual punches and summarizes the day', async () => {
    const manual = await client.post(
      `/employees/${manager.employeeId}/attendance/punches`,
      { punchedAt: IST(MON, '09:00'), direction: 'IN', note: 'Biometric device offline' },
      owner.accessToken,
    );
    expect(manual.status).toBe(201);
    expect(manual.body.data.source).toBe('MANUAL');
    const summary = await client.get(
      `/attendance/summary?date=${MON}&departmentId=${dept.id}`,
      owner.accessToken,
    );
    expect(summary.body.data.counts.PRESENT).toBeGreaterThanOrEqual(1);
    expect(summary.body.data.late).toBeGreaterThanOrEqual(1);
    expect((await client.get(`/attendance/summary?date=${MON}`, worker.token)).status).toBe(403);
    const audit = await client.get('/audit-logs?search=attendance.manual_punch', owner.accessToken);
    expect(audit.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('leave', () => {
  let cl: { id: string };
  let lop: { id: string };

  it('accrues, carries forward and reports balances', async () => {
    await client.put(
      '/attendance/settings',
      {
        leaveYearStartMonth: START_MONTH,
        webPunchEnabled: true,
        mobilePunchEnabled: true,
        qrPunchEnabled: true,
        geolocationRequired: false,
        qrRotationSeconds: 30,
      },
      owner.accessToken,
    );
    cl = await create('/leave/types', {
      code: 'CL',
      name: 'Casual leave',
      accrualMethod: 'YEARLY',
      annualQuota: '12',
      carryForwardMax: '5',
    });
    await create('/leave/types', {
      code: 'SL',
      name: 'Sick leave',
      accrualMethod: 'MONTHLY',
      annualQuota: '12',
    });
    lop = await create('/leave/types', {
      code: 'LOP',
      name: 'Loss of pay',
      isPaid: false,
      tracksBalance: false,
      accrualMethod: 'NONE',
    });
    expect(
      (await client.post('/leave/types', { code: 'CL', name: 'Dup' }, owner.accessToken)).status,
    ).toBe(409);
    expect(
      (await client.post('/leave/types', { code: 'XX', name: 'X' }, worker.token)).status,
    ).toBe(403);

    const balances = await client.get(`/me/leave/balances?year=${LEAVE_YEAR}`, worker.token);
    expect(balances.status, JSON.stringify(balances.body)).toBe(200);
    const byCode = Object.fromEntries(
      (balances.body.data as { leaveType: { code: string }; accrued: string }[]).map((b) => [
        b.leaveType.code,
        b,
      ]),
    );
    // Last year: nothing used → 5 (cap) carried forward. This year: 12 granted.
    expect(byCode.CL).toMatchObject({
      opening: '5.00',
      accrued: '12.00',
      balance: '17.00',
      available: '17.00',
    });
    // Monthly: one day per month started so far in the leave year.
    expect(byCode.SL?.accrued).toBe(`${String(MONTHS_STARTED)}.00`);
    expect(byCode.LOP).toMatchObject({ balance: '0.00' });

    const ledger = await client.get(
      `/me/leave/ledger?leaveTypeId=${cl.id}&year=${LEAVE_YEAR - 1}`,
      worker.token,
    );
    // Last year: its accrual and year-end lapse (plus a carry-in if the employee joined earlier).
    expect(ledger.body.data.map((e: { entryType: string }) => e.entryType)).toEqual(
      expect.arrayContaining(['ACCRUAL', 'LAPSE']),
    );
    // Idempotent: reading again does not double the credits.
    expect(
      (await client.get(`/me/leave/balances?year=${LEAVE_YEAR}`, worker.token)).body.data.find(
        (b: { leaveType: { code: string } }) => b.leaveType.code === 'CL',
      ).balance,
    ).toBe('17.00');
  });

  it('applies, routes to the manager, approves, and reverses on cancel', async () => {
    // Thu → Mon: Thu, Fri, Mon count; the weekend does not.
    const preview = await client.post(
      '/me/leave/requests/preview',
      { leaveTypeId: cl.id, startDate: L(0), endDate: L(4) },
      worker.token,
    );
    expect(preview.body.data).toMatchObject({ days: '3.00', problems: [] });

    const req = await client.post(
      '/me/leave/requests',
      { leaveTypeId: cl.id, startDate: L(0), endDate: L(4), reason: 'Family' },
      worker.token,
    );
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.data).toMatchObject({
      status: 'PENDING',
      days: '3.00',
      approver: { id: manager.employeeId },
      canDecide: false,
    });

    const overlap = await client.post(
      '/me/leave/requests',
      {
        leaveTypeId: lop.id,
        startDate: L(1),
        endDate: L(1),
        startSession: 'FIRST_HALF',
        endSession: 'FIRST_HALF',
      },
      worker.token,
    );
    expect(overlap.status).toBe(400);
    // Two halves of one day do not overlap.
    expect(
      (
        await client.post(
          '/me/leave/requests',
          {
            leaveTypeId: lop.id,
            startDate: L(6),
            endDate: L(6),
            startSession: 'FIRST_HALF',
            endSession: 'FIRST_HALF',
          },
          worker.token,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await client.post(
          '/me/leave/requests',
          {
            leaveTypeId: lop.id,
            startDate: L(6),
            endDate: L(6),
            startSession: 'SECOND_HALF',
            endSession: 'SECOND_HALF',
          },
          worker.token,
        )
      ).status,
    ).toBe(201);

    const tooMuch = await client.post(
      '/me/leave/requests',
      { leaveTypeId: cl.id, startDate: L(7), endDate: L(35) },
      worker.token,
    );
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toContain('Insufficient balance');
    const spans = await client.post(
      '/me/leave/requests',
      { leaveTypeId: lop.id, startDate: SPAN_FROM, endDate: SPAN_TO },
      worker.token,
    );
    expect(spans.status).toBe(400);

    const pending = (
      await client.get(`/me/leave/balances?year=${LEAVE_YEAR}`, worker.token)
    ).body.data.find((b: { leaveType: { id: string } }) => b.leaveType.id === cl.id);
    expect(pending).toMatchObject({ pending: '3.00', available: '14.00' });

    expect(
      (
        await client.post(
          `/leave/requests/${req.body.data.id}/decision`,
          { decision: 'APPROVED' },
          worker.token,
        )
      ).status,
    ).toBe(403);
    const inbox = await client.get('/me/approvals', manager.token);
    expect(
      inbox.body.data.leave.find((l: { id: string }) => l.id === req.body.data.id),
    ).toMatchObject({ canDecide: true });
    const approved = await client.post(
      `/leave/requests/${req.body.data.id}/decision`,
      { decision: 'APPROVED' },
      manager.token,
    );
    expect(approved.body.data.status).toBe('APPROVED');
    const used = (
      await client.get(`/me/leave/balances?year=${LEAVE_YEAR}`, worker.token)
    ).body.data.find((b: { leaveType: { id: string } }) => b.leaveType.id === cl.id);
    expect(used).toMatchObject({ used: '3.00', balance: '14.00', pending: '0.00' });
    const onLeave = await client.get(`/me/attendance?from=${L(0)}&to=${L(0)}`, worker.token);
    expect(onLeave.body.data.days[0]).toMatchObject({
      status: 'ON_LEAVE',
      leave: { type: 'Casual leave', session: 'FULL' },
    });
    expect(
      (
        await client.post(
          `/leave/requests/${req.body.data.id}/decision`,
          { decision: 'REJECTED' },
          manager.token,
        )
      ).status,
    ).toBe(409);

    const cancelled = await client.post(
      `/leave/requests/${req.body.data.id}/cancel`,
      {},
      worker.token,
    );
    expect(cancelled.body.data.status).toBe('CANCELLED');
    const restored = (
      await client.get(`/me/leave/balances?year=${LEAVE_YEAR}`, worker.token)
    ).body.data.find((b: { leaveType: { id: string } }) => b.leaveType.id === cl.id);
    expect(restored).toMatchObject({ used: '0.00', balance: '17.00' });
  });

  it('enforces notice and lets HR adjust balances (not their own)', async () => {
    const strict = await create('/leave/types', {
      code: 'PL',
      name: 'Planned',
      annualQuota: '10',
      minNoticeDays: 30,
    });
    const soon = await client.post(
      '/me/leave/requests',
      { leaveTypeId: strict.id, startDate: SOON, endDate: SOON },
      worker.token,
    );
    expect(soon.status).toBe(400);
    expect(soon.body.error.message).toContain('in advance');

    const adj = await client.post(
      `/employees/${worker.employeeId}/leave/adjustments`,
      { leaveTypeId: cl.id, year: LEAVE_YEAR, days: '2', note: 'Award' },
      owner.accessToken,
    );
    expect(adj.body.data).toMatchObject({ adjusted: '2.00', balance: '19.00' });
    expect(
      (
        await client.post(
          `/employees/${worker.employeeId}/leave/adjustments`,
          { leaveTypeId: cl.id, year: LEAVE_YEAR, days: '1', note: 'x' },
          worker.token,
        )
      ).status,
    ).toBe(403);
    // HR applies on behalf of an employee.
    const onBehalf = await client.post(
      `/employees/${worker.employeeId}/leave/requests`,
      { leaveTypeId: cl.id, startDate: L(13), endDate: L(13) },
      owner.accessToken,
    );
    expect(onBehalf.status).toBe(201);
  });
});

describe('isolation and integrity', () => {
  it('keeps other tenants out and history append-only', async () => {
    const other = await registerAccount(client, 'Time other');
    expect(
      (
        await client.get(
          `/employees/${worker.employeeId}/attendance/days?from=${MON}&to=${TUE}`,
          other.accessToken,
        )
      ).status,
    ).toBe(404);
    const theirReq = await client.get('/leave/requests?pageSize=200', other.accessToken);
    expect(theirReq.body.data).toEqual([]);
    const mine = await client.get('/leave/requests?status=PENDING&pageSize=200', owner.accessToken);
    const someId = (mine.body.data as { id: string }[])[0]?.id ?? '';
    expect(
      (
        await client.post(
          `/leave/requests/${someId}/decision`,
          { decision: 'APPROVED' },
          other.accessToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (await client.get(`/attendance/kiosk/${branch.id}/token`, other.accessToken)).status,
    ).toBe(404);

    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    try {
      for (const t of [
        'attendance_punches',
        'leave_requests',
        'leave_ledger_entries',
        'shifts',
        'time_settings',
      ]) {
        const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`);
        expect(rows[0]?.n, t).toBe('0');
      }
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.organization_id', $1, true)", [owner.organizationId]);
      await expect(db.query("UPDATE attendance_punches SET note = 'x'")).rejects.toThrow();
      await db.query('ROLLBACK');
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.organization_id', $1, true)", [owner.organizationId]);
      await expect(db.query('DELETE FROM leave_ledger_entries')).rejects.toThrow();
      await db.query('ROLLBACK');
    } finally {
      await db.end();
    }
  });
});
