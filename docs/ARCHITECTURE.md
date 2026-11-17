# Architecture

Status: **Phase 03 — Organization structure** (2026-11-17). Decisions are recorded as ADRs in
[`docs/architecture/`](architecture/).

## 1. System overview

```
 ┌──────────────┐   ┌──────────────┐
 │  Web (Vite)  │   │ Mobile (Expo)│        both use @hrm/api-client + @hrm/validation
 └──────┬───────┘   └──────┬───────┘        + @hrm/design-tokens
        │  HTTPS /api/v1 (JSON envelope)
        ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ NestJS API (ESM)                                             │
 │  request-id + AsyncLocalStorage context → helmet/CORS →      │
 │  throttler → controller → service → PrismaService.withTenant │
 │  global exception filter / response envelope / pino logging  │
 │  BullMQ workers (same process in Phase 01)                   │
 └───┬──────────────┬───────────────┬──────────────┬────────────┘
     ▼              ▼               ▼              ▼
 PostgreSQL 17   Redis 7        S3-compatible    AI provider
 + pgvector      (cache, rate   object storage   (OpenAI-compatible,
 RLS, hrm_app    limits, BullMQ) (tenant-prefixed optional)
 role            queues)         keys)
```

## 2. Monorepo

| Path                                          | Purpose                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/api`                                    | NestJS 12 REST API, Prisma 7, BullMQ, health, AI provider foundation      |
| `apps/web`                                    | React 19 + Vite 8 + Tailwind 4 SPA (app shell, system status)             |
| `apps/mobile`                                 | Expo SDK 58 / React Native 0.88 app (Expo Router)                         |
| `packages/shared-types`                       | Transport types: response envelope, error codes, health, branded IDs      |
| `packages/validation`                         | Zod schemas shared by API, web, mobile (pagination, decimals, text)       |
| `packages/api-client`                         | Typed fetch client: envelope unwrapping, error normalisation, timeouts    |
| `packages/design-tokens`                      | Colours (light/dark, WCAG-tested), type scale, spacing, density; CSS + JS |
| `packages/business-rules`                     | Pure domain logic; Phase 01: decimal-safe money (`decimal.js`)            |
| `packages/ui-web`                             | Web component library (Radix + Tailwind, shadcn conventions), DataTable   |
| `packages/eslint-config`, `typescript-config` | Shared lint (type-aware, strict) and TS configs                           |
| `infrastructure/`                             | Postgres init (roles/extensions), placeholders for nginx/monitoring/ci-cd |

Dependency direction: `apps → packages`; packages never import apps. `ui-web` is web-only.
All packages are ESM, built with `tsc` to `dist/` and consumed by Node, Vite and Metro.

## 3. Backend structure (`apps/api/src`)

```
config/            env schema (Zod, fail-fast) + global APP_CONFIG provider
common/context/    AsyncLocalStorage request context (requestId, organizationId, userId)
common/http/       request-id middleware, AppException, global exception filter,
                   success envelope interceptor, Zod validation pipe
common/logging/    pino options (redaction, request correlation)
infrastructure/    database (PrismaService.withTenant), redis, queue (BullMQ, tenant jobs),
                   storage (S3 client, tenant key builder)
modules/health     liveness / dependency report / readiness
modules/ai         provider abstraction (OpenAI-compatible + disabled), pgvector helpers
```

Business modules (`modules/<name>`) are added per phase with module, controller, service,
repository, DTO schemas (in `@hrm/validation`), policies, events and tests. Controllers only map
HTTP to service calls; services throw `AppException`.

## 4. Request lifecycle

1. `requestContextMiddleware` accepts a safe `X-Request-Id` or mints a UUID, echoes it, and opens
   the AsyncLocalStorage context.
2. pino-http logs with the same id (health probes are not logged; secrets are redacted).
3. Helmet, CORS allow-list, 1 MB body limit, global rate limiting (`@nestjs/throttler`).
4. Controller → service. Input validated by `ZodValidationPipe` with shared schemas.
5. Data access through `PrismaService.withTenant()` (see §5).
6. `EnvelopeInterceptor` wraps results as `{ success: true, data, meta }`; the global filter maps
   every error to `{ success: false, error: { code, message, details? }, meta }` and never leaks
   internals for 5xx.

## 5. Multi-tenancy and isolation (ADR-003)

- Shared database, shared schema; every tenant-owned table has `organization_id`.
- Runtime connects as **`hrm_app`** (NOSUPERUSER, NOBYPASSRLS, not table owner). Migrations run as
  **`hrm_migrator`** (schema owner). The API never holds migrator credentials.
- `withTenant(fn)` opens a transaction and runs `set_config('app.organization_id', $id, true)`
  (transaction-local → cannot leak through the connection pool), then executes `fn`.
- RLS policies compare `organization_id` with `app.current_organization_id()`; with no context
  the function returns NULL and **no rows** are visible or writable (fail closed).
- The tenant comes from trusted server context (Phase 02 authentication + membership check),
  never from request bodies or headers.
- Background jobs carry `organizationId` explicitly and restore the context in the worker.
- Object keys are always `org/<organizationId>/…`, built by `StorageService.tenantKey()`.
- Verified by integration tests: no-context = no rows, cross-tenant read/update/insert denied,
  no context leak on a single pooled connection, concurrent tenants isolated.

Phase 02 adds memberships, auth-derived context, composite tenant FKs, RBAC/ABAC policy engine and
a SECURITY DEFINER path for tenant registration.

## 6. Data and money

Prisma 7 (`prisma-client` generator, ESM, `@prisma/adapter-pg`). UUIDv7 keys, `timestamptz`,
`numeric` money, CHECK constraints / RLS / triggers in migration SQL. Audit log is append-only
(trigger + privilege revocation). Money math uses `@hrm/business-rules` (`decimal.js` clone,
precision 34, configurable rounding) and is transported as strings.

## 7. Background processing

BullMQ 5 on Redis 7 (`noeviction`, AOF). Queue prefix `hrm`. Default retries with exponential
backoff and bounded retention. Workers run inside the API process in Phase 01; Phase 14 splits a
dedicated worker deployment using the same modules.

## 8. Frontend

**Web:** React Router 8 data router, TanStack Query (server state), Zustand (UI preferences only),
Tailwind 4 with tokens from `@hrm/design-tokens`, components from `@hrm/ui-web`. App shell:
collapsible sidebar (drawer < md), sticky header, breadcrumbs from route handles, theme
(light/dark/system, no flash) and density (compact/comfortable) preferences, API indicator.

**Mobile:** Expo Router (`src/app`), native primitives themed from the same tokens (no NativeWind,
see ADR-005), TanStack Query, `expo-secure-store` for tokens (Keychain/Keystore only).

## 9. AI foundation (ADR-006)

`AiProvider` interface (chat, embeddings, usage + latency on every call). Implementations:
`OpenAiCompatibleProvider` (fetch, schema-validated responses, timeouts, no prompt echo in errors,
embedding dimension check against pgvector) and `DisabledAiProvider` (explicit failure). No AI HTTP
endpoints until authorization, permission-aware retrieval, metering and AI audit exist.

## 10. Security baseline (Phase 01)

Fail-fast config with production guards (no wildcard CORS, no auto-created buckets, no dev
credentials) · least-privilege DB role + RLS · append-only audit · Helmet · CORS allow-list ·
rate limiting · body size limits · request-id sanitisation · log redaction · generic 5xx messages
· supply-chain controls (pinned versions, pnpm `allowBuilds` allow-list, minimum release age).
Authentication, sessions, MFA and authorization arrive in Phase 02.

## 11. Identity and access (Phase 02)

- **Authentication:** argon2id passwords, 15-minute JWT access tokens, rotating opaque refresh
  tokens (httpOnly SameSite=Strict cookie on web, OS keystore on mobile), reuse detection, TOTP MFA
  with encrypted secrets and recovery codes, lockout, password reset via queued e-mail. See ADR-008.
- **Tenant resolution:** the global `AccessGuard` derives the tenant from the token's `org` claim
  **after** verifying an active membership in the database, then `withTenant()` + RLS scope all
  data access. Client tenant hints are ignored. See ADR-009.
- **Authorization:** per-organization roles over a shared permission catalog; ABAC scopes on role
  assignments; permission cache in Redis invalidated on every access change.
- **Modules:** `modules/auth`, `organizations`, `members` (members + invitations), `roles`,
  `audit`, `notifications` (e-mail), `access` (guard, policy, decorators), wired by
  `IdentityModule`.
- **Web:** session bootstrap from the refresh cookie, single-flight refresh on 401, route guards,
  permission-aware navigation, organization switcher, admin screens (members, roles, organization,
  audit) and account security.

## 12. Organization structure (Phase 03)

- **Module:** `modules/structure` — companies, legal entities, locations, branches, cost centers,
  departments, teams (`StructureController`), job grades and designations
  (`JobCatalogController`), work weeks, holiday calendars, calendar resolution and the org chart
  (`CalendarsController`). Services share `auditedCreate/Update/Delete`, `pagedList` and
  `mapWriteError` (constraint violation → 409/400 with the field path).
- **Integrity in depth:** services pre-validate references to return field errors; database
  triggers (same tenant, same company, department hierarchy, scope targets) are the backstop.
- **Calendars:** pure resolution in `@hrm/business-rules` (`resolveDays`, `countWorkingDays`),
  reused by attendance/leave/payroll later.
- **Structural ABAC:** `can()` evaluates COMPANY/BRANCH/TEAM attributes and DEPARTMENT subtrees;
  department coverage is resolved into the cached access and invalidated on tree changes.
  Scoped assignments are managed under `/members/:id/role-assignments`.
- **Web:** Organization section — Structure (tabbed), Org chart, Job catalog, Working days &
  holidays — built on a config-driven `EntityManager` (server-side list, filters, shared-schema
  forms, archive/delete) and the new `Tabs`/`Textarea` primitives in `@hrm/ui-web`.

See ADR-010.

## 13. ADR index

| ADR                                                                     | Title                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| [001](architecture/ADR-001-monorepo-and-toolchain.md)                   | Monorepo, toolchain and dependency policy                    |
| [002](architecture/ADR-002-backend-runtime-and-testing.md)              | NestJS 12 ESM runtime, validation and test runners           |
| [003](architecture/ADR-003-database-roles-and-rls.md)                   | Database roles, tenant context and Row-Level Security        |
| [004](architecture/ADR-004-api-conventions.md)                          | API conventions: versioning, envelope, errors, request IDs   |
| [005](architecture/ADR-005-design-system.md)                            | Design system across web and mobile                          |
| [006](architecture/ADR-006-ai-platform.md)                              | AI platform foundation and guardrails                        |
| [007](architecture/ADR-007-object-storage.md)                           | S3-compatible object storage (RustFS instead of MinIO)       |
| [008](architecture/ADR-008-authentication-and-sessions.md)              | Authentication and sessions                                  |
| [009](architecture/ADR-009-authorization-rbac-abac.md)                  | Authorization (RBAC + ABAC) and tenant resolution            |
| [010](architecture/ADR-010-organization-structure-and-scoped-access.md) | Organization structure, calendars and structural ABAC scopes |
