import { z } from 'zod';

const dependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});

/** Runtime validation for the readiness report, used by clients to verify API responses. */
export const healthReportSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.object({
    database: dependencyHealthSchema,
    redis: dependencyHealthSchema,
    storage: dependencyHealthSchema,
    queue: dependencyHealthSchema,
  }),
});
