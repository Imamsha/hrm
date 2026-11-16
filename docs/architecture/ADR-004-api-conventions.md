# ADR-004: API conventions

- Status: Accepted (2026-11-16)

- **Base path / versioning:** global prefix `api`, URI versioning with default version `1` →
  `/api/v1/...`. Breaking changes ship as `/api/v2` alongside v1.
- **Success envelope:** `{ success: true, data, meta: { requestId, timestamp, pagination? } }`.
  Handlers returning `{ items, pagination }` are emitted with `data = items` and pagination in meta.
- **Error envelope:** `{ success: false, error: { code, message, details?: [{ path, message, code? }] }, meta }`.
  Codes are the stable `ErrorCode` set in `@hrm/shared-types`. 5xx responses use a generic message;
  details go to logs only.
- **Exceptions:** services throw `AppException` (code + status + details). The global filter is the
  only place that maps exceptions, including Throttler and body-parser errors.
- **Validation:** `ZodValidationPipe(schema)` with schemas from `@hrm/validation`; field errors use
  dot paths.
- **List endpoints:** `page`, `pageSize` (≤ 200), `sortBy` (identifier-safe), `sortDir`, `search`
  via `listQuerySchema`; sort fields are additionally allow-listed per endpoint.
- **Request IDs:** `X-Request-Id` accepted if `[A-Za-z0-9._:-]{8,64}`, otherwise generated; always
  echoed and included in `meta.requestId` and every log line.
- **Money:** decimal strings (`"1234.50"`), never JSON numbers. **Dates:** ISO-8601; calendar dates
  as `YYYY-MM-DD`; timestamps in UTC.
- **Docs:** Swagger UI at `/api/docs`, OpenAPI JSON at `/api/docs/openapi.json` (disabled unless
  `SWAGGER_ENABLED=true`).
- **Health:** `/health/live` (process), `/health` (always 200, `ok|degraded` report for dashboards),
  `/health/ready` (200/503 for orchestrators). Unauthenticated, no secrets.
