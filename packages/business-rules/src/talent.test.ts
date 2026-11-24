/** Scales and limits below are fictional test configuration, not recommendations. */
import { describe, expect, it } from 'vitest';
import {
  aggregateSurvey,
  certificationExpiry,
  courseProgress,
  gradeQuiz,
  pointsBalance,
  publicQuestions,
  type QuizQuestion,
  type SurveyQuestion,
  validateSurveyAnswers,
} from './learning-engagement.js';
import {
  canMoveCycle,
  canRevealAggregate,
  metricProgress,
  nearestPoint,
  ratingDistribution,
  reviewScore,
  rollUpProgress,
  validateScale,
} from './performance.js';

const scale = [
  { value: '1', label: 'Below' },
  { value: '2', label: 'Partly' },
  { value: '3', label: 'Meets' },
  { value: '4', label: 'Exceeds' },
  { value: '5', label: 'Outstanding' },
];

describe('goals', () => {
  it('measures progress towards higher and lower targets, clamped to 0–100', () => {
    expect(metricProgress({ start: 0, target: 200, current: 50 }).toString()).toBe('25');
    expect(metricProgress({ start: 40, target: 10, current: 25 }).toString()).toBe('50');
    expect(metricProgress({ start: 0, target: 100, current: 150 }).toString()).toBe('100');
    expect(metricProgress({ start: 0, target: 100, current: -5 }).toString()).toBe('0');
    expect(metricProgress({ start: 5, target: 5, current: 5 }).toString()).toBe('100');
  });
  it('rolls key results up by weight', () => {
    expect(rollUpProgress([{ progress: 100 }, { progress: 50 }]).toString()).toBe('75');
    expect(
      rollUpProgress([
        { progress: 100, weight: 3 },
        { progress: 0, weight: 1 },
      ]).toString(),
    ).toBe('75');
    expect(rollUpProgress([]).toString()).toBe('0');
  });
});

describe('ratings', () => {
  it('validates scales and maps scores to the nearest point', () => {
    expect(validateScale(scale)).toEqual([]);
    expect(validateScale([{ value: '1', label: 'x' }])).toHaveLength(1);
    expect(
      validateScale([
        { value: '2', label: 'a' },
        { value: '1', label: 'b' },
      ]),
    ).toEqual(['Scale values must be in ascending order']);
    expect(nearestPoint('3.4', scale)?.label).toBe('Meets');
    expect(nearestPoint('3.5', scale)?.label).toBe('Exceeds');
  });
  it('weights goal achievement and competencies onto the scale', () => {
    // goals: 75 % → 1 + 4 × 0.75 = 4; competencies (4×2 + 2×1)/3 = 3.33; 60/40 → 3.73
    const r = reviewScore({
      scale,
      goalsWeightPercent: 60,
      goals: [
        { achievementPercent: 100, weight: 1 },
        { achievementPercent: 50, weight: 1 },
      ],
      competencies: [
        { rating: 4, weight: 2 },
        { rating: 2, weight: 1 },
      ],
    });
    expect([
      r.goals?.toString(),
      r.competencies?.toString(),
      r.overall?.toString(),
      r.point?.label,
    ]).toEqual(['4', '3.33', '3.73', 'Exceeds']);
    const onlyCompetencies = reviewScore({
      scale,
      goalsWeightPercent: 60,
      goals: [],
      competencies: [{ rating: 3, weight: 1 }],
    });
    expect(onlyCompetencies.overall?.toString()).toBe('3');
  });
  it('summarises the distribution and gates anonymous aggregates', () => {
    expect(
      ratingDistribution(['3', '3', '4', '5'], scale).map((d) => [d.label, d.count, d.percent]),
    ).toEqual([
      ['Below', 0, '0.0'],
      ['Partly', 0, '0.0'],
      ['Meets', 2, '50.0'],
      ['Exceeds', 1, '25.0'],
      ['Outstanding', 1, '25.0'],
    ]);
    expect(canRevealAggregate(2, 3)).toBe(false);
    expect(canRevealAggregate(3, 3)).toBe(true);
    expect(canRevealAggregate(5, 0)).toBe(false);
  });
  it('allows only the defined cycle moves', () => {
    expect(canMoveCycle('DRAFT', 'OPEN')).toBe(true);
    expect(canMoveCycle('OPEN', 'CLOSED')).toBe(false);
    expect(canMoveCycle('CALIBRATION', 'OPEN')).toBe(true);
    expect(canMoveCycle('CLOSED', 'OPEN')).toBe(false);
  });
});

describe('learning', () => {
  const quiz: QuizQuestion[] = [
    { id: 'q1', text: 'One', options: ['a', 'b'], correct: [1], points: 2 },
    { id: 'q2', text: 'Many', options: ['a', 'b', 'c'], correct: [0, 2], points: 2 },
    { id: 'q3', text: 'Bonus', options: ['a', 'b'], correct: [0], points: 1 },
  ];
  it('grades exact answers only and applies the pass mark', () => {
    const r = gradeQuiz(quiz, { q1: [1], q2: [2, 0], q3: [1] }, 80);
    expect([r.earned, r.possible, r.percent.toString(), r.passed]).toEqual([4, 5, '80', true]);
    expect(gradeQuiz(quiz, { q1: [1], q2: [0] }, 80).passed).toBe(false);
  });
  it('never exposes correct answers and computes progress and expiry', () => {
    expect(publicQuestions(quiz).every((q) => !('correct' in q))).toBe(true);
    expect(courseProgress(2, 3)).toBe(67);
    expect(courseProgress(0, 0)).toBe(0);
    expect(certificationExpiry('2026-01-31', 1)).toBe('2026-02-28');
    expect(certificationExpiry('2026-11-15', 24)).toBe('2028-11-15');
  });
});

describe('surveys', () => {
  const qs: SurveyQuestion[] = [
    { id: 'r', type: 'RATING', text: 'Happy?', required: true },
    { id: 'n', type: 'ENPS', text: 'Recommend?', required: true },
    { id: 'c', type: 'CHOICE', text: 'Office?', options: ['Home', 'Office'], required: false },
    { id: 't', type: 'TEXT', text: 'Anything else?', required: false },
  ];
  it('validates answers by type', () => {
    expect(validateSurveyAnswers(qs, { r: 4, n: 10 })).toEqual({});
    expect(validateSurveyAnswers(qs, { r: 6, n: 11, c: 'Mars', x: 1 })).toEqual({
      r: 'Choose 1 to 5',
      n: 'Choose 0 to 10',
      c: 'Choose one of the options',
      x: 'Unknown question',
    });
    expect(validateSurveyAnswers(qs, {})).toEqual({ r: 'Required', n: 'Required' });
  });
  it('hides results below the minimum group size and computes eNPS', () => {
    const responses: Record<string, number | string>[] = [
      { r: 5, n: 10, c: 'Home', t: 'Great' },
      { r: 4, n: 9, c: 'Office' },
      { r: 2, n: 3, c: 'Home' },
      { r: 3, n: 7 },
    ];
    expect(aggregateSurvey(qs, responses, 5)).toEqual({
      responses: 4,
      hidden: true,
      questions: [],
    });
    const r = aggregateSurvey(qs, responses, 4);
    expect(r.hidden).toBe(false);
    const [rating, enps, choice, text] = r.questions;
    expect(rating?.average).toBe('3.50');
    // promoters 2, detractors 1 of 4 → 25.0
    expect(enps?.enps).toBe('25.0');
    expect(choice?.distribution).toEqual({ Home: 2, Office: 1 });
    expect(text?.texts).toEqual(['Great']);
  });
  it('computes points balances', () => {
    expect(pointsBalance([10, 25, 5], [30])).toBe(10);
  });
});
