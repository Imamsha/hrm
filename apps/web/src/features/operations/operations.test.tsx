import type { ComplianceTaskItem, SeparationCaseDetails } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const emp = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Esha Rao' };
const CAT = '0195f1d2-0000-7000-8000-00000000c001';

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('operations navigation', () => {
  it('shows helpdesk and compliance self-service, hides setup', async () => {
    signInAs(['employees.self.access']);
    stubFetch(() => ok([]));
    renderAt('/helpdesk');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of ['Helpdesk', 'Knowledge base', 'Resignation', 'Separations', 'Compliance'])
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Helpdesk setup' })).not.toBeInTheDocument();
    expect(await screen.findByText('You have not raised any tickets')).toBeInTheDocument();
  });
});

describe('helpdesk', () => {
  it('suggests articles while raising a ticket and posts it', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.includes('/helpdesk/categories'))
        return ok([
          {
            id: CAT,
            code: 'IT',
            name: 'IT',
            description: null,
            status: 'ACTIVE',
            confidential: false,
            agents: [],
            defaultAssignee: null,
            escalationContact: null,
            sla: [],
          },
        ]);
      if (c.url.includes('/helpdesk/articles') && c.url.includes('search'))
        return ok([
          {
            id: 'a-1',
            category: null,
            title: 'Reset your VPN password',
            body: '…',
            status: 'PUBLISHED',
            helpful: 0,
            notHelpful: 0,
            updatedAt: '2026-11-26T00:00:00.000Z',
          },
        ]);
      if (c.method === 'POST') return ok({ id: 't-1' });
      return ok([]);
    });
    renderAt('/helpdesk');
    await user.click(await screen.findByRole('button', { name: /New ticket/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('option', { name: 'IT' })).toBeInTheDocument();
    });
    await user.selectOptions(within(dialog).getByLabelText(/^Category/), CAT);
    await user.type(within(dialog).getByLabelText(/^Subject/), 'VPN password');
    expect(
      await within(dialog).findByRole('link', { name: 'Reset your VPN password' }),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Description/), 'Locked out');
    await user.click(within(dialog).getByRole('button', { name: 'Raise ticket' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        categoryId: CAT,
        subject: 'VPN password',
        description: 'Locked out',
        priority: 'MEDIUM',
      });
    });
  });
});

describe('separation', () => {
  it('submits a resignation', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const calls = stubFetch((c) => (c.method === 'POST' ? ok({}) : ok([])));
    renderAt('/me/resignation');
    await user.type(await screen.findByLabelText(/^Requested last working day/), '2026-12-31');
    await user.click(screen.getByRole('button', { name: 'Submit resignation' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        reasonCategory: 'CAREER',
        note: null,
        requestedLastDay: '2026-12-31',
      });
    });
  });

  it('tells the leaver their exit interview is for HR only', async () => {
    signInAs(['employees.self.access']);
    const c: SeparationCaseDetails = {
      id: 'c-1',
      employee: emp,
      separationType: 'RESIGNATION',
      reasonCategory: 'CAREER',
      lastWorkingDay: '2026-12-31',
      status: 'IN_PROGRESS',
      clearance: { total: 1, pending: 1 },
      interviewDone: false,
      createdAt: '2026-11-26T00:00:00.000Z',
      note: null,
      items: [
        {
          id: 'i-1',
          title: 'Knowledge transfer and handover',
          kind: 'KNOWLEDGE_TRANSFER',
          owner: 'Bina Shah',
          status: 'PENDING',
          note: null,
          decidedBy: null,
          decidedAt: null,
          canDecide: false,
        },
      ],
      settlement: null,
      letters: [],
      can: { complete: false, cancel: false, interview: true, readInterview: false },
    };
    stubFetch((x) =>
      x.url.includes('/interview')
        ? ok({
            questions: [{ id: 'q1', type: 'RATING', text: 'How was your manager?' }],
            answers: null,
          })
        : ok(c),
    );
    renderAt('/separation/cases/c-1');
    expect(await screen.findByRole('list', { name: 'Clearance items' })).toHaveTextContent(
      'Knowledge transfer and handover',
    );
    expect(await screen.findByText(/seen only by HR, never by your manager/)).toBeInTheDocument();
  });
});

describe('compliance', () => {
  it('completes an overdue task with a note and evidence', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const task: ComplianceTaskItem = {
      id: 'ct-1',
      obligation: { id: 'o-1', title: 'Monthly filing', category: 'STATUTORY_FILING' },
      owner: emp,
      dueOn: '2026-11-25',
      status: 'OPEN',
      state: 'OVERDUE',
      completedAt: null,
      completedBy: null,
      note: null,
      evidence: null,
      canComplete: true,
    };
    const calls = stubFetch((c) => (c.method === 'POST' ? ok([]) : ok([task])));
    renderAt('/compliance');
    const table = await screen.findByRole('table', { name: 'My compliance tasks' });
    expect(within(table).getByText('overdue')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Complete' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/What was done/), 'Filed');
    await user.upload(
      within(dialog).getByLabelText('Evidence'),
      new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/compliance/tasks/ct-1/complete')),
      ).toBe(true);
    });
  });
});
