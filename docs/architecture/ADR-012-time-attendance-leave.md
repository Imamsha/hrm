# ADR-012: Shifts, attendance and leave

- Status: Accepted (2026-11-19, Phase 05)
- Builds on: [ADR-010](ADR-010-organization-structure-and-scoped-access.md) (calendars),
  [ADR-011](ADR-011-employee-management.md) (employees, scoped access)

## Context

Phase 05 adds time and attendance (shifts, clocking, attendance days, corrections) and leave
(types, balances, applications, approvals). Payroll (Phase 07) will consume both. The master
rules forbid inventing statutory rules, so every threshold, quota and counting rule must be the
organization's own configuration.

## Decisions

### Raw events are stored; attendance days are computed

- `attendance_punches` stores raw IN/OUT events from web, mobile, a kiosk QR code, device imports
  and manual HR entry, with an optional location. The table is **append-only**: a trigger and
  revoked privileges forbid UPDATE and DELETE.
- Attendance days are **not stored**. `evaluateDay` in `@hrm/business-rules` is a pure function
  that computes each day from:
  - the punches inside the shift's punch window;
  - the employee's calendar (work week and holidays of their branch on that date, following job
    history);
  - the shift (roster entry → shift assignment → organization default);
  - any approved regularization;
  - approved leave.

  From these it derives status, worked minutes, late arrival, early exit, overtime and
  missing-punch flags. A correction (approved regularization, approved leave, late device import,
  shift change) is reflected immediately, with no recompute job and no stale snapshot. Payroll
  will snapshot the computed days when a run is finalized (Phase 07).

- **Time zones:** times are local to the employee's branch, falling back to the company and then
  the organization. Conversion uses `Intl` (IANA zones, DST-safe) with no extra dependency. Night
  shifts belong to the date they start on, and each punch is claimed by exactly one day.
- Without a configured shift, presence is judged from punches alone. Without a configured work
  week, every day counts as a working day for attendance, while leave counting refuses with a
  clear error. **No default weekend is invented.**

### Thresholds are configuration

Each shift defines:

- start and end time (an end before the start crosses midnight);
- break;
- grace for late arrival and for early exit;
- the minutes needed for a full day and for a half day;
- an optional overtime threshold;
- the punch window before the start and after the end.

Overtime is computed and reported only; whether and how it is paid is a payroll decision. On
weekly offs and holidays all worked time counts as overtime.

### QR kiosk

- A kiosk screen shows a QR code with a link containing an HMAC-signed token (the key is derived
  from the server secret). The token is bound to the organization and branch and rotates every
  `qrRotationSeconds`. The API accepts the current and the previous window only, so a photographed
  code stops working after two rotations.
- The employee scans the code with a signed-in phone and the punch is recorded with source QR.
- Web and mobile clock-in can each be disabled per organization, and a location can be required
  for non-QR punches.

### Device imports

- `POST /attendance/punches/import` accepts device exports (employee number, time, direction).
- It is idempotent through a unique `(employee, time, direction)` constraint.
- Vendor push protocols are integration work for Phase 14; no device contract is assumed.

### Regularization

- Employees request corrected in/out times for a day: up to 60 days back, never the future, and
  only one pending request per day (a partial unique index).
- The **reporting manager**, or anyone holding `attendance.record.manage` in scope, decides.
  Nobody can decide their own request.
- An approved regularization replaces that day's punches in the evaluation; the punches
  themselves remain stored.

### Leave: types are policy; balances are a ledger

- A leave type configures:
  - paid or unpaid, and whether a balance is tracked;
  - accrual: yearly grant (optionally prorated for joiners), monthly (quota ÷ 12, with the
    rounding remainder in the last month so the year sums exactly) or none;
  - carry-forward cap, negative-balance allowance, half days;
  - whether weekly offs and holidays inside a leave are counted (the "sandwich" rule);
  - minimum notice and maximum days per request;
  - availability during probation, and which employment types it applies to.
- The leave year starts in a configurable month.
- **No leave type or quota is seeded:** statutory entitlements differ by state and establishment
  type.
- `leave_ledger_entries` is **append-only** (opening, accrual, adjustment, usage, reversal,
  carry-forward, lapse); the balance is the sum of entries.
  - Accruals and year-end rollovers are written **lazily and idempotently** when a balance is
    needed. Partial unique indexes and `ON CONFLICT DO NOTHING` let concurrent readers converge
    on the same ledger, with no scheduled job.
  - Approval writes a usage entry; cancelling approved leave writes a reversal.
- Applications:
  - Days are counted by `countLeaveDays` from the employee's calendar, with half-day sessions.
    Overlap detection is half-day aware, so a morning leave and an afternoon leave on one day
    are allowed.
  - A request must fall within one leave year.
  - The employee's row is locked (`FOR UPDATE`), so concurrent applications cannot overspend the
    balance.
  - The routing approver is the reporting manager at the time of the request; anyone with
    `leave.request.approve` in scope can also decide. The balance is re-checked at approval.
- Policy changes apply to future accruals; earlier ledger entries are never rewritten.

### Access

- Self-service uses organization-wide `attendance.self.use` and `leave.self.use`. Team views use
  `@RequireScopedPermissions` with scope filters, as in ADR-011.
- Managers approve their direct reports by reporting line, without needing an HR role.
- `/me/approvals` combines pending leave and regularizations the caller may decide.

## Deferred

- Overtime approval and compensatory-off grants (with payroll and workflows, Phases 07 and 10).
- Leave encashment and leave in final settlement (Phase 07).
- Multi-step approval chains, delegation and escalation (Phase 10 workflow engine).
- Biometric vendor push integrations, geofencing per branch, and mobile location capture (Phases
  13 and 14).
- Attendance analytics dashboards beyond the day summary and monthly register (Phase 12).
- A roster planning UI beyond the API: the web shows shift definitions and assignments, and roster
  overrides are API-only in this phase.
