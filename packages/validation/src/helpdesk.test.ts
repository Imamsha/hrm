import { describe, expect, it } from 'vitest';
import {
  clearanceDecisionSchema,
  clearanceTemplateSchema,
  exitQuestionsSchema,
  helpdeskCategorySchema,
  resignationDecisionSchema,
  ticketUpdateSchema,
} from './helpdesk.js';

const id = '0195f1d2-0000-7000-8000-000000000001';
const msgs = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);

describe('helpdesk', () => {
  it('needs agents and one SLA per priority', () => {
    expect(
      msgs(helpdeskCategorySchema.safeParse({ code: 'it', name: 'IT', agentEmployeeIds: [] })),
    ).toEqual(['Add at least one agent']);
    expect(
      msgs(
        helpdeskCategorySchema.safeParse({
          code: 'it',
          name: 'IT',
          agentEmployeeIds: [id],
          sla: [
            { priority: 'HIGH', firstResponseHours: 2 },
            { priority: 'HIGH', resolutionHours: 8 },
          ],
        }),
      ),
    ).toEqual(['One SLA per priority']);
    const ok = helpdeskCategorySchema.parse({
      code: 'it',
      name: 'IT',
      agentEmployeeIds: [id],
      sla: [{ priority: 'URGENT', firstResponseHours: '1', resolutionHours: '' }],
    });
    expect(ok).toMatchObject({
      code: 'IT',
      confidential: false,
      sla: [{ firstResponseHours: 1, resolutionHours: null }],
    });
  });

  it('requires a resolution note to resolve', () => {
    expect(msgs(ticketUpdateSchema.safeParse({ status: 'RESOLVED' }))).toEqual([
      'Describe the resolution',
    ]);
    expect(ticketUpdateSchema.parse({ priority: 'HIGH' })).toEqual({ priority: 'HIGH' });
  });
});

describe('separation', () => {
  it('needs reasons to reject and to waive', () => {
    expect(msgs(resignationDecisionSchema.safeParse({ decision: 'REJECTED' }))).toEqual([
      'Give a reason',
    ]);
    expect(msgs(clearanceDecisionSchema.safeParse({ status: 'WAIVED' }))).toEqual([
      'Say why it is waived',
    ]);
  });

  it('gives each clearance item exactly one owner and checks exit questions', () => {
    expect(msgs(clearanceTemplateSchema.safeParse({ items: [{ title: 'ID card' }] }))).toEqual([
      'Give the item a role or a person',
    ]);
    expect(
      clearanceTemplateSchema.parse({
        items: [{ title: 'ID card', ownerRoleKey: 'hr_admin', ownerEmployeeId: '' }],
      }).items[0]?.ownerEmployeeId,
    ).toBeNull();
    expect(
      msgs(
        exitQuestionsSchema.safeParse({
          questions: [{ id: 'q1', type: 'CHOICE', text: 'Why?', options: ['Pay'] }],
        }),
      ),
    ).toEqual(['A choice needs two options']);
  });
});
