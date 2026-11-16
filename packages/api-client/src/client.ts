import {
  type ApiFailure,
  type ApiResponse,
  type ApiSuccess,
  type PaginatedResult,
  ErrorCode,
  type HealthReport,
  type LivenessReport,
} from '@hrm/shared-types';
import { healthReportSchema } from '@hrm/validation';
import { ApiClientError } from './error.js';

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Do not attempt `onUnauthorized` recovery (used by the auth endpoints themselves). */
  skipAuthRefresh?: boolean;
}

export interface ApiClientConfig {
  /** Absolute API origin + prefix, e.g. `http://localhost:3100/api/v1`. */
  baseUrl: string;
  /** Returns the current access token, if any. Called per request. */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Injectable fetch (tests, React Native polyfills). */
  fetch?: typeof fetch;
  /** `include` lets browsers send the httpOnly refresh cookie cross-origin to the API. */
  credentials?: RequestCredentials;
  /**
   * Called once when a request fails with 401. Resolve `true` after obtaining a new access token
   * (e.g. via refresh) to retry the request once; `false` to surface the 401.
   */
  onUnauthorized?: () => Promise<boolean>;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function isFailure(body: unknown): body is ApiFailure {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { success?: unknown }).success === false &&
    typeof (body as { error?: unknown }).error === 'object'
  );
}

function statusToCode(status: number): ErrorCode {
  if (status === 401) return ErrorCode.UNAUTHENTICATED;
  if (status === 403) return ErrorCode.FORBIDDEN;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 409) return ErrorCode.CONFLICT;
  if (status === 429) return ErrorCode.RATE_LIMITED;
  if (status === 503) return ErrorCode.SERVICE_UNAVAILABLE;
  if (status >= 400 && status < 500) return ErrorCode.VALIDATION_FAILED;
  return ErrorCode.INTERNAL_ERROR;
}

export function createApiClient(config: ApiClientConfig) {
  // Resolve the global fetch lazily so polyfills / instrumentation installed after client creation are honoured.
  const fetchImpl: typeof fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = config.timeoutMs ?? 15_000;

  /** Full success envelope (data + meta), with one refresh-and-retry on 401. */
  async function requestEnvelope<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiSuccess<T> | undefined> {
    try {
      return await send<T>(method, path, options);
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.status === 401 &&
        !options.skipAuthRefresh &&
        config.onUnauthorized &&
        (await config.onUnauthorized())
      ) {
        return send<T>(method, path, options);
      }
      throw err;
    }
  }

  async function request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return (await requestEnvelope<T>(method, path, options))?.data as T;
  }

  /** List endpoints: items plus server pagination from `meta.pagination`. */
  async function getPage<T>(
    path: string,
    options: Omit<RequestOptions, 'body'> = {},
  ): Promise<PaginatedResult<T>> {
    const envelope = await requestEnvelope<T[]>('GET', path, options);
    const pagination = envelope?.meta.pagination;
    if (!envelope || !pagination) {
      throw new ApiClientError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Expected a paginated response',
        status: 200,
      });
    }
    return { items: envelope.data, pagination };
  }

  async function send<T>(
    method: string,
    path: string,
    options: RequestOptions,
  ): Promise<ApiSuccess<T> | undefined> {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = await config.getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    const onAbort = () => {
      controller.abort();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(config.baseUrl, path, options.query), {
        method,
        headers,
        body: options.body === undefined ? null : JSON.stringify(options.body),
        signal: controller.signal,
        ...(config.credentials ? { credentials: config.credentials } : {}),
      });
    } catch (cause) {
      const aborted = controller.signal.aborted && !options.signal?.aborted;
      throw new ApiClientError({
        code: ErrorCode.NETWORK_ERROR,
        status: 0,
        message: aborted ? `Request timed out after ${timeoutMs}ms` : 'Unable to reach the server',
        details: cause instanceof Error ? [{ path: '', message: cause.message }] : [],
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;
    const text = await response.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }

    if (isFailure(body)) {
      throw new ApiClientError({
        code: body.error.code,
        message: body.error.message,
        status: response.status,
        details: body.error.details ?? [],
        requestId: body.meta.requestId,
      });
    }
    if (!response.ok) {
      throw new ApiClientError({
        code: statusToCode(response.status),
        message: `Request failed with status ${response.status}`,
        status: response.status,
        requestId,
      });
    }
    // 204 No Content (logout, deletes): nothing to unwrap.
    if (response.status === 204 || !text) return undefined;
    const envelope = body as ApiResponse<T> | undefined;
    if (!envelope?.success) {
      throw new ApiClientError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Malformed response from server',
        status: response.status,
        requestId,
      });
    }
    return envelope;
  }

  return {
    request,
    getPage,
    get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
      request<T>('GET', path, options),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('POST', path, { ...options, body }),
    put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('PUT', path, { ...options, body }),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>('PATCH', path, { ...options, body }),
    delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),

    health: {
      /** Process liveness. */
      live: (signal?: AbortSignal) =>
        request<LivenessReport>('GET', '/health/live', signal ? { signal } : {}),
      /**
       * Full dependency report. Always HTTP 200 (status `ok` | `degraded`) so dashboards can
       * render partial outages; `/health/ready` is the 200/503 probe for orchestrators.
       * The payload is validated at runtime to detect client/server contract drift.
       */
      report: async (signal?: AbortSignal): Promise<HealthReport> => {
        const data = await request<unknown>('GET', '/health', signal ? { signal } : {});
        const parsed = healthReportSchema.safeParse(data);
        if (!parsed.success) {
          throw new ApiClientError({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Health report does not match the expected contract',
            status: 200,
          });
        }
        return parsed.data;
      },
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
