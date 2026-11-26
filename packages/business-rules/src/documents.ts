/**
 * Document template rules (pure; ADR-018). Templates are the organization's own wording; this
 * module only knows which merge fields exist and how to fill them.
 */

export type TemplateCategory =
  | 'OFFER_LETTER'
  | 'APPOINTMENT_LETTER'
  | 'EXPERIENCE_LETTER'
  | 'RELIEVING_LETTER'
  | 'SALARY_CERTIFICATE'
  | 'POLICY'
  | 'OTHER';

const ORG = ['organization.name', 'today'] as const;
const EMPLOYEE = [
  'employee.name',
  'employee.firstName',
  'employee.number',
  'employee.designation',
  'employee.department',
  'employee.company',
  'employee.location',
  'employee.dateOfJoining',
  'employee.workEmail',
] as const;

/** Merge fields per category. Offers use the candidate and offer, everything else an employee. */
export const MERGE_FIELDS: Record<TemplateCategory, readonly string[]> = {
  OFFER_LETTER: [
    ...ORG,
    'candidate.name',
    'candidate.email',
    'offer.jobTitle',
    'offer.ctc',
    'offer.currency',
    'offer.joiningDate',
    'offer.expiresOn',
    'offer.department',
    'offer.location',
  ],
  APPOINTMENT_LETTER: [...ORG, ...EMPLOYEE, 'employee.ctc'],
  EXPERIENCE_LETTER: [...ORG, ...EMPLOYEE, 'employee.lastWorkingDay'],
  RELIEVING_LETTER: [...ORG, ...EMPLOYEE, 'employee.lastWorkingDay'],
  SALARY_CERTIFICATE: [...ORG, ...EMPLOYEE, 'employee.ctc'],
  POLICY: [...ORG, ...EMPLOYEE],
  OTHER: [...ORG, ...EMPLOYEE],
};

/** Which subject a category is generated for. */
export const CATEGORY_SUBJECT: Record<TemplateCategory, 'EMPLOYEE' | 'OFFER'> = {
  OFFER_LETTER: 'OFFER',
  APPOINTMENT_LETTER: 'EMPLOYEE',
  EXPERIENCE_LETTER: 'EMPLOYEE',
  RELIEVING_LETTER: 'EMPLOYEE',
  SALARY_CERTIFICATE: 'EMPLOYEE',
  POLICY: 'EMPLOYEE',
  OTHER: 'EMPLOYEE',
};

const FIELD = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

export function templateFields(body: string): string[] {
  return [...new Set([...body.matchAll(FIELD)].map((m) => m[1] ?? ''))];
}

/** Unknown merge fields and unbalanced braces. */
export function validateTemplate(category: TemplateCategory, body: string): string[] {
  const issues: string[] = [];
  const allowed = new Set(MERGE_FIELDS[category]);
  for (const f of templateFields(body))
    if (!allowed.has(f)) issues.push(`Unknown merge field {{${f}}}`);
  const stray = body.replace(FIELD, '');
  if (stray.includes('{{') || stray.includes('}}'))
    issues.push('A merge field is not closed: use {{field}}');
  return issues;
}

/**
 * Fills the template. Every used field must have a value; a missing value is an error, never
 * an empty gap in a letter.
 */
export function renderTemplate(
  body: string,
  values: Readonly<Record<string, string | null | undefined>>,
): { text: string; missing: string[] } {
  const missing = templateFields(body).filter((f) => {
    const v = values[f];
    return v === null || v === undefined || v.trim() === '';
  });
  const text = body.replace(FIELD, (_, f: string) => values[f] ?? '');
  return { text, missing };
}

/** Signers accept in order; the next one is the first still pending. */
export function nextSigner<
  T extends { status: 'PENDING' | 'ACCEPTED' | 'DECLINED'; order: number },
>(signers: readonly T[]): T | null {
  if (signers.some((s) => s.status === 'DECLINED')) return null;
  return [...signers].sort((a, b) => a.order - b.order).find((s) => s.status === 'PENDING') ?? null;
}

export function signatureState(
  signers: readonly { status: 'PENDING' | 'ACCEPTED' | 'DECLINED' }[],
): 'PENDING' | 'COMPLETED' | 'DECLINED' {
  if (signers.some((s) => s.status === 'DECLINED')) return 'DECLINED';
  return signers.every((s) => s.status === 'ACCEPTED') ? 'COMPLETED' : 'PENDING';
}
