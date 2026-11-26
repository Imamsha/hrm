import type { ApprovalTaskItem, LibraryDocumentItem } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const boss = { id: 'e-2', employeeNumber: 'EMP-0002', displayName: 'Bina Shah' };
const emp = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Esha Rao' };

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

const task: ApprovalTaskItem = {
  id: 't-1',
  instanceId: 'i-1',
  process: 'TRAVEL_REQUEST',
  subjectId: 'trip-1',
  summary: 'Client visit, from 2026-12-10, est. 80000.00',
  link: '/travel/trips/trip-1',
  requester: emp,
  stepName: 'Finance',
  stepNumber: 2,
  stepCount: 2,
  dueAt: '2026-11-27T10:00:00.000Z',
  overdue: true,
  onBehalfOf: boss,
  escalatedFrom: null,
  createdAt: '2026-11-26T10:00:00.000Z',
};

describe('workflows navigation', () => {
  it('shows the inbox and documents to employees, the designer only with permission', async () => {
    signInAs(['employees.self.access']);
    stubFetch((c) =>
      c.url.includes('/me/delegations') ? ok({ given: [], received: [] }) : ok([]),
    );
    renderAt('/me/approval-tasks');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of ['Approval inbox', 'Documents', 'Company documents'])
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    for (const name of ['Approval workflows', 'Document templates'])
      expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
    expect(await screen.findByText('Nothing waiting for you')).toBeInTheDocument();
  });
});

describe('approval inbox', () => {
  it('approves a step and asks for a reason to reject', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const calls = stubFetch((c) =>
      c.url.includes('/me/delegations')
        ? ok({ given: [], received: [] })
        : c.method === 'POST'
          ? ok([])
          : ok([task]),
    );
    renderAt('/me/approval-tasks');
    const list = await screen.findByRole('list', { name: 'Approval tasks' });
    expect(list).toHaveTextContent('step 2 of 2: Finance');
    expect(within(list).getByText('overdue')).toBeInTheDocument();
    expect(within(list).getByText('for Bina Shah')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), 'Over budget');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        url: expect.stringContaining('/approvals/t-1/decision') as string,
        body: { decision: 'REJECTED', note: 'Over budget' },
      });
    });
  });
});

describe('company documents', () => {
  it('acknowledges the current version', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const doc: LibraryDocumentItem = {
      id: 'l-1',
      title: 'Code of conduct',
      category: 'Policies',
      description: null,
      requiresAcknowledgement: true,
      status: 'PUBLISHED',
      version: 2,
      fileName: 'conduct.pdf',
      size: 1234,
      publishedAt: '2026-11-26T00:00:00.000Z',
      audience: { companyId: null, departmentId: null },
      acknowledgedAt: null,
      stats: null,
    };
    const calls = stubFetch((c) =>
      c.method === 'POST'
        ? ok([{ ...doc, acknowledgedAt: '2026-11-26T01:00:00.000Z' }])
        : ok([doc]),
    );
    renderAt('/library');
    const list = await screen.findByRole('list', { name: 'Company documents' });
    expect(list).toHaveTextContent('v2');
    await user.click(within(list).getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/library/l-1/acknowledge')),
      ).toBe(true);
    });
  });
});

describe('public acceptance', () => {
  it('lets a candidate accept with the e-mailed code, without signing in', async () => {
    const user = userEvent.setup();
    const view = {
      organizationName: 'Acme India',
      title: 'Offer for Kavya Iyer',
      candidateName: 'Kavya Iyer',
      status: 'PENDING',
      sha256: 'a'.repeat(64),
    };
    const calls = stubFetch((c) =>
      c.url.endsWith('/code')
        ? ok({ sent: true })
        : c.url.endsWith('/accept')
          ? ok({ ...view, status: 'ACCEPTED' })
          : ok(view),
    );
    renderAt('/accept-document?token=tok_123456789012345678901234');
    expect(
      await screen.findByText(/Acme India has sent this document to Kavya Iyer/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a qualified or Aadhaar e-signature/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'E-mail me a code to accept' }));
    await user.type(await screen.findByLabelText(/6-digit code/), '123456');
    await user.click(screen.getByRole('button', { name: 'I accept' }));
    expect(await screen.findByText('You accepted this document. Thank you.')).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/accept'))?.body).toEqual({ code: '123456' });
  });
});
