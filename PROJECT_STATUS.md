# Project status

_Last updated: 2026-11-26_

## Current phase

**Phase 11b — Helpdesk, separation & offboarding, compliance: complete, approved and pushed.** Design: [ADR-019](docs/architecture/ADR-019-helpdesk-separation-compliance.md).
Demo data for manual testing: `pnpm seed:demo` (logins in `docs/TESTING_GUIDE.md`).

- Phases 01–11b: approved and pushed (Phase 11a = `ebe5bd4`); CI not checked from this machine
  (no `gh` CLI).
- With 11b, Phase 11 (documents, helpdesk & workflows) is complete.

**Next phase (after approval):** Phase 12 — Advanced AI platform (see `docs/DEVELOPMENT_ROADMAP.md`).

## Phase 11b verification (2026-11-26)

| Check                                                    | Result                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=2`)                                                                                                                                          |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                                                            |
| Unit/component tests                                     | ✅ API 81 · shared-types 3 · validation 94 · api-client 12 · design-tokens 38 · business-rules 116 · ui-web 12 · web 72 · mobile 8 (jest)                                           |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 149 passed (141 earlier + 8 Phase 11b)                                                                                                                                           |
| Migrations                                               | ✅ 14 applied to dev and test; drift check reports no difference                                                                                                                    |
| Playwright E2E (production build + live API)             | ✅ 16 passed, 14 skipped by design. New: helpdesk category with SLA → urgent ticket raised, answered, resolved, closed → monthly compliance task completed and rolled to next month |
| GitHub Actions                                           | ⏳ runs when Phase 11b is pushed                                                                                                                                                    |

## Phase 11b delivered

- **Helpdesk:**
  - Your categories (HR, payroll, IT, …), each with agents, a default assignee, an escalation
    contact and an SLA per priority; categories can be confidential.
  - Tickets are numbered, with due times, breach flags, internal notes, attachments (PDF or
    image), history, rating and reopening.
  - Tickets past their resolution time are escalated every 15 minutes.
  - A knowledge base with search, "was this helpful" votes, and suggestions while raising a
    ticket.
- **Separation & offboarding:**
  - Employees submit a resignation. Your notice period (if set) shows the notice last day and the
    days to waive.
  - It is approved through the workflow engine (new `RESIGNATION` process) or by the reporting
    manager; approval puts the employee on notice.
  - HR can also start terminations, retirements and contract ends.
  - Each separation gets an exit checklist: your clearance items, plus the leaver's assets and
    licence seats (clear themselves when returned or revoked) and the manager's knowledge
    transfer. HR can waive an item with a reason.
  - Exit interviews use your questions and are seen by HR only. Completing the separation
    requires full clearance, then closes employment and suspends the login.
  - Links to the full & final settlement and experience/relieving letters (the last working day
    is merged).
  - Exit analytics: attrition %, by month, type, reason and department; interview averages from 5
    answers.
- **Compliance:**
  - Your obligations (filings, renewals, audits, reviews) with owners and recurrence; none are
    pre-loaded.
  - Tasks are completed with a note and evidence, and the next occurrence follows automatically.
  - An expiry tracker for certifications, licences, fixed-term engagements and tasks.
  - A dashboard with policy acknowledgement rates and recent audit activity.

## Assumptions (recorded in ADR-019; the owner may override)

1. SLA clocks run continuously (no business hours, no pause while waiting on the requester).
2. One notice period for the organization, in days.
3. Clearance must be complete before a separation can be completed (HR can waive items).
4. Exit interviews are linked to the employee but visible only to HR (`separation.interview.read`).
5. No statutory compliance calendar or SLA is shipped; regulatory reports come with sourced
   templates in Phase 13.
6. E-mail reminders for tickets and tasks arrive with Phase 15 notifications.

## Issues found and fixed during Phase 11b

1. **An escalated ticket was invisible to its new assignee** when the escalation contact was not
   an agent of the category. The assignee now always works the ticket.
2. Resignation approval would have needed the employee lifecycle permission, which managers do
   not have. Approval now puts the employee on notice directly (the approval is the authority);
   HR-started separations still use the employment actions with their checks.
3. A validation schema name (`completeTaskSchema`) collided with recruitment's; it is
   `completeComplianceTaskSchema`.
4. **E2E against `pnpm dev`:** your dev API restarts whenever builds change, and a test that hit
   it mid-restart failed with "Unable to reach the server". The suite was run against a separate
   API on port 3101 (web built with `VITE_API_BASE_URL`), leaving your dev session untouched.
5. ADR-019 listed employee-document expiry, but documents carry no expiry date; the tracker covers
   certifications, licences, fixed-term engagements and tasks (noted as carried forward).

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
| 20261127000000_workflows_documents                | ✅  | ✅   |
| 20261128000000_helpdesk_separation_compliance     | ✅  | ✅   |

## Next recommended task

1. Owner reviews Phase 11b (start `pnpm dev`, sign in as owner, link yourself to an employee and
   give someone a manager):
   - **Helpdesk setup**: add a category with agents and an SLA; raise a ticket in **Helpdesk** and
     work it from the queue; add an article in **Knowledge base**;
   - **Separations → Settings**: notice period, clearance items, exit questions; then, as an
     employee, submit a **Resignation**, approve it as the manager and work the exit checklist;
   - **Compliance**: add an obligation, complete its task with evidence, check the dashboard.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 11b, then confirm CI is green.
4. Then Phase 12: advanced AI platform.
