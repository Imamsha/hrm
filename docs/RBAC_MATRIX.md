# RBAC / ABAC matrix

Status: **enforced since Phase 02.** Model and enforcement path: [ADR-009](architecture/ADR-009-authorization-rbac-abac.md).
Every protected row below is covered by an integration test (allowed role succeeds; others → 403;
other tenants → 404/400).

## Permission catalog

| Permission                     | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| `organization.settings.read`   | View organization profile and settings              |
| `organization.settings.update` | Update organization profile and settings            |
| `users.member.read`            | View members (and pending invitations)              |
| `users.member.invite`          | Invite people, revoke invitations                   |
| `users.member.update`          | Suspend/reactivate members, change role assignments |
| `users.member.remove`          | Remove members                                      |
| `roles.role.read`              | View roles and the permission catalog               |
| `roles.role.manage`            | Create, update, delete custom roles                 |
| `audit.log.read`               | View the organization audit log                     |
| `subscription.plan.read`       | View the subscription                               |

## System roles (created per organization, immutable)

| Permission                   | Owner | Admin | HR admin | Finance | Manager | Employee |
| ---------------------------- | :---: | :---: | :------: | :-----: | :-----: | :------: |
| organization.settings.read   |   ✓   |   ✓   |    ✓     |    ✓    |    ✓    |    ✓     |
| organization.settings.update |   ✓   |   ✓   |          |         |         |          |
| users.member.read            |   ✓   |   ✓   |    ✓     |         |    ✓    |          |
| users.member.invite          |   ✓   |   ✓   |    ✓     |         |         |          |
| users.member.update          |   ✓   |   ✓   |    ✓     |         |         |          |
| users.member.remove          |   ✓   |   ✓   |          |         |         |          |
| roles.role.read              |   ✓   |   ✓   |    ✓     |         |         |          |
| roles.role.manage            |   ✓   |   ✓   |          |         |         |          |
| audit.log.read               |   ✓   |   ✓   |    ✓     |         |         |          |
| subscription.plan.read       |   ✓   |   ✓   |          |    ✓    |         |          |

Owner-only actions (beyond permissions): grant/revoke the owner role; suspend or remove another owner.

## Endpoint authorization

| Endpoint                                                                                                                                                              | Requirement                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /health*`                                                                                                                                                        | Public                                                                                   |
| `POST /auth/register`, `/auth/login`, `/auth/mfa/verify`, `/auth/password/forgot`, `/auth/password/reset`                                                             | Public, credential rate limit                                                            |
| `POST /auth/refresh`                                                                                                                                                  | Public (valid refresh token required)                                                    |
| `GET /invitations/preview`, `POST /invitations/accept`                                                                                                                | Public, credential rate limit; existing accounts must be signed in as the invited e-mail |
| `GET /auth/me`, `POST /auth/logout`, `/logout-all`, `/switch-organization`, `/password/change`, `/mfa/totp/*`, `GET/DELETE /auth/sessions`, `GET /auth/login-history` | Any authenticated user (self-service)                                                    |
| `POST /organizations`                                                                                                                                                 | Any authenticated user (becomes owner of the new organization)                           |
| `GET /organizations/current`                                                                                                                                          | organization.settings.read                                                               |
| `PATCH /organizations/current`                                                                                                                                        | organization.settings.update                                                             |
| `GET /organizations/current/subscription`                                                                                                                             | subscription.plan.read                                                                   |
| `GET /members`, `GET /invitations`                                                                                                                                    | users.member.read                                                                        |
| `POST /invitations`, `DELETE /invitations/:id`                                                                                                                        | users.member.invite (+ owner to grant owner)                                             |
| `PATCH /members/:id`, `PUT /members/:id/roles`                                                                                                                        | users.member.update (+ owner rules)                                                      |
| `DELETE /members/:id`                                                                                                                                                 | users.member.remove (+ owner rules)                                                      |
| `GET /roles`, `GET /permissions`                                                                                                                                      | roles.role.read                                                                          |
| `POST/PATCH/DELETE /roles`                                                                                                                                            | roles.role.manage                                                                        |
| `GET /audit-logs`                                                                                                                                                     | audit.log.read                                                                           |

## Access scopes (target model)

| Scope                                | Status                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| ORGANIZATION                         | Enforced                                                                  |
| SELF                                 | Evaluated by `can()` for owner-attributed resources                       |
| COMPANY / BRANCH / DEPARTMENT / TEAM | Stored on assignments; evaluated from Phase 03 (deny until then)          |
| Platform administration              | Not exposed through tenant APIs; separate audited path planned (Phase 14) |
