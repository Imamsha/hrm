import { describe, expect, it } from 'vitest';
import {
  boardColumnsSchema,
  clientSchema,
  invoiceSchema,
  projectSchema,
  timesheetDecisionSchema,
  timesheetSchema,
  updateClientSchema,
  updateProjectSchema,
  workItemSchema,
} from './projects.js';

const id = '0195f1d2-0000-7000-8000-000000000001';
const msgs = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);

describe('clients and projects', () => {
  it('normalises codes and currency, and leaves omitted fields untouched on update', () => {
    const c = clientSchema.parse({
      code: 'acme',
      name: 'Acme',
      currency: 'inr',
      paymentTermsDays: '30',
      email: '',
    });
    expect(c).toMatchObject({ code: 'ACME', currency: 'INR', paymentTermsDays: 30, email: null });
    const u = updateClientSchema.parse({ name: 'Acme Ltd' });
    expect(u).toEqual({ name: 'Acme Ltd' });
    expect(updateClientSchema.parse({ email: '' }).email).toBeNull();
    expect(updateProjectSchema.parse({ status: 'ON_HOLD' })).toEqual({ status: 'ON_HOLD' });
  });

  it('needs a client for billable and portal projects', () => {
    const base = { key: 'web', name: 'Website', billingType: 'TIME_AND_MATERIALS' };
    expect(msgs(projectSchema.safeParse(base))).toContain('A billable project needs a client');
    expect(projectSchema.parse({ ...base, clientId: id }).key).toBe('WEB');
    expect(
      msgs(projectSchema.safeParse({ ...base, billingType: 'NON_BILLABLE', portalEnabled: true })),
    ).toEqual(['Only client projects can be shown in the portal']);
    expect(msgs(projectSchema.safeParse({ ...base, key: '1X', clientId: id }))[0]).toMatch(
      /starting with a letter/,
    );
  });

  it('needs one column of each category', () => {
    const r = boardColumnsSchema.safeParse({
      columns: [
        { name: 'To do', category: 'TODO' },
        { name: 'Review', category: 'TODO' },
        { name: 'Done', category: 'DONE' },
      ],
    });
    expect(msgs(r)).toEqual(["Add a column for 'in progress'"]);
  });
});

describe('work items', () => {
  it('keeps bug fields to bugs and requires a severity on bugs', () => {
    expect(
      msgs(workItemSchema.safeParse({ type: 'STORY', title: 'Login', severity: 'MAJOR' })),
    ).toEqual(['Severity, steps and environment are for bugs']);
    expect(msgs(workItemSchema.safeParse({ type: 'BUG', title: 'Crash' }))).toEqual([
      'Choose the severity',
    ]);
    expect(workItemSchema.parse({ type: 'TASK', title: 'Build', storyPoints: '' })).toMatchObject({
      priority: 'MEDIUM',
      storyPoints: null,
      clientVisible: false,
      labels: [],
    });
  });
});

describe('timesheets', () => {
  it('starts on a Monday, uses quarter hours and stays within the week', () => {
    expect(msgs(timesheetSchema.safeParse({ weekStart: '2026-11-24', entries: [] }))).toEqual([
      'A week starts on Monday',
    ]);
    const r = timesheetSchema.safeParse({
      weekStart: '2026-11-23',
      entries: [
        { date: '2026-11-24', projectId: id, hours: '7.5' },
        { date: '2026-12-01', projectId: id, hours: 1 },
      ],
    });
    expect(msgs(r)).toEqual(['Entry 2: 2026-12-01 is not in the week of 2026-11-23']);
    expect(
      msgs(
        timesheetSchema.safeParse({
          weekStart: '2026-11-23',
          entries: [{ date: '2026-11-25', projectId: id, hours: '0.3' }],
        }),
      ),
    ).toEqual(['Enter 0.25–24 hours in quarter hours']);
    expect(msgs(timesheetDecisionSchema.safeParse({ decision: 'REJECTED' }))).toEqual([
      'Give a reason',
    ]);
  });
});

describe('invoices', () => {
  it('needs time or lines, and both period dates', () => {
    expect(msgs(invoiceSchema.safeParse({ clientId: id }))).toEqual([
      'Add time or at least one line',
    ]);
    expect(msgs(invoiceSchema.safeParse({ clientId: id, timeFrom: '2026-11-01' }))).toContain(
      'Give both dates of the time period',
    );
    const ok = invoiceSchema.parse({
      clientId: id,
      lines: [{ description: 'Milestone 1', quantity: 1, unitPrice: '50000', taxRateId: '' }],
    });
    expect(ok.lines[0]).toMatchObject({ quantity: '1', unitPrice: '50000', taxRateId: null });
  });
});
