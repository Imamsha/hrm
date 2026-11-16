import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://hrm_app:pw@localhost:5434/hrm',
  REDIS_URL: 'redis://:pw@localhost:6380/0',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY: 'key',
  STORAGE_SECRET_KEY: 'secret-value',
  STORAGE_BUCKET: 'hrm-dev',
  AUTH_JWT_SECRET: 'a-sufficiently-long-test-secret-0123456789',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadConfig', () => {
  it('parses a minimal valid environment with defaults', () => {
    const cfg = loadConfig(base);
    expect(cfg.API_PORT).toBe(3100);
    expect(cfg.AI_PROVIDER).toBe('disabled');
    expect(cfg.SWAGGER_ENABLED).toBe(false);
  });

  it('parses CSV origins and booleans', () => {
    const cfg = loadConfig({
      ...base,
      CORS_ORIGINS: 'http://a.test, http://b.test',
      SWAGGER_ENABLED: 'true',
    });
    expect(cfg.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(cfg.SWAGGER_ENABLED).toBe(true);
  });

  it('lists every missing variable without echoing secret values', () => {
    expect(() => loadConfig({ STORAGE_SECRET_KEY: 'short' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL/,
    );
    try {
      loadConfig({ ...base, STORAGE_SECRET_KEY: 'tiny' });
    } catch (e) {
      expect((e as Error).message).not.toContain('tiny');
    }
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://x@y/z' })).toThrow(/PostgreSQL/);
  });

  it('requires provider settings when AI is enabled', () => {
    expect(() => loadConfig({ ...base, AI_PROVIDER: 'openai-compatible' })).toThrow(/AI_API_KEY/);
  });

  it('applies production safety rules', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', STORAGE_AUTO_CREATE_BUCKET: 'true' }),
    ).toThrow(/provisioned by infrastructure/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(
      /Wildcard/,
    );
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://hrm_app:app_dev_only@db/hrm',
      }),
    ).toThrow(/Development credentials/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/Secure in production/);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        AUTH_COOKIE_SECURE: 'true',
        AUTH_JWT_SECRET: 'jwt_secret_dev_only_change_me_0123456789',
      }),
    ).toThrow(/Development JWT secret/);
  });

  it('requires a 32-byte base64 encryption key and a long JWT secret', () => {
    expect(() =>
      loadConfig({ ...base, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/exactly 32 bytes/);
    expect(() => loadConfig({ ...base, AUTH_JWT_SECRET: 'short' })).toThrow(/32 characters/);
  });
});
