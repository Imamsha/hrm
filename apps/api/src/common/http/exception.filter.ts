import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { type ApiErrorDetail, type ApiFailure, ErrorCode } from '@hrm/shared-types';
import type { Response } from 'express';
import { RequestContext } from '../context/request-context.js';
import { AppException } from './app.exception.js';

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return ErrorCode.VALIDATION_FAILED;
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED;
  }
}

/** Normalises any thrown value into `{ status, body }` using the shared error envelope. */
export function toErrorResponse(exception: unknown): {
  status: number;
  code: ErrorCode;
  message: string;
  details: ApiErrorDetail[];
} {
  if (exception instanceof AppException) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }
  if (exception instanceof ThrottlerException) {
    return {
      status: 429,
      code: ErrorCode.RATE_LIMITED,
      message: 'Too many requests, please retry later',
      details: [],
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    const raw = typeof res === 'string' ? res : (res as { message?: unknown }).message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : exception.message;
    return { status, code: codeForStatus(status), message, details: [] };
  }
  // Body-parser errors (malformed JSON, payload too large) arrive as plain errors with a status.
  const maybe = exception as { status?: unknown; type?: unknown } | null;
  if (maybe && typeof maybe.status === 'number' && maybe.status >= 400 && maybe.status < 500) {
    const message =
      maybe.type === 'entity.too.large' ? 'Request payload is too large' : 'Malformed request body';
    return { status: maybe.status, code: codeForStatus(maybe.status), message, details: [] };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
    details: [],
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, code, message, details } = toErrorResponse(exception);

    if (status >= 500) {
      // Full detail goes to logs only; clients receive a generic message.
      this.logger.error({ err: exception, code }, 'Unhandled request error');
    }

    const body: ApiFailure = {
      success: false,
      error: { code, message, ...(details.length ? { details } : {}) },
      meta: {
        requestId: RequestContext.requestId() ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };
    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
