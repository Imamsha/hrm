import { describe, expect, it } from 'vitest';
import {
  bulkHolidaysSchema,
  calendarResolveQuerySchema,
  codeSchema,
  createLegalEntitySchema,
  createLocationSchema,
  createWorkWeekSchema,
  scopedRoleAssignmentSchema,
  updateBranchSchema,
} from './structure.js';

const company = '0195f1d2-0000-7000-8000-0000000000c1';

describe('codeSchema', () => {
  it('upper-cases and validates codes', () => {
    expect(codeSchema.parse(' blr-01 ')).toBe('BLR-01');
    expect(codeSchema.safeParse('has space').success).toBe(false);
    expect(codeSchema.safeParse('X'.repeat(21)).success).toBe(false);
  });
});

describe('legal entity identifiers (India)', () => {
  const base = { companyId: company, code: 'LE1', legalName: 'Acme India Private Limited' };

  it('accepts well-formed PAN, TAN, GSTIN and CIN and normalises case', () => {
    const v = createLegalEntitySchema.parse({
      ...base,
      pan: 'aaacr1234k',
      tan: 'BLRA12345C',
      gstin: '29AAACR1234K1Z5',
      cin: 'U72200KA2020PTC123456',
    });
    expect(v.pan).toBe('AAACR1234K');
  });

  it('rejects malformed identifiers', () => {
    expect(createLegalEntitySchema.safeParse({ ...base, pan: 'ABC123' }).success).toBe(false);
    expect(createLegalEntitySchema.safeParse({ ...base, tan: 'AAAAA1234A' }).success).toBe(false);
    expect(
      createLegalEntitySchema.safeParse({ ...base, cin: 'X72200KA2020PTC123456' }).success,
    ).toBe(false);
  });

  it('requires the GSTIN to embed the PAN', () => {
    const r = createLegalEntitySchema.safeParse({
      ...base,
      pan: 'AAACR1234K',
      gstin: '29BBBCR1234K1Z5',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['gstin']);
  });

  it('treats blank identifiers as cleared', () => {
    expect(createLegalEntitySchema.parse({ ...base, pan: '' }).pan).toBeNull();
  });
});

describe('locations', () => {
  const base = { code: 'BLR', name: 'Bengaluru HQ', addressLine1: '1 MG Road', city: 'Bengaluru' };
  it('validates coordinates as decimal strings and requires both', () => {
    expect(
      createLocationSchema.safeParse({ ...base, latitude: '12.971599', longitude: '77.594566' })
        .success,
    ).toBe(true);
    expect(createLocationSchema.safeParse({ ...base, latitude: '12.97' }).success).toBe(false);
    expect(
      createLocationSchema.safeParse({ ...base, latitude: '91', longitude: '0' }).success,
    ).toBe(false);
    expect(
      createLocationSchema.safeParse({ ...base, latitude: '1.1234567', longitude: '0' }).success,
    ).toBe(false);
  });
});

describe('branch updates', () => {
  it('clears optional references with empty strings', () => {
    expect(updateBranchSchema.parse({ workWeekId: '' })).toEqual({ workWeekId: null });
  });
});

describe('work weeks', () => {
  it('uses the shared work-week rules', () => {
    const ok = createWorkWeekSchema.safeParse({
      name: 'Mon-Sat alt',
      rules: [
        { weekday: 1, dayType: 'FULL' },
        { weekday: 6, dayType: 'FULL' },
        { weekday: 6, occurrence: 2, dayType: 'OFF' },
      ],
    });
    expect(ok.success).toBe(true);
    const dup = createWorkWeekSchema.safeParse({
      name: 'Dup',
      rules: [
        { weekday: 1, dayType: 'FULL' },
        { weekday: 1, dayType: 'HALF' },
      ],
    });
    expect(dup.success).toBe(false);
  });
});

describe('holidays and calendar queries', () => {
  it('rejects duplicate dates in a bulk upload', () => {
    const r = bulkHolidaysSchema.safeParse({
      holidays: [
        { date: '2026-01-26', name: 'A' },
        { date: '2026-01-26', name: 'B' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('requires an ordered range', () => {
    expect(
      calendarResolveQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success,
    ).toBe(false);
  });
});

describe('scoped role assignments', () => {
  const roleId = '0195f1d2-0000-7000-8000-0000000000a1';
  it('requires a scope id exactly for structural scopes', () => {
    expect(
      scopedRoleAssignmentSchema.safeParse({ roleId, scopeType: 'ORGANIZATION' }).success,
    ).toBe(true);
    expect(scopedRoleAssignmentSchema.safeParse({ roleId, scopeType: 'DEPARTMENT' }).success).toBe(
      false,
    );
    expect(
      scopedRoleAssignmentSchema.safeParse({ roleId, scopeType: 'DEPARTMENT', scopeId: company })
        .success,
    ).toBe(true);
    expect(
      scopedRoleAssignmentSchema.safeParse({ roleId, scopeType: 'ORGANIZATION', scopeId: company })
        .success,
    ).toBe(false);
  });
});
