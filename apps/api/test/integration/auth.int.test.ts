import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Api,
  api,
  login,
  OTHER_PASSWORD,
  registerAccount,
  STRONG_PASSWORD,
  startApp,
  tokenFromLink,
  totpCode,
  uniqueEmail,
  waitForEmail,
} from './helpers.js';

let app: NestExpressApplication;
let client: Api;

beforeAll(async () => {
  app = await startApp();
  client = api(app);
});

afterAll(async () => {
  await app.close();
});

describe('registration', () => {
  it('creates user, organization, system roles, owner membership and trial subscription', async () => {
    const owner = await registerAccount(client, 'Acme');
    const me = await client.get('/auth/me', owner.accessToken);
    expect(me.body.data.activeOrganization.roles.map((r: { key: string }) => r.key)).toEqual([
      'owner',
    ]);
    expect(me.body.data.permissions).toContain('roles.role.manage');

    const roles = await client.get('/roles', owner.accessToken);
    expect(roles.body.data.map((r: { key: string }) => r.key).sort()).toEqual(
      ['admin', 'client', 'employee', 'finance', 'hr_admin', 'manager', 'owner'].sort(),
    );
    const sub = await client.get('/organizations/current/subscription', owner.accessToken);
    expect(sub.body.data).toMatchObject({ planKey: 'trial', status: 'TRIALING' });
    const audit = await client.get('/audit-logs', owner.accessToken);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toContain(
      'organization.created',
    );
  });

  it('sets the refresh token only as an httpOnly SameSite=Strict cookie for browsers', async () => {
    const res = await client.post('/auth/register', {
      organizationName: 'Cookie Org',
      fullName: 'Cara Cookie',
      email: uniqueEmail('cookie'),
      password: STRONG_PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.refreshToken).toBeUndefined();
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toMatch(/hrm_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    const refreshed = await client
      .post('/auth/refresh', {})
      .set('Cookie', cookie.split(';')[0] ?? '');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
  });

  it('rejects duplicate e-mails and weak or personal passwords', async () => {
    const owner = await registerAccount(client);
    const dup = await client.post('/auth/register', {
      organizationName: 'Dup',
      fullName: 'Dup',
      email: owner.email,
      password: STRONG_PASSWORD,
    });
    expect(dup.status).toBe(409);
    const weak = await client.post('/auth/register', {
      organizationName: 'Weak',
      fullName: 'Weak',
      email: uniqueEmail('weak'),
      password: 'short',
    });
    expect(weak.status).toBe(400);
    const email = uniqueEmail('rajesh');
    const personal = await client.post('/auth/register', {
      organizationName: 'Personal',
      fullName: 'Rajesh Kumar',
      email,
      password: `${email.split('@')[0] ?? ''}-2026!`,
    });
    expect(personal.status).toBe(400);
  });
});

describe('login and lockout', () => {
  it('uses one generic error for unknown e-mails and wrong passwords', async () => {
    const owner = await registerAccount(client);
    const wrong = await login(client, owner.email, 'not-the-password-123');
    const unknown = await login(client, uniqueEmail('ghost'), 'not-the-password-123');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after repeated failures without revealing it', async () => {
    const owner = await registerAccount(client);
    for (let i = 0; i < 5; i++) await login(client, owner.email, `wrong-password-${String(i)}-xyz`);
    const locked = await login(client, owner.email, owner.password);
    expect(locked.status).toBe(401);
    expect(locked.body.error.message).toBe('Invalid email or password');

    const history = await client.get('/auth/login-history', owner.accessToken);
    expect(history.body.data.map((e: { type: string }) => e.type)).toContain('LOGIN_LOCKED');
  });
});

describe('sessions and refresh tokens', () => {
  it('rotates refresh tokens and revokes the session when an old token is reused', async () => {
    const owner = await registerAccount(client);
    const first = await client.post('/auth/refresh', { refreshToken: owner.refreshToken });
    expect(first.status).toBe(200);
    const rotated = first.body.data.refreshToken as string;
    expect(rotated).not.toBe(owner.refreshToken);

    const reuse = await client.post('/auth/refresh', { refreshToken: owner.refreshToken });
    expect(reuse.status).toBe(401);
    // The whole session is gone: the rotated token and the access token stop working.
    expect((await client.post('/auth/refresh', { refreshToken: rotated })).status).toBe(401);
    expect((await client.get('/auth/me', first.body.data.accessToken)).status).toBe(401);
  });

  it('logout ends the session immediately', async () => {
    const owner = await registerAccount(client);
    expect((await client.post('/auth/logout', {}, owner.accessToken)).status).toBe(204);
    expect((await client.get('/auth/me', owner.accessToken)).status).toBe(401);
    expect((await client.post('/auth/refresh', { refreshToken: owner.refreshToken })).status).toBe(
      401,
    );
  });

  it('lists and revokes own sessions', async () => {
    const owner = await registerAccount(client);
    const second = await login(client, owner.email, owner.password);
    const list = await client.get('/auth/sessions', owner.accessToken);
    expect(list.body.data).toHaveLength(2);
    const other = (list.body.data as { id: string; current: boolean }[]).find((s) => !s.current);
    expect(
      (await client.delete(`/auth/sessions/${other?.id ?? ''}`, owner.accessToken)).status,
    ).toBe(204);
    expect((await client.get('/auth/me', second.body.data.accessToken)).status).toBe(401);
    expect((await client.get('/auth/me', owner.accessToken)).status).toBe(200);
  });
});

describe('password recovery and change', () => {
  it('resets the password via the e-mailed link and revokes existing sessions', async () => {
    const owner = await registerAccount(client);
    const res = await client.post('/auth/password/forgot', { email: owner.email });
    expect(res.status).toBe(202);
    const mail = await waitForEmail(owner.email);
    expect(mail.subject).toMatch(/Reset your/);
    const token = tokenFromLink(mail.text, '/reset-password');

    expect(
      (await client.post('/auth/password/reset', { token, password: OTHER_PASSWORD })).status,
    ).toBe(204);
    expect((await client.get('/auth/me', owner.accessToken)).status).toBe(401);
    expect((await login(client, owner.email, OTHER_PASSWORD)).status).toBe(200);
    expect((await login(client, owner.email, STRONG_PASSWORD)).status).toBe(401);
    // Single use.
    expect(
      (await client.post('/auth/password/reset', { token, password: 'yet-another-pass-123' }))
        .status,
    ).toBe(400);
  });

  it('answers identically for unknown e-mails', async () => {
    const res = await client.post('/auth/password/forgot', { email: uniqueEmail('nobody') });
    expect(res.status).toBe(202);
  });

  it('changes the password, keeping the current session and ending the others', async () => {
    const owner = await registerAccount(client);
    const other = await login(client, owner.email, owner.password);
    const bad = await client.post(
      '/auth/password/change',
      { currentPassword: 'wrong-current-pass', newPassword: OTHER_PASSWORD },
      owner.accessToken,
    );
    expect(bad.status).toBe(400);
    const ok = await client.post(
      '/auth/password/change',
      { currentPassword: owner.password, newPassword: OTHER_PASSWORD },
      owner.accessToken,
    );
    expect(ok.status).toBe(204);
    expect((await client.get('/auth/me', owner.accessToken)).status).toBe(200);
    expect((await client.get('/auth/me', other.body.data.accessToken)).status).toBe(401);
  });
});

describe('TOTP multi-factor authentication', () => {
  it('enrols, challenges at login, accepts recovery codes and blocks code replay', async () => {
    const owner = await registerAccount(client);
    const setup = await client.post('/auth/mfa/totp/setup', {}, owner.accessToken);
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    expect(
      (await client.post('/auth/mfa/totp/enable', { code: '000000' }, owner.accessToken)).status,
    ).toBe(400);
    const code = totpCode(secret);
    const enabled = await client.post('/auth/mfa/totp/enable', { code }, owner.accessToken);
    expect(enabled.status).toBe(200);
    const recoveryCodes = enabled.body.data.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);

    const challenge = await login(client, owner.email, owner.password);
    expect(challenge.body.data).toMatchObject({ mfaRequired: true });
    const mfaToken = challenge.body.data.mfaToken as string;
    expect(challenge.body.data.accessToken).toBeUndefined();

    // The code already used for enrolment cannot be replayed.
    const replay = await client.post('/auth/mfa/verify', {
      mfaToken,
      code,
      tokenTransport: 'body',
    });
    expect(replay.status).toBe(401);

    const viaRecovery = await client.post('/auth/mfa/verify', {
      mfaToken,
      recoveryCode: recoveryCodes[0],
      tokenTransport: 'body',
    });
    expect(viaRecovery.status).toBe(200);
    expect(viaRecovery.body.data.accessToken).toBeTruthy();

    // Recovery codes are single use.
    const again = await login(client, owner.email, owner.password);
    const reused = await client.post('/auth/mfa/verify', {
      mfaToken: again.body.data.mfaToken,
      recoveryCode: recoveryCodes[0],
      tokenTransport: 'body',
    });
    expect(reused.status).toBe(401);

    const disabled = await client.post(
      '/auth/mfa/totp/disable',
      { password: owner.password, code: totpCode(secret, 1) },
      owner.accessToken,
    );
    expect(disabled.status).toBe(204);
    expect((await login(client, owner.email, owner.password)).body.data.accessToken).toBeTruthy();
  });

  it('stores the TOTP secret encrypted, never in plaintext', async () => {
    const owner = await registerAccount(client);
    const setup = await client.post('/auth/mfa/totp/setup', {}, owner.accessToken);
    const { PrismaService } = await import('../../src/infrastructure/database/prisma.service.js');
    const prisma = app.get(PrismaService);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(row.mfaSecretEncrypted).toMatch(/^v1:/);
    expect(row.mfaSecretEncrypted).not.toContain(setup.body.data.secret as string);
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe('credential endpoint rate limiting', () => {
  it('returns 429 after AUTH_RATE_LIMIT_MAX attempts per minute', async () => {
    const limited = await startApp({ AUTH_RATE_LIMIT_MAX: '3' });
    try {
      const c = api(limited);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++)
        statuses.push((await login(c, uniqueEmail('rl'), 'whatever-password')).status);
      expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
      expect(statuses[3]).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
