# Project status

_Last updated: 2026-11-23_

## Current phase

**Phase 06 — Recruitment & onboarding: implemented and verified locally.** Phase 07
has **not** been started. Phase 06 changes are **not committed yet**.

- Phases 01–04: approved and pushed. Phase 05: approved and pushed (`3031dea`).
- The owner asked (2026-11-20) to push Phase 06 and continue with Phase 07.

**Current task:** commit and push Phase 06 (owner request 2026-11-20), then start Phase 07.

## Phase 06 verification

| Check                                                    | Result                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 36/37 on 2026-11-20. The one failure was a web lint error in the new E2E helper; it is fixed and the file re-lints clean                                                          |
| `pnpm format:check`                                      | ✅ clean (2026-11-23)                                                                                                                                                                |
| Unit/component tests                                     | ✅ 306 passed: API 81 · shared-types 3 · validation 60 · api-client 12 · design-tokens 38 · business-rules 48 · ui-web 12 · web 44 · mobile 8 (jest)                                 |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 97 passed on 2026-11-23 (24 Phase 01 + 38 Phase 02 + 10 Phase 03 + 10 Phase 04 + 9 Phase 05 + 6 Phase 06)                                                                         |
| Migrations                                               | ✅ 8 applied to dev and test; drift check reports no difference (2026-11-23)                                                                                                         |
| Playwright E2E (production build + live API)             | ✅ 10 passed, 8 skipped by design (2026-11-23). New: requisition → second HR approver invited via Mailpit → publish → anonymous apply on the career site → candidate in the pipeline |
| GitHub Actions                                           | ⏳ runs when Phase 06 is pushed                                                                                                                                                      |

## Phase 06 delivered

- **Requisitions:** budget, headcount and placement; draft → submit → approve or reject. Nobody
  can decide their own requisition: the API forbids it and the UI hides the buttons. A
  requisition is marked FILLED when the headcount is reached.
- **Openings:** need an approved requisition when one is linked. Each has a public slug; status
  can be draft, published, on hold or closed. The pipeline board shows each stage and links to
  the career-site page.
- **Public career site (`/careers/:org`):**
  - lists published openings, with a job page and an application form;
  - applying requires explicit consent and a resume (content type sniffed, stored in S3);
  - the endpoints are rate-limited;
  - the tenant is resolved through a `SECURITY DEFINER` function, so RLS still applies.
- **Candidates and applications:** one candidate per e-mail per organization, with resume upload
  and download.
  - **Stages:** stage rules are shared between the API and the web; a rejection needs a reason;
    the stage history is append-only.
  - **Assessments:** scores are decimal-safe.
- **Interviews:** a panel of employees; feedback goes through **My interviews**. A panelist sees
  other panelists' feedback only after submitting their own; recruiters see all of it.
- **Offers and hiring:**
  - an application can have only one live offer, and offer amounts are `numeric`;
  - hiring is **atomic**: it creates the employee through the Phase 04 joining logic, links the
    candidate, records the HIRED event, optionally starts onboarding and fills the requisition.
- **Onboarding:**
  - templates assign tasks to HR, the manager, the new joiner or IT, with due offsets relative to
    the joining date and optionally a required document;
  - plans resolve each assignee;
  - the joiner uploads documents from **My onboarding**, which completes the task;
  - only HR can skip a task, and a plan closes automatically when every task is done.
- **Web:**
  - Recruitment navigation: Requisitions, Openings, Candidates, Applications, My interviews,
    Onboarding, My onboarding;
  - the application detail page: stage changes, interviews, assessments, offers, hire;
  - the public career pages.

## Assumptions (recorded in ADR-013; the owner may override)

1. AI resume parsing, skill extraction, summaries and JD assistance are deferred to Phase 11. There
   is no fake AI; skills are entered by hand.
2. AI never rejects or advances candidates; every decision is a person's and is recorded.
3. Recruitment permissions are organization-wide in this phase.
4. Offer letters as documents, e-signature and candidate e-mails come in Phase 10.
5. The career site is part of the main web app; there are no custom domains.
6. Candidate data retention and erasure (DPDP) are not automated yet; the consent time is
   recorded.

## Issues found and fixed during Phase 06

1. Hiring failed with a 500: the nested onboarding-task create passed `organizationId`, which
   Prisma fills in from the relation. Removed.
2. Onboarding tasks returned 404 instead of 403 to people involved in the plan who were not
   allowed to act on a task. Added an "involved" visibility check.
3. The validation money-range checks compared JS numbers. They now use `Decimal`; a test checks
   that `"9"` is below `"10"`.
4. The owner saw an **Approve** button on their own requisition, which the API then refused. The
   requester id is now exposed and the button is hidden.
5. The E2E helper's regex lost its escape (`\?`), which made `?` a quantifier. Fixed; lint caught
   it.

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
8. Recruitment has no mobile screens yet (Phase 13) and no analytics yet (Phase 12).
9. **Local machine:** with little free memory, the gate needs `--concurrency=2` and E2E needs
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
| 20261120000000_recruitment_onboarding             | ✅  | ✅   |

## Next recommended task

1. Push Phase 06 and confirm CI is green on GitHub.
2. Owner reviews Phase 06 (run `pnpm dev`): Recruitment → Requisitions → Openings → publish, then open
   the career-site link, apply, move the candidate through the pipeline, make an offer, hire, and
   follow the onboarding plan under **Onboarding** and **My onboarding**.
3. Phase 07 (India payroll) — started at owner request; see the Phase 07 plan when it is added.
