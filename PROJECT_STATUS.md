# Project status

_Last updated: 2026-11-24_

## Current phase

**Phase 09 — Performance, learning & engagement: complete, verified locally, awaiting owner
approval.** Design: [ADR-016](docs/architecture/ADR-016-performance-learning-engagement.md).
Nothing of Phase 09 is committed yet.

- Phases 01–08: approved and pushed (last push `aa28ca1`); CI not checked from this machine (no
  `gh` CLI).
- Owner decision 2026-11-24: **Clients & projects** (epics, stories, tasks, bugs, assignments,
  sprints & boards, timesheets, client billing, client portal) is added as **Phase 10**; later phases
  shift by one (15 in total).

**Next phase (after approval):** Phase 10 — Clients & projects.

## Phase 09 verification (2026-11-24)

| Check                                                    | Result                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=2`)                                                                                                               |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                                 |
| Unit/component tests                                     | ✅ API 81 · shared-types 3 · validation 80 · api-client 12 · design-tokens 38 · business-rules 93 · ui-web 12 · web 59 · mobile 8 (jest)                 |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 122 passed (113 earlier + 9 Phase 09)                                                                                                                 |
| Migrations                                               | ✅ 11 applied to dev and test; drift check reports no difference                                                                                         |
| Playwright E2E (production build + live API)             | ✅ 13 passed, 11 skipped by design. New: linked employee creates a KPI goal and checks in (25 %); anonymous pulse survey published, answered, eNPS shown |
| GitHub Actions                                           | ⏳ runs when Phase 09 is pushed                                                                                                                          |

## Phase 09 delivered

- **Goals & OKRs:** personal, department and organization goals; KPIs and key results measured
  from a start to a target (rising or falling); objectives roll up their key results by weight;
  append-only check-ins with history. Personal goals are visible to the employee, their manager
  and HR only.
- **Reviews:**
  - Rating scales, competencies and templates are the organization's own (nothing pre-filled).
  - A cycle snapshots its template at launch and creates self, manager, peer and upward slots
    for its audience. Employees nominate peers within the template's bounds.
  - The manager review computes a weighted score (goals vs competencies) mapped to the nearest
    scale point; HR calibrates with a required reason; closing releases results and freezes the
    cycle in the database.
  - Peer and upward feedback reaches the employee only after release, without names, and only at
    the template's anonymity minimum. Promotion is a recorded recommendation only.
  - HR sees progress and the rating distribution; employees acknowledge their results.
- **Improvement plans:** objectives, check-ins and an outcome (passed, not met, extended,
  cancelled), visible to the employee, manager and HR.
- **Learning:** courses with content and quiz modules (answers never sent to learners), pass
  marks, certification validity, skills; learning paths; self-enrolment, assignment by HR or by
  managers to their reports, due dates and overdue flags; completion issues the certification and
  records the skills; feedback; skill matrix and expiring certifications.
- **Engagement:**
  - Surveys and pulse checks (rating, eNPS, choice, text) for an audience. Anonymous answers
    store no employee id, a random id and a day-only time; results and department breakdowns are
    hidden below the survey's minimum group size.
  - Recognition with badges and points, a rewards catalogue, redemptions decided by HR (rejecting
    returns points and stock).
  - Announcements with read tracking and acknowledgement; events with RSVP and capacity;
    suggestions (optionally anonymous) with votes and an official response.
- **Web:** Performance, Learning and Engagement sections in the navigation (13 new pages).

## Assumptions (recorded in ADR-016; the owner may override)

1. Rating scales, weights, competencies, the anonymity minimum, survey minimum group sizes and
   points values are configured by the organization; none are pre-loaded.
2. AI writing help (review drafts, summaries) is deferred to Phase 12; AI never rates, ranks or
   recommends promotion.
3. Course content is links and text; SCORM/xAPI and external learning platforms are Phase 15.
4. Rewards carry no monetary or tax treatment.
5. HR permissions are organization-wide; managers act on direct reports through the reporting line.

## Issues found and fixed during Phase 09

1. **Anonymous answers could have been re-identified.** Survey responses and suggestions used
   time-ordered (v7) ids and exact timestamps, which could be matched to request logs or to the
   invitation's "responded" time. They now use a random v4 id and a day-only time, and anonymous
   suggestions write no audit entry.
2. The review page read the scale from an untyped field; the shared `ReviewDetails` type now
   carries the snapshotted scale, and the casts are gone.
3. Forms validated the flat field values before nested bodies (goal measures, audiences, ISO
   datetimes) were built, so valid goals would have been rejected. `ResourceForm` gained a
   `transform` prop that shapes the body before validation.
4. The goal owner picker offered "— None —" for a field that is required when shown; fixed (found
   by E2E).
5. An integration-test helper missed an `await`; peers in the test skipped a required question.

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

## Next recommended task

1. Owner reviews Phase 09 (start `pnpm dev`, sign in as owner, link yourself to an employee):
   - **Performance setup**: add a rating scale, competencies and a review template;
   - **Review cycles**: create a cycle, launch it, write the self and manager reviews under
     **Reviews**, calibrate and close;
   - **Goals & OKRs**: an objective with key results, then check in;
   - **Training & skills**: create a course with a quiz, publish and assign it; take it in
     **My learning**;
   - **Engagement admin**: badges, rewards, an announcement and an event; then **Company**,
     **Surveys** and **Suggestions**.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 09, then confirm CI is green.
4. Then Phase 10: Clients & projects.
