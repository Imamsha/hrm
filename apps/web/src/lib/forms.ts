import { ApiClientError } from '@hrm/api-client';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { errorMessage } from './api';

/**
 * Maps API validation details onto form fields. Returns the message to show as a form-level
 * error when it could not be attributed to a field (or null when every detail was mapped).
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (error instanceof ApiClientError && error.details.length > 0) {
    let unmapped = false;
    for (const d of error.details) {
      const field = fields.find((f) => f === d.path);
      if (field) setError(field, { type: 'server', message: d.message });
      else unmapped = true;
    }
    return unmapped ? error.message : null;
  }
  return errorMessage(error);
}
