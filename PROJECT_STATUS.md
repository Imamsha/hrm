# Project status

_Last updated: 2026-11-26_

## Current phase

**Phase 11a — Workflow engine & documents: complete, verified locally, awaiting owner approval.**
Design: [ADR-018](docs/architecture/ADR-018-workflows-and-documents.md). Nothing of Phase 11a is
committed when Phase 11b starts (owner approval 2026-11-26).

- Phases 01–10: pushed (Phase 10 = `ef2ef1e`); CI not checked from this machine (no `gh` CLI).
- Owner decisions 2026-11-26: Phase 11 is split into **11a** (workflow engine, documents,
  e-acceptance) and **11b** (helpdesk, separation & offboarding, compliance). Signing is a
  built-in e-acceptance; provider e-signatures move to Phase 15.

**Next phase (after approval):** Phase 11b — helpdesk, separation & offboarding, compliance.

## Phase 11a verification (2026-11-26)

| Check                                                    | Result                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=2`)                                                                                                                               |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                                                 |
| Unit/component tests                                     | ✅ API 81 · shared-types 3 · validation 90 · api-client 12 · design-tokens 38 · business-rules 110 · ui-web 12 · web 67 · mobile 8 (jest)                                |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 141 passed (129 earlier + 12 Phase 11a; payslip and invoice PDF checks added to existing tests)                                                                       |
| Migrations                                               | ✅ 13 applied to dev and test; drift check reports no difference                                                                                                         |
| Playwright E2E (production build + live API)             | ✅ 15 passed, 13 skipped by design. New: design and activate a two-step leave workflow → template with a merge field → letter generated, accepted, certificate available |
| GitHub Actions                                           | ⏳ runs when Phase 11a is pushed                                                                                                                                         |

## Phase 11a delivered

- **Approval workflows:** your own chains for leave, expense claims (manager stage), travel and
  timesheets.
  - Steps go to the reporting manager, a higher manager, anyone with a role, or a named person.
  - A step can apply only above a threshold (days, amount or hours).
  - A step can have an SLA; when it is late, it escalates to the approver's manager or a named
    person.
  - Steps that would go to the requester, or that nobody can decide, are skipped and recorded.
  - Running approvals keep the steps they started with.
  - Without an active workflow, every request keeps today's rule.
- **Approval inbox and delegation:**
  - One inbox for every waiting step, with overdue, "on behalf of" and escalation badges.
  - Approve or reject (with a reason) from the inbox or from the request's own page.
  - Delegate your approvals for a period (all or chosen processes); revoking hands them back.
  - The approval trail shows who decided what.
- **Document templates:**
  - Letters in your own wording with merge fields per category (offer, appointment,
    experience, relieving, salary certificate, policy, other).
  - Unknown fields are refused; published versions never change.
- **Generated documents:**
  - PDF letters filled from employee or offer records. Values not on record (e.g. the last
    working day) are asked for; a letter is never produced with a gap.
  - Each file is stored with its SHA-256.
- **E-acceptance:**
  - Employees accept when signed in.
  - Candidates accept an offer letter from an e-mailed link with a one-time code; this marks the
    offer accepted.
  - The record holds who, how, when, the IP address and the hash. A replaced file is refused.
  - A certificate page is appended once everyone has accepted.
  - The UI states that this is not a qualified or Aadhaar e-signature.
- **Company documents:** PDF policies for everyone or a department, versioned, with
  per-version acknowledgement and counts.
- **PDFs** of finalized payslips and of issued invoices (billing and client portal).

## Assumptions (recorded in ADR-018; the owner may override)

1. Workflows cover leave, expense claims (manager stage), travel and timesheets; requisitions,
   profile changes and regularizations keep their flows for now.
2. A role step needs one approval from any holder (no "all must approve").
3. Escalation reassigns a late step; it never approves or rejects.
4. PDFs use Helvetica (Latin script; amounts with the currency code). Indic scripts need bundled
   fonts later.
5. Uploads are checked to be real PDFs but not malware-scanned yet (Phase 15).

## Issues found and fixed during Phase 11a

1. **DATABASE_SCHEMA.md had been duplicated by the Phase 09 and 10 doc updates.** A regex
   pattern in the inserted text (`$` followed by a backtick) is a special sequence for
   JavaScript's `String.replace`, so the whole document was copied (1,093 lines, four copies,
   no "Migrations" heading). It was rebuilt from the last clean version with the Phase 09–11a
   sections. Doc scripts now use function replacements, and duplicated headings are checked.
2. Escalation first closed the overdue step and opened a new one, which the database rules
   correctly forbid (decided steps never change; one task per step). It now reassigns the
   pending step.
3. Candidate acceptance failed with a 500: the public request had no tenant context for
   auditing. It now runs inside the tenant resolved from the link.
4. The engine's inbox route would have clashed with the Phase 05 `/me/approvals`; it is
   `/me/approval-tasks`.
5. A delegation left active by one test captured a later step in another, as designed. The test
   now revokes it, which also covers revocation.

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

## Next recommended task

1. Owner reviews Phase 11a (start `pnpm dev`, sign in as owner, link yourself to an employee and
   give someone a manager):
   - **Approval workflows**: create a chain (for example manager, then finance above an amount),
     activate it, submit a request as an employee and decide it in **Approval inbox**;
   - **Approval inbox**: delegate your approvals for a few days;
   - **Document templates**: write a letter with merge fields; **Documents**: generate it with a
     signer and accept it; for an offer, generate an offer letter for a sent offer (the candidate
     receives the link in Mailpit);
   - **Company documents**: publish a PDF that needs acknowledgement;
   - download a payslip or invoice PDF.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 11a, then confirm CI is green.
4. Then Phase 11b: helpdesk, separation & offboarding, compliance.
