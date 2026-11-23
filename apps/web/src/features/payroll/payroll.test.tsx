/** Rule values here are FICTIONAL test numbers, not statutory rates. */
import type { PayrollResultItem, PayrollRunItem, PayslipItem } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const ref = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Asha Rao' };

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

const run: PayrollRunItem = {
  id: 'r-1',
  company: { id: 'c-1', code: 'PAY', name: 'Pay Co' },
  year: 2026,
  month: 4,
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  status: 'CALCULATED',
  employeeCount: 1,
  problemCount: 0,
  totals: { gross: '50000.00', deductions: '4283.00', net: '45717.00', employerCost: '52000.00' },
  note: null,
  createdBy: 'Owner',
  calculatedBy: 'Owner',
  calculatedAt: '2026-05-01T00:00:00.000Z',
  approvedBy: null,
  approvedAt: null,
  finalizedBy: null,
  finalizedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  canApprove: true,
};
const result: PayrollResultItem = {
  id: 'res-1',
  employee: ref,
  payableDays: '30.00',
  periodDays: '30.00',
  lossOfPayDays: '0.00',
  gross: '50000.00',
  totalDeductions: '4283.00',
  netPay: '45717.00',
  employerCost: '52000.00',
  problems: [],
  lines: [
    {
      code: 'BASIC',
      name: 'Basic',
      category: 'EARNING',
      source: 'STRUCTURE',
      amount: '20000.00',
      forYear: null,
      forMonth: null,
    },
    {
      code: 'ARR_BASIC',
      name: 'Basic arrears',
      category: 'EARNING',
      source: 'ARREARS',
      amount: '4000.00',
      forYear: 2026,
      forMonth: 3,
    },
    {
      code: 'EPF_EE',
      name: 'Provident fund',
      category: 'DEDUCTION',
      source: 'STATUTORY',
      amount: '2000.00',
      forYear: null,
      forMonth: null,
    },
  ],
};

describe('payroll navigation', () => {
  it('gives employees their payslips but not payroll administration', async () => {
    signInAs(['employees.self.access']);
    stubFetch(() => ok([]));
    renderAt('/me/payslips');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My payslips' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'My salary & tax' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Payroll runs' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Statutory rules' })).not.toBeInTheDocument();
    expect(await screen.findByText('No payslips yet')).toBeInTheDocument();
  });
});

describe('statutory rules', () => {
  it('requires an official source and saves a draft with exactly the values entered', async () => {
    signInAs(['payroll.run.read', 'payroll.statutory.manage']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => (c.method === 'POST' ? ok({ id: 'rs-1' }) : ok([])));
    renderAt('/payroll/statutory');
    expect(await screen.findByText('No statutory rule sets')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /New rule set/ }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Rule type/), 'EPF');
    await user.type(within(dialog).getByLabelText(/^Name/), 'EPF test');
    await user.type(within(dialog).getByLabelText(/^Effective from/), '2026-04-01');
    await user.type(within(dialog).getByLabelText(/^Employee rate/), '10');
    await user.type(within(dialog).getByLabelText(/^Employer rate/), '10');
    await user.type(within(dialog).getByLabelText(/^Pension \(EPS\) share/), '6');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(
      await within(dialog).findByText(/sourceReference: Cite the official source/),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await user.type(within(dialog).getByLabelText(/^Source/), 'Test notification 1/2026');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      expect(
        calls.find((c) => c.method === 'POST' && c.url.endsWith('/payroll/rule-sets'))?.body,
      ).toMatchObject({
        type: 'EPF',
        sourceReference: 'Test notification 1/2026',
        config: {
          employeeRatePercent: '10',
          employerRatePercent: '10',
          epsRatePercent: '6',
          wageCeiling: null,
          rounding: { scale: 0, mode: 'HALF_UP' },
        },
      });
    });
  });
});

describe('payroll run', () => {
  it('shows results with arrears and lets a second person approve', async () => {
    signInAs(['payroll.run.read', 'payroll.run.approve']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.method === 'POST') return ok({ ...run, status: 'APPROVED' });
      if (c.url.includes('/results')) return ok([result]);
      if (c.url.includes('/adjustments')) return ok([]);
      return ok(run);
    });
    renderAt('/payroll/runs/r-1');
    expect(await screen.findByRole('heading', { name: 'April 2026 · Pay Co' })).toBeInTheDocument();
    const totals = screen.getByLabelText('Run totals');
    expect(within(totals).getByText('₹45,717.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Asha Rao/ }));
    expect(await screen.findByText(/\(March 2026\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(calls.find((c) => c.url.endsWith('/payroll/runs/r-1/decision'))?.body).toEqual({
        decision: 'APPROVED',
      });
    });
  });

  it('explains problems that block approval', async () => {
    signInAs(['payroll.run.read', 'payroll.run.manage']);
    stubFetch((c) => {
      if (c.url.includes('/results'))
        return ok([
          {
            ...result,
            problems: [
              {
                code: 'PT_RULE_MISSING',
                message:
                  'No active Professional Tax rule set for the employee’s state covers this month',
              },
            ],
          },
        ]);
      if (c.url.includes('/adjustments')) return ok([]);
      return ok({ ...run, problemCount: 1, canApprove: false });
    });
    renderAt('/payroll/runs/r-1');
    expect(await screen.findByText(/1 employee\(s\) have problems/)).toBeInTheDocument();
    expect(await screen.findByText(/No active Professional Tax rule set/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recalculate' })).toBeInTheDocument();
  });
});

describe('payslip', () => {
  it('shows earnings, deductions, net pay and the tax projection', async () => {
    signInAs(['employees.self.access']);
    const slip: PayslipItem = {
      ...result,
      runId: 'r-1',
      year: 2026,
      month: 4,
      company: { name: 'Pay Co', legalName: 'Pay Co Private Limited' },
      finalizedAt: '2026-05-02T00:00:00.000Z',
      taxRegime: 'NEW',
      annualTaxProjection: '25000.00',
      taxTrace: [{ label: 'Taxable income', amount: '550000.00' }],
      bankAccount: { bankName: 'Test Bank', last4: '4321' },
    };
    stubFetch(() => ok(slip));
    renderAt('/me/payslips/res-1');
    expect(
      await screen.findByRole('heading', { name: 'Payslip · April 2026' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pay Co Private Limited')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Deductions' })).getByText('₹2,000.00'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Net pay ₹45,717.00/)).toBeInTheDocument();
    expect(screen.getByText(/Test Bank ••••4321/)).toBeInTheDocument();
    expect(screen.getByText(/new regime\): ₹25,000.00 for the year/)).toBeInTheDocument();
  });
});
