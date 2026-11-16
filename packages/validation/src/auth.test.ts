import { describe, expect, it } from 'vitest';
import {
  createRoleSchema,
  inviteMemberSchema,
  localeSchema,
  timezoneSchema,
  updateOrganizationSchema,
} from './access.js';
import {
  changePasswordSchema,
  emailSchema,
  loginSchema,
  mfaVerifySchema,
  passwordSchema,
  registerSchema,
} from './auth.js';

describe('emailSchema', () => {
  it('normalises case and whitespace', () => {
    expect(emailSchema.parse('  Asha.R@Example.COM ')).toBe('asha.r@example.com');
  });
  it('rejects invalid addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('requires 12+ characters', () => {
    expect(passwordSchema.safeParse('short-pass1').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });
  it('rejects repetitive passwords and surrounding spaces', () => {
    expect(passwordSchema.safeParse('aaaaaaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse(' leading-space-pass').success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('defaults the token transport to cookie', () => {
    const v = registerSchema.parse({
      organizationName: 'Acme',
      fullName: 'Asha Rao',
      email: 'asha@acme.test',
      password: 'correct horse battery',
    });
    expect(v.tokenTransport).toBe('cookie');
  });
});

describe('loginSchema', () => {
  it('accepts legacy passwords (no policy on login)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});

describe('mfaVerifySchema', () => {
  it('requires exactly one of code / recoveryCode', () => {
    expect(mfaVerifySchema.safeParse({ mfaToken: 't' }).success).toBe(false);
    expect(mfaVerifySchema.safeParse({ mfaToken: 't', code: '123456' }).success).toBe(true);
    expect(mfaVerifySchema.safeParse({ mfaToken: 't', recoveryCode: 'abcde-12345' }).success).toBe(
      true,
    );
    expect(
      mfaVerifySchema.safeParse({ mfaToken: 't', code: '123456', recoveryCode: 'abcde-12345' })
        .success,
    ).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('rejects reusing the current password', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'correct horse battery',
      newPassword: 'correct horse battery',
    });
    expect(r.success).toBe(false);
  });
});

describe('organization settings', () => {
  it('validates time zones and locales with Intl', () => {
    expect(timezoneSchema.safeParse('Asia/Kolkata').success).toBe(true);
    expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
    expect(localeSchema.safeParse('en-IN').success).toBe(true);
    expect(localeSchema.safeParse('not a locale').success).toBe(false);
  });
  it('requires at least one field and upper-cases currency', () => {
    expect(updateOrganizationSchema.safeParse({}).success).toBe(false);
    expect(updateOrganizationSchema.parse({ defaultCurrency: 'inr' })).toEqual({
      defaultCurrency: 'INR',
    });
  });
});

describe('roles and invitations', () => {
  it('rejects unknown permissions and de-duplicates', () => {
    expect(
      createRoleSchema.safeParse({ key: 'auditor', name: 'Auditor', permissions: ['x.y.z'] })
        .success,
    ).toBe(false);
    const v = createRoleSchema.parse({
      key: 'auditor',
      name: 'Auditor',
      permissions: ['audit.log.read', 'audit.log.read'],
    });
    expect(v.permissions).toEqual(['audit.log.read']);
  });
  it('requires at least one role on invitations', () => {
    expect(inviteMemberSchema.safeParse({ email: 'a@b.co', roleIds: [] }).success).toBe(false);
  });
});
