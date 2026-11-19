import type {
  ApprovalInbox,
  AttendanceDayItem,
  AttendanceRangeItem,
  LeaveBalanceItem,
  LeaveTypeItem,
  TodayAttendance,
} from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const ref = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Asha Rao' };
const page = (n: number) => ({ pagination: { page: 1, pageSize: 50, total: n, totalPages: 1 } });

const day = (date: string, over: Partial<AttendanceDayItem> = {}): AttendanceDayItem => ({
  date,
  status: 'PRESENT',
  leave: null,
  holidayName: null,
  shift: { code: 'GEN', name: 'General' },
  scheduledStart: `${date}T04:00:00.000Z`,
  scheduledEnd: `${date}T13:00:00.000Z`,
  firstIn: `${date}T04:20:00.000Z`,
  lastOut: `${date}T13:00:00.000Z`,
  workedMinutes: 520,
  lateMinutes: 10,
  earlyExitMinutes: 0,
  overtimeMinutes: 0,
  missingPunch: false,
  workedOnOffDay: false,
  regularized: false,
  pendingRegularization: false,
  ...over,
});

const today: TodayAttendance = {
  day: day('2026-11-19', {
    status: 'PENDING',
    firstIn: null,
    lastOut: null,
    workedMinutes: 0,
    lateMinutes: 0,
  }),
  punches: [],
  nextDirection: 'IN',
  timeZone: 'Asia/Kolkata',
  allowed: { web: true, mobile: true, qr: true, geolocationRequired: false },
};

function rangeFor(from: string, to: string): AttendanceRangeItem {
  return {
    employee: ref,
    timeZone: 'Asia/Kolkata',
    from,
    to,
    days: [
      day(from),
      day(`${from.slice(0, 8)}02`, {
        status: 'ABSENT',
        firstIn: null,
        lastOut: null,
        workedMinutes: 0,
        lateMinutes: 0,
      }),
    ],
    totals: {
      present: 1,
      halfDay: 0,
      absent: 1,
      onLeave: 0,
      weeklyOff: 0,
      holiday: 0,
      pending: 0,
      workedMinutes: 520,
      lateDays: 1,
      overtimeMinutes: 0,
      missingPunches: 0,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('time navigation', () => {
  it('shows self-service to employees and team views only with permissions', async () => {
    signInAs(['attendance.self.use', 'leave.self.use']);
    stubFetch(() => ok({ leave: [], regularizations: [] }));
    renderAt('/me/approvals');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My attendance' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'My leave' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Team attendance' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Shifts' })).not.toBeInTheDocument();
    expect(await screen.findByText('Nothing to approve')).toBeInTheDocument();
  });
});

describe('my attendance', () => {
  it('clocks in through the API and shows the month', async () => {
    signInAs(['attendance.self.use']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.includes('/me/attendance/today')) return ok(today);
      if (c.method === 'POST' && c.url.endsWith('/me/attendance/punches'))
        return ok({ ...today, nextDirection: 'OUT' });
      if (c.url.includes('/me/attendance/regularizations')) return ok([]);
      if (c.url.includes('/me/attendance?')) {
        const u = new URL(c.url);
        return ok(rangeFor(u.searchParams.get('from') ?? '', u.searchParams.get('to') ?? ''));
      }
      return ok(null);
    });
    renderAt('/me/attendance');
    await user.click(await screen.findByRole('button', { name: /Clock in/ }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ source: 'WEB' });
    });
    expect(await screen.findByRole('grid', { name: 'Attendance calendar' })).toBeInTheDocument();
    expect(screen.getByText(/1 present · 0 half · 1 absent/)).toBeInTheDocument();
    // Selecting an absent day offers a regularization request.
    const absent = screen
      .getAllByRole('gridcell')
      .find((c) => c.getAttribute('aria-label')?.endsWith('Absent'));
    expect(absent).toBeDefined();
    await user.click(absent as HTMLElement);
    expect(
      await screen.findByRole('button', { name: 'Request regularization' }),
    ).toBeInTheDocument();
  });
});

describe('leave', () => {
  const types: LeaveTypeItem[] = [
    {
      id: 'lt-1',
      code: 'CL',
      name: 'Casual leave',
      description: null,
      isPaid: true,
      tracksBalance: true,
      accrualMethod: 'YEARLY',
      annualQuota: '12.00',
      prorateOnJoining: false,
      carryForwardMax: null,
      allowNegativeBalance: false,
      allowHalfDay: true,
      countWeeklyOffs: false,
      countHolidays: false,
      minNoticeDays: 0,
      maxConsecutiveDays: null,
      allowDuringProbation: true,
      employmentTypes: [],
      status: 'ACTIVE',
    },
  ];
  const balance: LeaveBalanceItem = {
    leaveType: { id: 'lt-1', code: 'CL', name: 'Casual leave', isPaid: true, tracksBalance: true },
    year: 2026,
    opening: '0.00',
    accrued: '12.00',
    adjusted: '0.00',
    used: '2.00',
    pending: '0.00',
    balance: '10.00',
    available: '10.00',
  };

  it('shows balances and previews an application before applying', async () => {
    signInAs(['leave.self.use']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.includes('/me/leave/balances')) return ok([balance]);
      if (c.url.includes('/me/leave/requests/preview'))
        return ok({ days: '2.00', breakdown: [], balance, problems: [] });
      if (c.method === 'POST' && c.url.endsWith('/me/leave/requests')) return ok({ id: 'r-1' });
      if (c.url.includes('/me/leave/requests')) return ok([], page(0));
      if (c.url.includes('/leave/types')) return ok(types);
      return ok(null);
    });
    renderAt('/me/leave');
    const balances = await screen.findByRole('list', { name: 'Leave balances' });
    expect(within(balances).getByText('10.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Apply for leave/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: 'Casual leave' })).toBeInTheDocument();
    });
    await user.selectOptions(within(dialog).getByLabelText(/^Leave type/), 'lt-1');
    await user.type(within(dialog).getByLabelText(/^From/), '2026-12-03');
    await user.clear(within(dialog).getByLabelText(/^To/));
    await user.type(within(dialog).getByLabelText(/^To/), '2026-12-04');
    expect(await within(dialog).findByText('2.00 day(s)')).toBeInTheDocument();
    expect(within(dialog).getByText(/after this 8.00/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.method === 'POST' && c.url.endsWith('/me/leave/requests'))?.body,
      ).toMatchObject({
        leaveTypeId: 'lt-1',
        startDate: '2026-12-03',
        endDate: '2026-12-04',
        startSession: 'FULL',
        endSession: 'FULL',
      });
    });
  });

  it('approves requests from the inbox', async () => {
    signInAs(['leave.self.use']);
    const user = userEvent.setup();
    const inbox: ApprovalInbox = {
      leave: [
        {
          id: 'r-9',
          employee: ref,
          leaveType: { id: 'lt-1', code: 'CL', name: 'Casual leave' },
          startDate: '2026-12-03',
          endDate: '2026-12-04',
          startSession: 'FULL',
          endSession: 'FULL',
          days: '2.00',
          reason: 'Family',
          status: 'PENDING',
          approver: null,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          createdAt: '',
          canDecide: true,
        },
      ],
      regularizations: [],
    };
    const calls = stubFetch((c) => (c.url.includes('/decision') ? ok({}) : ok(inbox)));
    renderAt('/me/approvals');
    const list = await screen.findByRole('list', { name: 'Leave approvals' });
    expect(within(list).getByText(/Asha Rao · Casual leave · 2.00 day/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /Approve/ }));
    await waitFor(() => {
      expect(calls.find((c) => c.url.endsWith('/leave/requests/r-9/decision'))?.body).toEqual({
        decision: 'APPROVED',
      });
    });
  });
});
