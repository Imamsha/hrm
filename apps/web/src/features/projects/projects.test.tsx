import type { BoardData, ProjectDetails, ProjectItem, TimesheetItem } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const me = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Esha Rao' };
const progress = { todo: '1', inProgress: '0', done: '0', percentDone: '0' };
const columns = [
  { id: 'c-todo', name: 'To do', category: 'TODO' as const, position: 0, wipLimit: null },
  { id: 'c-doing', name: 'Doing', category: 'IN_PROGRESS' as const, position: 1, wipLimit: null },
  { id: 'c-done', name: 'Done', category: 'DONE' as const, position: 2, wipLimit: null },
];
const PID = '0195f1d2-0000-7000-8000-00000000a001';
const projectItem: ProjectItem = {
  id: PID,
  key: 'WEB',
  name: 'Website',
  description: null,
  client: { id: 'cl-1', code: 'ACME', name: 'Acme' },
  billingType: 'TIME_AND_MATERIALS',
  status: 'ACTIVE',
  startDate: null,
  endDate: null,
  portalEnabled: true,
  progress,
  myRole: 'MEMBER',
  canManage: false,
};
const project: ProjectDetails = {
  ...projectItem,
  members: [
    { id: 'm-1', employee: me, role: 'MEMBER', billingRate: null, allocationPercent: null },
  ],
  columns,
  sprints: [],
  finance: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('projects navigation', () => {
  it('shows delivery self-service to employees and hides billing and the portal', async () => {
    signInAs(['employees.self.access']);
    stubFetch(() => ok([]));
    renderAt('/projects');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of ['My work', 'My timesheet', 'Projects', 'Timesheets'])
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    for (const name of ['Clients', 'Billing', 'Portal'])
      expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
    expect(await screen.findByText('No projects')).toBeInTheDocument();
  });

  it('sends client contacts to their portal and shows nothing else', async () => {
    signInAs(['projects.portal.access']);
    stubFetch(() =>
      ok({
        client: { id: 'cl-1', code: 'ACME', name: 'Acme' },
        projects: [
          {
            id: 'p-1',
            key: 'WEB',
            name: 'Website',
            status: 'ACTIVE',
            startDate: null,
            endDate: null,
            progress,
            openBugs: 2,
          },
        ],
        invoices: [],
      }),
    );
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: 'Acme — client portal' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Portal projects' })).toHaveTextContent('2 open bugs');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Portal' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'My work' })).not.toBeInTheDocument();
  });
});

describe('board', () => {
  it('moves a card to another column', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const board: BoardData = {
      sprint: null,
      columns: columns.map((c) => ({
        ...c,
        items:
          c.id === 'c-todo'
            ? [
                {
                  id: 'w-1',
                  key: 'WEB-1',
                  type: 'TASK',
                  title: 'Card form',
                  priority: 'MEDIUM',
                  column: { id: 'c-todo', name: 'To do', category: 'TODO' },
                  assignee: me,
                  parent: null,
                  sprintId: null,
                  storyPoints: '3',
                  estimateHours: null,
                  dueDate: null,
                  labels: [],
                  severity: null,
                  clientVisible: false,
                  fromClient: false,
                  rank: 1,
                  children: 0,
                  updatedAt: '2026-11-24T00:00:00.000Z',
                },
              ]
            : [],
      })),
    };
    const calls = stubFetch((c) =>
      c.url.includes('/board') ? ok(board) : c.method === 'PATCH' ? ok({}) : ok(project),
    );
    renderAt(`/projects/${PID}`);
    const todo = await screen.findByRole('region', { name: 'Column To do' });
    await user.selectOptions(within(todo).getByLabelText('Move WEB-1'), 'c-doing');
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
        url: expect.stringContaining(`/projects/${PID}/items/w-1`) as string,
        body: { columnId: 'c-doing' },
      });
    });
  });
});

describe('timesheet', () => {
  it('saves the week with the entered time', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const sheet: TimesheetItem = {
      id: null,
      employee: me,
      weekStart: '2026-11-23',
      status: 'DRAFT',
      totalHours: '0',
      billableHours: '0',
      submittedAt: null,
      approver: null,
      decisionNote: null,
      entries: [],
      can: { edit: true, submit: false, decide: false },
    };
    const calls = stubFetch((c) =>
      c.url.includes('/me/timesheet')
        ? ok(sheet)
        : c.url.includes('/projects')
          ? ok([projectItem])
          : ok([]),
    );
    renderAt('/me/timesheet');
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/projects'))).toBe(true);
    });
    await user.click(await screen.findByRole('button', { name: /Add time/ }));
    const entry = screen.getByRole('group', { name: 'Entry 1' });
    await user.selectOptions(within(entry).getByLabelText('Day'), sheet.weekStart);
    await within(entry).findByRole('option', { name: 'Website (WEB)' });
    await user.selectOptions(within(entry).getByLabelText('Project'), PID);
    await user.type(within(entry).getByLabelText('Hours'), '7.5');
    await user.type(within(entry).getByLabelText('Note'), 'Checkout');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        weekStart: '2026-11-23',
        entries: [
          { date: '2026-11-23', projectId: PID, hours: '7.5', billable: true, note: 'Checkout' },
        ],
      });
    });
  });
});
