# Project status

_Last updated: 2026-11-23_

## Current phase

**Phase 08 — Expenses, assets & travel: implemented and verified locally. Awaiting owner
approval.** Phase 09 has **not** been started. Phase 08 changes are **not committed yet**.

- Phases 01–06: approved and pushed. Phase 07: approved and pushed (`d454f0e`); CI not checked from
  this machine (no `gh` CLI).

**Current task:** none. Waiting for the owner to review Phase 08 and to say whether to commit and
push.

## Phase 08 verification (2026-11-23)

| Check                                                    | Result                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=2`)                                                                                                                                    |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                                                      |
| Unit/component tests                                     | ✅ API 81 · shared-types 3 · validation 74 · api-client 12 · design-tokens 38 · business-rules 82 · ui-web 12 · web 54 · mobile 8 (jest)                                      |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 113 passed (107 earlier + 6 Phase 08)                                                                                                                                      |
| Migrations                                               | ✅ 10 applied to dev and test; drift check reports no difference                                                                                                              |
| Playwright E2E (production build + live API)             | ✅ 12 passed, 10 skipped by design. New: claim → routed to finance (no manager) → invited finance user approves and marks paid → asset registered, allocated and acknowledged |
| GitHub Actions                                           | ⏳ runs when Phase 08 is pushed                                                                                                                                               |

## Phase 08 delivered

- **Expense claims:**
  - Categories carry the organization's own limits (per item, month or day), receipt threshold and
    payroll taxability. None are pre-filled.
  - Multi-item claims in any currency, with an entered exchange rate and receipts in S3.
  - Live policy check. Missing receipts, future or stale dates and inactive categories block
    submission; over-limit items need a justification.
  - Routing: the reporting manager approves first; without a manager, the claim goes straight to
    finance.
  - Finance verifies the amount per item (lower with a reason) and chooses payroll or outside
    payroll.
  - Every step is in an append-only history. Submitted items are frozen in the database.
- **Reimbursement:**
  - Payroll payouts become one-time lines in the next run, taxable or not by category. They are
    marked reimbursed when the run is finalized.
  - External payouts are marked paid with a reference.
- **Travel:**
  - Requests with itinerary legs, approved by the manager (or HR when there is no manager), never
    by the traveller.
  - The travel desk records bookings and advances.
  - Trip claims link to the trip, and the settlement nets approved claims against advances. Only
    the balance is paid or recovered, through payroll or outside it.
- **Assets:**
  - A register with categories, serials, purchase details, warranty and an informational
    straight-line book value.
  - Allocation (one holder at a time), employee acknowledgement in **My assets**, return with
    condition, status changes, maintenance and an append-only history.
- **Software licences:** seat counts that assignments can never exceed.
- **Offboarding:** the full & final settlement now flags unreturned assets, assigned licence seats,
  undecided claims and unpaid approved claims.

## Assumptions (recorded in ADR-015; the owner may override)

1. OCR of bills is deferred to Phase 11; amounts are entered by hand.
2. Approval is fixed at two levels (manager → finance) until the Phase 10 workflow engine.
3. Exchange rates are entered manually; there is no rate feed (Phase 14).
4. Bookings are recorded, not made; there is no booking-engine integration.
5. Depreciation is informational only, not an accounting ledger.
6. Expense, travel and asset permissions are organization-wide; manager approval is by reporting
   line.

## Issues found and fixed during Phase 08

1. **Partial asset updates would have cleared fields.** The nullable date and money schemas
   turned an omitted field into `null`, so a PATCH of an asset's name would have wiped its
   purchase date, cost and warranty. Fixed with outer `.optional()`, with a regression test. The
   same check found the licence update schema had the issue too, and it is fixed as well.
2. **Trip claims could have been paid twice.** Claims of a trip with an advance would have been
   reimbursed on their own _and_ through the trip settlement. They are now held for the
   settlement, and claims already carried by a payroll run are excluded from it.
3. Submitting a claim recorded the answered warnings without the month-to-date context. It now
   reuses the full policy check.
4. A conditional `usePermission` call in the travel page broke the rules of hooks; fixed.
5. E2E: a first run hit your dev API while `--watch` was restarting it after a rebuild ("Unable to
   reach the server"). The rerun passed. Two locators were too broad and one test label was wrong
   ("Laptops (LAPTOP)"); fixed.

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
8. Mobile has no payroll, recruitment, onboarding, expense or asset screens yet (Phase 13).
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

## Next recommended task

1. Owner reviews Phase 08 (`pnpm dev` is running):
   - **Expense setup**: add categories and limits;
   - **My expenses**: claim with receipts and submit;
   - **Expense approvals**: approve as the manager, then as finance;
   - **My travel / Travel requests**: request, approve, record an advance and settle;
   - **Assets**: register, allocate, then confirm in **My assets**;
   - **Software licences**: add one and assign its seats.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 08, then confirm CI is green.
4. Then Phase 09: performance, learning and engagement.
