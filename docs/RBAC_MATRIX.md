# RBAC / ABAC matrix

Status: **enforced since Phase 02.** Model and enforcement path: [ADR-009](architecture/ADR-009-authorization-rbac-abac.md).
Every protected row below is covered by an integration test (allowed role succeeds; others → 403;
other tenants → 404/400).

## Permission catalog

| Permission                        | Description                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `organization.settings.read`      | View organization profile and settings                                                                             |
| `organization.settings.update`    | Update organization profile and settings                                                                           |
| `organization.structure.read`     | View companies, legal entities, branches, locations, departments, teams, cost centers and the org chart (Phase 03) |
| `organization.structure.manage`   | Create, update, archive and delete structure records (Phase 03)                                                    |
| `organization.job_catalog.read`   | View designations and job grades (Phase 03)                                                                        |
| `organization.job_catalog.manage` | Manage designations and job grades (Phase 03)                                                                      |
| `organization.calendar.read`      | View work weeks, holiday calendars and resolved working days (Phase 03)                                            |
| `organization.calendar.manage`    | Manage work weeks, holiday calendars and holidays (Phase 03)                                                       |
| `employees.employee.read`         | Employee directory, profiles, job history, background (Phase 04)                                                   |
| `employees.employee.create`       | Add employees (joining) (Phase 04)                                                                                 |
| `employees.employee.update`       | Update profiles, background records, link login account (Phase 04)                                                 |
| `employees.lifecycle.manage`      | Job changes, confirmation, probation, separation, rejoining (Phase 04)                                             |
| `employees.personal.read`         | Personal details, addresses, emergency contacts, family (Phase 04)                                                 |
| `employees.sensitive.read`        | Bank accounts and PAN/UAN (masked; reveals audited) (Phase 04)                                                     |
| `employees.sensitive.manage`      | Manage bank accounts and PAN/UAN (Phase 04)                                                                        |
| `employees.document.read`         | View/download employee documents (Phase 04)                                                                        |
| `employees.document.manage`       | Upload, rename, delete employee documents (Phase 04)                                                               |
| `employees.settings.manage`       | Employee numbering (organization-wide only) (Phase 04)                                                             |
| `employees.self.access`           | Self-service: own profile under `/me/employee` (Phase 04)                                                          |
| `shifts.shift.read`               | View shifts, assignments and rosters (scoped) (Phase 05)                                                           |
| `shifts.shift.manage`             | Manage shifts (definitions: organization-wide), assignments and rosters (scoped) (Phase 05)                        |
| `attendance.self.use`             | Clock in/out, own attendance, request regularizations (Phase 05)                                                   |
| `attendance.record.read`          | Attendance of employees in scope (summary, register, punches) (Phase 05)                                           |
| `attendance.record.manage`        | Manual punches and regularization decisions in scope (Phase 05)                                                    |
| `attendance.punch.import`         | Import device punches (organization-wide) (Phase 05)                                                               |
| `attendance.kiosk.operate`        | Run the QR kiosk for a branch (scoped by company/branch) (Phase 05)                                                |
| `attendance.settings.manage`      | Clock-in channels, location requirement, QR rotation, leave year (Phase 05)                                        |
| `leave.self.use`                  | Apply for leave, own balances, approvals inbox (Phase 05)                                                          |
| `leave.type.manage`               | Leave types and policies (Phase 05)                                                                                |
| `leave.request.read`              | Leave of employees in scope (Phase 05)                                                                             |
| `leave.request.approve`           | Approve/reject and apply on behalf in scope (Phase 05)                                                             |
| `leave.balance.adjust`            | Opening balances and adjustments in scope (Phase 05)                                                               |
| `recruitment.requisition.read`    | View requisitions (Phase 06)                                                                                       |
| `recruitment.requisition.manage`  | Create, edit, submit, cancel requisitions (Phase 06)                                                               |
| `recruitment.requisition.approve` | Approve/reject requisitions — never your own (Phase 06)                                                            |
| `recruitment.opening.manage`      | Create, edit, publish, hold and close openings (Phase 06)                                                          |
| `recruitment.candidate.read`      | View openings, candidates, resumes, applications and all feedback (Phase 06)                                       |
| `recruitment.candidate.manage`    | Add candidates/applications, move stages, assessments, interviews (Phase 06)                                       |
| `recruitment.offer.manage`        | Offers and hiring (hire also needs `employees.employee.create`) (Phase 06)                                         |
| `onboarding.template.manage`      | Onboarding templates (Phase 06)                                                                                    |
| `onboarding.plan.read`            | View onboarding plans and templates (Phase 06)                                                                     |
| `onboarding.plan.manage`          | Start/cancel plans, complete or skip any task (Phase 06)                                                           |
| `payroll.settings.manage`         | Payroll settings, salary components and structures (Phase 07)                                                      |
| `payroll.statutory.manage`        | Statutory rule sets: create drafts, activate, close, retire (Phase 07)                                             |
| `payroll.salary.read`             | Employee salaries, payroll profiles and declarations (Phase 07)                                                    |
| `payroll.salary.manage`           | Set salaries and revisions, profiles and declarations (Phase 07)                                                   |
| `payroll.run.read`                | Payroll runs, results, payslips, rule sets (Phase 07)                                                              |
| `payroll.run.manage`              | Create, calculate, adjust, finalize and cancel runs (Phase 07)                                                     |
| `payroll.run.approve`             | Approve runs and settlements — never one you calculated (Phase 07)                                                 |
| `payroll.bank_file.export`        | Export bank payment files of finalized runs (Phase 07)                                                             |
| `payroll.settlement.manage`       | Prepare and finalize full & final settlements (Phase 07)                                                           |
| `expenses.category.manage`        | Expense categories, policy limits and settings (Phase 08)                                                          |
| `expenses.claim.read`             | View all expense claims (Phase 08)                                                                                 |
| `expenses.claim.verify`           | Finance verification, approved amounts, payout, mark paid (Phase 08)                                               |
| `travel.request.read`             | View all travel requests (Phase 08)                                                                                |
| `travel.request.approve`          | Approve trips of employees without a reporting manager (Phase 08)                                                  |
| `travel.desk.manage`              | Bookings, advances and trip settlement (Phase 08)                                                                  |
| `assets.asset.read`               | View the asset register and licences (Phase 08)                                                                    |
| `assets.asset.manage`             | Register assets, allocate, return, status, maintenance (Phase 08)                                                  |
| `assets.license.manage`           | Software licences and seat assignments (Phase 08)                                                                  |
| `performance.config.manage`       | Rating scales, competencies and review templates (Phase 09)                                                        |
| `performance.cycle.manage`        | Review cycles: launch, calibration, close, distribution (Phase 09)                                                 |
| `performance.goal.manage`         | Goals of anyone, department and organization goals (Phase 09)                                                      |
| `performance.pip.manage`          | Performance improvement plans of anyone (Phase 09)                                                                 |
| `learning.course.manage`          | Courses, modules, quizzes and learning paths (Phase 09)                                                            |
| `learning.assignment.manage`      | Assign training to anyone; all enrollments and the skill matrix (Phase 09)                                         |
| `engagement.survey.manage`        | Surveys and pulse checks, and their (aggregated) results (Phase 09)                                                |
| `engagement.content.manage`       | Announcements, events, badges, rewards and redemptions (Phase 09)                                                  |
| `engagement.suggestion.manage`    | Respond to suggestions (Phase 09)                                                                                  |
| `projects.client.manage`          | Clients, contacts and client portal logins (Phase 10)                                                              |
| `projects.project.read`           | See every project (otherwise only your own) (Phase 10)                                                             |
| `projects.project.manage`         | Create projects; manage members, rates and any project (Phase 10)                                                  |
| `projects.timesheet.read`         | All timesheets and the time report (Phase 10)                                                                      |
| `projects.timesheet.approve`      | Approve timesheets of employees without a reporting manager (Phase 10)                                             |
| `projects.billing.manage`         | Tax rates, invoice numbering, invoices and payments (Phase 10)                                                     |
| `projects.portal.access`          | Client portal — the `client` role only (Phase 10)                                                                  |
| `users.member.read`               | View members (and pending invitations)                                                                             |
| `users.member.invite`             | Invite people, revoke invitations                                                                                  |
| `users.member.update`             | Suspend/reactivate members, change role assignments                                                                |
| `users.member.remove`             | Remove members                                                                                                     |
| `roles.role.read`                 | View roles and the permission catalog                                                                              |
| `roles.role.manage`               | Create, update, delete custom roles                                                                                |
| `audit.log.read`                  | View the organization audit log                                                                                    |
| `subscription.plan.read`          | View the subscription                                                                                              |

## System roles (created per organization, immutable)

| Permission                      | Owner | Admin | HR admin | Finance | Manager | Employee |
| ------------------------------- | :---: | :---: | :------: | :-----: | :-----: | :------: |
| organization.settings.read      |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |    ✓     |
| organization.settings.update    |   ✓   |   ✓   |          |         |         |          |
| organization.structure.read     |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |    ✓     |
| organization.structure.manage   |   ✓   |   ✓   |    ✓     |         |         |          |
| organization.job_catalog.read   |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |          |
| organization.job_catalog.manage |   ✓   |   ✓   |    ✓     |         |         |          |
| organization.calendar.read      |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |    ✓     |
| organization.calendar.manage    |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.employee.read         |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |          |
| employees.employee.create       |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.employee.update       |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.lifecycle.manage      |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.personal.read         |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.sensitive.read        |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| employees.sensitive.manage      |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.document.read         |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.document.manage       |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.settings.manage       |   ✓   |   ✓   |    ✓     |         |         |          |
| employees.self.access           |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |    ✓     |
| shifts.shift.read               |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |          |
| shifts.shift.manage             |   ✓   |   ✓   |    ✓     |         |         |          |
| attendance.self.use             |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |    ✓     |
| attendance.record.read          |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |          |
| attendance.record.manage        |   ✓   |   ✓   |    ✓     |         |         |          |
| attendance.punch.import         |   ✓   |   ✓   |    ✓     |         |         |          |
| attendance.kiosk.operate        |   ✓   |   ✓   |    ✓     |         |         |          |
| attendance.settings.manage      |   ✓   |   ✓   |    ✓     |         |         |          |
| leave.self.use                  |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |    ✓     |
| leave.type.manage               |   ✓   |   ✓   |    ✓     |         |         |          |
| leave.request.read              |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |          |
| leave.request.approve           |   ✓   |   ✓   |    ✓     |         |         |          |
| leave.balance.adjust            |   ✓   |   ✓   |    ✓     |         |         |          |
| users.member.read               |   ✓   |   ✓   |    ✓     |         |    ✓    |          |
| users.member.invite             |   ✓   |   ✓   |    ✓     |         |         |          |
| users.member.update             |   ✓   |   ✓   |    ✓     |         |         |          |
| users.member.remove             |   ✓   |   ✓   |          |         |         |          |
| roles.role.read                 |   ✓   |   ✓   |    ✓     |         |         |          |
| roles.role.manage               |   ✓   |   ✓   |          |         |         |          |
| audit.log.read                  |   ✓   |   ✓   |    ✓     |         |         |          |
| subscription.plan.read          |   ✓   |   ✓   |          |    ✓    |         |          |

Owner-only actions (beyond permissions): grant/revoke the owner role; suspend or remove another owner.
The owner role can only be assigned organization-wide (never with a structural scope).

Existing organizations received the Phase 03 permissions through migration
`20261117000000_organization_structure`; an integration test asserts that every organization’s
system roles match `SYSTEM_ROLES` exactly.

## Endpoint authorization

| Endpoint                                                                                                                                                              | Requirement                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health*`                                                                                                                                                        | Public                                                                                                                                              |
| `POST /auth/register`, `/auth/login`, `/auth/mfa/verify`, `/auth/password/forgot`, `/auth/password/reset`                                                             | Public, credential rate limit                                                                                                                       |
| `POST /auth/refresh`                                                                                                                                                  | Public (valid refresh token required)                                                                                                               |
| `GET /invitations/preview`, `POST /invitations/accept`                                                                                                                | Public, credential rate limit; existing accounts must be signed in as the invited e-mail                                                            |
| `GET /auth/me`, `POST /auth/logout`, `/logout-all`, `/switch-organization`, `/password/change`, `/mfa/totp/*`, `GET/DELETE /auth/sessions`, `GET /auth/login-history` | Any authenticated user (self-service)                                                                                                               |
| `POST /organizations`                                                                                                                                                 | Any authenticated user (becomes owner of the new organization)                                                                                      |
| `GET /organizations/current`                                                                                                                                          | organization.settings.read                                                                                                                          |
| `PATCH /organizations/current`                                                                                                                                        | organization.settings.update                                                                                                                        |
| `GET /organizations/current/subscription`                                                                                                                             | subscription.plan.read                                                                                                                              |
| `GET /members`, `GET /invitations`                                                                                                                                    | users.member.read                                                                                                                                   |
| `POST /invitations`, `DELETE /invitations/:id`                                                                                                                        | users.member.invite (+ owner to grant owner)                                                                                                        |
| `PATCH /members/:id`, `PUT /members/:id/roles`                                                                                                                        | users.member.update (+ owner rules)                                                                                                                 |
| `DELETE /members/:id`                                                                                                                                                 | users.member.remove (+ owner rules)                                                                                                                 |
| `GET /roles`, `GET /permissions`                                                                                                                                      | roles.role.read                                                                                                                                     |
| `POST/PATCH/DELETE /roles`                                                                                                                                            | roles.role.manage                                                                                                                                   |
| `GET /audit-logs`                                                                                                                                                     | audit.log.read                                                                                                                                      |
| `GET /employees`, `GET /employees/:id`, `…/employment-history`, `…/direct-reports`, `GET …/<collection>`                                                              | employees.employee.read at **any scope** — results limited to the scopes held (404 outside); personal collections also need employees.personal.read |
| `POST /employees`                                                                                                                                                     | employees.employee.create for the **target placement**                                                                                              |
| `PATCH /employees/:id`, `PUT …/member`, `POST/PATCH/DELETE …/<collection>`                                                                                            | employees.employee.update (scoped); personal fields also need employees.personal.read                                                               |
| `POST …/job-changes`, `…/confirmation`, `…/probation-extension`, `…/separation[/complete]`, `DELETE …/separation`, `…/rejoin`                                         | employees.lifecycle.manage (scoped; job changes and rejoining also for the target placement)                                                        |
| `GET …/bank-accounts`, `GET …/statutory-ids`, `POST …/reveal`                                                                                                         | employees.sensitive.read (scoped; reveals audited)                                                                                                  |
| `POST/PATCH/DELETE …/bank-accounts`, `PUT …/statutory-ids`                                                                                                            | employees.sensitive.manage (scoped)                                                                                                                 |
| `GET …/documents`, `GET …/documents/:id/download`                                                                                                                     | employees.document.read (scoped; downloads audited)                                                                                                 |
| `POST/PATCH/DELETE …/documents`                                                                                                                                       | employees.document.manage (scoped)                                                                                                                  |
| `GET /employees/settings` / `PUT /employees/settings`                                                                                                                 | employees.employee.create (any scope) / employees.settings.manage (organization-wide)                                                               |
| `/me/employee/**`                                                                                                                                                     | employees.self.access (organization-wide) and a linked employee record; own record only                                                             |
| `/me/attendance/**` (today, punches, range, regularizations)                                                                                                          | attendance.self.use; own record only                                                                                                                |
| `GET /attendance/summary`, `GET /employees/:id/attendance/days`, `…/attendance/punches`, `GET /attendance/regularizations`                                            | attendance.record.read at any scope (filtered)                                                                                                      |
| `POST /employees/:id/attendance/punches`                                                                                                                              | attendance.record.manage (scoped; never for yourself)                                                                                               |
| `POST /attendance/regularizations/:id/decision`                                                                                                                       | reporting manager, or attendance.record.manage in scope (never your own)                                                                            |
| `POST /attendance/punches/import`                                                                                                                                     | attendance.punch.import (organization-wide)                                                                                                         |
| `GET /attendance/kiosk/:branchId/token`                                                                                                                               | attendance.kiosk.operate covering the branch                                                                                                        |
| `GET/PUT /attendance/settings`                                                                                                                                        | attendance.self.use / attendance.settings.manage                                                                                                    |
| `GET /shifts`, `/shift-assignments`, `/roster`                                                                                                                        | shifts.shift.read (scoped lists)                                                                                                                    |
| `POST/PATCH/DELETE /shifts`                                                                                                                                           | shifts.shift.manage (organization-wide)                                                                                                             |
| `POST/DELETE /shift-assignments`, `PUT/DELETE /roster`                                                                                                                | shifts.shift.manage for each employee (scoped)                                                                                                      |
| `GET /leave/types` / `POST/PATCH /leave/types`                                                                                                                        | leave.self.use / leave.type.manage                                                                                                                  |
| `/me/leave/**`, `GET /me/approvals`                                                                                                                                   | leave.self.use; own record / items you may decide                                                                                                   |
| `GET /leave/requests`, `GET /employees/:id/leave/balances                                                                                                             | ledger`                                                                                                                                             | leave.request.read (scoped)                      |
| `POST /leave/requests/:id/decision`                                                                                                                                   | reporting manager, or leave.request.approve in scope (never your own)                                                                               |
| `POST /leave/requests/:id/cancel`                                                                                                                                     | the employee (pending, or approved and not started) or an approver                                                                                  |
| `POST /employees/:id/leave/preview                                                                                                                                    | requests`                                                                                                                                           | leave.request.approve (scoped) — apply on behalf |
| `POST /employees/:id/leave/adjustments`                                                                                                                               | leave.balance.adjust (scoped; never your own balance)                                                                                               |
| `GET /members/:id/role-assignments`                                                                                                                                   | users.member.read                                                                                                                                   |
| `POST /members/:id/role-assignments`, `DELETE /members/:id/role-assignments/:assignmentId`                                                                            | users.member.update (+ owner rules; owner role organization-wide only)                                                                              |
| `GET` companies, legal-entities, locations, branches, cost-centers, departments, teams (list + `:id`), `GET /org-chart`                                               | organization.structure.read                                                                                                                         |
| `POST/PATCH/DELETE` on the structure resources above                                                                                                                  | organization.structure.manage                                                                                                                       |
| `GET /job-grades`, `GET /designations` (list + `:id`)                                                                                                                 | organization.job_catalog.read                                                                                                                       |
| `POST/PATCH/DELETE /job-grades`, `/designations`                                                                                                                      | organization.job_catalog.manage                                                                                                                     |
| `GET /work-weeks`, `GET /holiday-calendars`, `GET /holiday-calendars/:id/holidays`, `GET /calendar/resolve`                                                           | organization.calendar.read                                                                                                                          |
| `POST/PATCH/DELETE /work-weeks`, `/holiday-calendars`, `/holiday-calendars/:id/holidays[/:holidayId]`                                                                 | organization.calendar.manage                                                                                                                        |

### Phase 06 role grants

| Permission                      | Owner | Admin | HR admin | Finance | Manager | Employee |
| ------------------------------- | :---: | :---: | :------: | :-----: | :-----: | :------: |
| recruitment.requisition.read    |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |          |
| recruitment.requisition.manage  |   ✓   |   ✓   |    ✓     |         |    ✓    |          |
| recruitment.requisition.approve |   ✓   |   ✓   |    ✓     |         |         |          |
| recruitment.opening.manage      |   ✓   |   ✓   |    ✓     |         |         |          |
| recruitment.candidate.read      |   ✓   |   ✓   |    ✓     |         |    ✓    |          |
| recruitment.candidate.manage    |   ✓   |   ✓   |    ✓     |         |         |          |
| recruitment.offer.manage        |   ✓   |   ✓   |    ✓     |         |         |          |
| onboarding.template.manage      |   ✓   |   ✓   |    ✓     |         |         |          |
| onboarding.plan.read            |   ✓   |   ✓   |    ✓     |         |    ✓    |          |
| onboarding.plan.manage          |   ✓   |   ✓   |    ✓     |         |         |          |

Phase 06 endpoints: `/recruitment/**` require the permission named in
[API_DOCUMENTATION.md](API_DOCUMENTATION.md) (organization-wide grant). `/me/interviews/**`,
`/me/onboarding/**`, `GET /onboarding/plans/:id` and `PUT /onboarding/tasks/:id/status` need
`employees.self.access` plus being the panelist / joiner / assignee (or HR). `/careers/**` is
public and rate-limited.

### Phase 07 role grants

| Permission                | Owner | Admin | HR admin | Finance | Manager | Employee |
| ------------------------- | :---: | :---: | :------: | :-----: | :-----: | :------: |
| payroll.settings.manage   |   ✓   |   ✓   |          |    ✓    |         |          |
| payroll.statutory.manage  |   ✓   |   ✓   |          |    ✓    |         |          |
| payroll.salary.read       |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| payroll.salary.manage     |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| payroll.run.read          |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| payroll.run.manage        |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| payroll.run.approve       |   ✓   |   ✓   |          |    ✓    |         |          |
| payroll.bank_file.export  |   ✓   |   ✓   |          |    ✓    |         |          |
| payroll.settlement.manage |   ✓   |   ✓   |    ✓     |    ✓    |         |          |

Payroll permissions are organization-wide. Approval additionally requires being a different
person from the calculator (API and database CHECK). `/me/salary`, `/me/payslips/**` and
`/me/tax-declarations/**` need `employees.self.access` and return only the caller's own data.

### Phase 08 role grants

| Permission               | Owner | Admin | HR admin | Finance | Manager | Employee |
| ------------------------ | :---: | :---: | :------: | :-----: | :-----: | :------: |
| expenses.category.manage |   ✓   |   ✓   |          |    ✓    |         |          |
| expenses.claim.read      |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| expenses.claim.verify    |   ✓   |   ✓   |          |    ✓    |         |          |
| travel.request.read      |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| travel.request.approve   |   ✓   |   ✓   |    ✓     |         |         |          |
| travel.desk.manage       |   ✓   |   ✓   |    ✓     |    ✓    |         |          |
| assets.asset.read        |   ✓   |   ✓   |    ✓     |         |         |          |
| assets.asset.manage      |   ✓   |   ✓   |    ✓     |         |         |          |
| assets.license.manage    |   ✓   |   ✓   |    ✓     |         |         |          |

Manager approval of claims and trips is **relationship-based** (the reporting manager at
submission), not a permission; nobody approves or verifies their own claim or trip.
`/me/expense-claims`, `/me/trips` and `/me/assets` need `employees.self.access`.

### Phase 09 role grants

| Permission                   | Owner | Admin | HR admin | Finance | Manager | Employee |
| ---------------------------- | :---: | :---: | :------: | :-----: | :-----: | :------: |
| performance.config.manage    |   ✓   |   ✓   |    ✓     |         |         |          |
| performance.cycle.manage     |   ✓   |   ✓   |    ✓     |         |         |          |
| performance.goal.manage      |   ✓   |   ✓   |    ✓     |         |         |          |
| performance.pip.manage       |   ✓   |   ✓   |    ✓     |         |         |          |
| learning.course.manage       |   ✓   |   ✓   |    ✓     |         |         |          |
| learning.assignment.manage   |   ✓   |   ✓   |    ✓     |         |         |          |
| engagement.survey.manage     |   ✓   |   ✓   |    ✓     |         |         |          |
| engagement.content.manage    |   ✓   |   ✓   |    ✓     |         |         |          |
| engagement.suggestion.manage |   ✓   |   ✓   |    ✓     |         |         |          |

Managers act on their **direct reports** by relationship, not by permission: their goals,
improvement plans, training assignments, and manager reviews. Everything under `/me/**`, taking
part in reviews, surveys, recognition, events and suggestions needs `employees.self.access`.
Nobody recognises themselves; peer and upward feedback is never shown with names.

### Phase 10 role grants

| Permission                 | Owner | Admin | HR admin | Finance | Manager | Employee | Client |
| -------------------------- | :---: | :---: | :------: | :-----: | :-----: | :------: | :----: |
| projects.client.manage     |   ✓   |   ✓   |          |         |         |          |        |
| projects.project.read      |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |          |        |
| projects.project.manage    |   ✓   |   ✓   |          |         |         |          |        |
| projects.timesheet.read    |   ✓   |   ✓   |    ✓     |    ✓    |         |          |        |
| projects.timesheet.approve |   ✓   |   ✓   |    ✓     |         |         |          |        |
| projects.billing.manage    |   ✓   |   ✓   |          |    ✓    |         |          |        |
| projects.portal.access     |   ✓   |   ✓   |          |         |         |          |   ✓    |

The new **`client`** system role holds only `projects.portal.access`; every other endpoint denies
it. The portal additionally requires a `client_portal_users` link, so owners and admins (who hold
every permission) see no portal data. Project roles are **relationships**: project managers manage
members, rates, columns and sprints; members (not viewers) create and change work items and log
time. Timesheets are approved by the reporting manager; nobody approves their own.

## Access scopes

| Scope                   | Status                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| ORGANIZATION            | Enforced                                                                                                                                   |
| SELF                    | Evaluated by `can()` for owner-attributed resources                                                                                        |
| COMPANY / BRANCH / TEAM | Evaluated by `can()` against the resource’s `companyId` / `branchId` / `teamId` (Phase 03)                                                 |
| DEPARTMENT              | Evaluated by `can()`; covers the department **and all sub-departments** (expanded at resolution, cached, invalidated on every tree change) |
| Platform administration | Not exposed through tenant APIs; separate audited path planned (Phase 14)                                                                  |

Since Phase 04, **employee endpoints consume scoped grants** (`@RequireScopedPermissions` + service
filters — see ADR-011). Elsewhere, scoped grants never satisfy an endpoint’s `@RequirePermissions` check — that check requires an
organization-wide grant. Scoped grants are consumed by services through `can(principal, permission,
resource)` once resources carry structural attributes (employee records, Phase 04). A missing
attribute on the resource means **deny**. Scope targets must belong to the same tenant (validated by
the API and by a database trigger) and cannot be deleted while referenced.
