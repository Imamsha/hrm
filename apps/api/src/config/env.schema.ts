import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const postgresUrl = z
  .url()
  .refine(
    (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
    'Must be a PostgreSQL URL',
  );

const redisUrl = z
  .url()
  .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), 'Must be a Redis URL');

/**
 * Environment contract for the API. Parsed once at boot; the process refuses to start
 * when anything is missing or malformed (fail fast, never run half-configured).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    API_PUBLIC_URL: z.url().default('http://localhost:3100'),
    CORS_ORIGINS: csv.default([]),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SWAGGER_ENABLED: bool.default(false),
    APP_VERSION: z.string().default('0.1.0'),

    DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    REDIS_URL: redisUrl,

    STORAGE_ENDPOINT: z.url(),
    STORAGE_REGION: z.string().min(1).default('us-east-1'),
    STORAGE_ACCESS_KEY: z.string().min(1),
    STORAGE_SECRET_KEY: z.string().min(8),
    STORAGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Invalid S3 bucket name'),
    STORAGE_FORCE_PATH_STYLE: bool.default(true),
    STORAGE_AUTO_CREATE_BUCKET: bool.default(false),

    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),

    /** Browser origin of the web app; used to build links in e-mails. */
    APP_WEB_URL: z.url().default('http://localhost:5180'),

    /** HMAC key for access/MFA tokens (HS256). At least 32 random bytes. */
    AUTH_JWT_SECRET: z.string().min(32, 'Use at least 32 characters'),
    AUTH_JWT_ISSUER: z.string().default('hrm-api'),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    AUTH_MFA_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    /** Absolute session lifetime; refresh-token rotation cannot extend past it. */
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(20).default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /** `Secure` attribute on the refresh cookie. Must be true behind HTTPS (enforced in production). */
    AUTH_COOKIE_SECURE: bool.default(false),
    AUTH_PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    AUTH_INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    /** Rate limit for credential endpoints (login, register, password reset), per minute per IP. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

    /** Base64-encoded 32-byte key for AES-256-GCM field encryption (e.g. MFA secrets). */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length === 32,
        'Must be base64 encoding exactly 32 bytes (openssl rand -base64 32)',
      ),

    /** Trial length for new organizations (business configuration, not a statutory value). */
    SUBSCRIPTION_TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(30),
    SUBSCRIPTION_DEFAULT_PLAN_KEY: z.string().default('trial'),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM: z.string().default('HRM Platform <no-reply@hrm.local>'),

    AI_PROVIDER: z.enum(['disabled', 'openai-compatible']).default('disabled'),
    AI_BASE_URL: z.string().default(''),
    AI_API_KEY: z.string().default(''),
    AI_CHAT_MODEL: z.string().default(''),
    AI_EMBEDDING_MODEL: z.string().default(''),
    AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(16000).default(1536),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'openai-compatible') {
      for (const key of ['AI_BASE_URL', 'AI_API_KEY', 'AI_CHAT_MODEL'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when AI_PROVIDER=openai-compatible`,
          });
        }
      }
      if (env.AI_BASE_URL && !z.url().safeParse(env.AI_BASE_URL).success) {
        ctx.addIssue({ code: 'custom', path: ['AI_BASE_URL'], message: 'Must be a URL' });
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.STORAGE_AUTO_CREATE_BUCKET) {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_AUTO_CREATE_BUCKET'],
          message: 'Buckets must be provisioned by infrastructure in production',
        });
      }
      if (env.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Wildcard CORS is not allowed in production',
        });
      }
      if (/_dev_only/.test(env.DATABASE_URL) || /_dev_only/.test(env.REDIS_URL)) {
        ctx.addIssue({
          code: 'custom',
          path: ['DATABASE_URL'],
          message: 'Development credentials detected in production',
        });
      }
      if (/dev[_-]only|change[_-]?me/i.test(env.AUTH_JWT_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_JWT_SECRET'],
          message: 'Development JWT secret detected in production',
        });
      }
      if (!env.AUTH_COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_COOKIE_SECURE'],
          message: 'Refresh cookies must be Secure in production',
        });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

/** Parses the environment, throwing one readable error listing every problem (values never echoed). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
