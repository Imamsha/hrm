# ADR-013: Recruitment (ATS), career portal and onboarding

- Status: Accepted (2026-11-20, Phase 06)
- Builds on: [ADR-003](ADR-003-database-roles-and-rls.md) (RLS), [ADR-007](ADR-007-object-storage.md)
  (files), [ADR-011](ADR-011-employee-management.md) (employees, joining, documents)

## Context

Phase 06 adds hiring, from a request to hire through to a joined employee with a joining checklist.
The master rules state that **AI never auto-rejects or makes employment decisions**. No AI provider
is configured yet; Phase 11 delivers the AI platform.

## Decisions

### Requisition → opening → application → hire

- **Requisitions** are requests to hire, with budget, headcount and placement. They move
  DRAFT → SUBMITTED → APPROVED / REJECTED (or CANCELLED). Only a DRAFT or REJECTED requisition can
  be edited, and editing resets it to DRAFT. **Nobody decides their own requisition**: the API
  enforces this and the UI hides the buttons. A requisition becomes FILLED when hires reach the
  headcount.
- **Openings** are published job posts. An opening needs an APPROVED requisition when one is
  linked. Each opening has a `slug` that is unique per organization, and statuses DRAFT,
  PUBLISHED, ON_HOLD and CLOSED. Only PUBLISHED openings appear on the career site.
- **Candidates** are unique per organization by e-mail. A resume is stored in S3 under the
  tenant's prefix, after its content type is sniffed from its magic bytes, as with employee
  documents. Consent time (`consent_at`) is recorded for portal applicants.
- **Applications** (one per candidate and opening) move through the stages
  APPLIED → SCREENING → ASSESSMENT → INTERVIEW → OFFER → HIRED, with exits to REJECTED and
  WITHDRAWN.
  - The allowed moves are a pure function, `canMoveStage` in `@hrm/business-rules`, shared by the
    API and the web.
  - A rejection requires a reason.
  - HIRED can be reached only through the hire endpoint.
  - Every move writes an **append-only** `application_events` row (trigger plus revoked
    privileges), so the history cannot be rewritten.

### Interviews and independent feedback

- An interview has a panel of employees. Each panelist submits a rating (1–5), a recommendation
  and notes through `/me/interviews`.
- To avoid anchoring, **a panelist sees other panelists' feedback only after submitting their
  own**. Recruiters (`recruitment.candidate.manage`) always see all feedback.
- `summarizeFeedback` produces the average and the recommendation counts. It is a summary for a
  person to read and never decides anything.

### Offers and hiring are atomic

- An offer (amount in `numeric`, decimal string on the wire) can be created only at the OFFER
  stage, and an application can have only one live offer (partial unique index). Status moves
  follow a fixed transition map. The amount is not written to the audit log.
- **Hire** needs an ACCEPTED offer and the `employees.employee.create` permission. In **one
  transaction** it:
  1. creates the employee through `EmployeesService.joinInTx`, the same joining logic as Phase 04,
     using the offer's joining date, designation and grade;
  2. links the candidate to the employee;
  3. sets the application to HIRED and writes the event;
  4. starts onboarding when a template is given;
  5. marks the requisition FILLED once the headcount is reached.

  `withTenant` cannot nest, so the services expose `*InTx` variants that run inside the caller's
  transaction.

### Public career portal without leaking tenants

- `/careers/:organizationSlug/jobs[/:slug]` and `POST …/applications` are `@Public` and
  rate-limited.
- The tenant is resolved by `app.career_portal_tenant(slug)`, a `SECURITY DEFINER` function that
  returns only an ACTIVE organization's id. All further access goes through `withTenant` with that
  id, so RLS still applies.
- Portal responses contain only published openings and their public fields. The salary is shown
  only when `show_salary` is set.
- Applying needs explicit consent (`consent: 'true'`) and a resume. Applicants are deduplicated by
  e-mail. The audit entry has no actor.

### Onboarding

- **Templates** list tasks, each with an assignee role (HR, MANAGER, EMPLOYEE, IT), a due offset
  in days relative to the joining date (which may be negative), and an optional required
  document category. An organization has at most one default template.
- **Starting a plan** copies the template into concrete tasks with due dates (`taskDueDate`).
  EMPLOYEE tasks are assigned to the joiner, and MANAGER tasks to their current manager. An
  employee has at most one active plan.
- **Completing tasks:**
  - HR (`onboarding.plan.manage`) or the assigned employee can complete a task; only HR can skip
    one.
  - A task that requires a document can be completed only when the employee has a document of that
    category.
  - The joiner can upload that document themselves through
    `/me/onboarding/tasks/:id/document`. This reuses the employee document service in
    `asSelf` mode, and the upload completes the task.
- A plan closes automatically when every task is DONE or SKIPPED. Progress comes from
  `onboardingProgress`.

### Permissions

Recruitment and onboarding permissions are **organization-wide**. They are not narrowed by
structural scopes in this phase. Recruitment permissions:

- `recruitment.requisition.read`, `recruitment.requisition.manage`,
  `recruitment.requisition.approve`;
- `recruitment.opening.manage`;
- `recruitment.candidate.read`, `recruitment.candidate.manage`;
- `recruitment.offer.manage`.

Onboarding permissions: `onboarding.template.manage`, `onboarding.plan.read` and
`onboarding.plan.manage`.

Role defaults:

- HR admin has every recruitment and onboarding permission.
- Finance has requisition read.
- A manager has requisition read and manage, candidate read and onboarding plan read.

## Assumptions (the owner may override)

1. **AI resume parsing, skill extraction, candidate summaries and JD assistance are deferred to
   Phase 11.** No AI provider is configured, and the master rules forbid fake AI. Skills are
   entered by hand.
2. AI will **never** reject or advance candidates. Every stage change, rejection, offer and hire
   is made by a person and recorded.
3. Recruitment permissions are organization-wide. Department-scoped hiring can come later
   through the Phase 03 scope model.
4. Offer letters as generated documents and e-signature are Phase 10 (documents and workflows).
   Offers store their terms, and the status is tracked by hand.
5. Candidate e-mails (interview invitations, offer notifications) are not sent in this phase.
   Communication templates are Phase 10.
6. The career portal is a page of the main web app at `/careers/:org`. It has no custom domain or
   branding.
7. Retaining or deleting candidate data on request (DPDP Act 2023) is not automated yet. Consent
   time is recorded so that a retention policy can be built on it.

## Consequences

- Hiring creates employees through the same validated path as manual joining, so employee
  numbering, job history and the audit trail stay consistent.
- The append-only events and independent feedback make hiring decisions auditable and fairer.
- The career portal is the first public, tenant-resolving endpoint. Any future public endpoint must
  follow the same `SECURITY DEFINER` lookup plus `withTenant` pattern.
