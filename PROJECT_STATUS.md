# Project status

_Last updated: 2026-11-16_

## Current phase

**Phase 01 — Foundation & architecture: implemented and verified locally. Awaiting owner
approval.** Only the GitHub Actions run is outstanding (no Git remote / no commits yet).
Phase 02 has **not** been started.

**Current task:** none — waiting for Phase 01 approval.

## Verification results (2026-11-16)

| Check                                                                  | Result                                                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm turbo run typecheck lint test build` (11 packages)               | ✅ 37/37 tasks                                                                                                                                   |
| `pnpm format:check`                                                    | ✅ clean                                                                                                                                         |
| Unit / component tests                                                 | ✅ 131 passed, 0 failed, 0 skipped — business-rules 10 · design-tokens 38 · validation 13 · api-client 8 · api 41 · ui-web 9 · web 10 · mobile 2 |
| `pnpm infra:up` (Postgres 17 + pgvector, Redis 7.4, RustFS, Mailpit)   | ✅ all healthy; port-publication check passes                                                                                                    |
| Postgres init script (roles, extensions, `hrm` + `hrm_test`)           | ✅                                                                                                                                               |
| Migrations on fresh databases (dev + test)                             | ✅ 2/2 applied; schema drift check: no difference                                                                                                |
| Integration tests (tenant isolation 15, health 8, queue 1)             | ✅ 24 passed (run twice)                                                                                                                         |
| Live API `/health`                                                     | ✅ database, redis, storage, queue all `up`; `/health/ready` 200; Swagger 200                                                                    |
| Playwright E2E (production build + live API; desktop Chrome + Pixel 7) | ✅ 4 passed, 2 skipped by design (device-specific specs)                                                                                         |
| Mobile Android bundle export (pnpm monorepo)                           | ✅                                                                                                                                               |
| GitHub Actions CI                                                      | ⏳ not run — needs a remote                                                                                                                      |
| Mobile app on a device/emulator against the live API                   | ⏳ not run (no emulator in session); component tests + bundle export pass                                                                        |

## Completed

Monorepo (pnpm 12 catalog, Turborepo, TS 6, strict type-aware ESLint, Prettier) · shared packages
(shared-types, validation, api-client, design-tokens, business-rules, ui-web, configs) · NestJS 12
API core (config validation, request context/IDs, envelope, exception filter, Zod pipe, pino,
Helmet, CORS, throttling, versioning, Swagger) · health endpoints · Prisma 7 schema + migrations
(organizations, append-only audit_logs, RLS, CHECKs, triggers) · least-privilege DB roles ·
`withTenant()` tenant context · BullMQ with tenant-aware jobs · S3 storage with tenant keys · AI
provider abstraction + pgvector helpers · design system + DataTable · web shell with live system
status · Expo mobile shell with live health screen · CI workflow · full documentation set.

## Issues found and fixed during verification

1. **Port collisions with other local projects.** `floodguard-db` held 5433 and
   `floodguard-frontend` held 3000; another Vite app held 5173. Docker Desktop started our Postgres
   **without** a host port, so clients reached the other project's database (authentication failed
   before anything was written). Fix: defaults moved to Postgres **5434**, API **3100**, web
   **5180**; `pnpm infra:up` now runs `scripts/check-infra-ports.mjs` and fails if any port was
   not published.
2. **`NODE_ENV` in root `.env`** made Vite produce a development React build. Removed from
   `.env`/`.env.example`; the API defaults to `development`.
3. Web preview origin `http://localhost:4173` added to dev `CORS_ORIGINS` (needed for E2E).

## Pending (later phases)

See `docs/DEVELOPMENT_ROADMAP.md` (Phase 02: authentication, RBAC/ABAC, memberships, full RLS
enforcement) and its "carried forward" list (DataTable filtering/saved views/inline edit/export,
header org switcher/search/notifications/profile, forms system).

## Known issues and risks

1. Local Node 22.13.1 is below what parts of the ecosystem expect (Nest CLI crash, jsdom 30).
   Recommend Node 22.22+ or 24 LTS; CI uses 22.22.2.
2. MinIO replaced by RustFS 1.0.4 (MinIO images no longer public) — ADR-007.
3. pnpm "Agent skills awaiting approval: @tanstack/react-table" left unapproved (owner's call).
4. Health endpoints are public by design; no other endpoints exist until Phase 02 auth.
5. Repository has no commits yet (initialised on `main`).

## Technical decisions (details in ADRs)

NestJS 12 ESM without Nest CLI · Vitest + SWC for API/libs, Jest for React Native · shared Zod
validation · Prisma 7.10 (8.0 is RC) · BullMQ 5.81 · TypeScript 6.0.3 · TanStack Table v9 ·
native mobile components (no NativeWind) · RustFS for local S3 · UUIDv7 keys · `hrm_app`
(NOBYPASSRLS) + `hrm_migrator` roles · transaction-local tenant context via `set_config`.

## Database migration status

| Migration                              | dev (`hrm`) | test (`hrm_test`) |
| -------------------------------------- | ----------- | ----------------- |
| 20261116000000_platform_foundation     | ✅ applied  | ✅ applied        |
| 20261116000100_organizations_and_audit | ✅ applied  | ✅ applied        |

## Next recommended task

1. Owner reviews and approves Phase 01.
2. Commit Phase 01, add a GitHub remote, push, confirm CI green.
3. Start Phase 02 (authentication, RBAC/ABAC, SaaS tenancy) after approval.
