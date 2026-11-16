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
