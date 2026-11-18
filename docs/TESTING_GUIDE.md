# Testing guide

## Test layers

| Layer                                                    | Tool                                                 | Location                                    | Needs infrastructure |
| -------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- | -------------------- |
| Unit — shared packages                                   | Vitest 5                                             | `packages/*/src/**/*.test.ts`               | no                   |
| Unit — API (incl. full Nest HTTP pipeline via Supertest) | Vitest 5 + SWC + Supertest                           | `apps/api/src/**/*.test.ts`                 | no                   |
| Integration — API against real Postgres/Redis/S3         | Vitest 5 + Supertest + pg                            | `apps/api/test/integration/*.int.test.ts`   | **yes**              |
| Component — web                                          | Vitest + React Testing Library + jsdom               | `packages/ui-web/src/**`, `apps/web/src/**` | no                   |
| Component — mobile                                       | Jest (`jest-expo`) + React Native Testing Library 14 | `apps/mobile/src/**/*.test.tsx`             | no                   |
| E2E — web                                                | Playwright (desktop Chrome + Pixel 7)                | `apps/web/e2e`                              | yes (API + infra)    |
| E2E — mobile                                             | Maestro                                              | Phase 13                                    | —                    |
| Load                                                     | k6                                                   | Phase 14                                    | —                    |

Rule: tests may stub **network boundaries** (fetch) to exercise real client/UI code; they never
replace product functionality with mock data.

## Commands

```bash
pnpm turbo run typecheck lint test build        # everything that needs no infrastructure
pnpm format:check                               # Prettier

pnpm infra:up                                   # Docker: postgres, redis, storage, mailpit (healthy)
pnpm --filter @hrm/api test:integration         # applies migrations to hrm_test, then runs suites

# E2E (API running on :3100 against migrated dev DB)
pnpm db:deploy && pnpm --filter @hrm/api dev    # terminal 1
pnpm --filter @hrm/web exec playwright install chromium   # once
pnpm --filter @hrm/web test:e2e                 # terminal 2 (builds + previews the web app)
```

Integration tests use an isolated database (`hrm_test`), Redis DB 1 and bucket `hrm-test`
(`TEST_*` variables in `.env.example`). The audit log is append-only, so tests create uniquely
named tenants instead of cleaning up.

## What is covered (Phase 04)

- **Employees (10 integration, `employees.int.test.ts`):** numbering from settings incl. skipping
  manual collisions; duplicate number / work e-mail → 409 on the field; placement consistency
  (department of another company, team of another department) in the API **and** the database
  trigger; field errors; directory filters (department subtree, branch, search, sort allow-list);
  job changes (start-date rules, closing the previous record, one future change, circular
  reporting), append-only history (UPDATE/DELETE rejected, no DELETE privilege on employees),
  overlap exclusion; probation extend/confirm; separation start/withdraw/complete with login
  suspension and rejoining; collections (unique address type and skill, single primary contact,
  merged-record validation, unknown collection 404); bank/PAN/UAN encryption at rest, masking,
  audited reveal; document upload with content sniffing, streamed download equality, delete;
  self-service (own profile only, limited fields, no directory); department-scoped HR (subtree
  visibility, 404 outside, scoped hiring, settings organization-wide only); cross-tenant ids,
  companies and managers; RLS with no tenant context.
- **Unit:** current-placement selection, scope filters, ABAC attributes, masks, date arithmetic;
  magic-byte sniffing, file-name sanitising, Content-Disposition; employee schemas (blank → null,
  date ordering, IFSC/PAN/UAN, numbering, self-service key stripping).
- **Web (5):** People navigation by permission, directory server filters and pre-submit
  validation, profile tabs/actions by access flags, job-change prefill, job history, payload
  normalisation (checkbox, omit-if-blank, explicit blank). **Mobile (2):** My profile, not linked.
- **E2E:** add an employee through the UI, add an address, see them in the directory.

## What is covered (Phase 03)

- **Structure (10 integration, `structure.int.test.ts`):** company/legal entity/location/branch
  lifecycle with audit entries; duplicate code → 409 on `code`, duplicate grade rank → 409 on
  `rank`; GSTIN-must-embed-PAN and India-only identifiers; branch legal entity of another company
  rejected; delete-in-use → 409 and archive instead; department tree, self/cyclic and
  cross-company parents rejected (API **and** database trigger); org chart nesting; work-week
  occurrence rules (2nd/4th Saturday off), one default per organization, holiday bulk insert and
  duplicate date → 409, calendar resolution with branch override and organization fallback,
  invalid patterns and > 366-day ranges → 400; employee role can read but not manage; scoped
  role assignments (duplicate → 409, owner with a scope → 400, scoped grant does not open
  organization-wide endpoints, department scope expands to new sub-departments immediately,
  referenced department cannot be deleted); cross-tenant ids → 404/400, cross-tenant optional
  reference refused by the same-tenant trigger, cross-tenant scope target refused; every
  organization's system roles equal `SYSTEM_ROLES` after the data migration.
- **Unit:** `can()` for COMPANY/BRANCH/TEAM attributes and DEPARTMENT subtrees (missing attribute →
  deny); org-chart tree building; calendar resolution, occurrence rules, half days, holiday
  precedence (`@hrm/business-rules`, 21); structure schemas incl. PAN/TAN/GSTIN/CIN and coordinates
  (`@hrm/validation`).
- **Web (10):** organization navigation by permission, job catalog guard, read-only lists, create
  with server 409 mapped to the field, shared-schema validation before any request, Indian
  identifiers hidden outside India, payload normalisation (blank → null, hidden → null,
  create-only fields not sent on edit), work-week summaries, month preview, org-chart tree
  expand/collapse, scoped role assignment dialog.
- **E2E:** create a company and a two-level department tree through the UI, then see it on the
  org chart (against the production build and live API).

## What is covered (Phase 02)

- **Auth (14 integration):** registration provisioning, cookie attributes, duplicate/weak/personal
  passwords, generic login errors, lockout, refresh rotation + reuse revocation, logout, session
  listing/revocation, password reset through Mailpit, password change, TOTP enrolment/challenge/
  recovery codes/replay protection, encrypted secret at rest, credential rate limiting (429).
- **Access control (14 integration):** employee permissions, single-use invitations, immediate
  effect of role changes, suspension, HR cannot grant owner, last-owner protections, immutable
  system roles, existing-account invitations + organization switching, duplicate invitations,
  settings validation + field-level audit, second organization, server pagination/search/sort.
- **Cross-tenant (10 integration):** foreign ids behave as non-existent, foreign roles rejected,
  switch without membership denied, client tenant headers ignored, RLS with no context, user-scope
  visibility, composite-FK protection, invitation lookup, read-only catalogs, permission catalog
  parity, tenant context never leaks a user's other memberships.
- **Web:** guards and safe redirects, login + MFA, server field errors, permission-aware navigation,
  members table server params, invite dialog, organization switcher. **Mobile:** login + MFA, only
  the refresh token persisted in the keystore. **E2E:** register → status/admin → reload → sign out
  → sign in, theme, mobile drawer.

## What was covered in Phase 01

- **Tenant isolation:** runtime role is non-superuser/no-BYPASSRLS; no context → no rows;
  `withTenant` sees only its tenant; context comes from request context; missing tenant rejected;
  no leakage on a reused pooled connection; cross-tenant INSERT (WITH CHECK) and UPDATE denied;
  10 concurrent mixed-tenant transactions isolated; audit log append-only; runtime role cannot
  create organizations or read `_prisma_migrations`; CHECK constraints enforced; pgvector usable.
- **HTTP pipeline:** envelope, pagination meta, Zod field errors, domain error mapping, no 5xx
  detail leakage, 404 envelope, request-id acceptance/rejection, security headers, CORS allow-list,
  malformed JSON, OpenAPI document.
- **Health:** all-up report and readiness 200; degraded storage → `/health` 200 degraded and
  `/health/ready` 503 without secrets.
- **Queue:** a job round-trips through Redis and the in-process worker.
- **Config:** fail-fast validation, CSV/boolean parsing, AI provider requirements, production guards.
- **Money:** decimal drift, rounding modes, proration, allocation remainder distribution.
- **Design tokens:** WCAG AA contrast for every text/surface pair in both themes; theme parity.
- **API client:** envelope unwrapping, error mapping, timeouts, late-bound fetch, contract validation.
- **AI:** OpenAI-compatible request/usage mapping, error-body non-leakage, response validation,
  embedding ordering and dimension enforcement, disabled provider, pgvector serialisation.
- **UI:** DataTable pagination, sorting (aria-sort), selection + bulk actions, keyboard navigation,
  empty/error/loading states, server mode; system status page (all-up, degraded, unreachable),
  routing/not-found, theme & density persistence; mobile health screen.

## Adding tests for a new module (checklist)

1. Service unit tests for business rules (edge cases, money via Decimal).
2. Integration tests: happy path through HTTP, validation errors, **other-tenant access denied**,
   permission denied per RBAC matrix row.
3. Component tests for screens using real API client with stubbed fetch.
4. Playwright happy path for critical flows.

## Local troubleshooting

- **Integration tests fail in `beforeAll` with 500 / "Stream isn't writeable":** Docker Desktop's
  port forwarding to Redis on `localhost` (IPv6 `::1`) can stall while `127.0.0.1` still works.
  `docker restart hrm-redis-1` restores it.
- **Vitest "Failed to start forks worker" / timeouts during `pnpm turbo run … test`:** the machine
  is short of memory. Re-run with `--concurrency=3`. jsdom suites allow 20 s per test.
- **E2E "Unable to reach the server":** the Playwright web server runs `pnpm build`; on a
  memory-constrained machine the dev API (`node --watch`) can restart meanwhile. Build first,
  start `pnpm --filter @hrm/web preview`, then run `pnpm --filter @hrm/web test:e2e` (the
  existing preview server is reused).
