/**
 * Approval workflow rules (pure; ADR-018). Chains, thresholds and SLAs are the organization's
 * configuration — nothing here assumes an approval policy.
 */
import { type DecimalInput, toDecimal } from './money.js';

export type WorkflowProcess = 'LEAVE_REQUEST' | 'EXPENSE_CLAIM' | 'TRAVEL_REQUEST' | 'TIMESHEET';
export const WORKFLOW_PROCESSES: readonly WorkflowProcess[] = [
  'LEAVE_REQUEST',
  'EXPENSE_CLAIM',
  'TRAVEL_REQUEST',
  'TIMESHEET',
];
/** What the threshold of each process is measured in. */
export const PROCESS_MEASURE: Record<WorkflowProcess, string> = {
  LEAVE_REQUEST: 'days',
  EXPENSE_CLAIM: 'amount',
  TRAVEL_REQUEST: 'estimated cost',
  TIMESHEET: 'hours',
};

export type ApproverRule =
  | { type: 'REPORTING_MANAGER' }
  | { type: 'MANAGER_LEVEL'; level: number }
  | { type: 'ROLE'; roleKey: string }
  | { type: 'EMPLOYEE'; employeeId: string };

export type EscalationRule = { type: 'NEXT_MANAGER' } | { type: 'EMPLOYEE'; employeeId: string };

export interface WorkflowStep {
  name: string;
  approver: ApproverRule;
  /** The step applies only when the request's measure is at least this value. */
  minMeasure?: string | null;
  slaHours?: number | null;
  escalateTo?: EscalationRule | null;
}

export function validateDefinition(steps: readonly WorkflowStep[]): string[] {
  const issues: string[] = [];
  if (!steps.length) issues.push('Add at least one step');
  if (steps.length > 10) issues.push('A workflow has at most 10 steps');
  steps.forEach((s, i) => {
    const n = `Step ${String(i + 1)}`;
    if (s.approver.type === 'MANAGER_LEVEL' && (s.approver.level < 2 || s.approver.level > 6))
      issues.push(`${n}: the manager level is 2 to 6 (1 is the reporting manager)`);
    if (s.minMeasure !== null && s.minMeasure !== undefined && toDecimal(s.minMeasure).lt(0))
      issues.push(`${n}: the threshold cannot be negative`);
    if (s.escalateTo && !s.slaHours) issues.push(`${n}: escalation needs an SLA`);
    if (s.slaHours !== null && s.slaHours !== undefined && (s.slaHours < 1 || s.slaHours > 720))
      issues.push(`${n}: the SLA is 1 to 720 hours`);
  });
  return issues;
}

/** Steps that apply to a request with this measure, keeping their definition index. */
export function applicableSteps(
  steps: readonly WorkflowStep[],
  measure: DecimalInput,
): { index: number; step: WorkflowStep }[] {
  const m = toDecimal(measure);
  return steps
    .map((step, index) => ({ index, step }))
    .filter(
      ({ step }) =>
        step.minMeasure === null ||
        step.minMeasure === undefined ||
        m.gte(toDecimal(step.minMeasure)),
    );
}

export interface ResolveContext {
  requesterId: string;
  /** The requester's managers: [reporting manager, their manager, …]. */
  managerChain: readonly string[];
  /** Employee ids of active members holding a role key. */
  roleHolders: (roleKey: string) => readonly string[];
  /** Employee ids that exist and are active. */
  isActive: (employeeId: string) => boolean;
}

export type Resolution = { assignees: string[] } | { skipped: string };

/** Who may decide a step; skipped when nobody other than the requester can. */
export function resolveApprover(rule: ApproverRule, ctx: ResolveContext): Resolution {
  let ids: readonly string[];
  switch (rule.type) {
    case 'REPORTING_MANAGER':
      ids = ctx.managerChain.slice(0, 1);
      break;
    case 'MANAGER_LEVEL':
      ids = ctx.managerChain.slice(rule.level - 1, rule.level);
      break;
    case 'ROLE':
      ids = ctx.roleHolders(rule.roleKey);
      break;
    case 'EMPLOYEE':
      ids = ctx.isActive(rule.employeeId) ? [rule.employeeId] : [];
      break;
  }
  const assignees = [...new Set(ids)].filter((id) => id !== ctx.requesterId);
  if (assignees.length) return { assignees };
  return {
    skipped:
      ids.length && ids.every((id) => id === ctx.requesterId)
        ? 'the approver is the requester'
        : rule.type === 'ROLE'
          ? `nobody holds the role ${rule.roleKey}`
          : 'no approver found',
  };
}

export interface Delegation {
  delegatorId: string;
  delegateId: string;
  from: string;
  to: string;
  /** Empty = every process. */
  processes: readonly WorkflowProcess[];
}

/**
 * The person who acts for `assigneeId` on `date` (one hop, never the requester), or the
 * assignee themself.
 */
export function delegateFor(
  assigneeId: string,
  process: WorkflowProcess,
  date: string,
  delegations: readonly Delegation[],
  requesterId: string,
): { actorId: string; onBehalfOf: string | null } {
  const d = delegations.find(
    (x) =>
      x.delegatorId === assigneeId &&
      x.from <= date &&
      date <= x.to &&
      (x.processes.length === 0 || x.processes.includes(process)) &&
      x.delegateId !== requesterId,
  );
  return d
    ? { actorId: d.delegateId, onBehalfOf: assigneeId }
    : { actorId: assigneeId, onBehalfOf: null };
}

/** Delegations of one person may not overlap for the same process. */
export function delegationsOverlap(a: Delegation, b: Delegation): boolean {
  if (a.delegatorId !== b.delegatorId) return false;
  if (a.to < b.from || b.to < a.from) return false;
  if (!a.processes.length || !b.processes.length) return true;
  return a.processes.some((p) => b.processes.includes(p));
}

export function dueAt(start: Date, slaHours: number | null | undefined): Date | null {
  return slaHours ? new Date(start.getTime() + slaHours * 3_600_000) : null;
}

export function isOverdue(due: Date | null, now: Date): boolean {
  return !!due && now.getTime() > due.getTime();
}

/** Where an overdue task goes: the assignee's next manager up, or a named employee. */
export function escalationTarget(
  rule: EscalationRule | null | undefined,
  assigneeManagerId: string | null,
  requesterId: string,
): string | null {
  if (!rule) return null;
  const target = rule.type === 'EMPLOYEE' ? rule.employeeId : assigneeManagerId;
  return target && target !== requesterId ? target : null;
}
