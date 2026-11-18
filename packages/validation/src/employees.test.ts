import { describe, expect, it } from 'vitest';
import {
  createBankAccountSchema,
  createEmployeeSchema,
  educationSchema,
  employeeSettingsSchema,
  formatEmployeeNumber,
  jobChangeSchema,
  separationSchema,
  statutoryIdsSchema,
  updateSelfSchema,
} from './employees.js';

const COMPANY = '0195f1d2-0000-7000-8000-000000000001';
const joining = {
  firstName: 'Asha',
  dateOfJoining: '2026-01-05',
  companyId: COMPANY,
  employmentType: 'FULL_TIME',
};

describe('createEmployeeSchema', () => {
  it('normalises blanks to null and leaves the number for generation', () => {
    const v = createEmployeeSchema.parse({
      ...joining,
      employeeNumber: '',
      lastName: '',
      workEmail: ' Asha@Acme.TEST ',
      departmentId: '',
      gender: '',
    });
    expect(v).toMatchObject({
      employeeNumber: undefined,
      lastName: null,
      workEmail: 'asha@acme.test',
      departmentId: null,
      gender: null,
    });
  });

  it('requires a company and employment type, and orders dates', () => {
    const r = createEmployeeSchema.safeParse({
      firstName: 'A',
      dateOfJoining: '2026-01-05',
      probationEndDate: '2026-01-01',
      dateOfBirth: '2026-02-01',
    });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['companyId', 'employmentType']));
    const dates = createEmployeeSchema.safeParse({
      ...joining,
      probationEndDate: '2026-01-01',
      dateOfBirth: '2026-02-01',
    });
    expect(dates.error?.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['probationEndDate', 'dateOfBirth']),
    );
  });

  it('treats a null employee number as "generate one" (forms send null for blanks)', () => {
    expect(
      createEmployeeSchema.parse({ ...joining, employeeNumber: null }).employeeNumber,
    ).toBeUndefined();
  });

  it('upper-cases manual employee numbers and rejects odd characters', () => {
    expect(
      createEmployeeSchema.parse({ ...joining, employeeNumber: 'emp/24-001' }).employeeNumber,
    ).toBe('EMP/24-001');
    expect(createEmployeeSchema.safeParse({ ...joining, employeeNumber: 'EMP 1' }).success).toBe(
      false,
    );
  });
});

describe('lifecycle schemas', () => {
  it('requires a change type and full placement for job changes', () => {
    expect(
      jobChangeSchema.safeParse({
        effectiveFrom: '2026-02-01',
        companyId: COMPANY,
        employmentType: 'FULL_TIME',
      }).success,
    ).toBe(false);
    expect(
      jobChangeSchema.safeParse({
        effectiveFrom: '2026-02-01',
        changeType: 'PROMOTION',
        companyId: COMPANY,
        employmentType: 'FULL_TIME',
      }).success,
    ).toBe(true);
    // Joining/rejoining are not job changes.
    expect(
      jobChangeSchema.safeParse({
        effectiveFrom: '2026-02-01',
        changeType: 'JOINING',
        companyId: COMPANY,
        employmentType: 'FULL_TIME',
      }).success,
    ).toBe(false);
  });

  it('keeps the last working day on or after the notice date', () => {
    const r = separationSchema.safeParse({
      separationType: 'RESIGNATION',
      resignationDate: '2026-03-01',
      lastWorkingDate: '2026-02-28',
    });
    expect(r.error?.issues[0]?.path).toEqual(['lastWorkingDate']);
  });
});

describe('India identifiers and banking', () => {
  it('validates IFSC and account numbers', () => {
    const ok = createBankAccountSchema.parse({
      accountHolderName: 'A',
      bankName: 'HDFC',
      ifsc: 'hdfc0001234',
      accountNumber: '50100012345678',
      accountType: 'SAVINGS',
    });
    expect(ok).toMatchObject({ ifsc: 'HDFC0001234', isPrimary: false });
    expect(createBankAccountSchema.safeParse({ ...ok, ifsc: 'HDFC1001234' }).success).toBe(false);
    expect(createBankAccountSchema.safeParse({ ...ok, accountNumber: '12' }).success).toBe(false);
  });

  it('validates PAN and UAN and allows clearing them', () => {
    expect(statutoryIdsSchema.parse({ pan: 'abcpe1234f', uan: '100200300400' })).toEqual({
      pan: 'ABCPE1234F',
      uan: '100200300400',
    });
    expect(statutoryIdsSchema.parse({ pan: '', uan: '' })).toEqual({ pan: null, uan: null });
    expect(statutoryIdsSchema.safeParse({ uan: '1234' }).success).toBe(false);
    expect(statutoryIdsSchema.safeParse({ pan: 'ABCDE12345' }).success).toBe(false);
  });
});

describe('other schemas', () => {
  it('formats employee numbers from settings', () => {
    expect(formatEmployeeNumber('EMP-', 4, 42)).toBe('EMP-0042');
    expect(formatEmployeeNumber('', 1, 12345)).toBe('12345');
    expect(
      employeeSettingsSchema.safeParse({ numberPrefix: '-X', numberPadding: 4, nextNumber: 1 })
        .success,
    ).toBe(false);
  });

  it('checks education year order and self-service fields', () => {
    expect(
      educationSchema.safeParse({
        qualification: 'B.E.',
        institution: 'X',
        startYear: 2015,
        endYear: 2014,
      }).success,
    ).toBe(false);
    // Unknown keys (e.g. names, job) are stripped from self-service updates.
    expect(updateSelfSchema.parse({ personalPhone: '+91 90000 00000', firstName: 'X' })).toEqual({
      personalPhone: '+91 90000 00000',
    });
  });
});
