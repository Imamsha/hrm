# ADR-019: Helpdesk, separation & offboarding, compliance (Phase 11b)

- Status: Accepted (2026-11-26, Phase 11b) — assumptions below await owner confirmation
- Builds on:
  - ADR-011: employees; separation start, withdraw and complete.
  - ADR-014: full & final settlement.
  - ADR-015: assets and licences.
  - ADR-018: workflow engine, documents, library.

## Context

Phase 11b completes Phase 11 with three modules:

- **Helpdesk:** HR, payroll, IT and general tickets; assignment, priorities, SLA, escalation,
  internal comments, attachments, history, knowledge base.
- **Separation:** resignation, approval, notice period, exit interviews, knowledge transfer, asset
  return, account revocation, clearance, F&F, experience/relieving letters, exit analytics.
- **Compliance:** policies and acknowledgements (Phase 11a library), compliance calendar and
  tasks, audit history, document/contract expiry, dashboards.

The platform rules apply as always:

- RLS and tenant isolation;
- no invented legal rules: no statutory deadline, notice period or SLA is seeded;
- decimals for money;
- no business logic in controllers.

## Decision

### Helpdesk (`modules/helpdesk`)

- **Categories** are configured by the organization, for example HR, Payroll, IT and General.
  Each category has:
  - a code;
  - **agents**: the employees who work its tickets, with an optional default assignee;
  - an optional escalation contact;
  - optional confidentiality: visible to its agents only, never to other agents.
- **SLA policy** per category and priority (`LOW`/`MEDIUM`/`HIGH`/`URGENT`): first-response
  hours and resolution hours, both optional. None is pre-filled.
- **Tickets:**
  - an employee raises a ticket with a category, subject, description and priority, and a
    number such as `HD-2026-0001`;
  - status flow: `OPEN` → `IN_PROGRESS` → `WAITING_ON_REQUESTER` → `RESOLVED` → `CLOSED`.
    Reopening goes from resolved back to open; tickets close after the requester confirms or
    when an agent closes them;
  - the first response is the first public comment by an agent;
  - due times come from the SLA at creation, and the clock does not pause in 11b;
  - **breaches** are flagged, and a scheduled sweep (BullMQ, every 15 minutes) escalates
    tickets past their resolution time to the category's escalation contact. Escalation
    reassigns; it never closes anything.
- **Comments** are public (requester and agents) or internal (agents only). Both are
  append-only and live with an append-only event history.
- **Attachments:** PDF or images, at most 10 MB, sniffed by magic bytes and stored in S3 under
  the tenant prefix.
- **Satisfaction:** the requester may rate a resolved ticket 1–5.
- **Knowledge base:**
  - articles in a category, `DRAFT` / `PUBLISHED` / `ARCHIVED`;
  - plain-text body, searchable (title/body ILIKE);
  - "was this helpful" votes;
  - published articles matching the subject are suggested while raising a ticket.

### Separation & offboarding (`modules/separation`)

- **Resignation:**
  - The employee submits a resignation with a reason category, a note and a requested last
    working day.
  - **Notice period:** an organization setting in days (none is assumed). With a setting, the
    computed last day is shown and an earlier requested day needs a waiver at approval. Without
    a setting, the requested day is used.
- **Approval:**
  - Through the workflow engine (new process `RESIGNATION`); without a workflow, the reporting
    manager decides, or HR (`separation.case.manage`) when there is no manager.
  - Approval records the agreed last working day and starts the existing separation: status
    `ON_NOTICE`.
  - A rejection or the employee's withdrawal before approval leaves employment unchanged.
- **Separation case:**
  - One per separation: resignations start one when approved, and HR can start one for
    termination, retirement or contract end.
  - It holds the reason, the last working day and the **clearance checklist**.
- **Clearance:**
  - Items are generated when the case starts:
    - from the organization's **clearance template** (items with a responsible role or a named
      employee, e.g. "Return ID card — Admin");
    - **one item per allocated asset and licence seat** (from Phase 08), cleared automatically
      when the asset is returned or the seat revoked;
    - a **knowledge transfer** item for the manager when the employee has a manager.
  - Each item is cleared or waived (with a note) by its owner or by HR.
  - Completing the separation (existing action) requires every item cleared or waived. It
    still suspends the login, which is the account revocation.
- **Exit interview:**
  - Questions come from the organization (rating, choice or text).
  - The employee answers once during notice, or HR records answers on their behalf.
  - Answers are visible to `separation.interview.read` only, never to the manager.
- **F&F and letters:** the case links to the Phase 07 settlement of the employee and to
  experience/relieving letters generated from Phase 11a templates (the last working day is
  merged from the case).
- **Exit analytics:**
  - separations by month, type, reason category and department;
  - attrition rate for a period = separations ÷ average headcount (from employment records);
  - exit-interview rating averages, hidden below 5 answers.

### Compliance (`modules/compliance`)

- **Compliance calendar:**
  - Obligations are defined by the organization: title, category (statutory filing, licence
    renewal, audit, policy review, other), owner, first due date and recurrence (`NONE` /
    `MONTHLY` / `QUARTERLY` / `HALF_YEARLY` / `YEARLY`).
  - **No obligation or deadline is pre-loaded**; the organization knows which filings apply to
    it.
- **Tasks:** each occurrence is a task with a due date.
  - The owner completes it with a note and optional evidence (PDF or image).
  - Completing a recurring task creates the next occurrence.
  - Overdue tasks are flagged on the dashboard.
- **Expiry tracker:** one list of what expires within N days:
  - employee documents and certifications (Phase 04);
  - software licences (Phase 08);
  - fixed-term contracts (employment records with an end date);
  - library documents marked for review (11a);
  - compliance tasks.
- **Dashboard:**
  - overdue and upcoming tasks;
  - expiring items;
  - acknowledgement rates of required library documents;
  - recent audit entries (from the existing audit log, `audit.log.read`).
- **Regulatory reports** (statutory registers, returns) are not invented here. They come with
  sourced templates in Phase 13 (reports & analytics).

### Permissions (new)

| Permission                   | Meaning                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `helpdesk.config.manage`     | Categories, agents, SLA policies                           |
| `helpdesk.ticket.manage`     | Work any ticket (agents work their own categories without) |
| `helpdesk.knowledge.manage`  | Knowledge base articles                                    |
| `separation.case.manage`     | Start, run and complete separations; settings; templates   |
| `separation.interview.read`  | Exit interview answers and analytics                       |
| `compliance.calendar.manage` | Obligations and all compliance tasks                       |
| `compliance.dashboard.read`  | Compliance dashboard and expiry tracker                    |

### As built

- Migration `20261128000000_helpdesk_separation_compliance`: 17 tenant tables with RLS.
  - `workflow_process` gains `RESIGNATION`.
  - Guards: `app.ticket_guard` (closed tickets change only their rating),
    `app.resignation_guard`, `app.separation_case_guard` (completion requires no pending
    clearance), `app.clearance_item_guard`, `app.compliance_task_guard`.
  - Partial unique indexes: one pending resignation and one open separation per employee.
  - Ticket comments, events and attachments and exit interviews are append-only.
  - `app.tenants_with_breached_tickets` serves the escalation sweep. Seven permissions.
- `modules/helpdesk` (`OperationsModule`): `HelpdeskService`, `SeparationService`,
  `ComplianceService` and a `helpdesk.escalate` job scheduler (every 15 minutes).
  - A ticket's assignee (including an escalation contact) always works it.
  - Confidential categories are hidden even from `helpdesk.ticket.manage`.
- **Resignations:**
  - Approval goes through the workflow engine (`RESIGNATION`) or the reporting manager / HR.
  - Approving puts the employee on notice directly. The approver need not hold the employee
    lifecycle permission; the approval is the authority.
  - HR-started separations and completion use the existing employment actions.
- **Clearance:** asset and licence items clear themselves when the asset is returned or the
  seat revoked; HR can waive any item with a note.
- **Expiry tracker:** certifications, software licences, fixed-term (contract, consultant,
  intern) engagements with an end date, and compliance tasks. Employee documents carry no expiry
  date, and library documents no review date, so they are not tracked yet.
- **Letters:** `employee.lastWorkingDay` is now merged from the employee record into
  experience/relieving letters.

## Assumptions (to confirm with the owner)

1. Ticket SLA clocks run continuously (no business-hours calendar, no pause while waiting on the
   requester) in 11b.
2. Notice periods are one organization setting in days. Per-grade or per-contract notice comes
   later.
3. Clearance completion is required before a separation can be completed. HR can waive an item
   with a note.
4. Exit interviews are not anonymous: they are linked to the employee but visible only to
   `separation.interview.read`.
5. Compliance obligations and their recurrence are entirely the organization's data. No
   statutory calendar is shipped.
6. Notifications (e-mail reminders for due tasks and tickets) arrive with Phase 15.
