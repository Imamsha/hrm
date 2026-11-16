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

## Health (Phase 01)

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

## Authentication (Phase 02)

Authenticated requests send `Authorization: Bearer <accessToken>` (15-minute JWT). Browsers keep
the refresh token in the `hrm_rt` httpOnly cookie (send requests with `credentials: include`);
mobile clients pass `"tokenTransport": "body"` and receive `refreshToken` in the body.
Details: [ADR-008](architecture/ADR-008-authentication-and-sessions.md).

| Method | Path                               | Body                                                                              | Success                                               | Notes                                                                                                |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST   | `/auth/register`                   | `organizationName, fullName, email, password, organizationSlug?, tokenTransport?` | 201 `AuthTokens`                                      | creates user, organization, system roles, owner membership, trial subscription; 409 if e-mail exists |
| POST   | `/auth/login`                      | `email, password, organizationId?, tokenTransport?`                               | 200 `AuthTokens` or `{ mfaRequired: true, mfaToken }` | generic 401 for unknown e-mail / wrong password / locked                                             |
| POST   | `/auth/mfa/verify`                 | `mfaToken` + `code` or `recoveryCode`, `tokenTransport?`                          | 200 `AuthTokens`                                      | max 5 attempts per challenge                                                                         |
| POST   | `/auth/refresh`                    | `refreshToken?` (mobile)                                                          | 200 `AuthTokens`                                      | rotates the refresh token; reuse → 401 + session revoked                                             |
| POST   | `/auth/logout`, `/auth/logout-all` | —                                                                                 | 204                                                   | clears cookie                                                                                        |
| GET    | `/auth/me`                         | —                                                                                 | 200 `SessionInfo`                                     | user, memberships, active organization, effective permissions                                        |
| POST   | `/auth/switch-organization`        | `organizationId`                                                                  | 200 `AuthTokens` (access only)                        | 403 without membership                                                                               |
| POST   | `/auth/password/forgot`            | `email`                                                                           | 202                                                   | identical for unknown e-mails                                                                        |
| POST   | `/auth/password/reset`             | `token, password`                                                                 | 204                                                   | revokes all sessions                                                                                 |
| POST   | `/auth/password/change`            | `currentPassword, newPassword`                                                    | 204                                                   | revokes other sessions                                                                               |
| POST   | `/auth/mfa/totp/setup`             | —                                                                                 | 200 `{ secret, otpauthUri }`                          |                                                                                                      |
| POST   | `/auth/mfa/totp/enable`            | `code`                                                                            | 200 `{ recoveryCodes }`                               | codes shown once                                                                                     |
| POST   | `/auth/mfa/totp/disable`           | `password, code`                                                                  | 204                                                   |                                                                                                      |
| GET    | `/auth/sessions`                   | —                                                                                 | 200 `SessionListItem[]`                               | own active devices                                                                                   |
| DELETE | `/auth/sessions/:id`               | —                                                                                 | 204                                                   | own sessions only                                                                                    |
| GET    | `/auth/login-history`              | —                                                                                 | 200 `AuthEventItem[]`                                 | last 50 security events                                                                              |

## Organization, members, roles, audit (Phase 02)

Permissions per endpoint: [RBAC_MATRIX.md](RBAC_MATRIX.md).

| Method         | Path                                  | Body / query                                                                               | Success                                                                 |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| GET / PATCH    | `/organizations/current`              | PATCH: any of `name, legalName, defaultTimezone, defaultCurrency, defaultLocale`           | 200 `OrganizationDetails` (field-level audit entry)                     |
| POST           | `/organizations`                      | `name, slug?`                                                                              | 201 `{ organization, accessToken, expiresIn }` (new org becomes active) |
| GET            | `/organizations/current/subscription` | —                                                                                          | 200 `SubscriptionDetails`                                               |
| GET            | `/members`                            | `page, pageSize, sortBy (fullName/email/joinedAt/status), sortDir, search, status, roleId` | 200 paginated `MemberListItem[]`                                        |
| PATCH          | `/members/:membershipId`              | `status: ACTIVE                                                                            | SUSPENDED`                                                              | 200 `MemberListItem` |
| PUT            | `/members/:membershipId/roles`        | `roleIds[]`                                                                                | 200 `MemberListItem`                                                    |
| DELETE         | `/members/:membershipId`              | —                                                                                          | 204                                                                     |
| POST           | `/invitations`                        | `email, fullName?, roleIds[]`                                                              | 201 `InvitationItem` (e-mail sent)                                      |
| GET            | `/invitations`                        | —                                                                                          | 200 pending `InvitationItem[]`                                          |
| DELETE         | `/invitations/:id`                    | —                                                                                          | 204                                                                     |
| GET            | `/invitations/preview?token=`         | —                                                                                          | 200 `InvitationPreview` (public)                                        |
| POST           | `/invitations/accept`                 | `token, fullName?, password?, tokenTransport?`                                             | 200 `{ organizationId, accessToken? }`                                  |
| GET            | `/permissions`                        | —                                                                                          | 200 `PermissionCatalogItem[]`                                           |
| GET / POST     | `/roles`                              | POST: `key, name, description?, permissions[]`                                             | 200 `RoleDetails[]` / 201 `RoleDetails`                                 |
| PATCH / DELETE | `/roles/:id`                          | PATCH: `name?, description?, permissions?`                                                 | 200 / 204 (system roles: 403; assigned: 409)                            |
| GET            | `/audit-logs`                         | `page, pageSize, sortDir, search, action, actorId, from, to`                               | 200 paginated `AuditLogItem[]`                                          |

Paginated responses carry `meta.pagination`; the client helper `api.getPage<T>(path)` returns
`{ items, pagination }`.

## Planned (per roadmap)

Phase 03 adds companies, legal entities, branches, departments, teams, designations, job grades,
locations and holiday calendars. Later phases add the module routes listed in
`MASTER_PROJECT_INSTRUCTIONS.md` §8.
