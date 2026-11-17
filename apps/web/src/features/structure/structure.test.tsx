import type { CompanyItem, OrgChart, ResolvedCalendar, WorkWeekItem } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';
import { toPayload } from './entity-payload';
import { summarizeWorkWeek } from './work-week-summary';

const page = (total: number) => ({
  pagination: { page: 1, pageSize: 25, total, totalPages: Math.max(1, Math.ceil(total / 25)) },
});

const company: CompanyItem = {
  id: '0195f1d2-0000-7000-8000-0000000c0001',
  code: 'ACME-IN',
  name: 'Acme India',
  countryCode: 'IN',
  defaultCurrency: 'INR',
  timezone: 'Asia/Kolkata',
  status: 'ACTIVE',
  counts: { legalEntities: 1, branches: 2, departments: 3 },
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('organization navigation', () => {
  it('shows only the organization screens the user may read', async () => {
    signInAs(['organization.structure.read', 'organization.calendar.read']);
    stubFetch(() => ok([], page(0)));
    renderAt('/organization/structure');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Structure' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Working days & holidays' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Job catalog' })).not.toBeInTheDocument();
  });

  it('blocks the job catalog without its read permission', async () => {
    signInAs(['organization.structure.read']);
    stubFetch(() => ok([], page(0)));
    renderAt('/organization/job-catalog');
    expect(await screen.findByText('You don’t have access to this page')).toBeInTheDocument();
  });
});

describe('structure page', () => {
  it('lists companies read-only without the manage permission', async () => {
    signInAs(['organization.structure.read']);
    const calls = stubFetch((c) =>
      c.url.includes('/companies') ? ok([company], page(1)) : ok([], page(0)),
    );
    renderAt('/organization/structure');
    expect(await screen.findByText('Acme India')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New company/ })).not.toBeInTheDocument();
    const list = calls.find((c) => c.url.includes('/companies'));
    expect(list?.url).toContain('sortBy=name');
    expect(list?.url).toContain('sortDir=asc');
  });

  it('creates a company and shows a server conflict on the code field', async () => {
    signInAs(['organization.structure.read', 'organization.structure.manage']);
    const user = userEvent.setup();
    let attempts = 0;
    const calls = stubFetch((c) => {
      if (c.method === 'POST' && c.url.endsWith('/companies')) {
        attempts += 1;
        return attempts === 1
          ? fail(409, 'CONFLICT', 'A company with this code already exists', [
              { path: 'code', message: 'A company with this code already exists' },
            ])
          : ok({ ...company, id: 'new' });
      }
      return ok([], page(0));
    });
    renderAt('/organization/structure?tab=companies');
    await user.click(await screen.findByRole('button', { name: /New company/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), 'acme-in');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Acme India');
    await user.click(within(dialog).getByRole('button', { name: 'Create company' }));

    expect(
      await within(dialog).findByText('A company with this code already exists'),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({
      code: 'acme-in',
      name: 'Acme India',
      countryCode: 'IN',
      defaultCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    });

    await user.clear(within(dialog).getByLabelText(/^Code/));
    await user.type(within(dialog).getByLabelText(/^Code/), 'ACME-2');
    await user.click(within(dialog).getByRole('button', { name: 'Create company' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('validates Indian identifiers with the shared schema before calling the API', async () => {
    signInAs(['organization.structure.read', 'organization.structure.manage']);
    const user = userEvent.setup();
    const calls = stubFetch((c) =>
      c.url.includes('/companies') ? ok([company], page(1)) : ok([], page(0)),
    );
    renderAt('/organization/structure?tab=legal-entities');
    await user.click(await screen.findByRole('button', { name: /New legal entity/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(
        within(dialog).getByRole('option', { name: 'Acme India (ACME-IN)' }),
      ).toBeInTheDocument();
    });
    await user.selectOptions(within(dialog).getByLabelText(/^Company/), company.id);
    await user.type(within(dialog).getByLabelText(/^Code/), 'LE-1');
    await user.type(within(dialog).getByLabelText(/^Registered legal name/), 'Acme India Pvt Ltd');
    await user.type(within(dialog).getByLabelText(/^PAN/), 'AAACR1234K');
    await user.type(within(dialog).getByLabelText(/^GSTIN/), '29BBBCR1234K1Z5');
    await user.click(within(dialog).getByRole('button', { name: 'Create legal entity' }));
    expect(
      await within(dialog).findByText('GSTIN must contain the PAN (characters 3–12)'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    // Identifiers are Indian-only: changing the country hides them.
    await user.clear(within(dialog).getByLabelText(/^Country/));
    await user.type(within(dialog).getByLabelText(/^Country/), 'US');
    expect(within(dialog).queryByLabelText(/^PAN/)).not.toBeInTheDocument();
  });
});

describe('form payloads', () => {
  it('sends blank optional fields as null and hidden fields as null', () => {
    const fields = [
      { name: 'code', label: 'Code', required: true },
      { name: 'parentId', label: 'Parent', kind: 'ref' as const },
      { name: 'pan', label: 'PAN', show: () => false },
      { name: 'companyId', label: 'Company', createOnly: true, required: true },
    ];
    const values = { code: ' ENG ', parentId: '', pan: 'X', companyId: 'c1', status: 'INACTIVE' };
    expect(toPayload(fields, values, false)).toEqual({
      code: 'ENG',
      parentId: null,
      pan: null,
      companyId: 'c1',
    });
    expect(toPayload(fields, values, true)).toEqual({
      code: 'ENG',
      parentId: null,
      pan: null,
      status: 'INACTIVE',
    });
  });
});

describe('calendars', () => {
  it('summarises work-week patterns including occurrence exceptions', () => {
    expect(
      summarizeWorkWeek([
        ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, occurrence: 0, dayType: 'FULL' as const })),
        { weekday: 6, occurrence: 0, dayType: 'HALF' },
        { weekday: 6, occurrence: 2, dayType: 'OFF' },
        { weekday: 6, occurrence: 4, dayType: 'OFF' },
      ]),
    ).toBe('Mon–Fri full · Sat half · 2nd, 4th Sat off');
    expect(summarizeWorkWeek([])).toBe('No working days');
  });

  it('lists work weeks and renders the resolved month preview', async () => {
    signInAs(['organization.calendar.read', 'organization.structure.read']);
    const user = userEvent.setup();
    const week: WorkWeekItem = {
      id: 'w1',
      name: 'Standard',
      description: null,
      isDefault: true,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, occurrence: 0, dayType: 'FULL' })),
      branchCount: 2,
      createdAt: '',
      updatedAt: '',
    };
    const resolved: ResolvedCalendar = {
      branch: null,
      workWeek: { id: 'w1', name: 'Standard' },
      holidayCalendar: { id: 'h1', name: 'India 2026' },
      from: '2026-11-09',
      to: '2026-11-10',
      workingDays: 1,
      days: [
        { date: '2026-11-09', weekday: 1, kind: 'WORKING' },
        { date: '2026-11-10', weekday: 2, kind: 'HOLIDAY', holidayName: 'Company Day' },
      ],
    };
    const calls = stubFetch((c) => {
      if (c.url.includes('/work-weeks')) return ok([week]);
      if (c.url.includes('/calendar/resolve')) return ok(resolved);
      return ok([], page(0));
    });
    renderAt('/organization/calendars');
    expect(await screen.findByText('Mon–Fri full')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New work week/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Month preview' }));
    expect(await screen.findByText('1 working days')).toBeInTheDocument();
    expect(screen.getByRole('gridcell', { name: '2026-11-10: Company Day' })).toBeInTheDocument();
    const resolve = calls.find((c) => c.url.includes('/calendar/resolve'));
    expect(resolve?.url).toMatch(/from=\d{4}-\d{2}-01/);
  });
});

describe('org chart', () => {
  it('renders the nested department tree with teams', async () => {
    signInAs(['organization.structure.read']);
    const user = userEvent.setup();
    const chart: OrgChart = {
      companies: [
        {
          id: 'c1',
          code: 'ACME',
          name: 'Acme India',
          status: 'ACTIVE',
          branches: [{ id: 'b1', code: 'BLR', name: 'Bengaluru' }],
          departments: [
            {
              id: 'd1',
              code: 'ENG',
              name: 'Engineering',
              status: 'ACTIVE',
              teams: [],
              children: [
                {
                  id: 'd2',
                  code: 'PLAT',
                  name: 'Platform',
                  status: 'ACTIVE',
                  children: [
                    {
                      id: 'd3',
                      code: 'SRE-1',
                      name: 'SRE',
                      status: 'ACTIVE',
                      children: [],
                      teams: [{ id: 't1', code: 'ONCALL', name: 'On-call' }],
                    },
                  ],
                  teams: [],
                },
              ],
            },
          ],
        },
      ],
    };
    stubFetch(() => ok(chart));
    renderAt('/organization/org-chart');
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('3 departments · 1 branches')).toBeInTheDocument();
    expect(screen.getByText('SRE')).toBeInTheDocument();
    // Third level starts collapsed; expanding reveals its team.
    expect(screen.queryByText('On-call')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand SRE' }));
    expect(screen.getByText('On-call')).toBeInTheDocument();
  });
});
