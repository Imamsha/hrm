import { describe, expect, it } from 'vitest';
import {
  assessmentSchema,
  createOpeningSchema,
  createRequisitionSchema,
  feedbackSchema,
  moneySchema,
  moveStageSchema,
  offerSchema,
  onboardingTemplateSchema,
  portalApplicationSchema,
} from './recruitment.js';

const company = '0195f1d2-0000-7000-8000-000000000c01';

describe('money', () => {
  it('keeps amounts as decimal strings and rejects floats with more precision', () => {
    expect(moneySchema.parse(1200000)).toBe('1200000');
    expect(moneySchema.parse(' 1500000.50 ')).toBe('1500000.50');
    expect(moneySchema.safeParse('12.345').success).toBe(false);
    expect(moneySchema.safeParse('-5').success).toBe(false);
  });
});

describe('requisitions and openings', () => {
  const base = {
    title: 'Backend Engineer',
    companyId: company,
    employmentType: 'FULL_TIME',
    headcount: '2',
  };

  it('accepts a minimal requisition with INR default', () => {
    const r = createRequisitionSchema.parse(base);
    expect(r.headcount).toBe(2);
    expect(r.currency).toBe('INR');
    expect(r.budgetMin).toBeNull();
  });

  it('rejects an inverted budget range using decimal comparison', () => {
    expect(
      createRequisitionSchema.safeParse({ ...base, budgetMin: '1800000', budgetMax: '1200000' })
        .success,
    ).toBe(false);
    // 9 < 10 numerically even though "9" > "10" as strings.
    expect(
      createRequisitionSchema.safeParse({ ...base, budgetMin: '9', budgetMax: '10' }).success,
    ).toBe(true);
  });

  it('requires a description on openings', () => {
    const opening = {
      title: 'Backend Engineer',
      companyId: company,
      employmentType: 'FULL_TIME',
      positions: '1',
    };
    expect(createOpeningSchema.safeParse(opening).success).toBe(false);
    expect(createOpeningSchema.safeParse({ ...opening, description: 'Build APIs' }).success).toBe(
      true,
    );
  });
});

describe('career portal application', () => {
  const app = { firstName: 'Ravi', email: 'ravi@example.com', phone: '+919812345678' };

  it('requires explicit consent', () => {
    expect(portalApplicationSchema.safeParse(app).success).toBe(false);
    expect(portalApplicationSchema.safeParse({ ...app, consent: 'false' }).success).toBe(false);
    expect(portalApplicationSchema.safeParse({ ...app, consent: 'true' }).success).toBe(true);
  });
});

describe('pipeline', () => {
  it('requires a reason to reject', () => {
    expect(moveStageSchema.safeParse({ stage: 'REJECTED' }).success).toBe(false);
    expect(
      moveStageSchema.safeParse({ stage: 'REJECTED', rejectionReason: 'Skills gap' }).success,
    ).toBe(true);
    expect(moveStageSchema.safeParse({ stage: 'SCREENING' }).success).toBe(true);
    // HIRED is reached only through the hire endpoint.
    expect(moveStageSchema.safeParse({ stage: 'HIRED' }).success).toBe(false);
  });

  it('bounds assessment scores by the maximum', () => {
    const a = { name: 'Coding test', assessedOn: '2026-11-20', maxScore: '100' };
    expect(assessmentSchema.safeParse({ ...a, score: '85.5' }).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...a, score: '100.01' }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...a, score: '1', maxScore: '0' }).success).toBe(false);
  });

  it('validates feedback ratings and offers', () => {
    expect(
      feedbackSchema.safeParse({ rating: '6', recommendation: 'YES', notes: 'x' }).success,
    ).toBe(false);
    expect(feedbackSchema.parse({ rating: '4', recommendation: 'YES', notes: 'Good' }).rating).toBe(
      4,
    );
    const offer = offerSchema.parse({ joiningDate: '2026-12-01', annualCtc: '1500000' });
    expect(offer).toMatchObject({ annualCtc: '1500000', currency: 'INR' });
  });
});

describe('onboarding templates', () => {
  it('needs at least one task and maps a blank document to null', () => {
    expect(onboardingTemplateSchema.safeParse({ name: 'Standard', tasks: [] }).success).toBe(false);
    const t = onboardingTemplateSchema.parse({
      name: 'Standard',
      tasks: [
        { title: 'Submit ID', assignee: 'EMPLOYEE', dueOffsetDays: '-3', documentCategory: '' },
      ],
    });
    expect(t.tasks[0]).toMatchObject({ dueOffsetDays: -3, documentCategory: null });
    expect(t.isDefault).toBe(false);
  });
});
