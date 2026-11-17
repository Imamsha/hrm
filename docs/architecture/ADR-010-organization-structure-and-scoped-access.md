# ADR-010: Organization structure, calendars and structural ABAC scopes

- Status: Accepted (2026-11-17, Phase 03)
- Extends: [ADR-003](ADR-003-database-roles-and-rls.md), [ADR-009](ADR-009-authorization-rbac-abac.md)

## Context

Phase 03 introduces each tenant's structure (companies, legal entities, locations, branches, cost
centers, departments, teams), the job catalog (job grades, designations) and calendars (work
weeks, holiday calendars). It also has to make the COMPANY / BRANCH / DEPARTMENT / TEAM scopes
stored on role assignments since Phase 02 actually mean something. Later modules depend on this:
employees (Phase 04), attendance and leave (Phase 05) and payroll day counts (Phase 07).

## Decisions

### Structure model

```
Organization ─< Company ─< LegalEntity            (India identifiers: PAN, TAN, GSTIN, CIN)
                       ─< Branch >─ LegalEntity?, Location?, WorkWeek?, HolidayCalendar?
                       ─< Department (self-tree) ─< Team
             ─< Location, CostCenter (optional company), JobGrade ─< Designation
             ─< WorkWeek ─< WorkWeekRule           HolidayCalendar ─< Holiday
```

- A **company** is the operating business. A **legal entity** is a registered employer (it holds
  the statutory identifiers payroll will need). A **branch** is a place of work that belongs to one
  company and optionally to one of that company's legal entities.
- Owning parents (company of a branch, department or legal entity; department of a team) use
  composite `(organization_id, id)` foreign keys and cannot change after creation. Optional
  references use a plain FK plus the `app.enforce_same_tenant()` trigger. Prisma cannot express a
  composite FK in which only some columns are nullable.
- Records are **archived** (`status = INACTIVE`) rather than deleted. A delete that would orphan
  references fails with 23503, which the API maps to 409 "in use — set inactive".
- Identifier formats (PAN, TAN, GSTIN including the embedded PAN, CIN) are validated three times:
  shared Zod schemas on web and API, and CHECK constraints in the database. They apply only to
  Indian entities. No other statutory rule is assumed.

### Calendars

- A **work week** is a set of rules `(weekday 1–7, occurrence 0–5, dayType FULL | HALF | OFF)`.
  Occurrence 0 applies every week. An occurrence rule overrides it for the nth weekday of the month,
  e.g. 2nd and 4th Saturday off. Weekdays without a rule are OFF.
- A **holiday calendar** holds dated PUBLIC or OPTIONAL holidays entered by the organization.
  **No holiday list is seeded:** national, state and optional holidays vary by state and year, and
  the master rules forbid inventing them.
- Resolution (`resolveDays` in `@hrm/business-rules`): holiday first (PUBLIC beats OPTIONAL), then
  the work-week rule; half day counts as 0.5 working days; at most 366 days per call. A branch uses
  its own work week and calendar, falling back to the organization defaults. Each organization has
  at most one default of each, enforced by partial unique indexes. Policy questions such as a
  holiday on a weekly off or sandwich leave are left to the attendance and leave modules (Phase 05).

### Structural ABAC scopes

- `can(principal, permission, resource)` now evaluates COMPANY, BRANCH and TEAM by matching the
  resource's `companyId`, `branchId` or `teamId`. DEPARTMENT matches the department **and all of
  its sub-departments**. If the resource lacks the attribute, the result is deny.
- Department coverage is computed when access is resolved: a breadth-first walk of the tree, at
  most 12 levels, which is above the depth limit of 10. The result is stored with the cached
  `ResolvedAccess`. Every department create, update or delete bumps the organization's access
  version, so new sub-departments are covered immediately.
- Scoped grants **never** satisfy `@RequirePermissions`; endpoints still require an
  organization-wide grant. Scoped grants are consumed by services through `can()` once resources
  carry structural attributes (employee records, Phase 04). Phase 03 does not widen any endpoint.
- Integrity of assignments:
  - `app.membership_role_scope_target()` requires the scope target to exist in the same tenant.
  - `app.prevent_delete_scope_target()` blocks deleting a referenced company, branch, department
    or team.
  - The owner role is organization-wide only, and only owners can grant or revoke it.
  - Removing the last owner is rejected.

### Permissions

The six new permissions follow `organization.<area>.<read|manage>` for structure, job catalog and
calendar. The Phase 03 migration grants them to existing organizations' system roles to match
`SYSTEM_ROLES`, and an integration test asserts parity for every organization.

## Consequences

- Every later module can reference structure through composite FKs and inherit RLS.
- Scoped administration, such as a manager seeing only their department's employees, needs no
  schema changes in Phase 04: services pass the employee's structural attributes to `can()`.
- Department tree changes invalidate the organization's access cache. Tree edits are rare, so the
  extra resolutions are negligible.
- Reference pickers load up to 200 records per list (the API page maximum). Very large
  organizations will need search-as-you-type pickers; this is noted for Phase 04.
