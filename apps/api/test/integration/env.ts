import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type AppConfig, loadConfig } from '../../src/config/env.schema.js';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Defaults match docker-compose.yml so `pnpm infra:up && pnpm test:integration` works without a .env. */
export const testEnv = {
  databaseUrl:
    process.env.TEST_DATABASE_URL ??
    'postgresql://hrm_app:app_dev_only@localhost:5434/hrm_test?schema=public',
  migrationDatabaseUrl:
    process.env.TEST_MIGRATION_DATABASE_URL ??
    'postgresql://hrm_migrator:migrator_dev_only@localhost:5434/hrm_test?schema=public',
  redisUrl: process.env.TEST_REDIS_URL ?? 'redis://:redis_dev_only@localhost:6380/1',
  bucket: process.env.TEST_STORAGE_BUCKET ?? 'hrm-test',
  /** Mailpit HTTP API used to read e-mails sent by the API (password reset, invitations). */
  mailpitUrl: process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025',
};

export function integrationConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SWAGGER_ENABLED: 'true',
    DATABASE_URL: testEnv.databaseUrl,
    DATABASE_POOL_MAX: '4',
    REDIS_URL: testEnv.redisUrl,
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
    STORAGE_ACCESS_KEY: process.env.STORAGE_ACCESS_KEY ?? 'hrm_storage_dev',
    STORAGE_SECRET_KEY: process.env.STORAGE_SECRET_KEY ?? 'hrm_storage_dev_secret',
    STORAGE_BUCKET: testEnv.bucket,
    STORAGE_AUTO_CREATE_BUCKET: 'true',
    CORS_ORIGINS: 'http://localhost:5180',
    AUTH_JWT_SECRET: 'integration-test-jwt-secret-0123456789abcdef',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
    // Suites log in many times from one IP; throttling has its own dedicated test.
    AUTH_RATE_LIMIT_MAX: '10000',
    RATE_LIMIT_MAX: '10000',
    SMTP_HOST: process.env.SMTP_HOST ?? 'localhost',
    SMTP_PORT: process.env.SMTP_PORT ?? '1025',
    APP_WEB_URL: 'http://localhost:5180',
    ...overrides,
  });
}
