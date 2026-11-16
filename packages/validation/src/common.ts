import { z } from 'zod';

export const uuidSchema = z.uuid();

/**
 * Optional trimmed string where an empty input means "not provided".
 * Prevents forms from persisting `""` instead of `null`.
 */
export const optionalText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const requiredText = (max = 255) => z.string().trim().min(1, 'Required').max(max);

export const MAX_PAGE_SIZE = 200;

/** Server-side pagination / sorting / search query used by every list endpoint. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  sortBy: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/, 'Invalid sort field')
    .max(64)
    .optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  search: z.string().trim().max(200).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/** ISO-8601 calendar date (YYYY-MM-DD) without time component. */
export const isoDateSchema = z.iso.date();

/** Decimal amount transported as a string to avoid floating point loss. */
export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Must be a decimal with up to 4 fraction digits');
