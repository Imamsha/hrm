# API documentation

Base URL: `http://localhost:3100/api/v1` (dev). Interactive docs: `/api/docs` (Swagger UI),
OpenAPI JSON: `/api/docs/openapi.json` — enabled when `SWAGGER_ENABLED=true`.
Conventions: [ADR-004](architecture/ADR-004-api-conventions.md).

## Response format

```jsonc
// success
{ "success": true, "data": { … }, "meta": { "requestId": "…", "timestamp": "2026-11-16T07:25:40.970Z" } }
// paginated success
{ "success": true, "data": [ … ], "meta": { "requestId": "…", "timestamp": "…",
  "pagination": { "page": 1, "pageSize": 25, "total": 240, "totalPages": 10 } } }
// error
{ "success": false,
  "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed",
             "details": [ { "path": "email", "message": "Invalid email", "code": "invalid_format" } ] },
  "meta": { "requestId": "…", "timestamp": "…" } }
```

Error codes: `VALIDATION_FAILED` 400 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 ·
`TENANT_CONTEXT_MISSING` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `PAYLOAD_TOO_LARGE` 413 ·
`RATE_LIMITED` 429 · `INTERNAL_ERROR` 500 · `SERVICE_UNAVAILABLE` 503 (`NETWORK_ERROR` is client-side only).

Headers: `X-Request-Id` (optional in, always out) · `Authorization: Bearer` (Phase 02).
Limits: JSON/urlencoded body ≤ 1 MB; default rate limit 300 requests / 60 s per client
(`RATE_LIMIT_*`); health endpoints are exempt.

## Endpoints (Phase 01)

| Method | Path            | Auth | Description                                  | Responses                                                                                       |
| ------ | --------------- | ---- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET    | `/health/live`  | none | Process liveness                             | 200 `{ status: "ok", uptimeSeconds }`                                                           |
| GET    | `/health`       | none | Dependency report for dashboards             | 200 `HealthReport` (`status: ok \| degraded`)                                                   |
| GET    | `/health/ready` | none | Readiness for load balancers / orchestrators | 200 `HealthReport`; 503 `SERVICE_UNAVAILABLE` with `details[{ path: "<dependency>", message }]` |

`HealthReport`:

```jsonc
{
  "status": "ok",
  "version": "0.1.0",
  "environment": "development",
  "uptimeSeconds": 42,
  "checks": {
    "database": { "status": "up", "latencyMs": 2 },
    "redis": { "status": "up", "latencyMs": 1 },
    "storage": { "status": "down", "latencyMs": 107, "error": "ECONNREFUSED" },
    "queue": { "status": "up", "latencyMs": 3 },
  },
}
```

Probe errors are short codes only (never hostnames, URLs or credentials). Each probe times out
after 3 s. `queue` is up when Redis answers and at least one BullMQ worker is attached.

## Client usage

```ts
import { createApiClient } from '@hrm/api-client';
const api = createApiClient({ baseUrl: 'http://localhost:3100/api/v1', getAccessToken });
const report = await api.health.report(); // runtime-validated against the contract
const page = await api.get<Employee[]>('/employees', { query: { page: 2 } }); // Phase 04
```

All failures throw `ApiClientError { code, status, message, details, requestId }`.

## Planned (per roadmap)

Phase 02: `/auth/*`, `/users`, `/organizations`, `/memberships`, `/roles`, `/permissions`,
`/sessions`. Later phases add the module routes listed in `MASTER_PROJECT_INSTRUCTIONS.md` §8.
