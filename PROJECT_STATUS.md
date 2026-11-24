# Project status

_Last updated: 2026-11-24_

## Current phase

**Phase 10 — Clients & projects: complete, verified locally, awaiting owner approval.** Design:
[ADR-017](docs/architecture/ADR-017-clients-and-projects.md). Pushed to `main` on 2026-11-24 at the
owner's request; Phase 11 is **not started** (owner: start on 2026-11-25).

- Phases 01–09: approved and pushed (Phase 09 = `f169c98`); CI not checked from this machine (no
  `gh` CLI).

**Next phase (after approval):** Phase 11 — Documents, helpdesk & workflows (see
`docs/DEVELOPMENT_ROADMAP.md`).

## Phase 10 verification (2026-11-24)

| Check                                                    | Result                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=2`)                                                                                                        |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                          |
| Unit/component tests                                     | ✅ API 81 · shared-types 3 · validation 86 · api-client 12 · design-tokens 38 · business-rules 102 · ui-web 12 · web 63 · mobile 8 (jest)         |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 129 passed (122 earlier + 7 Phase 10)                                                                                                          |
| Migrations                                               | ✅ 12 applied to dev and test; drift check reports no difference                                                                                  |
| Playwright E2E (production build + live API)             | ✅ 14 passed, 12 skipped by design. New: client → project → story moved on the board → milestone invoice drafted, issued (INV-YYYY-0001) and paid |
| GitHub Actions                                           | ⏳ runs when Phase 10 is pushed                                                                                                                   |

## Phase 10 delivered

- **Clients:** code, billing currency, payment terms, tax registration number, billing address,
  contacts, and portal logins.
- **Projects:**
  - Client or internal, billed as time & materials, fixed fee or non-billable, with a default
    rate, budget (amount and hours) and dates.
  - Members with project roles (manager, member, viewer), their own billing rate and allocation.
  - Project managers see hours and approved billable value against the budget.
- **Work:**
  - Epics → features → stories → tasks/bugs → subtasks, numbered per project (`WEB-42`), with
    assignees, priority, points, estimates, due dates, labels and bug severity/steps.
  - The hierarchy is checked by the API and the database.
  - Comments (internal or shared with the client) and an append-only history.
  - **My work** lists everything assigned to you.
- **Sprints & boards:** the project's own board columns; one active sprint; the board shows the
  sprint or the backlog; completing a sprint records velocity and moves unfinished work on.
- **Timesheets:** weekly entries against your projects (quarter hours, at most 24 h a day,
  non-billable projects never billable), submitted to your reporting manager, approved or
  returned with a reason, frozen once approved. HR, finance and billing get a time report with
  billable value.
- **Billing:**
  - Your own tax rates and invoice numbering.
  - Draft invoices from approved, unbilled time at member or project rates, plus fixed-fee lines.
  - Issue (numbered, due date from terms), partial and full payments, void with a reason
    (releases the time).
  - Issued invoices are frozen in the database.
- **Client portal:** client contacts sign in to see:
  - their portal projects and progress;
  - shared items and conversations, where they can reply and report bugs or requests;
  - issued invoices.

  Nothing else is reachable.

## Assumptions (recorded in ADR-017; the owner may override)

1. Timesheets are approved by the reporting manager (as leave and expenses are); a configurable
   chain or project-manager approval arrives with the Phase 11 workflow engine.
2. Invoice tax uses rates you configure; no GST, TDS or e-invoicing (IRN) rule is built in.
3. One currency per invoice (the client's); no conversion of time.
4. Board columns are free-form per project with three categories; any card can move to any column.
5. Client contacts use the normal login with the `client` role; no separate portal domain.
6. Time is not pushed into payroll; PDF invoices come with Phase 11 documents.

## Issues found and fixed during Phase 10

1. **Project list crashed for users without an employee record** (for example a new owner): the
   query compared member ids with an empty string, which PostgreSQL rejects as a UUID. Fixed, and
   covered by the integration test.
2. Validation reported a bad entry's hours twice (field and week checks); the week check now
   leaves per-entry hours to the field.
3. The new-item dialog loaded the project's items even while closed; it now loads only when open.
4. ADR-017 first said project managers approve timesheets; corrected to match the decision
   (reporting manager) and the as-built grants.
5. The registration test listed the system roles explicitly; updated for the new `client` role.

## Known issues and risks

1. **Payroll calculations must be validated by a qualified payroll professional before production
   use** (master rules). The engines are tested with fictional values only.
2. Payroll runs are calculated synchronously in one transaction (5-minute limit); very large
   organizations will need batched background calculation (BullMQ).
3. Arrears for a past month whose revision also started mid-month are approximated.
4. Receipts and documents are not malware-scanned yet (Phase 10/14).
5. Local Node is 22.13.1 (22.22+ or 24 LTS recommended); MinIO was replaced by RustFS.
6. Self-registered owners have no e-mail verification; there are no passkeys.
7. Reference pickers load at most 200 options.
8. Mobile has no payroll, recruitment, onboarding, expense, asset, performance, learning or
   engagement screens yet (Phase 14).
9. **Local machine:** with little free memory, the gate needs `--concurrency=2` and E2E needs
   `--workers=1` with a pre-started preview. Stopping a background `pnpm start` / `pnpm preview`
   can leave node holding the port. See `docs/TESTING_GUIDE.md`.

## Database migration status

| Migration                                         | dev | test |
| ------------------------------------------------- | --- | ---- |
| 20261116000000_platform_foundation                | ✅  | ✅   |
| 20261116000100_organizations_and_audit            | ✅  | ✅   |
| 20261116010000_identity_access_subscriptions      | ✅  | ✅   |
| 20261116020000_user_scope_policies_without_tenant | ✅  | ✅   |
| 20261117000000_organization_structure             | ✅  | ✅   |
| 20261118000000_employee_management                | ✅  | ✅   |
| 20261119000000_time_attendance_leave              | ✅  | ✅   |
| 20261120000000_recruitment_onboarding             | ✅  | ✅   |
| 20261123000000_india_payroll                      | ✅  | ✅   |
| 20261124000000_expenses_travel_assets             | ✅  | ✅   |
| 20261125000000_performance_learning_engagement    | ✅  | ✅   |
| 20261126000000_clients_projects                   | ✅  | ✅   |

## Next recommended task

1. Owner reviews Phase 10 (start `pnpm dev`, sign in as owner, link yourself to an employee):
   - **Clients**: add a client and a contact;
   - **Projects**: create a project, add members with rates, create an epic, stories and a bug,
     plan a sprint, start it and move cards on the **Board**;
   - **My timesheet**: log time and submit (an employee with a manager shows the approval flow
     under **Timesheets**);
   - **Billing**: add a tax rate, draft an invoice from approved time or a milestone, issue it and
     record a payment;
   - **Client portal**: invite a contact under Members with only the **Client** role, link them
     on the client, enable the portal on the project and sign in as them.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 10, then confirm CI is green.
4. Then Phase 11.
