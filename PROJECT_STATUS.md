# Project status

_Last updated: 2026-11-17_

## Current phase

**Phase 03 — Organization structure: implemented and verified locally. Awaiting owner approval.**
Phase 04 has **not** been started. Phase 03 changes are **not committed yet**.

- Phase 01: approved, committed (`9bb442c`), CI green on GitHub.
- Phase 02: committed and pushed (`580d91c`), CI green on GitHub. The owner then asked to start
  Phase 03.

**Current task:** none. Waiting for the owner to review and approve Phase 03, and to say whether to
commit and push.

## Phase 03 verification (2026-11-17)

| Check                                                    | Result                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=3`; see known issue 9)                                                                                 |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                      |
| Unit/component tests                                     | ✅ 225 passed: API 68 · shared-types 3 · validation 36 · api-client 12 · design-tokens 38 · business-rules 21 · ui-web 12 · web 31 · mobile 4 |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 72 passed (24 Phase 01 + 38 Phase 02 + 10 Phase 03)                                                                                        |
| Migrations                                               | ✅ 5 applied to dev and test; drift check reports no difference                                                                               |
| Playwright E2E (production build + live API)             | ✅ 7 passed (new: structure → org chart), 5 skipped by design                                                                                 |
| GitHub Actions                                           | ⏳ runs when Phase 03 is pushed                                                                                                               |

## Phase 03 delivered

- **Structure API** (`modules/structure`), with full CRUD, archiving, server-side
  pagination/search/sort/filters and audit on every write:
  - companies, legal entities (PAN/TAN/GSTIN/CIN for Indian entities; GSTIN must embed the PAN);
  - locations (decimal coordinates), branches (legal entity must be in the same company);
  - cost centers, departments (tree; no cycles, same company, depth ≤ 10), teams;
  - job grades (unique rank), designations.
- **Calendars:**
  - work weeks with occurrence rules (e.g. 2nd/4th Saturday off) and half days;
  - holiday calendars with bulk holiday entry (entered by the organization; none seeded);
  - one default of each per organization;
  - `GET /calendar/resolve` resolves a branch's calendar, falling back to the organization defaults.
- **Org chart:** `GET /org-chart` returns companies → branches and nested departments → teams.
- **Structural ABAC:**
  - `can()` evaluates COMPANY / BRANCH / TEAM attributes and DEPARTMENT subtrees, cache-invalidated
    on tree changes;
  - scoped role assignments via `/members/:id/role-assignments`;
  - the owner role is organization-wide only;
  - scope targets must be in the same tenant and cannot be deleted while referenced.
- **Database:** migration `20261117000000_organization_structure`:
  - 13 tenant tables with RLS and composite FKs;
  - CHECKs for codes, identifiers and coordinates;
  - integrity triggers;
  - 6 permissions granted to existing organizations' system roles (parity test).
- **Shared packages:**
  - `@hrm/business-rules` calendar resolution;
  - `@hrm/validation` structure schemas (shared by web and API);
  - `@hrm/shared-types` structure types and permissions;
  - `@hrm/ui-web` `Tabs` and `Textarea`.
- **Web:** a new Organization section, built on a config-driven entity manager, plus Members →
  Scoped roles. Pages:
  - Structure (7 tabs);
  - Org chart (expandable tree);
  - Job catalog;
  - Working days & holidays (work-week editor, holiday calendars, month preview).
- **Docs:** ADR-010; database, API, RBAC matrix, testing, architecture, module status, roadmap and
  owner decisions updated.

## Issues found and fixed during Phase 03 verification

1. Creating a work week returned 500. The nested rule create passed `organizationId`, which
   Prisma derives from the composite relation. Fixed and covered by an integration test.
2. A duplicate job-grade rank was reported on `code` instead of `rank`: with driver adapters,
   Prisma's unique-violation error carries no `meta.target`. The field is now read from the
   adapter cause or the constraint name.
3. Reference pickers were not associated with their labels (accessibility); fixed and covered by
   tests.
4. Phase 02 tests hard-coded role permission lists; they now derive the lists from `SYSTEM_ROLES`.

## Known issues and risks

1. Local Node 22.13.1 (recommend 22.22+ / 24 LTS); see ADR-001.
2. MinIO replaced by RustFS (ADR-007).
3. Self-registered owners have no e-mail verification yet; no WebAuthn/passkeys yet.
4. Strict refresh-token reuse detection can end a session if two clients race a refresh.
5. Scoped role assignments are stored and evaluated by `can()`, but no endpoint consumes them yet.
   Organization-wide screens still need an organization-wide role. The first consumer is employee
   records (Phase 04).
6. Reference pickers load at most 200 records per list (API page maximum).
7. No mobile organization screens yet; the mobile app has still not been run on a
   device/emulator.
8. Subscription plans carry no pricing; the pnpm "agent skills" prompt is still unapproved
   (owner's call).
9. **Local machine:** with ~1.3 GB of free RAM, the turbo gate at default concurrency can hit
   vitest worker-start timeouts; it passes with `--concurrency=3`. Docker Desktop's IPv6
   forwarding to Redis stalled once and was fixed with `docker restart hrm-redis-1`. Workarounds
   are in `docs/TESTING_GUIDE.md`. jsdom test timeouts were raised to 20 s.

## Database migration status

| Migration                                         | dev | test |
| ------------------------------------------------- | --- | ---- |
| 20261116000000_platform_foundation                | ✅  | ✅   |
| 20261116000100_organizations_and_audit            | ✅  | ✅   |
| 20261116010000_identity_access_subscriptions      | ✅  | ✅   |
| 20261116020000_user_scope_policies_without_tenant | ✅  | ✅   |
| 20261117000000_organization_structure             | ✅  | ✅   |

## Next recommended task

1. Owner reviews Phase 03: run `pnpm dev`, then open http://localhost:5180/organization/structure.
2. On approval: commit and push Phase 03, then confirm CI is green.
3. Then Phase 04, employee management: directory, profiles, employment details with
   company/branch/department/team/designation/grade assignments, history, lifecycle. This is
   also the first consumer of scoped (ABAC) access.
