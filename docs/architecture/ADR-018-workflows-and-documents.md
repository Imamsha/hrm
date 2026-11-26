# ADR-018: Workflow engine, documents and e-acceptance (Phase 11a)

- Status: Accepted (2026-11-26, Phase 11a) — assumptions below await owner confirmation
- Builds on: ADR-012 (leave), ADR-015 (expenses and travel), ADR-017 (timesheets),
  ADR-013 (offers), ADR-014 (payslips), ADR-007 (object storage)

## Context

Approvals are hard-coded today:

- leave, travel and the manager step of expense claims go to the reporting manager;
- timesheets go to the reporting manager, or to a permission holder when there is none.

Organizations need their own chains: skip-level, finance or HR steps, thresholds, escalation
when a step is late, and delegation while someone is away.

Generated documents (offer letters, payslips, invoices, letters) and signing were deferred to this
phase.

**Owner decisions (2026-11-26):**

- Phase 11 is split in two:
  - **11a:** workflow engine and documents;
  - **11b:** helpdesk, separation & offboarding, compliance.
- Signing is a **built-in e-acceptance** with a tamper-evident record. Provider e-signatures
  (Aadhaar eSign, DocuSign, …) are a Phase 15 integration.

## Decision

### Workflow engine (`modules/workflows`)

- **Processes** that can use a workflow in 11a:
  - `LEAVE_REQUEST` (measure: days);
  - `EXPENSE_CLAIM` (the manager stage before finance; measure: claimed amount);
  - `TRAVEL_REQUEST` (measure: estimated cost);
  - `TIMESHEET` (measure: hours).
- **Definition:** an organization defines at most one **active** definition per process (partial
  unique index). A definition has ordered steps, and each step has:
  - an **approver**:
    - `REPORTING_MANAGER`;
    - `MANAGER_LEVEL` n (the manager's manager for n = 2, …);
    - `ROLE` (any active member holding a role key, e.g. `finance`; one approval is enough);
    - `EMPLOYEE` (a named person);
  - an optional **condition**: the step applies only when the request's measure is at least a
    threshold (e.g. claims of 50,000 or more). Thresholds are the organization's own; none are
    pre-filled;
  - an optional **SLA** in hours, and an escalation target when it is missed: the next manager
    up, or a named employee;
  - **skip rules:** a step whose approver would be the requester, or cannot be resolved (no
    manager), is skipped and the skip is recorded. A chain that skips every step falls back to
    the module's existing rule, so nothing is approved without someone deciding.
- **Instance:**
  - Submitting a request starts an instance that **snapshots** the definition (editing a
    definition never changes running approvals).
  - The instance creates one **task** per applicable step, one at a time.
  - Rejecting a step rejects the request. Approving the last step completes it, and the module
    then applies its own effects (leave ledger, finance stage, timesheet freeze, …).
  - Instances and tasks are append-only history except for status. A task is decided once.
- **Without an active definition** each module keeps its current behaviour (no change for
  organizations that do not configure workflows).
- **Delegation:**
  - An employee delegates their approvals to a colleague for a date range, for all processes
    or chosen ones.
  - Tasks assigned while the delegation is in force go to the delegate and record
    "on behalf of". Nobody can approve their own request through a delegation.
- **Escalation:**
  - A repeatable BullMQ job runs every 15 minutes, per tenant.
  - It reassigns overdue pending tasks to the escalation target and records the escalation.
    Escalating never approves anything.
- **One inbox:** `/me/approval-tasks` (web: **Approval inbox**) lists the caller's pending tasks across processes, with links to
  each module's page. Decisions are made through the same engine call from either place.

### Documents (`modules/documents`)

- **Templates:**
  - An organization writes templates with a category (`OFFER_LETTER`, `APPOINTMENT_LETTER`,
    `EXPERIENCE_LETTER`, `RELIEVING_LETTER`, `SALARY_CERTIFICATE`, `POLICY`, `OTHER`).
  - The body is text with **merge fields** (`{{employee.name}}`, `{{offer.ctc}}`, …) from a fixed
    catalogue per category. Unknown fields are rejected when saving, not left in the output.
  - Templates are versioned: a published version never changes.
  - No template wording is shipped: letters are the organization's own text.
- **Generated documents:**
  - A template version is rendered for a subject (an employee, or an offer of a candidate) into
    a **PDF** with `pdf-lib`.
  - It is stored in S3 under the tenant prefix with its **SHA-256** and the values merged.
- **System PDFs** (no template; layout only, figures from finalized data):
  - **payslips** of finalized payroll runs;
  - **invoices** that are issued or paid.

  Both are rendered on request from the stored figures, so they always match the screen.

- **Company documents (policy library):**
  - uploads (PDF), versioned, published to an audience;
  - optional acknowledgement per version, with read and acknowledged counts.

### E-acceptance (`document_signatures`)

- A generated document can require acceptance from one or more signers in order: an employee
  (logged in), or a candidate for an offer letter (e-mailed one-time code; no login).
- **Accepting records:**
  - the signer and the method (`LOGIN` or `EMAIL_OTP`);
  - the time, IP address and user agent;
  - the document's SHA-256.
- If the stored file no longer matches the hash, acceptance is refused.
- **Declining** records a reason.
- When everyone has accepted, a **certificate page** listing those records is appended to a new
  PDF version. The original and the certificate are kept, and the audit log records each step.
- This is evidence of consent inside the system. It is **not** a qualified/Aadhaar e-signature;
  the UI says so.
- Accepting an offer letter through e-acceptance marks the offer accepted, as the career-site
  acceptance does today.

### Permissions (new)

| Permission                    | Meaning                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `workflows.definition.manage` | Create and activate approval workflows                         |
| `workflows.instance.read`     | See all approval instances (audit of who approved what)        |
| `documents.template.manage`   | Document templates and versions                                |
| `documents.document.generate` | Generate documents for employees/offers and request acceptance |
| `documents.library.manage`    | Company documents (policies), versions and acknowledgements    |

Payslip PDFs follow the payslip permissions (own payslips: `employees.self.access`; others:
`payroll.run.read`); invoice PDFs follow `projects.billing.manage` and the client portal.

### As built

- Migration `20261127000000_workflows_documents`: 11 tenant tables with RLS.
  - Partial unique indexes: **one active workflow per process**, **one running approval per
    request**.
  - Guards: `app.workflow_instance_guard` and `app.workflow_task_guard` (finished approvals and
    decided steps never change); `app.generated_document_guard` (file, hash and values never
    change); `app.document_signer_guard` (a recorded acceptance never changes).
  - Template versions, library versions and acknowledgements are append-only.
  - `app.signer_token_tenant` resolves a candidate link's tenant;
    `app.tenants_with_overdue_workflow_tasks` lists only tenant ids for the escalation sweep.
  - Five permissions.
- `modules/workflows`:
  - `WorkflowEngine` (start, decide, cancel, inbox, escalation) and `WorkflowRegistry`.
  - Leave, expense claims (manager stage), travel and timesheets call the engine at submit,
    decide and cancel, and register their handler so the inbox can route decisions. Without an
    active workflow their built-in rule is unchanged.
  - The escalation sweep is a BullMQ job scheduler (`workflows.escalate`, every 15 minutes).
  - Delegation reassigns steps already waiting when it starts; revoking hands them back.
  - The inbox route is `/me/approval-tasks`, because `/me/approvals` already serves the
    Phase 05 leave/regularization page.
- `modules/documents`:
  - `PdfService` (pdf-lib 1.17.1, Helvetica, WinAnsi-safe text), `StatementsService` (payslip
    and invoice PDFs), `DocumentsService` (templates, generation, acceptance, the candidate
    one-time-code flow) and `LibraryService`.
  - Payslip and invoice PDFs are served by payroll, billing and the client portal.
  - Public acceptance runs inside the tenant resolved from the token, so it is audited like any
    other request.
- Web:
  - Approval inbox (with delegations), approval workflow designer, document templates,
    documents (generate, accept, decline, certificate), company documents (publish, version,
    acknowledge).
  - The public `/accept-document` page, and PDF buttons on payslips and invoices.

## Assumptions (to confirm with the owner)

1. Four processes use workflows in 11a. Recruitment requisitions, profile changes and attendance
   regularization keep their flows until requested.
2. A `ROLE` step is satisfied by one approval from any holder (no "all must approve").
3. Escalation reassigns; it never auto-approves or auto-rejects.
4. Generated PDFs use the built-in Helvetica font (Latin script only, amounts with the currency
   code instead of symbols). Indic-script letters need a bundled font (later).
5. Uploaded files are not malware-scanned yet (Phase 15, with a scanning service).

## Consequences

- Modules keep their own state machines and call the engine at submit and decide. The engine
  owns who may decide and in which order. Integration tests cover both "no definition" and
  "definition" paths per process.
- Rendering PDFs from stored, finalized figures avoids keeping two sources of truth. Only
  documents that need acceptance are stored with a hash.
