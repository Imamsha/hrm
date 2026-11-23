# ADR-015: Expenses, travel and assets

- Status: Accepted (2026-11-23, Phase 08)
- Builds on: [ADR-011](ADR-011-employee-management.md) (employees, reporting managers, documents
  in S3), [ADR-014](ADR-014-india-payroll.md) (payroll adjustments, settlements)

## Context

Phase 08 adds expense claims and reimbursement, travel requests with bookings, advances and
settlement, and the asset register: allocation and return, maintenance and software licences.

The master rules require that:

- money is decimal-safe;
- tenant isolation holds;
- there is no fake functionality.

They also give OCR of bills to the AI document-intelligence work (Phase 11).

## Decisions

### Expense claims

- **Categories** are the organization's policy. Each category can have:
  - a maximum per item and a maximum per employee per month;
  - a "receipt required above" amount;
  - a per-day limit (for allowances such as per diem);
  - a taxability flag that decides how a payroll reimbursement is treated.

  No limit or amount is pre-loaded.

- **A claim** holds one or more items: date, category, amount in the bill's currency, and an
  exchange rate entered by the claimant (finance may correct it). The amount in the
  organization's currency is derived with Decimal arithmetic.
- **Receipts** are uploaded to S3 under the tenant's prefix after magic-byte sniffing, like
  employee documents.
- **Policy checks** are a pure function in `@hrm/business-rules`. Violations are shown as
  **warnings** with a required justification, or as **blocking errors** (for example a missing
  receipt above the limit). They are never silently trimmed.
- **Approval** is fixed at two steps until the Phase 10 workflow engine exists:
  1. the reporting manager approves (HR in scope when there is no manager); nobody approves
     their own claim;
  2. finance verifies, and may approve a lower amount per item with a reason.
- Every status change is written to an **append-only** event history.
- **Reimbursement** is either through payroll or outside it:
  - **Through payroll:** finance-approved claims for the employee's company are added
    automatically to the next payroll run as one-time earnings, taxable or not per category. The
    claim is marked reimbursed when that run is **finalized**.
  - **Outside payroll:** the claim is marked paid with a reference.

### Travel

- **A travel request** records the purpose, the itinerary legs, dates, an estimated cost and an
  optional advance. It goes through manager approval; the approver cannot be the traveller.
- **The travel desk** (`travel.desk.manage`) records bookings: type, vendor, reference, cost and
  attachment. It also records advances paid, with a reference.
- **After the trip**, the traveller links expense claims to it.
- **Settlement** compares approved claims with advances:
  - if more was claimed, the balance is paid like any approved claim;
  - if less, the balance is recovered through payroll (a one-time deduction) or marked as
    repaid.

### Assets

- **Categories and assets:** asset tag unique per organization, serial number, model, vendor,
  purchase date and cost, warranty end, and a status: IN_STOCK, ALLOCATED, IN_REPAIR, RETIRED or
  LOST.
- **Allocation** to an employee records condition notes and an expected return date. At most
  one open allocation per asset is allowed (partial unique index). The employee acknowledges
  receipt in self-service.
- **Return** records the condition and moves the asset back to stock or to repair.
- **History** is append-only.
- **Maintenance records** hold vendor, cost, dates and outcome.
- **Software licences** have a seat count; seat assignments may never exceed it (checked in a
  transaction under a row lock).
- **Offboarding:** a full & final settlement reports a **problem** while the employee still holds
  allocated assets or licence seats.
- **Book value:** optional straight-line depreciation, computed as a report from the cost,
  useful life and salvage value the organization enters. It is not accounting.

### As built

- **Schema:** `20261124000000_expenses_travel_assets` adds 15 tenant tables with RLS. Database
  rules:
  - claim items are frozen once submitted (only the approved amount and the finance note may
    change, and only during finance verification);
  - reimbursed and cancelled claims, and cancelled, rejected or settled trips, never change;
  - one open allocation per asset, and one active seat per person per licence (partial unique
    indexes);
  - claim and asset histories are append-only;
  - same-tenant triggers on optional references.
- **Routing:** the approver is the claimant's reporting manager at submission. When there is no
  manager, the claim moves straight to finance and the history records why. Nobody approves or
  verifies their own claim or trip.
- **Trips with advances:** their claims are not reimbursed on their own. Settlement pays or
  recovers only the net balance: the approved, unpaid claims minus the advances. Claims already
  carried by a payroll run are paid by that run and left out of the settlement.
- **Payroll link (`modules/payroll/payroll-links.ts`):**
  - Calculating a run attaches each employee's finance-approved claims with payroll payout, as
    `EXP_REIMB` (non-taxable categories) and `EXP_REIMB_TX` (taxable categories).
  - It also attaches settled trip balances, as `TRAVEL_SETTLE` (payout) or `TRAVEL_RECOVERY`
    (deduction).
  - Finalizing marks those claims REIMBURSED with reference `Payroll YYYY-MM` and completes the
    recoveries. Cancelling releases them for the next run.
- **Offboarding:** a full & final settlement reports a problem for:
  - assets still allocated;
  - licence seats still assigned;
  - claims still awaiting a decision;
  - approved claims not yet reimbursed.
- **Book value:** computed from the category's useful life and salvage percentage at read time;
  nothing is stored.

## Assumptions (the owner may override)

1. OCR of bills is deferred to Phase 11; amounts are entered by hand.
2. Approval is fixed at two levels (manager, then finance) until Phase 10. Expense, travel and
   asset permissions are organization-wide apart from the manager's own team.
3. Exchange rates are entered manually; there is no rate feed yet (integration, Phase 14).
4. Booking is recorded, not performed: there is no booking-engine integration.
5. Depreciation is informational only, not an accounting ledger.
