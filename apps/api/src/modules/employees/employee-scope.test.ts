import type { Permission } from '@hrm/shared-types';
import { describe, expect, it } from 'vitest';
import type { AuthPrincipal, ScopedGrant } from '../access/principal.js';
import {
  addDays,
  currentRecord,
  displayName,
  employeeAttributes,
  employeeScopeWhere,
  mask,
  toDate,
} from './employee-scope.js';

const READ: Permission = 'employees.employee.read';
const principal = (grants: ScopedGrant[]): AuthPrincipal => ({
  userId: 'u-1',
  sessionId: 's-1',
  organizationId: 'o-1',
  membershipId: 'm-1',
  grants: new Map([[READ, grants]]),
});

const rec = (from: string, to: string | null, changeType = 'TRANSFER') => ({
  effectiveFrom: toDate(from),
  effectiveTo: to ? toDate(to) : null,
  changeType,
});

describe('currentRecord', () => {
  it('picks the record in force today', () => {
    const records = [rec('2026-01-01', '2026-06-30', 'JOINING'), rec('2026-07-01', null)];
    expect(currentRecord(records, '2026-11-18')).toBe(records[1]);
    expect(currentRecord(records, '2026-03-01')).toBe(records[0]);
  });

  it('keeps the current record when a future change is scheduled', () => {
    const records = [rec('2026-01-01', '2026-12-31', 'JOINING'), rec('2027-01-01', null)];
    expect(currentRecord(records, '2026-11-18')).toBe(records[0]);
  });

  it('uses the pending joining record for future joiners and the last record after separation', () => {
    const future = [rec('2027-02-01', null, 'JOINING')];
    expect(currentRecord(future, '2026-11-18')).toBe(future[0]);
    const separated = [rec('2025-01-01', '2026-05-31', 'JOINING')];
    expect(currentRecord(separated, '2026-11-18')).toBe(separated[0]);
    expect(currentRecord([], '2026-11-18')).toBeNull();
  });
});

describe('employeeScopeWhere', () => {
  it('is unrestricted for organization-wide grants and null without grants', () => {
    expect(
      employeeScopeWhere(
        principal([{ scopeType: 'ORGANIZATION', scopeId: null }]),
        READ,
        '2026-11-18',
      ),
    ).toEqual({});
    expect(employeeScopeWhere(principal([]), READ, '2026-11-18')).toBeNull();
  });

  it('ORs structural scopes on the in-force placement and SELF on the membership', () => {
    const where = employeeScopeWhere(
      principal([
        { scopeType: 'DEPARTMENT', scopeId: 'd-1', coveredIds: ['d-1', 'd-2'] },
        { scopeType: 'COMPANY', scopeId: 'c-1' },
        { scopeType: 'SELF', scopeId: null },
      ]),
      READ,
      '2026-11-18',
    );
    const ors = (where as { OR: unknown[] }).OR;
    expect(ors).toHaveLength(3);
    expect(JSON.stringify(ors[0])).toContain('"departmentId":{"in":["d-1","d-2"]}');
    expect(JSON.stringify(ors[1])).toContain('"companyId":"c-1"');
    expect(ors[2]).toEqual({ membershipId: 'm-1' });
  });
});

describe('helpers', () => {
  it('builds ABAC attributes only from present values', () => {
    expect(
      employeeAttributes({ companyId: 'c', branchId: null, departmentId: 'd', teamId: null }, 'u'),
    ).toEqual({ ownerUserId: 'u', companyId: 'c', departmentId: 'd' });
    expect(employeeAttributes(null, null)).toEqual({});
  });

  it('formats names, masks and dates', () => {
    expect(displayName({ firstName: 'Asha', lastName: 'Rao', preferredName: null })).toBe(
      'Asha Rao',
    );
    expect(displayName({ firstName: 'Ashwini', lastName: null, preferredName: 'Ash' })).toBe('Ash');
    expect(mask('1234', 8)).toBe('••••1234');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
