# Project status

_Last updated: 2026-11-16_

## Current phase

**Phase 02 — Authentication, RBAC & SaaS tenancy: implemented and verified locally. Awaiting
owner approval.** Phase 03 has **not** been started.

Phase 01 — approved by the owner, committed (`9bb442c`) and **CI green on GitHub**.

**Current task:** none — waiting for Phase 02 review/approval.

## Phase 02 verification (2026-11-16)

| Check                                                    | Result                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks                                                                                                                                 |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                       |
| Unit/component tests                                     | ✅ 190 passed — API 65 · shared-types 3 · validation 25 · api-client 12 · design-tokens 38 · business-rules 10 · ui-web 12 · web 21 · mobile 4 |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 62 passed (24 Phase 01 + 38 Phase 02)                                                                                                       |
| Migrations                                               | ✅ 4 applied to dev + test; drift check: no difference                                                                                         |
| Playwright E2E (production build + live API)             | ✅ 6 passed, 4 skipped by design                                                                                                               |
| Live smoke                                               | ✅ register → me → members; reset e-mail delivered to Mailpit via the queue                                                                    |
| Android bundle export                                    | ✅                                                                                                                                             |
| GitHub Actions                                           | ⏳ runs on push of this phase                                                                                                                  |

## Phase 02 delivered

- **Auth:** registration (provisions org, 6 system roles, owner membership, trial subscription),
  login with lockout and generic errors, TOTP MFA (encrypted secret, replay protection, recovery
  codes), refresh-token rotation with reuse detection, logout / logout-all, session list/revoke,
  forgot/reset/change password via queued e-mail, login history (append-only `auth_events`).
- **Tenancy & authorization:** global `AccessGuard` (session revocation, membership re-validation,
  permission enforcement), tenant derived only from verified membership, `withTenant()`/`withUser()`
  RLS contexts, permission catalog + system/custom roles, ABAC scope model (ORGANIZATION/SELF
  enforced), Redis permission cache with versioned invalidation, owner invariants.
- **Management APIs:** organization settings (field-level audit), additional organizations,
  members (server pagination/search/sort, suspend, roles, remove), invitations (e-mail, preview,
  accept for new/existing accounts), roles & permissions, audit log, subscription.
- **Web:** auth pages (login + MFA, register, forgot/reset, accept invitation), session bootstrap
  from httpOnly cookie, single-flight refresh, route + permission guards, org switcher, user menu,
  Members, Roles & permissions, Organization, Audit log, Account security (password, MFA with QR,
  sessions, history). Forms: React Hook Form + shared Zod schemas, server field errors.
- **Mobile:** login + MFA, keystore refresh token, session restore, protected routes, home, status.
- **Docs:** ADR-008 (authentication), ADR-009 (authorization); database, API, RBAC matrix,
  testing, deployment, architecture, module status and roadmap updated.

## Issues found and fixed during Phase 02 verification

1. **Tenant queries could include the caller's memberships in other organizations** (OR-ed user
   policy). Not a cross-tenant leak (own rows only) but wrong; fixed by migration
   `20261116020000` + explicit filter + regression test.
2. API client threw on `204 No Content`; captured `fetch` too early earlier — both fixed with tests.
3. Dialog forms reset via effects (React Compiler lint) — refactored to remount-per-open.

## Known issues and risks

1. Local Node 22.13.1 (recommend 22.22+ / 24 LTS) — see ADR-001.
2. MinIO replaced by RustFS (ADR-007).
3. Self-registered owners have no e-mail verification flow yet (invited users are verified by the
   link). No WebAuthn/passkeys yet.
4. Strict refresh-token reuse detection can end a session if two clients race a refresh; the web
   client de-duplicates refreshes.
5. Structural ABAC scopes (company/branch/department/team) are stored but deny until Phase 03.
6. Subscription plans carry no pricing; billing is out of scope until designed.
7. Mobile app not yet run on a device/emulator (component tests + bundle export only).
8. pnpm "agent skills" prompt for `@tanstack/react-table` left unapproved (owner's call).

## Database migration status

| Migration                                         | dev | test |
| ------------------------------------------------- | --- | ---- |
| 20261116000000_platform_foundation                | ✅  | ✅   |
| 20261116000100_organizations_and_audit            | ✅  | ✅   |
| 20261116010000_identity_access_subscriptions      | ✅  | ✅   |
| 20261116020000_user_scope_policies_without_tenant | ✅  | ✅   |

## Next recommended task

1. Owner reviews Phase 02 (try it: `pnpm dev`, register at http://localhost:5180/register).
2. Confirm CI is green for the Phase 02 commit.
3. After approval: Phase 03 — organization structure (companies, legal entities, branches,
   departments, teams, designations, job grades, locations, org chart, working days, holiday
   calendars) and evaluation of structural ABAC scopes.
