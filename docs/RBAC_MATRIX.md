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
| `GET /members/:id/role-assignments`                                                                                                                                   | users.member.read                                                                                                                                   |
| `POST /members/:id/role-assignments`, `DELETE /members/:id/role-assignments/:assignmentId`                                                                            | users.member.update (+ owner rules; owner role organization-wide only)                                                                              |
| `GET` companies, legal-entities, locations, branches, cost-centers, departments, teams (list + `:id`), `GET /org-chart`                                               | organization.structure.read                                                                                                                         |
| `POST/PATCH/DELETE` on the structure resources above                                                                                                                  | organization.structure.manage                                                                                                                       |
| `GET /job-grades`, `GET /designations` (list + `:id`)                                                                                                                 | organization.job_catalog.read                                                                                                                       |
| `POST/PATCH/DELETE /job-grades`, `/designations`                                                                                                                      | organization.job_catalog.manage                                                                                                                     |
| `GET /work-weeks`, `GET /holiday-calendars`, `GET /holiday-calendars/:id/holidays`, `GET /calendar/resolve`                                                           | organization.calendar.read                                                                                                                          |
| `POST/PATCH/DELETE /work-weeks`, `/holiday-calendars`, `/holiday-calendars/:id/holidays[/:holidayId]`                                                                 | organization.calendar.manage                                                                                                                        |

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
