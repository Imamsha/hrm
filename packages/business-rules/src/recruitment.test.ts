import { describe, expect, it } from 'vitest';
import {
  canMoveStage,
  onboardingProgress,
  openingSlug,
  summarizeFeedback,
  taskDueDate,
} from './recruitment.js';

describe('pipeline transitions', () => {
  it('moves forward (skipping optional stages) and back within the active pipeline', () => {
    expect(canMoveStage('APPLIED', 'SCREENING')).toBe(true);
    expect(canMoveStage('SCREENING', 'INTERVIEW')).toBe(true);
    expect(canMoveStage('INTERVIEW', 'ASSESSMENT')).toBe(true);
    expect(canMoveStage('OFFER', 'INTERVIEW')).toBe(true);
    expect(canMoveStage('APPLIED', 'APPLIED')).toBe(false);
  });

  it('reaches HIRED only through the hire action and keeps final stages final', () => {
    expect(canMoveStage('OFFER', 'HIRED')).toBe(false);
    expect(canMoveStage('HIRED', 'REJECTED')).toBe(false);
    expect(canMoveStage('WITHDRAWN', 'SCREENING')).toBe(false);
  });

  it('rejects or withdraws any active application and lets a rejected one be reconsidered', () => {
    expect(canMoveStage('INTERVIEW', 'REJECTED')).toBe(true);
    expect(canMoveStage('APPLIED', 'WITHDRAWN')).toBe(true);
    expect(canMoveStage('REJECTED', 'SCREENING')).toBe(true);
    expect(canMoveStage('REJECTED', 'OFFER')).toBe(false);
  });
});

describe('feedback and onboarding', () => {
  it('summarizes submitted feedback only', () => {
    expect(
      summarizeFeedback([
        { rating: 4, recommendation: 'YES' },
        { rating: 5, recommendation: 'STRONG_YES' },
        { rating: null, recommendation: null },
      ]),
    ).toEqual({
      submitted: 2,
      averageRating: 4.5,
      recommendations: { STRONG_YES: 1, YES: 1, NO: 0, STRONG_NO: 0 },
    });
    expect(summarizeFeedback([]).averageRating).toBeNull();
  });

  it('computes task due dates and progress', () => {
    expect(taskDueDate('2026-12-01', -3)).toBe('2026-11-28');
    expect(taskDueDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(
      onboardingProgress([
        { status: 'DONE' },
        { status: 'PENDING' },
        { status: 'SKIPPED' },
        { status: 'PENDING' },
      ]),
    ).toEqual({
      total: 4,
      closed: 2,
      percent: 50,
      complete: false,
    });
    expect(onboardingProgress([]).complete).toBe(true);
  });

  it('builds URL-safe slugs', () => {
    expect(openingSlug('Senior Software Engineer (Backend) — Bengaluru', 'a1b2')).toBe(
      'senior-software-engineer-backend-bengaluru-a1b2',
    );
    expect(openingSlug('!!!', 'x9')).toBe('job-x9');
  });
});
