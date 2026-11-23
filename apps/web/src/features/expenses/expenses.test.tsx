import type { ExpenseClaimDetails, MyAssetsItem, TravelRequestDetails } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const ref = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Esha Rao' };
const boss = { id: 'e-2', employeeNumber: 'EMP-0002', displayName: 'Bina Shah' };
const page = (n: number) => ({ pagination: { page: 1, pageSize: 25, total: n, totalPages: 1 } });
const can = {
  edit: false,
  submit: false,
  cancel: false,
  reopen: false,
  managerDecide: false,
  financeDecide: false,
  markPaid: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

const claim: ExpenseClaimDetails = {
  id: 'c-1',
  employee: ref,
  title: 'Customer visit',
  trip: null,
  status: 'DRAFT',
  totalClaimed: '1800.00',
  totalApproved: null,
  payoutMethod: null,
  approver: null,
  submittedAt: null,
  decisionNote: null,
  paidOn: null,
  paidReference: null,
  reimbursedAt: null,
  payrollRunId: null,
  createdAt: '2026-11-20T00:00:00.000Z',
  itemCount: 1,
  can: { ...can, edit: true, submit: true, cancel: true },
  items: [
    {
      id: 'i-1',
      category: { id: '0195f1d2-0000-7000-8000-0000000ca701', code: 'MEALS', name: 'Meals' },
      date: '2026-11-18',
      days: 1,
      description: 'Team dinner',
      merchant: null,
      currency: 'INR',
      originalAmount: '1800.00',
      exchangeRate: '1',
      amount: '1800.00',
      approvedAmount: null,
      financeNote: null,
      justification: null,
      issues: [],
      receipt: null,
    },
  ],
  events: [
    {
      fromStatus: null,
      toStatus: 'DRAFT',
      note: null,
      actor: 'Esha Rao',
      at: '2026-11-20T00:00:00.000Z',
    },
  ],
  issues: [
    {
      item: 0,
      code: 'RECEIPT_REQUIRED',
      severity: 'BLOCK',
      message: 'A receipt is required for Meals above 500.00',
    },
  ],
};

describe('expenses navigation', () => {
  it('shows self-service to everyone and the register only with permission', async () => {
    signInAs(['employees.self.access']);
    stubFetch(() => ok([], page(0)));
    renderAt('/me/expenses');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of ['My expenses', 'My travel', 'My assets', 'Expense approvals'])
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Assets' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Expense setup' })).not.toBeInTheDocument();
    expect(await screen.findByText('No expense claims')).toBeInTheDocument();
  });
});

describe('expense claim', () => {
  it('creates a draft with the entered items', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.method === 'POST' && c.url.endsWith('/me/expense-claims'))
        return ok({ ...claim, id: 'c-9' });
      if (c.url.includes('/expenses/settings'))
        return ok({ claimWindowDays: null, defaultPayoutMethod: 'PAYROLL', currency: 'INR' });
      if (c.url.includes('/expenses/categories'))
        return ok([
          {
            id: '0195f1d2-0000-7000-8000-0000000ca701',
            code: 'MEALS',
            name: 'Meals',
            description: null,
            maxPerItem: null,
            maxPerMonth: null,
            receiptRequiredAbove: '500.00',
            dailyLimit: null,
            taxable: false,
            status: 'ACTIVE',
          },
        ]);
      if (c.url.includes('/me/trips')) return ok([], page(0));
      return ok(claim);
    });
    renderAt('/expenses/claims/new');
    await user.type(await screen.findByLabelText(/^Title/), 'Customer visit');
    const item = screen.getByRole('group', { name: 'Item 1' });
    await waitFor(() => {
      expect(within(item).getByRole('option', { name: 'Meals' })).toBeInTheDocument();
    });
    await user.selectOptions(
      within(item).getByLabelText(/^Category/),
      '0195f1d2-0000-7000-8000-0000000ca701',
    );
    await user.type(within(item).getByLabelText(/^Amount/), '1800');
    await user.type(within(item).getByLabelText(/^Description/), 'Team dinner');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.method === 'POST' && c.url.endsWith('/me/expense-claims'))?.body,
      ).toMatchObject({
        title: 'Customer visit',
        tripId: null,
        items: [
          {
            categoryId: '0195f1d2-0000-7000-8000-0000000ca701',
            originalAmount: '1800',
            description: 'Team dinner',
            currency: 'INR',
            exchangeRate: '1',
            days: 1,
          },
        ],
      });
    });
  });

  it('shows blocking policy issues on a draft and lets the manager approve a submitted claim', async () => {
    signInAs(['employees.self.access']);
    stubFetch((c) =>
      c.url.includes('/expenses/') && !c.url.includes('/expense-claims')
        ? ok({ currency: 'INR', claimWindowDays: null, defaultPayoutMethod: 'PAYROLL' })
        : ok(claim),
    );
    renderAt('/expenses/claims/c-1');
    expect(await screen.findByRole('list', { name: 'Policy issues' })).toHaveTextContent(
      'A receipt is required for Meals above 500.00',
    );
    signOutForTest();
    vi.unstubAllGlobals();

    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const submitted = {
      ...claim,
      status: 'SUBMITTED' as const,
      approver: boss,
      issues: [],
      can: { ...can, managerDecide: true },
    };
    const calls = stubFetch((c) =>
      c.method === 'POST'
        ? ok(submitted)
        : c.url.includes('/expenses/settings')
          ? ok({ currency: 'INR', claimWindowDays: null, defaultPayoutMethod: 'PAYROLL' })
          : ok(submitted),
    );
    renderAt('/expenses/claims/c-1');
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.url.endsWith('/expense-claims/c-1/manager-decision'))?.body,
      ).toEqual({ decision: 'APPROVED', note: null });
    });
  });
});

describe('trip settlement', () => {
  it('previews the balance against advances', async () => {
    signInAs(['employees.self.access']);
    const trip: TravelRequestDetails = {
      id: 't-1',
      employee: ref,
      purpose: 'Site audit',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      legs: [{ from: 'Bengaluru', to: 'Chennai', departOn: '2026-11-10', mode: 'TRAIN' }],
      estimatedCost: null,
      advanceRequested: '5000.00',
      notes: null,
      status: 'APPROVED',
      approver: boss,
      decidedBy: 'Bina Shah',
      decidedAt: '2026-11-05T00:00:00.000Z',
      decisionNote: null,
      settlementBalance: null,
      recoveryMethod: null,
      recoveryReference: null,
      recoveredAt: null,
      settledAt: null,
      createdAt: '2026-11-04T00:00:00.000Z',
      can: { decide: false, cancel: false, desk: false },
      bookings: [],
      advances: [{ id: 'a-1', amount: '5000.00', paidOn: '2026-11-09', reference: 'ADV-1' }],
      claims: [
        {
          id: 'c-2',
          title: 'Audit trip',
          status: 'FINANCE_APPROVED',
          totalClaimed: '3000.00',
          totalApproved: '3000.00',
        },
      ],
      settlement: {
        advances: '5000.00',
        claimed: '3000.00',
        balance: '-2000.00',
        direction: 'RECOVERABLE',
        pendingClaims: 0,
      },
    };
    stubFetch(() => ok(trip));
    renderAt('/travel/trips/t-1');
    const settlement = await screen.findByLabelText('Settlement');
    expect(
      within(settlement).getByText('To recover from traveller: ₹2,000.00'),
    ).toBeInTheDocument();
    expect(within(settlement).getByText(/ADV-1/)).toBeInTheDocument();
  });
});

describe('my assets', () => {
  it('lets the employee confirm receipt of equipment', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const mine: MyAssetsItem = {
      assets: [
        {
          id: 'as-1',
          tag: 'LAP-001',
          name: 'Laptop 14"',
          category: { id: 'ac-1', code: 'LAPTOP', name: 'Laptops' },
          serialNumber: 'SN1',
          manufacturer: null,
          model: null,
          vendor: null,
          purchaseDate: null,
          purchaseCost: null,
          warrantyEnd: null,
          location: null,
          status: 'ALLOCATED',
          notes: null,
          holder: ref,
          bookValue: null,
          allocationId: 'al-1',
          allocatedOn: '2026-11-15',
          acknowledgedAt: null,
          expectedReturnOn: null,
        },
      ],
      licenses: [
        { id: 'l-1', name: 'Design suite', vendor: null, assignedOn: '2026-11-15T00:00:00.000Z' },
      ],
    };
    const calls = stubFetch((c) =>
      c.method === 'POST'
        ? ok({ ...mine, assets: [{ ...mine.assets[0], acknowledgedAt: 'x' }] })
        : ok(mine),
    );
    renderAt('/me/assets');
    const equipment = await screen.findByRole('list', { name: 'My equipment' });
    expect(within(equipment).getByText('LAP-001')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'My software' })).toHaveTextContent('Design suite');
    await user.click(within(equipment).getByRole('button', { name: 'Confirm receipt' }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.endsWith('/me/assets/al-1/acknowledge'))).toBe(true);
    });
  });
});
