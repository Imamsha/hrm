import { HttpStatus } from '@nestjs/common';
import { type ApiErrorDetail, ErrorCode } from '@hrm/shared-types';

/**
 * Domain-level exception carrying a stable error code. Services throw this (never raw
 * HttpExceptions) so the transport mapping stays in one place: the global exception filter.
 */
export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: HttpStatus,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'AppException';
  }

  static validation(details: ApiErrorDetail[], message = 'Request validation failed') {
    return new AppException(ErrorCode.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthenticated(message = 'Authentication required') {
    return new AppException(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }

  /** Validation-style rejection for a single field (e.g. wrong current password). */
  static badRequest(message: string, path?: string) {
    return new AppException(
      ErrorCode.VALIDATION_FAILED,
      message,
      HttpStatus.BAD_REQUEST,
      path ? [{ path, message }] : [],
    );
  }

  static tooManyRequests(message: string) {
    return new AppException(ErrorCode.RATE_LIMITED, message, HttpStatus.TOO_MANY_REQUESTS);
  }

  static notFound(entity: string) {
    return new AppException(ErrorCode.NOT_FOUND, `${entity} not found`, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppException(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static conflict(message: string) {
    return new AppException(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);
  }

  /** Conflict attributable to one field (e.g. duplicate code), so forms can highlight it. */
  static conflictOn(message: string, path: string) {
    return new AppException(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT, [{ path, message }]);
  }

  static tenantContextMissing() {
    return new AppException(
      ErrorCode.TENANT_CONTEXT_MISSING,
      'An organization context is required for this operation',
      HttpStatus.FORBIDDEN,
    );
  }

  static serviceUnavailable(message: string, details: ApiErrorDetail[] = []) {
    return new AppException(
      ErrorCode.SERVICE_UNAVAILABLE,
      message,
      HttpStatus.SERVICE_UNAVAILABLE,
      details,
    );
  }
}
