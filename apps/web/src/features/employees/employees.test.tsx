import type { EmployeeDetails, EmployeeListItem, EmploymentRecordItem } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toPayload } from '@/features/structure/entity-payload';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const page = (total: number) => ({
  pagination: { page: 1, pageSize: 25, total, totalPages: Math.max(1, Math.ceil(total / 25)) },
});
const ref = (id: string, name: string) => ({ id, code: name.toUpperCase(), name });

const listItem: EmployeeListItem = {
  id: 'e-1',
  employeeNumber: 'EMP-0001',
  displayName: 'Asha Rao',
  firstName: 'Asha',
  lastName: 'Rao',
  workEmail: 'asha@acme.test',
  workPhone: null,
  status: 'ACTIVE',
  dateOfJoining: '2025-01-06',
  job: {
    company: ref('c-1', 'Acme India'),
    branch: ref('b-1', 'Bengaluru'),
    department: ref('d-1', 'Engineering'),
    team: null,
    designation: ref('g-1', 'Software Engineer'),
    manager: { id: 'e-9', employeeNumber: 'EMP-0009', displayName: 'Meera Manager' },
    employmentType: 'FULL_TIME',
  },
  hasUserAccount: false,
};

const access = {
  update: true,
  lifecycle: true,
  personal: true,
  sensitive: false,
  sensitiveManage: false,
  documents: false,
  documentsManage: false,
  self: false,
};

const details = (over: Partial<EmployeeDetails> = {}): EmployeeDetails => ({
  ...listItem,
  middleName: null,
  preferredName: null,
  probationStatus: 'ON_PROBATION',
  probationEndDate: '2025-07-06',
  confirmationDate: null,
  noticePeriodDays: 60,
  resignationDate: null,
  lastWorkingDate: null,
  separationType: null,
  separationReason: null,
  member: null,
  personal: {
    dateOfBirth: '1994-02-10',
    gender: 'FEMALE',
    maritalStatus: null,
    nationality: 'IN',
    personalEmail: null,
    personalPhone: null,
  },
  access,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const record: EmploymentRecordItem = {
  id: 'r-1',
  effectiveFrom: '2025-01-06',
  effectiveTo: null,
  changeType: 'JOINING',
  employmentType: 'FULL_TIME',
  company: ref('c-1', 'Acme India'),
  legalEntity: null,
  branch: ref('b-1', 'Bengaluru'),
  department: ref('d-1', 'Engineering'),
  team: null,
  designation: ref('g-1', 'Software Engineer'),
  jobGrade: null,
  costCenter: null,
  manager: null,
  remarks: null,
  createdAt: '',
};

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('people navigation', () => {
  it('shows My profile to employees and Employees only to HR readers', async () => {
    signInAs(['employees.self.access']);
    stubFetch((c) =>
      c.url.endsWith('/me/employee')
        ? ok(details({ access: { ...access, update: false, lifecycle: false, self: true } }))
        : ok([]),
    );
    renderAt('/me/profile');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My profile' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Asha Rao/ })).toBeInTheDocument();
    // Self-service has no HR actions.
    expect(screen.queryByRole('button', { name: /Actions/ })).not.toBeInTheDocument();
  });
});

describe('employee directory', () => {
  it('lists employees with server filters and validates the joining form before sending', async () => {
    signInAs([
      'employees.employee.read',
      'employees.employee.create',
      'organization.structure.read',
    ]);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.includes('/employees/settings'))
        return ok({ numberPrefix: 'EMP-', numberPadding: 4, nextNumber: 2, preview: 'EMP-0002' });
      if (c.url.includes('/employees')) return ok([listItem], page(1));
      return ok([], page(0));
    });
    renderAt('/people/employees');
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Meera Manager')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/employees?'))?.url).toContain('sortBy=name');

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'ON_NOTICE');
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('status=ON_NOTICE'))).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: /Add employee/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Next number: EMP-0002')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Add employee' }));
    expect(await within(dialog).findAllByRole('alert')).not.toHaveLength(0);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('employee profile', () => {
  it('shows tabs and actions according to the caller’s access', async () => {
    signInAs([
      'employees.employee.read',
      'employees.lifecycle.manage',
      'employees.employee.update',
    ]);
    const user = userEvent.setup();
    stubFetch((c) => {
      if (c.url.endsWith('/employees/e-1')) return ok(details());
      if (c.url.endsWith('/employment-history')) return ok([record]);
      return ok([]);
    });
    renderAt('/people/employees/e-1');
    expect(await screen.findByRole('heading', { name: /Asha Rao/ })).toBeInTheDocument();
    expect(screen.getByText('On probation until Jul 6, 2025')).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Profile sections' });
    expect(within(tabs).getByRole('tab', { name: 'Personal' })).toBeInTheDocument();
    // No sensitive or document access → those tabs are not offered.
    expect(within(tabs).queryByRole('tab', { name: 'Bank & tax' })).not.toBeInTheDocument();
    expect(within(tabs).queryByRole('tab', { name: 'Documents' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Actions/ }));
    expect(await screen.findByRole('menuitem', { name: 'Confirm employment' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Record separation' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Record rejoining' })).not.toBeInTheDocument();

    // A job change starts from the current placement.
    await user.click(screen.getByRole('menuitem', { name: 'Record job change' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Record a job change')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Employment type/)).toHaveValue('FULL_TIME');
  });

  it('renders job history entries', async () => {
    signInAs(['employees.employee.read']);
    const user = userEvent.setup();
    stubFetch((c) => {
      if (c.url.endsWith('/employees/e-1'))
        return ok(details({ access: { ...access, update: false, lifecycle: false } }));
      if (c.url.endsWith('/employment-history'))
        return ok([
          {
            ...record,
            id: 'r-2',
            changeType: 'TRANSFER',
            effectiveFrom: '2025-06-01',
            remarks: 'Moved',
          },
          { ...record, effectiveTo: '2025-05-31' },
        ]);
      return ok([]);
    });
    renderAt('/people/employees/e-1?tab=job');
    const list = await screen.findByRole('list', { name: 'Employment history' });
    expect(within(list).getByText('Transfer')).toBeInTheDocument();
    expect(within(list).getByText('Moved')).toBeInTheDocument();
    expect(within(list).getByText(/Jan 6, 2025 – May 31, 2025/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(await screen.findByText('Software Engineer')).toBeInTheDocument();
  });
});

describe('form payloads for employee forms', () => {
  it('sends checkboxes as booleans and omits "keep current" fields', () => {
    const body = toPayload(
      [
        { name: 'isPrimary', label: 'Primary', kind: 'checkbox' },
        { name: 'accountNumber', label: 'Account', omitIfBlank: true },
        { name: 'numberPrefix', label: 'Prefix', blank: '' },
      ],
      { isPrimary: 'true', accountNumber: '', numberPrefix: '' },
      true,
    );
    expect(body).toEqual({ isPrimary: true, numberPrefix: '' });
  });
});
