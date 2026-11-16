import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiSuccess, PaginatedResult } from '@hrm/shared-types';
import { map, type Observable } from 'rxjs';
import { RequestContext } from '../context/request-context.js';

function isPaginated(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { items?: unknown }).items) &&
    typeof (value as { pagination?: unknown }).pagination === 'object'
  );
}

/**
 * Wraps every successful handler result in the standard `{ success, data, meta }` envelope.
 * Paginated results (`{ items, pagination }`) expose `items` as `data` and move pagination to meta.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown>> {
    return next.handle().pipe(
      map((value: unknown) => {
        const meta = {
          requestId: RequestContext.requestId() ?? 'unknown',
          timestamp: new Date().toISOString(),
        };
        if (isPaginated(value)) {
          return {
            success: true as const,
            data: value.items,
            meta: { ...meta, pagination: value.pagination },
          };
        }
        return { success: true as const, data: value ?? null, meta };
      }),
    );
  }
}
