import { decodeJwt, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/env.schema.js';
import { FieldEncryption } from './field-encryption.service.js';
import {
  constantTimeEqual,
  generateOpaqueToken,
  generateRecoveryCodes,
  sha256Hex,
} from './opaque-token.js';
import { PasswordHasher } from './password-hasher.service.js';
import { TokenService } from './token.service.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://u:p@localhost:5434/hrm',
  REDIS_URL: 'redis://localhost:6380',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY: 'k',
  STORAGE_SECRET_KEY: 'secretsecret',
  STORAGE_BUCKET: 'hrm-test',
  AUTH_JWT_SECRET: 'unit-test-secret-unit-test-secret-0123',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
});

describe('PasswordHasher (argon2id)', () => {
  const hasher = new PasswordHasher();
  beforeAll(async () => {
    await hasher.onModuleInit();
  });

  it('hashes with argon2id and verifies', async () => {
    const h = await hasher.hash('correct horse battery');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h).toContain('m=19456,t=2,p=1');
    await expect(hasher.verify(h, 'correct horse battery')).resolves.toBe(true);
    await expect(hasher.verify(h, 'wrong horse battery')).resolves.toBe(false);
  });

  it('never throws on malformed hashes', async () => {
    await expect(hasher.verify('not-a-hash', 'x')).resolves.toBe(false);
    await expect(hasher.verifyDummy('x')).resolves.toBe(false);
  });
});

describe('opaque tokens', () => {
  it('generates 256-bit url-safe tokens and stable SHA-256 digests', () => {
    const t = generateOpaqueToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueToken()).not.toBe(t);
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(constantTimeEqual('a', 'a')).toBe(true);
    expect(constantTimeEqual('a', 'ab')).toBe(false);
  });

  it('generates unique, well-formed recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });
});

describe('FieldEncryption (AES-256-GCM)', () => {
  const enc = new FieldEncryption(config);

  it('round-trips with a random IV per call', () => {
    const a = enc.encrypt('JBSWY3DPEHPK3PXP', 'users.mfa_secret:u1');
    const b = enc.encrypt('JBSWY3DPEHPK3PXP', 'users.mfa_secret:u1');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(enc.decrypt(a, 'users.mfa_secret:u1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects tampering and context swaps', () => {
    const a = enc.encrypt('secret', 'users.mfa_secret:u1');
    expect(() => enc.decrypt(a, 'users.mfa_secret:u2')).toThrow();
    const parts = a.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => enc.decrypt(parts.join(':'), 'users.mfa_secret:u1')).toThrow();
  });
});

describe('TokenService', () => {
  const tokens = new TokenService(config);

  it('issues access tokens with session and organization claims', async () => {
    const jwt = await tokens.signAccessToken({ sub: 'u1', sid: 's1', org: 'o1' });
    expect(await tokens.verifyAccessToken(jwt)).toEqual({ sub: 'u1', sid: 's1', org: 'o1' });
    const decoded = decodeJwt(jwt);
    expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(900);
  });

  it('keeps MFA tokens and access tokens non-interchangeable', async () => {
    const mfa = await tokens.signMfaToken({ sub: 'u1' });
    await expect(tokens.verifyAccessToken(mfa)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const access = await tokens.signAccessToken({ sub: 'u1', sid: 's1' });
    await expect(tokens.verifyMfaToken(access)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects tokens signed with another key or algorithm', async () => {
    const forged = await new SignJWT({ sid: 's1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuer('hrm-api')
      .setAudience('hrm-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('another-secret-another-secret-0123456'));
    await expect(tokens.verifyAccessToken(forged)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      '{"sub":"u1","sid":"s1"}',
    ).toString('base64url')}.`;
    await expect(tokens.verifyAccessToken(unsigned)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('reports expiry distinctly', async () => {
    const expired = await new SignJWT({ sid: 's1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setIssuer('hrm-api')
      .setAudience('hrm-api')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(config.AUTH_JWT_SECRET));
    await expect(tokens.verifyAccessToken(expired)).rejects.toMatchObject({
      message: 'Token expired',
    });
  });
});
