import { describe, expect, it } from 'vitest';
import {
  attritionRate,
  canMoveTicket,
  clearanceComplete,
  dueState,
  nextOccurrence,
  noticeLastDay,
  ratingAverage,
  slaDue,
  slaState,
  ticketNumber,
  waivedNoticeDays,
} from './helpdesk-separation-compliance.js';

describe('helpdesk', () => {
  it('moves tickets along the allowed path', () => {
    expect(canMoveTicket('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canMoveTicket('RESOLVED', 'OPEN')).toBe(true);
    expect(canMoveTicket('CLOSED', 'OPEN')).toBe(false);
    expect(canMoveTicket('WAITING_ON_REQUESTER', 'CLOSED')).toBe(false);
    expect(ticketNumber('HD', 2026, 12)).toBe('HD-2026-0012');
  });

  it('computes due times and breaches', () => {
    const created = new Date('2026-11-26T10:00:00Z');
    const due = slaDue(created, { firstResponseHours: 4, resolutionHours: 24 });
    expect([due.firstResponseDue?.toISOString(), due.resolutionDue?.toISOString()]).toEqual([
      '2026-11-26T14:00:00.000Z',
      '2026-11-27T10:00:00.000Z',
    ]);
    expect(slaDue(created, null)).toEqual({ firstResponseDue: null, resolutionDue: null });
    const t = { ...due, firstRespondedAt: new Date('2026-11-26T15:00:00Z'), resolvedAt: null };
    expect(slaState(t, new Date('2026-11-27T09:00:00Z'))).toEqual({
      responseBreached: true,
      resolutionBreached: false,
    });
    expect(slaState(t, new Date('2026-11-27T11:00:00Z')).resolutionBreached).toBe(true);
    expect(
      slaState(
        { ...t, resolvedAt: new Date('2026-11-27T09:59:00Z') },
        new Date('2026-12-30T00:00:00Z'),
      ).resolutionBreached,
    ).toBe(false);
  });
});

describe('separation', () => {
  it('derives the notice last day and waived days', () => {
    expect(noticeLastDay('2026-11-26', 30)).toBe('2026-12-25');
    expect(noticeLastDay('2026-11-26', null)).toBeNull();
    expect(waivedNoticeDays('2026-12-25', '2026-12-15')).toBe(10);
    expect(waivedNoticeDays('2026-12-25', '2026-12-31')).toBe(0);
    expect(waivedNoticeDays(null, '2026-12-01')).toBe(0);
  });

  it('checks clearance and attrition', () => {
    expect(clearanceComplete([{ status: 'CLEARED' }, { status: 'WAIVED' }])).toBe(true);
    expect(clearanceComplete([{ status: 'CLEARED' }, { status: 'PENDING' }])).toBe(false);
    expect(attritionRate(3, 100, 98)?.toString()).toBe('3.03');
    expect(attritionRate(1, 0, 0)).toBeNull();
    expect(ratingAverage([4, 5, 3], 5)).toEqual({ count: 3, average: null });
    expect(ratingAverage([4, 5, 3, 4, 4], 5)).toEqual({ count: 5, average: '4.00' });
  });
});

describe('compliance', () => {
  it('rolls recurring obligations forward, keeping the day of month', () => {
    expect(nextOccurrence('2026-01-31', '2026-01-31', 'MONTHLY')).toBe('2026-02-28');
    expect(nextOccurrence('2026-01-31', '2026-02-28', 'MONTHLY')).toBe('2026-03-31');
    expect(nextOccurrence('2026-04-15', '2026-04-15', 'QUARTERLY')).toBe('2026-07-15');
    expect(nextOccurrence('2026-11-30', '2026-11-30', 'HALF_YEARLY')).toBe('2027-05-30');
    expect(nextOccurrence('2024-02-29', '2024-02-29', 'YEARLY')).toBe('2025-02-28');
    expect(nextOccurrence('2026-01-01', '2026-01-01', 'NONE')).toBeNull();
  });

  it('classifies due dates', () => {
    expect(dueState('2026-11-25', '2026-11-26', 30)).toBe('OVERDUE');
    expect(dueState('2026-12-20', '2026-11-26', 30)).toBe('DUE_SOON');
    expect(dueState('2027-01-30', '2026-11-26', 30)).toBe('LATER');
  });
});
