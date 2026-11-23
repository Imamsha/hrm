import type {
  InterviewItem,
  OnboardingPlanItem,
  PublicCareers,
  PublicOpening,
} from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const ref = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Asha Rao' };

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('recruitment navigation', () => {
  it('shows hiring screens only to recruiters and self-service to everyone', async () => {
    signInAs(['employees.self.access']);
    stubFetch(() => ok([]));
    renderAt('/me/interviews');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'My interviews' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'My onboarding' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Candidates' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Requisitions' })).not.toBeInTheDocument();
    expect(await screen.findByText('No interviews')).toBeInTheDocument();
  });
});

describe('career site', () => {
  const opening: PublicOpening = {
    slug: 'backend-engineer',
    title: 'Backend Engineer',
    company: 'Acme India',
    location: 'Bengaluru',
    employmentType: 'FULL_TIME',
    description: 'Build APIs.',
    requirements: 'Node.js',
    experienceMinYears: 2,
    experienceMaxYears: 5,
    salary: null,
    publishedAt: '2026-11-18T00:00:00.000Z',
    closesOn: null,
  };
  const careers: PublicCareers = {
    organization: { name: 'Acme', slug: 'acme' },
    openings: [opening],
  };

  it('lists openings and submits an application with consent and a resume', async () => {
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.endsWith('/careers/acme/jobs')) return ok(careers);
      if (c.url.endsWith('/careers/acme/jobs/backend-engineer')) return ok(opening);
      if (c.method === 'POST' && c.url.endsWith('/careers/acme/jobs/backend-engineer/applications'))
        return ok({ received: true });
      return fail(401, 'UNAUTHENTICATED', 'Sign in');
    });
    renderAt('/careers/acme');
    const list = await screen.findByRole('list', { name: 'Open positions' });
    expect(within(list).getByText(/Bengaluru · Full-time · 2–5 years/)).toBeInTheDocument();
    await user.click(within(list).getByRole('link', { name: /Backend Engineer/ }));
    expect(await screen.findByRole('heading', { name: 'Backend Engineer' })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^First name/), 'Ravi');
    await user.type(screen.getByLabelText(/^E-mail/), 'ravi@example.com');
    await user.type(screen.getByLabelText(/^Phone/), '+919800000000');
    // Consent is required before anything is sent.
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await user.upload(
      screen.getByLabelText(/^Resume/),
      new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText(/your application has been received/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('panel feedback', () => {
  it('submits the panelist feedback', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const interview: InterviewItem = {
      id: 'iv-1',
      applicationId: 'ap-1',
      candidate: { id: 'c-1', displayName: 'Ravi Kumar' },
      opening: { id: 'o-1', title: 'Backend Engineer' },
      roundName: 'Technical',
      scheduledAt: '2026-11-20T05:30:00.000Z',
      durationMinutes: 60,
      mode: 'VIDEO',
      locationOrLink: null,
      status: 'SCHEDULED',
      panel: [
        { employee: ref, rating: null, recommendation: null, notes: null, submittedAt: null },
      ],
    };
    const calls = stubFetch((c) => (c.method === 'POST' ? ok({}) : ok([interview])));
    renderAt('/me/interviews');
    await user.click(await screen.findByRole('button', { name: 'Give feedback' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Rating/), '4');
    await user.selectOptions(within(dialog).getByLabelText(/^Recommendation/), 'YES');
    await user.type(within(dialog).getByLabelText(/^Notes/), 'Solid fundamentals');
    await user.click(within(dialog).getByRole('button', { name: 'Submit feedback' }));
    await waitFor(() => {
      expect(calls.find((c) => c.url.endsWith('/me/interviews/iv-1/feedback'))?.body).toMatchObject(
        {
          recommendation: 'YES',
          notes: 'Solid fundamentals',
        },
      );
    });
  });
});

describe('my onboarding', () => {
  it('shows progress and completes a task', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const plan: OnboardingPlanItem = {
      id: 'pl-1',
      employee: ref,
      template: { id: 't-1', name: 'Standard' },
      joiningDate: '2026-12-01',
      status: 'IN_PROGRESS',
      progress: { total: 2, closed: 1, percent: 50 },
      createdAt: '',
      tasks: [
        {
          id: 'tk-1',
          title: 'Read the handbook',
          description: null,
          assignee: 'EMPLOYEE',
          assigneeEmployee: ref,
          dueDate: '2026-12-01',
          documentCategory: null,
          status: 'PENDING',
          completedAt: null,
          completedBy: null,
          canComplete: true,
        },
        {
          id: 'tk-2',
          title: 'Create e-mail account',
          description: null,
          assignee: 'IT',
          assigneeEmployee: null,
          dueDate: '2026-11-28',
          documentCategory: null,
          status: 'DONE',
          completedAt: '2026-11-18T00:00:00.000Z',
          completedBy: 'IT Admin',
          canComplete: false,
        },
      ],
    };
    const calls = stubFetch((c) => {
      if (c.method === 'PUT') return ok({});
      if (c.url.endsWith('/me/onboarding')) return ok(plan);
      return ok([]);
    });
    renderAt('/me/onboarding');
    expect(await screen.findByText('1/2 done (50%)')).toBeInTheDocument();
    const tasks = screen.getByRole('list', { name: 'Onboarding tasks' });
    await user.click(within(tasks).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => {
      expect(calls.find((c) => c.url.endsWith('/onboarding/tasks/tk-1/status'))?.body).toEqual({
        status: 'DONE',
      });
    });
  });
});
