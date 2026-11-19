# Project status

_Last updated: 2026-11-19_

## Current phase

**Phase 05 — Attendance, shifts & leave: implemented and verified locally. Awaiting owner
approval.** Phase 06 has **not** been started. Phase 05 changes are **not committed yet**.

- Phases 01–03: approved, pushed, CI green.
- Phase 04: approved 2026-11-19 and pushed (`fd35129`). Its CI result was not checked from this
  machine.

**Current task:** none. Waiting for the owner to review Phase 05 and to say whether to commit and
push.

## Phase 05 verification (2026-11-19)

| Check                                                    | Result                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=2`)                                                                                                           |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                             |
| Unit/component tests                                     | ✅ 287 passed: API 81 · shared-types 3 · validation 51 · api-client 12 · design-tokens 38 · business-rules 42 · ui-web 12 · web 40 · mobile 8 (jest) |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 91 passed (24 Phase 01 + 38 Phase 02 + 10 Phase 03 + 10 Phase 04 + 9 Phase 05)                                                                    |
| Migrations                                               | ✅ 7 applied to dev and test; drift check reports no difference                                                                                      |
| Playwright E2E (production build + live API)             | ✅ 9 passed (new: link the owner as an employee → clock in → leave type → balance), 7 skipped by design                                              |
| GitHub Actions                                           | ⏳ runs when Phase 05 is pushed                                                                                                                      |

## Phase 05 delivered

- **Calculation core (`@hrm/business-rules`):**
  - IANA time-zone conversion that is DST-safe and needs no new dependency;
  - shift windows, including night shifts;
  - punch pairing and day evaluation: status, worked time, late arrival, early exit, overtime,
    missing punches, half-day leave, holidays and weekly offs, regularization, presence by
    punches when there is no shift;
  - leave-day counting, with half days and the optional "sandwich" rule;
  - leave years starting in any month;
  - yearly accrual (optionally prorated) and monthly accrual with an exact year total;
  - carry-forward and lapse.
- **Shifts:** definitions with grace, full-day and half-day minutes, overtime threshold and punch
  window, plus one organization default; effective-dated assignments with no overlaps (enforced by
  the database); day-level roster overrides, including days off.
- **Attendance:**
  - **Clocking:** web and mobile clock-in toggles IN/OUT, blocks duplicate taps within 60 s, and
    can be turned off per channel with a location requirement. A **QR kiosk** shows a rotating,
    HMAC-signed code; employees scan it with a signed-in phone.
  - **Device imports:** idempotent, with per-row errors.
  - **Manual punches:** audited and never allowed for yourself.
  - **Views:** per-employee day ranges with totals, and a team day summary limited to the
    caller's scope.
  - **Regularization:** requests are routed to the reporting manager, or HR in scope, and take
    effect immediately when approved.
- **Leave:**
  - **Types:** fully policy-configured; no leave type or quota is seeded.
  - **Balances:** an append-only ledger with lazy, idempotent accruals and year-end rollover.
  - **Applications:** a live preview of days, balance and problems; half-day-aware overlap
    detection; must fall within one leave year; minimum notice and maximum days per request;
    serialized per employee so concurrent requests cannot overspend.
  - **Decisions:** approval by the reporting manager or by HR in scope, with the balance
    re-checked; cancelling approved leave writes a reversal.
  - **Other:** HR can apply on an employee's behalf and adjust balances (never their own). An
    approvals inbox combines leave and regularizations.
- **Database:** migration `20261119000000_time_attendance_leave` adds:
  - 9 tenant tables with RLS;
  - append-only punches and leave ledger;
  - idempotency indexes;
  - CHECK constraints;
  - 13 permissions granted to existing organizations' system roles.
- **Web:** a new Time section:
  - My attendance: clock card and month calendar with regularization requests;
  - QR clock-in page and kiosk display;
  - My leave: balances and an apply form with live preview;
  - Approvals, Team attendance (with manual punches), Leave requests;
  - Shifts: definitions and assignments;
  - Leave & attendance policies, including settings.
- **Mobile:** an Attendance screen for clocking in and out.
- **Docs:** ADR-012 is new. Updated: database, API, RBAC matrix, testing, architecture, module
  status, roadmap and owner decisions.

## Assumptions (recorded in ADR-012; the owner may override)

1. No leave types or quotas are seeded; statutory entitlements vary by state and type of
   establishment.
2. Overtime is computed and reported only. Whether and how it is paid is decided in payroll
   (Phase 07).
3. Biometric devices are supported through an import API. Vendor push protocols come in Phase 14.
4. Without a configured work week, attendance treats every day as a working day and leave
   counting refuses. No default weekend is assumed.
5. Regularizations are limited to the last 60 days (product limit, configurable later). The
   approver is the reporting manager or HR in scope; there are no multi-level chains until
   Phase 10.

## Issues found and fixed during Phase 05 verification

1. `GET /employees/:id/attendance` was captured by Phase 04's generic `/employees/:id/:collection`
   route. The range endpoint moved to `/employees/:id/attendance/days`.
2. Cancelling approved leave violated my own CHECK constraint (a decision timestamp was only
   allowed on approved or rejected requests). The constraint now only _requires_ a timestamp for
   those statuses. It was fixed in the migration and in both local databases before anything was
   committed.
3. Integration tests used fixed 2026 dates, which would break as time passes (the 60-day
   regularization limit, monthly accrual counts, leave-year rollover). All dates are now relative
   to today.
4. The E2E member picker selected the "Not linked" option, because the select's index 0 is its
   placeholder.

## Known issues and risks

1. Local Node is 22.13.1 (22.22+ or 24 LTS recommended); MinIO was replaced by RustFS.
2. Self-registered owners have no e-mail verification; there are no passkeys.
3. Reference pickers load at most 200 options.
4. Uploaded documents are not malware-scanned yet (Phase 10/14).
5. Mobile cannot capture location yet; when an organization requires location, the app points
   employees to the web or the kiosk. The mobile app has not been run on a device.
6. Attendance days are computed on every read. Ranges are capped at 93 days and summaries at 500
   employees; very large organizations may need materialized day records (with payroll, Phase 07).
7. A roster planning UI is not built (the API supports roster entries). The UI cannot yet set a
   leave type's employment-type applicability (the API supports it).
8. **Local machine:** with little free memory, the gate needs `--concurrency=2` and E2E needs
   `--workers=1` with a pre-started preview. The dev API sometimes restarts under load. See
   `docs/TESTING_GUIDE.md`.

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

## Next recommended task

1. Owner reviews Phase 05: run `pnpm dev`, then:
   - link yourself as an employee (Employees → profile → Actions → Link login account);
   - open **Time → My attendance**;
   - set up a leave type under **Leave & attendance policies**;
   - try **My leave** and **Approvals**;
   - try the kiosk under **Time → Kiosk**.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 05, then confirm CI is green.
4. Then Phase 06: recruitment and onboarding.
