import { type ApiErrorDetail, ErrorCode } from '@hrm/shared-types';

/** Normalised error thrown by the API client for every failure mode. */
export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];
  readonly requestId: string | undefined;

  constructor(params: {
    code: ErrorCode;
    message: string;
    status: number;
    details?: ApiErrorDetail[];
    requestId?: string | undefined;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details ?? [];
    this.requestId = params.requestId;
  }

  get isNetworkError(): boolean {
    return this.code === ErrorCode.NETWORK_ERROR;
  }
}
