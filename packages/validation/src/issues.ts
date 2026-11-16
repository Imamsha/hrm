import type { ApiErrorDetail } from '@hrm/shared-types';
import type { z } from 'zod';

/** Converts Zod issues into the API's stable error detail format. */
export function toErrorDetails(error: z.ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}
