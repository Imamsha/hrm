/**
 * Recruitment and onboarding rules (pure). Decisions about candidates are always made by
 * people: nothing here (or anywhere in the product) rejects a candidate automatically.
 */

export type ApplicationStage =
  | 'APPLIED'
  | 'SCREENING'
  | 'ASSESSMENT'
  | 'INTERVIEW'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN';

export const PIPELINE: readonly ApplicationStage[] = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'HIRED',
];

const ACTIVE = new Set<ApplicationStage>([
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
]);

export function isActiveStage(stage: ApplicationStage): boolean {
  return ACTIVE.has(stage);
}

/**
 * Whether a recruiter may move an application from one stage to another.
 *  - Forward moves may skip optional stages (e.g. screening → interview), never past OFFER:
 *    HIRED is reached only through the hire action (which creates the employee).
 *  - Steps back within the active pipeline are allowed (re-interview, re-assess).
 *  - Any active application can be rejected or withdrawn; a rejected one can be reconsidered
 *    (back to SCREENING); HIRED and WITHDRAWN are final.
 */
export function canMoveStage(from: ApplicationStage, to: ApplicationStage): boolean {
  if (from === to) return false;
  if (to === 'HIRED') return false;
  if (from === 'HIRED' || from === 'WITHDRAWN') return false;
  if (from === 'REJECTED') return to === 'SCREENING';
  if (to === 'REJECTED' || to === 'WITHDRAWN') return true;
  return isActiveStage(to);
}

export type Recommendation = 'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO';

export interface FeedbackEntry {
  rating: number | null;
  recommendation: Recommendation | null;
}

/** Aggregates submitted panel feedback (unsubmitted entries are ignored). */
export function summarizeFeedback(entries: readonly FeedbackEntry[]) {
  const rated = entries.filter((e) => e.rating !== null).map((e) => e.rating as number);
  const counts: Record<Recommendation, number> = { STRONG_YES: 0, YES: 0, NO: 0, STRONG_NO: 0 };
  for (const e of entries) if (e.recommendation) counts[e.recommendation] += 1;
  const submitted = entries.filter((e) => e.rating !== null || e.recommendation !== null).length;
  return {
    submitted,
    averageRating: rated.length
      ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10
      : null,
    recommendations: counts,
  };
}

/** Due date of an onboarding task relative to the joining date (negative = before joining). */
export function taskDueDate(joiningDate: string, offsetDays: number): string {
  const [y, m, d] = joiningDate.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return t.toISOString().slice(0, 10);
}

/** Progress of an onboarding plan: done or skipped tasks over all tasks. */
export function onboardingProgress(tasks: readonly { status: 'PENDING' | 'DONE' | 'SKIPPED' }[]) {
  const total = tasks.length;
  const closed = tasks.filter((t) => t.status !== 'PENDING').length;
  return {
    total,
    closed,
    percent: total ? Math.round((closed / total) * 100) : 100,
    complete: closed === total,
  };
}

/** URL-safe slug for a job opening (career portal links). */
export function openingSlug(title: string, suffix: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${base || 'job'}-${suffix}`;
}
