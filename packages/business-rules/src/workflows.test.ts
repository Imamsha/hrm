import { describe, expect, it } from 'vitest';
import {
  nextSigner,
  renderTemplate,
  signatureState,
  templateFields,
  validateTemplate,
} from './documents.js';
import {
  applicableSteps,
  type Delegation,
  delegateFor,
  delegationsOverlap,
  dueAt,
  escalationTarget,
  isOverdue,
  resolveApprover,
  validateDefinition,
  type WorkflowStep,
} from './workflows.js';

const ctx = {
  requesterId: 'emp',
  managerChain: ['boss', 'bigboss'],
  roleHolders: (k: string) => (k === 'finance' ? ['fin1', 'emp'] : []),
  isActive: (id: string) => id !== 'gone',
};

describe('workflow definitions', () => {
  it('checks levels, thresholds and SLAs', () => {
    expect(validateDefinition([])).toEqual(['Add at least one step']);
    expect(
      validateDefinition([
        { name: 'a', approver: { type: 'MANAGER_LEVEL', level: 1 } },
        { name: 'b', approver: { type: 'REPORTING_MANAGER' }, minMeasure: '-1' },
        {
          name: 'c',
          approver: { type: 'REPORTING_MANAGER' },
          escalateTo: { type: 'NEXT_MANAGER' },
        },
      ]),
    ).toEqual([
      'Step 1: the manager level is 2 to 6 (1 is the reporting manager)',
      'Step 2: the threshold cannot be negative',
      'Step 3: escalation needs an SLA',
    ]);
  });

  it('applies steps from their threshold', () => {
    const steps: WorkflowStep[] = [
      { name: 'Manager', approver: { type: 'REPORTING_MANAGER' } },
      { name: 'Finance', approver: { type: 'ROLE', roleKey: 'finance' }, minMeasure: '50000' },
    ];
    expect(applicableSteps(steps, '49999.99').map((s) => s.index)).toEqual([0]);
    expect(applicableSteps(steps, '50000').map((s) => s.index)).toEqual([0, 1]);
  });
});

describe('approvers', () => {
  it('resolves managers, roles and people, never the requester', () => {
    expect(resolveApprover({ type: 'REPORTING_MANAGER' }, ctx)).toEqual({ assignees: ['boss'] });
    expect(resolveApprover({ type: 'MANAGER_LEVEL', level: 2 }, ctx)).toEqual({
      assignees: ['bigboss'],
    });
    expect(resolveApprover({ type: 'MANAGER_LEVEL', level: 3 }, ctx)).toEqual({
      skipped: 'no approver found',
    });
    expect(resolveApprover({ type: 'ROLE', roleKey: 'finance' }, ctx)).toEqual({
      assignees: ['fin1'],
    });
    expect(resolveApprover({ type: 'ROLE', roleKey: 'hr_admin' }, ctx)).toEqual({
      skipped: 'nobody holds the role hr_admin',
    });
    expect(resolveApprover({ type: 'EMPLOYEE', employeeId: 'emp' }, ctx)).toEqual({
      skipped: 'the approver is the requester',
    });
    expect(resolveApprover({ type: 'EMPLOYEE', employeeId: 'gone' }, ctx)).toEqual({
      skipped: 'no approver found',
    });
  });

  it('hands tasks to a delegate in force, never to the requester', () => {
    const ds: Delegation[] = [
      {
        delegatorId: 'boss',
        delegateId: 'deputy',
        from: '2026-12-01',
        to: '2026-12-10',
        processes: ['LEAVE_REQUEST'],
      },
    ];
    expect(delegateFor('boss', 'LEAVE_REQUEST', '2026-12-05', ds, 'emp')).toEqual({
      actorId: 'deputy',
      onBehalfOf: 'boss',
    });
    expect(delegateFor('boss', 'EXPENSE_CLAIM', '2026-12-05', ds, 'emp').actorId).toBe('boss');
    expect(delegateFor('boss', 'LEAVE_REQUEST', '2026-12-11', ds, 'emp').actorId).toBe('boss');
    expect(delegateFor('boss', 'LEAVE_REQUEST', '2026-12-05', ds, 'deputy').actorId).toBe('boss');
    const all: Delegation = {
      delegatorId: 'boss',
      delegateId: 'x',
      from: '2026-12-09',
      to: '2026-12-20',
      processes: [],
    };
    expect(delegationsOverlap(ds[0] as Delegation, all)).toBe(true);
    expect(delegationsOverlap(ds[0] as Delegation, { ...all, from: '2026-12-11' })).toBe(false);
  });

  it('computes SLAs and escalation targets', () => {
    const d = dueAt(new Date('2026-11-26T10:00:00Z'), 24);
    expect(d?.toISOString()).toBe('2026-11-27T10:00:00.000Z');
    expect(isOverdue(d, new Date('2026-11-27T10:00:01Z'))).toBe(true);
    expect(isOverdue(null, new Date())).toBe(false);
    expect(escalationTarget({ type: 'NEXT_MANAGER' }, 'bigboss', 'emp')).toBe('bigboss');
    expect(escalationTarget({ type: 'EMPLOYEE', employeeId: 'emp' }, 'bigboss', 'emp')).toBeNull();
    expect(escalationTarget(null, 'bigboss', 'emp')).toBeNull();
  });
});

describe('document templates', () => {
  it('rejects unknown and unclosed merge fields', () => {
    expect(templateFields('Dear {{ employee.name }}, {{employee.name}} {{today}}')).toEqual([
      'employee.name',
      'today',
    ]);
    expect(validateTemplate('EXPERIENCE_LETTER', 'Dear {{employee.name}}, {{offer.ctc}}')).toEqual([
      'Unknown merge field {{offer.ctc}}',
    ]);
    expect(validateTemplate('OFFER_LETTER', 'Dear {{candidate.name}} {{offer.ctc')).toEqual([
      'A merge field is not closed: use {{field}}',
    ]);
  });

  it('fills every field or reports what is missing', () => {
    expect(
      renderTemplate('Dear {{employee.name}}, from {{organization.name}}', {
        'employee.name': 'Esha',
        'organization.name': 'Acme',
      }),
    ).toEqual({
      text: 'Dear Esha, from Acme',
      missing: [],
    });
    expect(
      renderTemplate('Last day {{employee.lastWorkingDay}}', { 'employee.lastWorkingDay': null })
        .missing,
    ).toEqual(['employee.lastWorkingDay']);
  });

  it('orders signers and tracks completion', () => {
    const s = [
      { order: 2, status: 'PENDING' as const, id: 'b' },
      { order: 1, status: 'ACCEPTED' as const, id: 'a' },
    ];
    expect(nextSigner(s)?.id).toBe('b');
    expect(signatureState(s)).toBe('PENDING');
    expect(signatureState(s.map((x) => ({ ...x, status: 'ACCEPTED' as const })))).toBe('COMPLETED');
    expect(nextSigner([...s, { order: 3, status: 'DECLINED' as const, id: 'c' }])).toBeNull();
  });
});
