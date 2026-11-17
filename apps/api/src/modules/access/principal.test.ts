import type { Permission } from '@hrm/shared-types';
import { describe, expect, it } from 'vitest';
import { type AuthPrincipal, can, hasOrganizationWide, type ScopedGrant } from './principal.js';

function principal(grants: [Permission, ScopedGrant[]][]): AuthPrincipal {
  return {
    userId: 'u-1',
    sessionId: 's-1',
    organizationId: 'o-1',
    membershipId: 'm-1',
    grants: new Map(grants),
  };
}

const READ: Permission = 'users.member.read';

describe('ABAC can()', () => {
  it('denies permissions that are not granted', () => {
    expect(can(principal([]), READ)).toBe(false);
  });

  it('allows organization-wide grants for any resource', () => {
    const p = principal([[READ, [{ scopeType: 'ORGANIZATION', scopeId: null }]]]);
    expect(can(p, READ)).toBe(true);
    expect(can(p, READ, { ownerUserId: 'someone-else' })).toBe(true);
    expect(hasOrganizationWide(p, READ)).toBe(true);
  });

  it('limits SELF grants to resources owned by the caller', () => {
    const p = principal([[READ, [{ scopeType: 'SELF', scopeId: null }]]]);
    expect(can(p, READ, { ownerUserId: 'u-1' })).toBe(true);
    expect(can(p, READ, { ownerUserId: 'u-2' })).toBe(false);
    expect(can(p, READ)).toBe(false);
    expect(hasOrganizationWide(p, READ)).toBe(false);
  });

  it('covers a department and its expanded sub-departments only', () => {
    const p = principal([
      [READ, [{ scopeType: 'DEPARTMENT', scopeId: 'd-eng', coveredIds: ['d-eng', 'd-platform'] }]],
    ]);
    expect(can(p, READ, { departmentId: 'd-eng' })).toBe(true);
    expect(can(p, READ, { departmentId: 'd-platform' })).toBe(true);
    expect(can(p, READ, { departmentId: 'd-sales' })).toBe(false);
    expect(can(p, READ, { companyId: 'c-1' })).toBe(false); // attribute missing → deny
    expect(hasOrganizationWide(p, READ)).toBe(false);
  });

  it('matches company, branch and team scopes by attribute', () => {
    const p = principal([
      [
        READ,
        [
          { scopeType: 'COMPANY', scopeId: 'c-1' },
          { scopeType: 'BRANCH', scopeId: 'b-pune' },
          { scopeType: 'TEAM', scopeId: 't-qa' },
        ],
      ],
    ]);
    expect(can(p, READ, { companyId: 'c-1' })).toBe(true);
    expect(can(p, READ, { companyId: 'c-2', branchId: 'b-pune' })).toBe(true);
    expect(can(p, READ, { companyId: 'c-2', teamId: 't-qa' })).toBe(true);
    expect(can(p, READ, { companyId: 'c-2', branchId: 'b-delhi', teamId: 't-dev' })).toBe(false);
    expect(can(p, READ)).toBe(false);
  });
});
