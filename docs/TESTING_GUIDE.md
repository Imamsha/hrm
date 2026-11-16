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

## What is covered (Phase 01)

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
