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

## Organization structure (Phase 03)

Permissions per endpoint: [RBAC_MATRIX.md](RBAC_MATRIX.md). Every write is audited
(`company.created`, `branch.updated`, …). Shared Zod schemas: `@hrm/validation` (`structure.ts`);
transport types: `@hrm/shared-types` (`structure.ts`).

Standard resources — each supports `GET /<resource>` (paginated), `GET /<resource>/:id`,
`POST`, `PATCH /:id` (partial; `status: ACTIVE | INACTIVE` archives) and `DELETE /:id`:

| Resource          | Create body (required in bold)                                                                                                                   | List filters / sort keys                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `/companies`      | **code, name**, countryCode (default IN), defaultCurrency, timezone                                                                              | `status`, `search`; sort `code, name, status`                        |
| `/legal-entities` | **companyId, code, legalName**, countryCode, pan, tan, gstin, cin (India only; GSTIN must contain PAN), registrationNumber, registeredLocationId | `companyId`; sort `code, name`                                       |
| `/locations`      | **code, name, addressLine1, city**, addressLine2, state, postalCode, countryCode, timezone, latitude + longitude (decimal strings, both or none) | sort `code, name, city`                                              |
| `/branches`       | **companyId, code, name**, legalEntityId (same company), locationId, timezone, workWeekId, holidayCalendarId                                     | `companyId`; sort `code, name, company`                              |
| `/cost-centers`   | **code, name**, companyId (empty = organization-wide)                                                                                            | `companyId`; sort `code, name`                                       |
| `/departments`    | **companyId, code, name**, parentId (same company, no cycles, depth ≤ 10), costCenterId                                                          | `companyId`, `parentId` (uuid or `root`); sort `code, name, company` |
| `/teams`          | **departmentId, code, name**                                                                                                                     | `departmentId`; sort `code, name, department`                        |
| `/job-grades`     | **code, name, rank** (1–1000, unique), description                                                                                               | sort `rank, code, name`                                              |
| `/designations`   | **code, name**, jobGradeId, description                                                                                                          | `jobGradeId`; sort `code, name, grade`                               |

Codes are upper-cased; 1–20 letters, digits, `-` or `_`, unique per organization. Owning parents
(`companyId` of branches/departments/legal entities) cannot be changed after creation.

Errors: duplicate code/rank → **409** with `details[0].path` = the field; deleting a record that is
still referenced → **409** (archive instead); invalid or cross-tenant references, cycles, a branch
legal entity of another company → **400** with the field path; unknown or other-tenant ids → **404**.

Calendars and org chart:

| Method         | Path                                         | Body / query                                                                                        | Success                                                                                                                     |
| -------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET / POST     | `/work-weeks`                                | POST: `name, description?, isDefault?, rules[{weekday 1–7, occurrence 0–5, dayType FULL/HALF/OFF}]` | 200 `WorkWeekItem[]` / 201 `WorkWeekItem`; setting a default clears the previous one                                        |
| PATCH / DELETE | `/work-weeks/:id`                            | PATCH: any field; `rules` replaces the whole set                                                    | 200 / 204 (in use by a branch → 409)                                                                                        |
| GET / POST     | `/holiday-calendars`                         | POST: `name, description?, isDefault?`                                                              | 200 `HolidayCalendarItem[]` / 201                                                                                           |
| PATCH / DELETE | `/holiday-calendars/:id`                     |                                                                                                     | 200 / 204 (in use → 409; holidays cascade)                                                                                  |
| GET / POST     | `/holiday-calendars/:id/holidays`            | GET `year?`; POST `holidays[{date, name, kind PUBLIC/OPTIONAL}]` (1–200)                            | 200 `HolidayItem[]` / 201 (a date already in the calendar → 409)                                                            |
| PATCH / DELETE | `/holiday-calendars/:id/holidays/:holidayId` |                                                                                                     | 200 / 204                                                                                                                   |
| GET            | `/calendar/resolve`                          | `from, to` (ISO dates, ≤ 366 days), `branchId?`                                                     | 200 `ResolvedCalendar`: per-day kind and `workingDays` (half day = 0.5); branch settings fall back to organization defaults |
| GET            | `/org-chart`                                 | `includeInactive?`                                                                                  | 200 `OrgChart`: companies → branches, nested departments → teams                                                            |

Scoped role assignments (ABAC):

| Method | Path                                          | Body                                                                       | Success                                                   |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| GET    | `/members/:id/role-assignments`               | —                                                                          | 200 `ScopedRoleAssignment[]` (organization-wide + scoped) |
| POST   | `/members/:id/role-assignments`               | `roleId, scopeType (COMPANY/BRANCH/DEPARTMENT/TEAM/ORGANIZATION), scopeId` | 201; duplicate → 409; owner role with a scope → 400       |
| DELETE | `/members/:id/role-assignments/:assignmentId` | —                                                                          | 204; last owner protected (409)                           |

## Employees (Phase 04)

Permissions: [RBAC_MATRIX.md](RBAC_MATRIX.md). Shared schemas: `@hrm/validation` (`employees.ts`);
types: `@hrm/shared-types` (`employees.ts`). Model and privacy rules: [ADR-011](architecture/ADR-011-employee-management.md).
Employees outside the caller's scopes answer **404**.

| Method         | Path                                                    | Body / query                                                                                                                                                                                                                                                                                              | Success                                                                                                             |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET            | `/employees`                                            | `page, pageSize, sortBy (name/employeeNumber/dateOfJoining/status), sortDir, search, status, employmentType, companyId, branchId, departmentId (subtree), teamId, designationId, managerId`                                                                                                               | 200 paginated `EmployeeListItem[]` (current placement)                                                              |
| POST           | `/employees`                                            | names, `employeeNumber?` (generated when empty), work contact, **dateOfJoining**, `probationEndDate?`, `noticePeriodDays?`, `membershipId?`, personal fields, placement: **companyId, employmentType**, legalEntityId, branchId, departmentId, teamId, designationId, jobGradeId, costCenterId, managerId | 201 `EmployeeDetails`; duplicate number/work e-mail → 409 on the field; inconsistent placement → 400 on the field   |
| GET / PUT      | `/employees/settings`                                   | PUT: `numberPrefix, numberPadding, nextNumber`                                                                                                                                                                                                                                                            | 200 `EmployeeSettingsItem` (with `preview`)                                                                         |
| GET / PATCH    | `/employees/:id`                                        | PATCH: names, number, work contact, notice period, personal fields                                                                                                                                                                                                                                        | 200 `EmployeeDetails` (with `access` flags; `personal` only when permitted)                                         |
| PUT            | `/employees/:id/member`                                 | `membershipId` or null                                                                                                                                                                                                                                                                                    | 200; member already linked elsewhere → 409                                                                          |
| GET            | `/employees/:id/employment-history` · `/direct-reports` | —                                                                                                                                                                                                                                                                                                         | 200 `EmploymentRecordItem[]` · `EmployeeListItem[]`                                                                 |
| POST           | `/employees/:id/job-changes`                            | **effectiveFrom, changeType** (TRANSFER/PROMOTION/REDESIGNATION/MANAGER_CHANGE/EMPLOYMENT_TYPE_CHANGE/REORGANIZATION), full placement, remarks                                                                                                                                                            | 201; closes the open record the day before; second future change → 409; circular manager → 400                      |
| POST           | `/employees/:id/confirmation` · `/probation-extension`  | `confirmationDate` · `probationEndDate`                                                                                                                                                                                                                                                                   | 200; not on probation → 409                                                                                         |
| POST / DELETE  | `/employees/:id/separation`                             | `separationType, resignationDate, lastWorkingDate, reason?`                                                                                                                                                                                                                                               | 200 ON_NOTICE / withdraw → ACTIVE                                                                                   |
| POST           | `/employees/:id/separation/complete`                    | —                                                                                                                                                                                                                                                                                                         | 200 SEPARATED after the last working day (earlier → 409); closes the record, suspends the linked login (not owners) |
| POST           | `/employees/:id/rejoin`                                 | `dateOfJoining` (after last working day), placement, `probationEndDate?`                                                                                                                                                                                                                                  | 200 ACTIVE + REJOINING record                                                                                       |
| GET / POST     | `/employees/:id/<collection>`                           | collections: `addresses, emergency-contacts, family-members, education, experience, certifications, skills`                                                                                                                                                                                               | 200 list / 201 item; duplicates (address type, skill name) → 409                                                    |
| PATCH / DELETE | `/employees/:id/<collection>/:itemId`                   | partial (merged record re-validated)                                                                                                                                                                                                                                                                      | 200 / 204                                                                                                           |
| GET / POST     | `/employees/:id/bank-accounts`                          | POST: accountHolderName, bankName, branchName?, **ifsc**, **accountNumber**, accountType, isPrimary                                                                                                                                                                                                       | masked `BankAccountItem`; first account becomes primary                                                             |
| PATCH / DELETE | `/employees/:id/bank-accounts/:accountId`               | accountNumber optional (replace)                                                                                                                                                                                                                                                                          | 200 / 204                                                                                                           |
| POST           | `/employees/:id/bank-accounts/:accountId/reveal`        | —                                                                                                                                                                                                                                                                                                         | 200 `{ accountNumber }` (audited)                                                                                   |
| GET / PUT      | `/employees/:id/statutory-ids`                          | PUT: `pan?, uan?` (null clears)                                                                                                                                                                                                                                                                           | 200 `{ panMasked, uanMasked }`                                                                                      |
| POST           | `/employees/:id/statutory-ids/reveal`                   | —                                                                                                                                                                                                                                                                                                         | 200 `{ pan, uan }` (audited)                                                                                        |
| GET / POST     | `/employees/:id/documents`                              | POST multipart: `file` (PDF/PNG/JPEG/WebP by content, ≤ 10 MB), `category`, `title`                                                                                                                                                                                                                       | 200 list / 201 `EmployeeDocumentItem`                                                                               |
| GET            | `/employees/:id/documents/:documentId/download`         | —                                                                                                                                                                                                                                                                                                         | 200 file stream (`Content-Disposition: attachment`; audited)                                                        |
| PATCH / DELETE | `/employees/:id/documents/:documentId`                  | `category?, title?`                                                                                                                                                                                                                                                                                       | 200 / 204                                                                                                           |

Self-service (`employees.self.access`, linked employee record required — otherwise 404):

| Method                      | Path                                                                                                                         | Notes                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET / PATCH                 | `/me/employee`                                                                                                               | PATCH: `preferredName, personalEmail, personalPhone, maritalStatus` only (other keys ignored) |
| GET                         | `/me/employee/employment-history` · `/team` · `/bank-accounts` · `/statutory-ids` · `/documents` · `/documents/:id/download` | read-only; bank/statutory masked                                                              |
| GET / POST / PATCH / DELETE | `/me/employee/<collection>[/:itemId]`                                                                                        | same collections as HR; blocked after separation                                              |

## Shifts, attendance and leave (Phase 05)

Permissions: [RBAC_MATRIX.md](RBAC_MATRIX.md). Model: [ADR-012](architecture/ADR-012-time-attendance-leave.md).
Times are ISO-8601 with offset; shift times are local `HH:MM` of the employee's branch.

| Method             | Path                                                           | Body / query                                                                                                                                                            | Success                                                                                                                       |
| ------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GET / POST         | `/shifts`                                                      | POST: **code, name, startTime, endTime, fullDayMinutes, halfDayMinutes**, breakMinutes, graceIn/OutMinutes, overtimeAfterMinutes?, windowBefore/AfterMinutes, isDefault | 200 `ShiftItem[]` / 201 (invalid thresholds → 400; duplicate code → 409)                                                      |
| PATCH / DELETE     | `/shifts/:id`                                                  | partial (merged config re-validated)                                                                                                                                    | 200 / 204 (in use → 409)                                                                                                      |
| GET / POST         | `/shift-assignments`                                           | GET: employeeId, shiftId, on, search, page; POST: **employeeIds[], shiftId, effectiveFrom**, effectiveTo?                                                               | paginated / 201 `{ assigned }` (open assignment ends the day before; a later one → 409)                                       |
| DELETE             | `/shift-assignments/:id`                                       | —                                                                                                                                                                       | 204                                                                                                                           |
| GET / PUT          | `/roster`                                                      | GET: **from, to**, employeeId?; PUT: `entries[{employeeId, date, shiftId                                                                                                | null, note?}]`                                                                                                                | `RosterEntryItem[]` / `{ saved }` |
| DELETE             | `/roster/:id`                                                  | —                                                                                                                                                                       | 204                                                                                                                           |
| GET                | `/me/attendance/today`                                         | —                                                                                                                                                                       | `TodayAttendance` (evaluated day, punches, next direction, allowed channels)                                                  |
| POST               | `/me/attendance/punches`                                       | `direction?` (toggles when omitted), `source` WEB/MOBILE, `qrToken?`, latitude?, longitude?                                                                             | 201 `TodayAttendance`; disabled channel → 403; location required → 400; duplicate within 60 s → 409; invalid/expired QR → 400 |
| GET                | `/me/attendance` · `/employees/:id/attendance/days`            | **from, to** (≤ 93 days)                                                                                                                                                | `AttendanceRangeItem` (days + totals)                                                                                         |
| GET                | `/me/attendance/punches` · `/employees/:id/attendance/punches` | **from, to**                                                                                                                                                            | `PunchItem[]`                                                                                                                 |
| POST               | `/employees/:id/attendance/punches`                            | **punchedAt, direction, note**                                                                                                                                          | 201 `PunchItem` (source MANUAL, audited)                                                                                      |
| POST               | `/attendance/punches/import`                                   | `punches[{employeeNumber, punchedAt, direction, deviceLabel?}]` (≤ 2000)                                                                                                | 200 `{ imported, duplicates, errors[{row, message}] }`                                                                        |
| GET                | `/attendance/summary`                                          | **date**, departmentId?, branchId?                                                                                                                                      | `AttendanceSummaryItem`                                                                                                       |
| GET                | `/attendance/kiosk/:branchId/token`                            | —                                                                                                                                                                       | `KioskToken` (`url` to encode in the QR; rotates)                                                                             |
| GET / POST         | `/me/attendance/regularizations`                               | POST: **date, requestedIn, requestedOut, reason**                                                                                                                       | list / 201 (future or > 60 days back → 400; pending exists → 409)                                                             |
| POST               | `/me/attendance/regularizations/:id/cancel`                    | —                                                                                                                                                                       | 200                                                                                                                           |
| GET                | `/attendance/regularizations`                                  | status?, employeeId?, page                                                                                                                                              | paginated                                                                                                                     |
| POST               | `/attendance/regularizations/:id/decision`                     | **decision** APPROVED/REJECTED, note?                                                                                                                                   | 200 (decided → 409; own → 403)                                                                                                |
| GET / PUT          | `/attendance/settings`                                         | PUT: leaveYearStartMonth, web/mobile/qrPunchEnabled, geolocationRequired, qrRotationSeconds                                                                             | `TimeSettingsItem`                                                                                                            |
| GET / POST / PATCH | `/leave/types[/:id]`                                           | GET `includeInactive?`; see `LeaveTypeItem`                                                                                                                             | list / 201 / 200                                                                                                              |
| GET                | `/me/leave/balances` · `/employees/:id/leave/balances`         | year?                                                                                                                                                                   | `LeaveBalanceItem[]` (opening, accrued, adjusted, used, pending, balance, available — decimal strings)                        |
| GET                | `/me/leave/ledger` · `/employees/:id/leave/ledger`             | **leaveTypeId, year**                                                                                                                                                   | `LeaveLedgerItem[]`                                                                                                           |
| POST               | `/me/leave/requests/preview` · `/employees/:id/leave/preview`  | as below                                                                                                                                                                | `LeavePreview` (days, per-day breakdown, balance, problems)                                                                   |
| GET / POST         | `/me/leave/requests`                                           | POST: **leaveTypeId, startDate, endDate**, startSession, endSession, reason?                                                                                            | paginated / 201 `LeaveRequestItem` (problems → 400 with field)                                                                |
| POST               | `/employees/:id/leave/requests`                                | same                                                                                                                                                                    | 201 (HR on behalf)                                                                                                            |
| GET                | `/leave/requests`                                              | status, employeeId, leaveTypeId, from, to, page                                                                                                                         | paginated                                                                                                                     |
| POST               | `/leave/requests/:id/decision` · `/cancel`                     | decision, note? · —                                                                                                                                                     | 200 (insufficient balance at approval → 409)                                                                                  |
| POST               | `/employees/:id/leave/adjustments`                             | **leaveTypeId, year, days, note**, kind OPENING/ADJUSTMENT                                                                                                              | `LeaveBalanceItem`                                                                                                            |
| GET                | `/me/approvals`                                                | —                                                                                                                                                                       | `ApprovalInbox` { leave, regularizations }                                                                                    |

## Recruitment, career site and onboarding (Phase 06)

Permissions: [RBAC_MATRIX.md](RBAC_MATRIX.md). Model: [ADR-013](architecture/ADR-013-recruitment-and-onboarding.md).
Money is a decimal string (`"1500000.00"`), never a number.

| Method             | Path                                                 | Body / query                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET / POST         | `/recruitment/requisitions`                          | GET: status, search, page; POST: **title, companyId, employmentType, headcount**, departmentId, branchId, designationId, targetDate, justification, budgetMin/Max, currency                      |
| GET / PATCH        | `/recruitment/requisitions/:id`                      | partial (DRAFT/REJECTED only; resets to DRAFT)                                                                                                                                                   |
| POST               | `/recruitment/requisitions/:id/submit` · `/cancel`   | —                                                                                                                                                                                                |
| POST               | `/recruitment/requisitions/:id/decision`             | **decision** APPROVED/REJECTED, note? (not your own)                                                                                                                                             |
| GET / POST         | `/recruitment/openings`                              | POST: **title, companyId, employmentType, description**, requisitionId (APPROVED), placement, location, requirements, experience/salary ranges, showSalary, positions, hiringManagerId, closesOn |
| GET / PATCH        | `/recruitment/openings/:id`                          | includes pipeline counts per stage                                                                                                                                                               |
| PUT                | `/recruitment/openings/:id/status`                   | **status** DRAFT/PUBLISHED/ON_HOLD/CLOSED                                                                                                                                                        |
| GET / POST         | `/recruitment/candidates`                            | POST: **firstName, email**, lastName, phone, company/title, experience, location, skills[], source, notes                                                                                        |
| GET / PATCH        | `/recruitment/candidates/:id`                        | —                                                                                                                                                                                                |
| POST / GET         | `/recruitment/candidates/:id/resume`                 | multipart `file` (PDF/PNG/JPEG/WebP ≤ 10 MB) / streamed download                                                                                                                                 |
| GET / POST         | `/recruitment/applications`                          | GET: openingId, stage, candidateId, page; POST: **candidateId, openingId**                                                                                                                       |
| GET                | `/recruitment/applications/:id`                      | details: candidate, history, assessments, interviews, offers, feedback summary                                                                                                                   |
| POST               | `/recruitment/applications/:id/stage`                | **stage**, note?, rejectionReason (required for REJECTED)                                                                                                                                        |
| POST               | `/recruitment/applications/:id/assessments`          | **name, score, maxScore, assessedOn**, notes                                                                                                                                                     |
| POST               | `/recruitment/applications/:id/interviews`           | **roundName, scheduledAt, durationMinutes, mode, panelEmployeeIds[]**, locationOrLink                                                                                                            |
| PUT                | `/recruitment/interviews/:id/status`                 | **status**                                                                                                                                                                                       |
| POST               | `/recruitment/applications/:id/offers`               | **joiningDate, annualCtc**, currency, designationId, jobGradeId, notes (OFFER stage)                                                                                                             |
| PUT                | `/recruitment/offers/:id/status`                     | **status** SENT/ACCEPTED/DECLINED/WITHDRAWN                                                                                                                                                      |
| POST               | `/recruitment/applications/:id/hire`                 | **companyId, employmentType**, legalEntityId, branchId, departmentId, teamId, managerId, probationEndDate, onboardingTemplateId — creates the employee atomically                                |
| GET                | `/me/interviews`                                     | interviews where the caller is a panelist                                                                                                                                                        |
| POST               | `/me/interviews/:id/feedback`                        | **rating 1–5, recommendation, notes**                                                                                                                                                            |
| GET                | `/careers/:organizationSlug/jobs[/:slug]`            | **public**; published openings only                                                                                                                                                              |
| POST               | `/careers/:organizationSlug/jobs/:slug/applications` | **public, rate-limited**, multipart: **firstName, email, phone, consent="true", resume**, lastName, currentCompany, currentTitle, location, coverLetter                                          |
| GET / POST / PATCH | `/onboarding/templates[/:id]`                        | **name, tasks[{title, assignee, dueOffsetDays, documentCategory?}]**, isDefault, description                                                                                                     |
| GET / POST         | `/onboarding/plans`                                  | GET: status, employeeId; POST: **employeeId, templateId**                                                                                                                                        |
| GET                | `/onboarding/plans/:id`                              | HR, the joiner or a task assignee                                                                                                                                                                |
| POST               | `/onboarding/plans/:id/cancel`                       | —                                                                                                                                                                                                |
| PUT                | `/onboarding/tasks/:id/status`                       | **status** DONE/PENDING/SKIPPED (SKIPPED is HR-only)                                                                                                                                             |
| GET                | `/me/onboarding` · `/me/onboarding/tasks`            | own plan · tasks assigned to the caller                                                                                                                                                          |
| POST               | `/me/onboarding/tasks/:id/document`                  | multipart `file`; stores an employee document and completes the task                                                                                                                             |

## India payroll (Phase 07)

Permissions: [RBAC_MATRIX.md](RBAC_MATRIX.md). Model: [ADR-014](architecture/ADR-014-india-payroll.md).
Money and rates are decimal strings. Statutory configs are validated per type by
`statutoryRuleSetSchema` (`@hrm/validation`).

| Method              | Path                                                                              | Body / query                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET / PUT           | `/payroll/settings`                                                               | PUT: **payableDaysMethod, absentIsLossOfPay**, fixedDays, hraComponentCode, basicComponentCodes[], defaultTaxRegime                                                                                          |
| GET / POST          | `/payroll/rule-sets`                                                              | GET: type?, status?; POST: **type, name, effectiveFrom, sourceReference, config**, effectiveTo, notes (created as DRAFT)                                                                                     |
| GET / PUT / DELETE  | `/payroll/rule-sets/:id`                                                          | PUT replaces a DRAFT; DELETE only drafts                                                                                                                                                                     |
| PUT                 | `/payroll/rule-sets/:id/status`                                                   | **status** ACTIVE (from DRAFT) / RETIRED (from ACTIVE); 409 on overlap                                                                                                                                       |
| PUT                 | `/payroll/rule-sets/:id/close`                                                    | **effectiveTo** (ACTIVE only)                                                                                                                                                                                |
| GET / POST / PATCH  | `/payroll/components[/:id]`                                                       | POST: **code, name, kind**, taxable, pfWage, esiWage, ptWage, prorate, payslipOrder                                                                                                                          |
| GET / POST / PATCH  | `/payroll/structures[/:id]`                                                       | POST: **name, components[{componentId, calc}]**, employerStatutoryInCtc; PATCH: name, description, status only                                                                                               |
| GET                 | `/payroll/employees/:id`                                                          | profile, salary history with breakdowns, current salary                                                                                                                                                      |
| POST / DELETE       | `/payroll/employees/:id/salaries[/:salaryId]`                                     | POST: **structureId, annualCtc, effectiveFrom, reason**, note; DELETE refused when used by a finalized run                                                                                                   |
| PUT                 | `/payroll/employees/:id/profile`                                                  | **pfApplicable, esiApplicable**, voluntaryPfFullWages, epsEligible, esiNumber, ptStateCode, metroCity, taxApplicable                                                                                         |
| GET / PUT           | `/payroll/employees/:id/declarations/:fy` · `/payroll/employees/:id/declarations` | PUT: **financialYear, regime**, rentPaidAnnual, deductions{section: amount}                                                                                                                                  |
| GET / POST          | `/payroll/runs`                                                                   | GET: status, companyId, year, page; POST: **companyId, year, month**                                                                                                                                         |
| GET                 | `/payroll/runs/:id` · `/payroll/runs/:id/results?problemsOnly=`                   | run (with `canApprove`) · results with lines and problems                                                                                                                                                    |
| POST                | `/payroll/runs/:id/calculate`                                                     | DRAFT or CALCULATED only                                                                                                                                                                                     |
| GET / POST / DELETE | `/payroll/runs/:id/adjustments[/:adjustmentId]`                                   | POST: **employeeId, code, name, category, amount**, taxable, wage flags, note (sends a calculated run back to DRAFT)                                                                                         |
| POST                | `/payroll/runs/:id/decision`                                                      | **decision** APPROVED/REJECTED, note — not by the calculator; approval refused while problems remain                                                                                                         |
| POST                | `/payroll/runs/:id/finalize` · `/cancel`                                          | finalize APPROVED runs in month order                                                                                                                                                                        |
| GET                 | `/payroll/runs/:id/bank-file`                                                     | CSV (finalized runs; audited)                                                                                                                                                                                |
| GET                 | `/payroll/payslips/:resultId`                                                     | payslip of a finalized result                                                                                                                                                                                |
| GET / POST          | `/payroll/settlements`                                                            | POST: **employeeId**, leaveEncashmentDays, encashmentComponentCodes, encashmentDivisor, notice days/waiver/divisor, includeGratuity, waiveGratuityMinimum, gratuityTaxable, encashmentTaxable, adjustments[] |
| GET / PUT           | `/payroll/settlements/:id`                                                        | PUT recalculates with new inputs (before approval)                                                                                                                                                           |
| POST                | `/payroll/settlements/:id/decision` · `/finalize` · `/cancel`                     | as for runs                                                                                                                                                                                                  |
| GET                 | `/me/salary` · `/me/payslips` · `/me/payslips/:resultId`                          | own salary, payslips                                                                                                                                                                                         |
| GET / PUT           | `/me/tax-declarations/:fy` · `/me/tax-declarations`                               | own regime and declarations                                                                                                                                                                                  |

## Planned (per roadmap)

Phase 05 adds attendance, shifts and leave on top of employee placements and calendars. Later
phases add the module routes listed in `MASTER_PROJECT_INSTRUCTIONS.md` §8.
