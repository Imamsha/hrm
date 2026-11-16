import type { ErrorCode } from './errors.js';

/** Metadata attached to every API response. */
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Successful response envelope. Every `/api/v1` endpoint returns this shape. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ResponseMeta & { pagination?: PaginationMeta };
}

export interface ApiErrorDetail {
  /** Dot-path to the offending field, e.g. `address.postalCode`. */
  path: string;
  message: string;
  code?: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: ApiErrorDetail[];
}

/** Error response envelope. */
export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type SortDirection = 'asc' | 'desc';

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}
