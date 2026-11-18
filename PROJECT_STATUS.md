# Project status

_Last updated: 2026-11-18_

## Current phase

**Phase 04 — Employee management: implemented and verified locally. Awaiting owner approval.**
Phase 05 has **not** been started. Phase 04 changes are **not committed yet**.

- Phase 01: approved, committed (`9bb442c`), CI green on GitHub.
- Phase 02: approved, pushed (`580d91c`), CI green.
- Phase 03: approved 2026-11-18, pushed (`7c144cd`), CI green.

**Current task:** none. Waiting for the owner to review Phase 04 and to say whether to commit and
push.

## Phase 04 verification (2026-11-18)

| Check                                                    | Result                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=3`)                                                                                                           |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                             |
| Unit/component tests                                     | ✅ 254 passed: API 79 · shared-types 3 · validation 46 · api-client 12 · design-tokens 38 · business-rules 21 · ui-web 12 · web 36 · mobile 6 (jest) |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 82 passed (24 Phase 01 + 38 Phase 02 + 10 Phase 03 + 10 Phase 04)                                                                                 |
| Migrations                                               | ✅ 6 applied to dev and test; drift check reports no difference on both                                                                              |
| Playwright E2E (production build + live API)             | ✅ 8 passed (new: add employee → profile → address → directory), 6 skipped by design                                                                 |
| GitHub Actions                                           | ⏳ runs when Phase 04 is pushed                                                                                                                      |

## Phase 04 delivered

- **Employees API** (`modules/employees`):
  - **Joining:** creates the employee and the first employment record together. Employee numbers
    are generated from per-organization settings (prefix, padding, next number) and are safe
    under concurrency; manual numbers are also accepted.
  - **Directory:** server-side search, filters (company, branch, department subtree, team,
    designation, manager, type, status) and sorting.
  - **Profile:** includes per-caller access flags and lets HR link a login account.
- **Job history:** effective-dated `employment_records`.
  - The database makes overlapping periods impossible, and history is append-only (no edits
    other than closing a record, no deletes).
  - Change types: transfer, promotion, redesignation, manager change, employment-type change and
    reorganization. One change can be scheduled for the future at a time.
  - Circular reporting lines are rejected, and direct reports can be listed.
- **Lifecycle:**
  - confirm, or extend, probation;
  - record a separation: notice, then withdraw or complete; completing it closes the employment
    record and suspends the linked login (owners excepted);
  - record a rejoining (prior history is kept).
- **Profile data:** addresses, emergency contacts (one primary), family, education, experience,
  certifications and skills, all with validation and audit entries.
- **Sensitive data:**
  - Bank accounts (IFSC validated), PAN and UAN are AES-256-GCM encrypted and shown masked; each
    full reveal is audited.
  - Aadhaar numbers are deliberately not collected.
  - Audit entries for personal fields record field names only, never values.
- **Documents:**
  - S3 storage under tenant-prefixed keys, 10 MB limit.
  - File type is detected from the file's content, not its declared type; a SHA-256 hash is
    stored.
  - Downloads stream through the API and are audited.
- **Scoped access (first real use of the Phase 03 scopes):**
  - Grants at any scope pass the guard; the service then limits data to the caller's scopes.
    Employees outside those scopes return 404.
  - Scoped hiring and transfers also require the scope of the destination placement.
  - Numbering settings require an organization-wide grant.
- **Self-service (`/me/employee`):** employees can view their own profile, history, team and
  masked bank/tax data; edit their contact details; and maintain their own personal and
  background records.
- **Database:** migration `20261118000000_employee_management` adds:
  - 13 tenant tables with RLS;
  - the `btree_gist` exclusion constraint;
  - placement-consistency and append-only triggers;
  - CHECK constraints;
  - DELETE revoked on employees and their job history;
  - 11 permissions granted to existing organizations' system roles.
- **Web:** People section with the Employees directory and a tabbed employee profile (overview,
  job history, personal, background, bank & tax, documents, reports), all actions in dialogs, and
  **My profile** built on the same component. The Phase 03 form engine was extracted into a
  reusable `ResourceForm` and gained date, checkbox and section fields.
- **Mobile:** a read-only "My profile" screen.
- **Docs:** ADR-011 is new. Updated: database, API, RBAC matrix, testing, deployment
  (`btree_gist`), architecture, module status, roadmap and owner decisions.

## Assumptions (recorded in ADR-011; the owner may override)

1. Aadhaar numbers are **not** stored, because of Aadhaar Act and UIDAI storage restrictions.
   Identity-proof documents can be uploaded instead.
2. Salary and salary-revision history are deferred to Phase 07 (payroll).
3. Employee self-service edits apply immediately, limited to contact and background data.
   Approval workflows arrive in Phase 10.
4. Login accounts are linked to employees explicitly by HR; nothing is auto-linked by e-mail.

## Issues found and fixed during Phase 04 verification

1. **Long dialog forms could not be submitted:** the footer was pushed off-screen because the
   `<form>` wrapper broke the dialog's scrolling layout. This also affected the Phase 03 forms and
   the invite form. Found by E2E and fixed.
2. **Creating an employee with an empty employee number failed:** the form sent `null`. The form
   now omits the field, and the schema also accepts `null`. A regression test was added.
3. **Duplicate address type or skill name was reported on the wrong field:** the constraint
   naming varies, so the 409 mapping now falls back to the field the caller declared.
4. **Phase 03 `DATABASE_SCHEMA.md` (as committed in `7c144cd`) had a duplicated block and was
   missing the structure table:** a doc-generation script had expanded `$` patterns. Repaired.

## Known issues and risks

1. Local Node is 22.13.1 (22.22+ or 24 LTS recommended); see ADR-001.
2. MinIO was replaced by RustFS (ADR-007).
3. Self-registered owners have no e-mail verification yet, and there are no passkeys.
4. Reference pickers, including the manager picker, load at most 200 options.
5. Uploaded documents are not malware-scanned yet (planned for Phase 10/14). Content-type
   checks limit uploads to PDF and images.
6. The mobile app is read-only for profiles and has not been run on a device or emulator.
7. Subscription plans carry no pricing, and the pnpm "agent skills" prompt is still unapproved.
8. **Local machine:** low free memory makes the turbo gate time out at default concurrency (it
   passes with `--concurrency=3`). Argon2 registration can take more than 5 s while E2E tests
   run in parallel, so the E2E registration wait is now 15 s. See `docs/TESTING_GUIDE.md`.

## Database migration status

| Migration                                         | dev | test |
| ------------------------------------------------- | --- | ---- |
| 20261116000000_platform_foundation                | ✅  | ✅   |
| 20261116000100_organizations_and_audit            | ✅  | ✅   |
| 20261116010000_identity_access_subscriptions      | ✅  | ✅   |
| 20261116020000_user_scope_policies_without_tenant | ✅  | ✅   |
| 20261117000000_organization_structure             | ✅  | ✅   |
| 20261118000000_employee_management                | ✅  | ✅   |

## Next recommended task

1. Owner reviews Phase 04: run `pnpm dev`, then open http://localhost:5180/people/employees.
   Also try My profile with an invited employee linked from the profile's Actions menu.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 04, then confirm CI is green.
4. Then Phase 05, attendance, shifts and leave, built on employee placements, work weeks and
   holiday calendars.
