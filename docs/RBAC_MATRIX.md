# RBAC / ABAC matrix

Status: **not yet enforced.** Authentication, roles, permissions and ABAC policies are Phase 02.
Phase 01 provides the enforcement substrate: tenant-scoped RLS, a least-privileged runtime role
and request context fields (`organizationId`, `userId`) that Phase 02 authentication populates.

## Access scopes (target model)

| Scope        | Who                                    | Boundary                                                                               |
| ------------ | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Platform     | Platform administrators (vendor staff) | Cross-tenant support tooling only via audited platform path; never through tenant APIs |
| Organization | Organization administrators            | One organization (all companies within it)                                             |
| HR           | HR administrators                      | Organization or assigned companies/branches                                            |
| Finance      | Finance users / payroll admins         | Payroll, expenses, reimbursements within assigned entities                             |
| Manager      | People managers                        | Own reporting tree (direct + indirect reports)                                         |
| Employee     | Every employee                         | Self-service on own records                                                            |

## Permission naming

`<module>.<resource>.<action>` with actions `read | create | update | delete | approve | export |
manage`, e.g. `employees.profile.read`, `leave.request.approve`, `payroll.run.manage`.
ABAC conditions narrow a permission by attributes: `scope=self|team|department|branch|company|org`,
data sensitivity (e.g. bank/tax fields), and workflow state.

## Phase 01 endpoints

| Endpoint            | Platform | Org admin | HR  | Finance | Manager | Employee | Anonymous                                        |
| ------------------- | -------- | --------- | --- | ------- | ------- | -------- | ------------------------------------------------ |
| `GET /health/live`  | ✓        | ✓         | ✓   | ✓       | ✓       | ✓        | ✓                                                |
| `GET /health`       | ✓        | ✓         | ✓   | ✓       | ✓       | ✓        | ✓ (no secrets; restrict in Phase 14 if required) |
| `GET /health/ready` | ✓        | ✓         | ✓   | ✓       | ✓       | ✓        | ✓                                                |

The matrix is extended module by module from Phase 02, and every row is backed by an
authorization test (allowed role succeeds, other roles and other tenants are denied).
