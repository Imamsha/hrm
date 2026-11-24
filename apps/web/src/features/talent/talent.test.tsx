import type { CourseDetails, GoalItem, ReviewDetails, SurveyItem } from '@hrm/shared-types';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, renderAt, signInAs, signOutForTest, stubFetch } from '@/test/utils';

const me = { id: 'e-1', employeeNumber: 'EMP-0001', displayName: 'Esha Rao' };
const boss = { id: 'e-2', employeeNumber: 'EMP-0002', displayName: 'Bina Shah' };
const page = (n: number) => ({ pagination: { page: 1, pageSize: 200, total: n, totalPages: 1 } });

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('talent navigation', () => {
  it('shows self-service to employees and hides HR setup', async () => {
    signInAs(['employees.self.access']);
    stubFetch(() => ok([], page(0)));
    renderAt('/me/goals');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const name of [
      'Goals & OKRs',
      'Reviews',
      'My learning',
      'Company',
      'Surveys',
      'Suggestions',
    ])
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    for (const name of ['Review cycles', 'Performance setup', 'Engagement admin'])
      expect(within(nav).queryByRole('link', { name })).not.toBeInTheDocument();
    expect(await screen.findByText('No goals yet')).toBeInTheDocument();
  });
});

describe('goals', () => {
  it('checks in a KPI with its current value', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const kpi: GoalItem = {
      id: 'g-1',
      ownerType: 'EMPLOYEE',
      employee: me,
      department: null,
      parent: null,
      cycleId: null,
      kind: 'KPI',
      title: 'Close support tickets',
      description: null,
      weight: '1',
      measure: { start: '0', target: '200', current: '50', unit: 'tickets' },
      progress: '25.00',
      status: 'ACTIVE',
      dueOn: null,
      children: 0,
      canEdit: true,
    };
    const calls = stubFetch((c) => (c.method === 'POST' ? ok([]) : ok([kpi], page(1))));
    renderAt('/me/goals');
    const goals = await screen.findByRole('list', { name: 'Goals' });
    expect(goals).toHaveTextContent('50 of 200 tickets');
    await user.click(within(goals).getByRole('button', { name: 'Check in' }));
    const current = await screen.findByLabelText(/^Current value/);
    await user.clear(current);
    await user.type(current, '120');
    await user.type(screen.getByLabelText(/^What changed/), 'Cleared the backlog');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        url: expect.stringContaining('/goals/g-1/check-ins') as string,
        body: { current: '120', note: 'Cleared the backlog' },
      });
    });
  });
});

describe('reviews', () => {
  it('hides peer feedback below the anonymity minimum', async () => {
    signInAs(['employees.self.access']);
    const review: ReviewDetails = {
      id: 'p-1',
      cycle: { id: 'c-1', name: 'FY26 annual', status: 'CLOSED' },
      employee: me,
      manager: boss,
      computedScore: '3.40',
      computedRating: '3',
      finalRating: '3',
      finalLabel: 'Meets expectations',
      calibrationReason: null,
      promotion: 'NONE',
      promotionJustification: null,
      acknowledgedAt: null,
      responses: [
        { role: 'MANAGER', submitted: 1, total: 1 },
        { role: 'PEER', submitted: 2, total: 2 },
      ],
      template: {
        id: 't-1',
        name: 'Annual',
        ratingScale: { id: 's-1', name: 'Five point' },
        goalsWeightPercent: '50',
        competencies: [],
        questions: [],
        includeSelf: false,
        includeManager: true,
        peerMin: 0,
        peerMax: 3,
        includeUpward: false,
        anonymityMinimum: 3,
        status: 'ACTIVE',
        scale: [
          { value: '1', label: 'Below' },
          { value: '3', label: 'Meets expectations' },
          { value: '5', label: 'Exceeds' },
        ],
      },
      goals: [],
      visible: [],
      anonymousFeedback: [
        { role: 'PEER', responses: 2, hidden: true, comments: [], competencyAverages: [] },
      ],
      can: { calibrate: false, acknowledge: true, nominatePeers: false },
    };
    const user = userEvent.setup();
    const calls = stubFetch((c) => (c.url.includes('/me/review-tasks') ? ok([]) : ok(review)));
    renderAt('/performance/reviews/p-1');
    expect(await screen.findByLabelText('Peer feedback summary')).toHaveTextContent(
      'fewer than 3 responses',
    );
    expect(screen.getByText('Final: Meets expectations')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Acknowledge results' }));
    await waitFor(() => {
      expect(
        calls.some(
          (c) => c.method === 'POST' && c.url.endsWith('/performance/reviews/p-1/acknowledge'),
        ),
      ).toBe(true);
    });
  });
});

describe('learning', () => {
  it('submits quiz answers by option index and shows the score', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const enrollment = {
      id: 'en-1',
      course: { id: 'co-1', code: 'POSH', title: 'Workplace conduct', moduleCount: 1 },
      employee: me,
      source: 'ASSIGNED' as const,
      dueOn: null,
      status: 'ENROLLED' as const,
      completedModules: [],
      progress: 0,
      scorePercent: null,
      completedAt: null,
      certificationExpiresOn: null,
      overdue: false,
    };
    const course: CourseDetails = {
      id: 'co-1',
      code: 'POSH',
      title: 'Workplace conduct',
      description: null,
      format: 'ONLINE',
      durationMinutes: 30,
      passPercent: 80,
      certificationValidityMonths: 12,
      skills: [],
      status: 'PUBLISHED',
      moduleCount: 1,
      enrolled: 1,
      completed: 0,
      myEnrollment: enrollment,
      modules: [
        {
          id: 'm-1',
          title: 'Check your understanding',
          type: 'QUIZ',
          content: null,
          url: null,
          questions: [
            {
              id: 'q1',
              text: 'Who can raise a complaint?',
              options: ['Only managers', 'Anyone'],
              points: 1,
            },
          ],
        },
      ],
    };
    const calls = stubFetch((c) =>
      c.method === 'POST'
        ? ok({
            scorePercent: '100.00',
            passed: true,
            perQuestion: [{ id: 'q1', correct: true }],
            enrollment,
          })
        : ok(course),
    );
    renderAt('/learning/courses/co-1');
    const question = await screen.findByRole('group', { name: /Who can raise a complaint/ });
    await user.click(within(question).getByRole('checkbox', { name: 'Anyone' }));
    await user.click(screen.getByRole('button', { name: 'Submit answers' }));
    expect(await screen.findByText(/Score 100.00% — passed/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      url: expect.stringContaining('/me/learning/en-1/quizzes/m-1') as string,
      body: { answers: { q1: [1] } },
    });
  });
});

describe('surveys', () => {
  it('tells the employee an anonymous survey is anonymous and posts the answers', async () => {
    signInAs(['employees.self.access']);
    const user = userEvent.setup();
    const survey: SurveyItem = {
      id: 'sv-1',
      title: 'Quarterly pulse',
      description: null,
      kind: 'PULSE',
      anonymous: true,
      minimumGroupSize: 5,
      opensAt: '2026-11-01T00:00:00.000Z',
      closesAt: '2026-12-01T00:00:00.000Z',
      status: 'PUBLISHED',
      questions: [{ id: 'q1', type: 'ENPS', text: 'Would you recommend us?', required: true }],
      invited: 10,
      responded: 2,
      canRespond: true,
      hasResponded: false,
    };
    const calls = stubFetch((c) => (c.method === 'POST' ? ok({ ok: true }) : ok([survey])));
    renderAt('/engagement/surveys');
    await user.click(await screen.findByRole('button', { name: 'Respond' }));
    expect(await screen.findByText(/stored without your name/)).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Would you recommend us?' })).getByRole('button', {
        name: '9',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ answers: { q1: 9 } });
    });
  });
});
