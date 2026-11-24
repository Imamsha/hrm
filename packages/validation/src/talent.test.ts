import { describe, expect, it } from 'vitest';
import {
  courseModuleSchema,
  goalSchema,
  learningAssignmentSchema,
  pipOutcomeSchema,
  ratingScaleSchema,
  reviewResponseSchema,
  reviewTemplateSchema,
  surveySchema,
} from './talent.js';

const id = (n: number) => `0195f1d2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ok = (r: { success: boolean }) => r.success;

describe('performance', () => {
  it('requires an ascending scale of at least two points', () => {
    expect(
      ok(
        ratingScaleSchema.safeParse({
          name: 'Five',
          points: [
            { value: 1, label: 'Low' },
            { value: 5, label: 'High' },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      ok(
        ratingScaleSchema.safeParse({
          name: 'Bad',
          points: [
            { value: 5, label: 'High' },
            { value: 1, label: 'Low' },
          ],
        }),
      ),
    ).toBe(false);
  });
  it('checks template reviewers, peer bounds and anonymity minimum', () => {
    const t = {
      name: 'Annual',
      ratingScaleId: id(1),
      goalsWeightPercent: '60',
      competencies: [],
      questions: [],
      includeSelf: true,
      includeManager: true,
      peerMin: 2,
      peerMax: 4,
      includeUpward: false,
      anonymityMinimum: 3,
    };
    expect(ok(reviewTemplateSchema.safeParse(t))).toBe(true);
    expect(ok(reviewTemplateSchema.safeParse({ ...t, peerMin: 5 }))).toBe(false);
    expect(
      ok(
        reviewTemplateSchema.safeParse({
          ...t,
          includeSelf: false,
          includeManager: false,
          peerMax: 0,
          peerMin: 0,
        }),
      ),
    ).toBe(false);
    expect(ok(reviewTemplateSchema.safeParse({ ...t, anonymityMinimum: 0 }))).toBe(false);
  });
  it('needs owners for goals and measures for KPIs and key results', () => {
    expect(ok(goalSchema.safeParse({ title: 'Ship', ownerType: 'EMPLOYEE', kind: 'GOAL' }))).toBe(
      false,
    );
    expect(
      ok(
        goalSchema.safeParse({
          title: 'Ship',
          ownerType: 'EMPLOYEE',
          employeeId: id(2),
          kind: 'GOAL',
        }),
      ),
    ).toBe(true);
    expect(ok(goalSchema.safeParse({ title: 'NPS', ownerType: 'ORGANIZATION', kind: 'KPI' }))).toBe(
      false,
    );
    expect(
      ok(
        goalSchema.safeParse({
          title: 'KR',
          ownerType: 'ORGANIZATION',
          kind: 'KEY_RESULT',
          measure: { start: 0, target: 10, current: 0 },
        }),
      ),
    ).toBe(false);
  });
  it('requires justifications and new end dates', () => {
    expect(ok(reviewResponseSchema.safeParse({ promotion: 'RECOMMEND' }))).toBe(false);
    expect(
      ok(
        reviewResponseSchema.safeParse({
          promotion: 'RECOMMEND',
          promotionJustification: 'Leads the team',
        }),
      ),
    ).toBe(true);
    expect(ok(pipOutcomeSchema.safeParse({ outcome: 'EXTENDED', note: 'More time' }))).toBe(false);
  });
});

describe('learning', () => {
  it('validates quizzes and assignments', () => {
    expect(
      ok(
        courseModuleSchema.safeParse({
          title: 'Quiz',
          type: 'QUIZ',
          questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correct: [2] }],
        }),
      ),
    ).toBe(false);
    expect(ok(courseModuleSchema.safeParse({ title: 'Read', type: 'CONTENT' }))).toBe(false);
    expect(
      ok(
        learningAssignmentSchema.safeParse({
          courseId: id(3),
          pathId: id(4),
          employeeIds: [id(5)],
        }),
      ),
    ).toBe(false);
    expect(ok(learningAssignmentSchema.safeParse({ courseId: id(3) }))).toBe(false);
    expect(
      ok(
        learningAssignmentSchema.safeParse({ courseId: id(3), audience: { departmentId: id(6) } }),
      ),
    ).toBe(true);
  });
});

describe('engagement', () => {
  const survey = {
    title: 'Pulse',
    kind: 'PULSE',
    anonymous: true,
    minimumGroupSize: 5,
    opensAt: '2026-11-24T00:00:00Z',
    closesAt: '2026-12-01T00:00:00Z',
    questions: [{ id: 'r', type: 'RATING', text: 'How are you?' }],
  };
  it('requires a minimum group size, a close after open and valid choices', () => {
    expect(ok(surveySchema.safeParse(survey))).toBe(true);
    expect(ok(surveySchema.safeParse({ ...survey, minimumGroupSize: 0 }))).toBe(false);
    expect(ok(surveySchema.safeParse({ ...survey, closesAt: '2026-11-01T00:00:00Z' }))).toBe(false);
    expect(
      ok(
        surveySchema.safeParse({
          ...survey,
          questions: [{ id: 'c', type: 'CHOICE', text: 'Pick', options: ['only'] }],
        }),
      ),
    ).toBe(false);
  });
});
