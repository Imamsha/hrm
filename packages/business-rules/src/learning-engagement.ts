/**
 * Learning and engagement rules (pure). Pass marks, minimum group sizes and points are the
 * organization's configuration.
 */
import { Decimal } from './money.js';

// ------------------------------------------------------------------------------ quizzes

export interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  /** Indexes of the correct options (one or more). Never sent to learners. */
  correct: number[];
  points: number;
}

/**
 * Grades a quiz attempt. A question scores its points only when the selected options are exactly
 * the correct set. Returns the score in percent (2 decimals) and whether it reaches the pass mark.
 */
export function gradeQuiz(
  questions: readonly QuizQuestion[],
  answers: Readonly<Record<string, readonly number[]>>,
  passPercent: number,
): {
  earned: number;
  possible: number;
  percent: Decimal;
  passed: boolean;
  perQuestion: { id: string; correct: boolean }[];
} {
  let earned = 0;
  let possible = 0;
  const perQuestion = questions.map((q) => {
    possible += q.points;
    const given = [...new Set(answers[q.id] ?? [])].sort((a, b) => a - b);
    const expected = [...new Set(q.correct)].sort((a, b) => a - b);
    const correct = given.length === expected.length && given.every((v, i) => v === expected[i]);
    if (correct) earned += q.points;
    return { id: q.id, correct };
  });
  const percent =
    possible === 0
      ? new Decimal(0)
      : new Decimal(earned).times(100).dividedBy(possible).toDecimalPlaces(2);
  return {
    earned,
    possible,
    percent,
    passed: percent.greaterThanOrEqualTo(passPercent),
    perQuestion,
  };
}

/** Strips correct answers before a quiz goes to a learner. */
export function publicQuestions(
  questions: readonly QuizQuestion[],
): Omit<QuizQuestion, 'correct'>[] {
  return questions.map(({ correct: _hidden, ...q }) => q);
}

/** Completed share of modules in percent. */
export function courseProgress(completedModules: number, totalModules: number): number {
  if (totalModules <= 0) return 0;
  return Math.min(100, Math.round((completedModules / totalModules) * 100));
}

/** Certification expiry: `validityMonths` after completion (same day of month, clamped). */
export function certificationExpiry(completedOn: string, validityMonths: number): string {
  const [y, m, d] = completedOn.split('-').map(Number) as [number, number, number];
  const total = m - 1 + validityMonths;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------ surveys

export type SurveyQuestionType = 'RATING' | 'ENPS' | 'CHOICE' | 'TEXT';
export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  text: string;
  options?: string[];
  required: boolean;
}

export type SurveyAnswer = number | string | null;

/** Validates one response against the questions; returns problems by question id. */
export function validateSurveyAnswers(
  questions: readonly SurveyQuestion[],
  answers: Readonly<Record<string, SurveyAnswer>>,
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const q of questions) {
    const a = answers[q.id];
    if (a === undefined || a === null || a === '') {
      if (q.required) problems[q.id] = 'Required';
      continue;
    }
    if (q.type === 'RATING' && !(typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= 5))
      problems[q.id] = 'Choose 1 to 5';
    if (q.type === 'ENPS' && !(typeof a === 'number' && Number.isInteger(a) && a >= 0 && a <= 10))
      problems[q.id] = 'Choose 0 to 10';
    if (q.type === 'CHOICE' && !(typeof a === 'string' && (q.options ?? []).includes(a)))
      problems[q.id] = 'Choose one of the options';
    if (q.type === 'TEXT' && !(typeof a === 'string' && a.length <= 5000))
      problems[q.id] = 'At most 5000 characters';
  }
  for (const id of Object.keys(answers))
    if (!questions.some((q) => q.id === id)) problems[id] = 'Unknown question';
  return problems;
}

export interface QuestionResult {
  id: string;
  type: SurveyQuestionType;
  text: string;
  responses: number;
  average?: string;
  /** eNPS = % promoters (9–10) − % detractors (0–6). */
  enps?: string;
  distribution?: Record<string, number>;
  texts?: string[];
}

/**
 * Aggregates responses. Below the minimum group size nothing is revealed (`hidden: true`), so small
 * groups cannot be de-anonymised.
 */
export function aggregateSurvey(
  questions: readonly SurveyQuestion[],
  responses: readonly Readonly<Record<string, SurveyAnswer>>[],
  minimumGroupSize: number,
): { responses: number; hidden: boolean; questions: QuestionResult[] } {
  if (responses.length < Math.max(1, minimumGroupSize))
    return { responses: responses.length, hidden: true, questions: [] };
  const out = questions.map((q): QuestionResult => {
    const values = responses
      .map((r) => r[q.id])
      .filter((v): v is number | string => v !== undefined && v !== null && v !== '');
    const base: QuestionResult = { id: q.id, type: q.type, text: q.text, responses: values.length };
    if (q.type === 'RATING' || q.type === 'ENPS') {
      const nums = values.filter((v): v is number => typeof v === 'number');
      const dist: Record<string, number> = {};
      for (const n of nums) dist[String(n)] = (dist[String(n)] ?? 0) + 1;
      const avg = nums.length
        ? nums
            .reduce((a, n) => a.plus(n), new Decimal(0))
            .dividedBy(nums.length)
            .toFixed(2)
        : undefined;
      const result: QuestionResult = {
        ...base,
        distribution: dist,
        ...(avg ? { average: avg } : {}),
      };
      if (q.type === 'ENPS' && nums.length) {
        const promoters = nums.filter((n) => n >= 9).length;
        const detractors = nums.filter((n) => n <= 6).length;
        result.enps = new Decimal(promoters - detractors)
          .times(100)
          .dividedBy(nums.length)
          .toFixed(1);
      }
      return result;
    }
    if (q.type === 'CHOICE') {
      const dist: Record<string, number> = Object.fromEntries((q.options ?? []).map((o) => [o, 0]));
      for (const v of values) if (typeof v === 'string') dist[v] = (dist[v] ?? 0) + 1;
      return { ...base, distribution: dist };
    }
    return { ...base, texts: values.filter((v): v is string => typeof v === 'string') };
  });
  return { responses: responses.length, hidden: false, questions: out };
}

// ------------------------------------------------------------------------------ recognition

/** Points balance: received minus redeemed (pending and fulfilled redemptions hold points). */
export function pointsBalance(received: readonly number[], redeemed: readonly number[]): number {
  return received.reduce((a, n) => a + n, 0) - redeemed.reduce((a, n) => a + n, 0);
}
