# ADR-017: Clients and projects

- Status: Accepted (2026-11-24, Phase 10) — assumptions below await owner confirmation
- Builds on: [ADR-009](ADR-009-authorization-rbac-abac.md) (roles, invitations),
  [ADR-011](ADR-011-employee-management.md) (employees, reporting managers),
  [ADR-014](ADR-014-india-payroll.md) (money as decimals)

## Context

The owner added a delivery module (2026-11-24). It covers:

- clients and their contacts;
- projects with members, rates and budgets;
- a work hierarchy: epics/features → stories → tasks and bugs, with assignments;
- sprints and boards;
- timesheets;
- client billing;
- a client portal.

It must follow the platform rules:

- tenant isolation through RLS;
- money as decimals;
- no hard-coded tax rates;
- no business logic in controllers;
- the shared Zod schemas.

## Decision

### Clients and projects

- A **client** has a code, name, billing currency, payment terms (days), billing address, tax
  registration number (free text, not validated against any authority) and **contacts**.
- A **project** has:
  - a key (`^[A-Z][A-Z0-9]{1,9}$`, unique per organization) used in work item numbers;
  - an optional client (internal projects have none);
  - a billing type: `TIME_AND_MATERIALS`, `FIXED_FEE` or `NON_BILLABLE`;
  - a default hourly rate, an optional budget amount and budget hours;
  - dates and a status (`PLANNED` / `ACTIVE` / `ON_HOLD` / `COMPLETED` / `CANCELLED`).
- **Project members** are employees with a project role (`MANAGER` / `MEMBER` / `VIEWER`), an
  optional billing rate override and an allocation %. Project managers manage the project's
  members, rates, columns and sprints; people with `projects.project.manage` manage every project.

### Work items

- One table, `work_items`, holds every type: `EPIC`, `FEATURE`, `STORY`, `TASK`, `BUG`, `SUBTASK`.
- Parents follow a fixed hierarchy:
  - EPIC → FEATURE/STORY;
  - FEATURE → STORY;
  - STORY → TASK/BUG/SUBTASK;
  - TASK/BUG → SUBTASK;
  - BUG may also be top-level.
- The hierarchy is validated in `@hrm/business-rules` and by a database trigger (same project, no
  cycles).
- Each item gets a per-project number, e.g. `WEB-42`. Numbers come from a counter on the project,
  incremented under a row lock, and are never reused.
- Fields:
  - title, description;
  - **status** (one of the project's board columns);
  - priority `LOWEST…HIGHEST`;
  - assignee (a project member), reporter;
  - story points, estimate hours, due date, labels;
  - for bugs: severity, steps to reproduce and environment;
  - a **client visible** flag.
- **Board columns** are configured per project. Each column has a category (`TODO` /
  `IN_PROGRESS` / `DONE`), and a new project gets three default columns, one per category. The
  category drives progress and sprint completion; column names are the project's own.
- Comments (internal or client-visible) and an **append-only** activity history: status, assignee
  and sprint changes.

### Sprints

- A sprint belongs to one project and is `PLANNED` → `ACTIVE` → `COMPLETED`. Only one sprint per
  project can be active, enforced by a partial unique index.
- Completing a sprint records its committed and completed story points (velocity). Unfinished
  items move to the backlog or to a chosen planned sprint.
- The board shows the active sprint (or the backlog) by column. Moving a card changes its status
  and writes history.

### Timesheets

- **Weekly timesheets:** one per employee per week (Monday start), `DRAFT` → `SUBMITTED` →
  `APPROVED` / `REJECTED`, then back to draft.
- **Entries:**
  - date within the week, project (the employee must be a member), optional work item;
  - hours from 0.25 to 24 in quarter steps, a billable flag (forced false on non-billable
    projects) and a note;
  - at most 24 hours per day across entries.
- **Approval:** each timesheet is approved by the employee's **reporting manager**, or by someone
  with `projects.timesheet.approve` when there is no manager. Nobody approves their own timesheet.
  Approved timesheets are frozen in the database.

### Billing

- **Tax rates** are configured by the organization (name, rate %, effective dates); none are
  seeded, and no GST or VAT rule is assumed.
- **An invoice belongs to one client and one currency.** Lines come from:
  - approved, billable, not-yet-invoiced time entries of the client's T&M projects for a period,
    at the member's rate or the project's default rate (one line per project and person);
  - and/or manual lines (fixed-fee milestones, other charges).
- Each line has quantity × unit price; amounts are rounded half-up to 2 decimals with
  `@hrm/business-rules`. Tax is applied per line from the chosen tax rate.
- **Status flow:** `DRAFT` → `ISSUED` (numbered from the organization's sequence, e.g.
  `INV-2026-0001`, with the due date from the payment terms) → `PAID`, or `VOID`.
  - Payments are recorded and partial payments are allowed; the invoice is `PAID` when the
    balance is zero.
  - Time entries on an issued invoice cannot be invoiced again. Voiding releases them.
  - Issued and paid invoices are frozen in the database, except for status and payments.
- PDF invoices come with the Phase 11 documents module; this phase stores and displays them.

### Client portal

- **Client contacts** can be invited through the existing invitation flow with a new system role
  **`client`** whose only permission is `projects.portal.access`.
- A `client_portal_users` row links the membership to one client.
- Portal routes (`/portal/**`) show only that client's projects (and only those with the portal
  enabled):
  - progress by board category;
  - client-visible work items and comments;
  - issued invoices.
- Contacts can raise a **bug or request**, which is created as a client-visible item reported by
  the portal user, and they can comment.
- They never see:
  - internal comments;
  - rates, hours of individuals, timesheets or draft invoices;
  - any HR data. The `client` role has no other permission, so every other endpoint denies.

### Permissions (new)

| Permission                   | Meaning                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `projects.client.manage`     | Clients, contacts, portal users                                 |
| `projects.project.read`      | See every project (otherwise only projects you are a member of) |
| `projects.project.manage`    | Create projects, manage members/rates and any project's work    |
| `projects.timesheet.read`    | All timesheets and time reports                                 |
| `projects.timesheet.approve` | Approve timesheets of employees without a manager               |
| `projects.billing.manage`    | Tax rates, invoices, payments                                   |
| `projects.portal.access`     | Client portal (the `client` role only)                          |

Owner and admin hold all permissions. `manager` gets `projects.project.read`; `hr_admin` gets
project read, timesheet read and timesheet approve; `finance` gets project read, timesheet read and
billing. Members work on their own projects through
`employees.self.access`.

### As built

- Migration `20261126000000_clients_projects`: 17 tenant tables with RLS and composite same-tenant
  keys. Guards:
  - `app.work_item_guard`: column, sprint and parent belong to the item's project; the parent
    type fits the hierarchy; no cycles; items never move between projects.
  - `app.timesheet_guard`: approved weeks never change.
  - `app.time_entry_guard`: entries change only in draft or rejected weeks; afterwards only the
    invoice link may change, and only approved time can be invoiced.
  - `app.invoice_guard` / `app.invoice_line_guard`: issued invoices keep their content; paid and
    void invoices never change; lines change only on drafts.
- Partial unique index: one active sprint per project. Comments, history and payments are
  append-only.
- Seven permissions; the `client` system role is created for existing organizations and for new
  ones (`SYSTEM_ROLES`).
- `modules/projects`: clients, projects (members, columns, sprints, work items, board), timesheets
  (week, approval, report), billing (tax rates, numbering, invoices, payments) and portal services.
  Work item numbers and invoice numbers are allocated under row locks.
- Drafting an invoice reserves its time entries (row-locked), so the same hours cannot be on two
  invoices. Deleting a draft or voiding an unpaid invoice releases them; paid invoices cannot be
  voided.
- A portal login must hold only the `client` role and have no employee record. The portal never
  returns rates, individuals' hours, timesheets, internal comments or draft/void invoices.
- Web: My work, My timesheet, Projects (board, backlog, sprints, members, settings with a column
  editor), the work item page, Timesheets (approvals, all, time report), Clients (contacts, portal
  logins), Billing (invoices, tax rates, numbering) and the client portal (projects, items with
  replies, bug/request form, invoices). Client contacts land on the portal; staff never see it in
  the navigation (`hideWith`).

## Assumptions (to confirm with the owner)

1. Timesheet approval follows the reporting line, as leave and expenses do; project managers see
   their project's time but do not approve it. A configurable approval chain arrives with the
   Phase 11 workflow engine.
2. Tax on invoices uses rates the organization configures; no GST, TDS or e-invoicing (IRN) rule
   is built in. E-invoicing and accounting exports are Phase 15 integrations.
3. One currency per invoice (the client's); no exchange-rate conversion of time.
4. Board columns are per project with three categories; workflow transitions are unrestricted
   between columns.
5. Client contacts sign in with the same login as staff (separate user accounts, role `client`).
   A separate branded portal domain is out of scope.
6. Time entries are not pushed into payroll; project costing reports are Phase 13 analytics.

## Consequences

- One work-item table keeps boards, backlogs and the hierarchy simple. Type-specific fields are
  nullable, with CHECKs.
- Reusing memberships for clients gives them MFA, sessions and audit for free. The cost is that
  every portal query must go through the client link, which the integration tests cover.
