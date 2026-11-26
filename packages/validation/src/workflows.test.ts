import { describe, expect, it } from 'vitest';
import {
  approvalDecisionSchema,
  delegationSchema,
  documentTemplateSchema,
  generateDocumentSchema,
  otpAcceptSchema,
  workflowDefinitionSchema,
} from './workflows.js';

const id = '0195f1d2-0000-7000-8000-000000000001';
const msgs = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);

describe('workflow definitions', () => {
  it('normalises thresholds and rejects invalid chains', () => {
    const ok = workflowDefinitionSchema.parse({
      process: 'EXPENSE_CLAIM',
      name: 'Claims',
      steps: [
        { name: 'Manager', approver: { type: 'REPORTING_MANAGER' }, minMeasure: '' },
        {
          name: 'Finance',
          approver: { type: 'ROLE', roleKey: 'finance' },
          minMeasure: 50000,
          slaHours: '48',
          escalateTo: { type: 'NEXT_MANAGER' },
        },
      ],
    });
    expect(ok.steps.map((s) => [s.minMeasure, s.slaHours])).toEqual([
      [null, null],
      ['50000', 48],
    ]);
    expect(
      msgs(workflowDefinitionSchema.safeParse({ process: 'LEAVE_REQUEST', name: 'x', steps: [] })),
    ).toEqual(['Add at least one step']);
    expect(
      msgs(
        workflowDefinitionSchema.safeParse({
          process: 'LEAVE_REQUEST',
          name: 'x',
          steps: [{ name: 'a', approver: { type: 'EMPLOYEE' } }],
        }),
      ),
    ).toEqual(['Choose the employee']);
  });

  it('needs a reason to reject and a valid delegation range', () => {
    expect(msgs(approvalDecisionSchema.safeParse({ decision: 'REJECTED' }))).toEqual([
      'Give a reason',
    ]);
    expect(
      msgs(
        delegationSchema.safeParse({
          delegateEmployeeId: id,
          from: '2026-12-10',
          to: '2026-12-01',
        }),
      ),
    ).toEqual(['The end cannot be before the start']);
    expect(
      delegationSchema.parse({ delegateEmployeeId: id, from: '2026-12-01', to: '2026-12-10' })
        .processes,
    ).toEqual([]);
  });
});

describe('documents', () => {
  it('checks merge fields against the category, including the title', () => {
    expect(
      msgs(
        documentTemplateSchema.safeParse({
          name: 'Exp',
          category: 'EXPERIENCE_LETTER',
          title: 'For {{candidate.name}}',
          body: 'Dear {{employee.name}}',
        }),
      ),
    ).toEqual(['Unknown merge field {{candidate.name}}']);
    expect(
      documentTemplateSchema.safeParse({
        name: 'Offer',
        category: 'OFFER_LETTER',
        title: 'Offer',
        body: 'Dear {{candidate.name}}, {{offer.ctc}}',
      }).success,
    ).toBe(true);
  });

  it('generates for exactly one subject and checks OTP codes', () => {
    expect(msgs(generateDocumentSchema.safeParse({ templateId: id }))).toEqual([
      'Choose the employee or the offer',
    ]);
    expect(
      generateDocumentSchema.parse({
        templateId: id,
        employeeId: id,
        signers: [{ kind: 'EMPLOYEE', employeeId: id }],
      }).values,
    ).toEqual({});
    expect(msgs(otpAcceptSchema.safeParse({ code: '12a456' }))).toEqual(['Enter the 6-digit code']);
  });
});
