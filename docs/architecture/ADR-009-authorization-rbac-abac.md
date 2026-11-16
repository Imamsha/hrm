# ADR-009: Authorization (RBAC + ABAC) and tenant resolution

- Status: Accepted (2026-11-16, Phase 02)

## Model

```
User ──< Membership (organization, status) ──< MembershipRole (role, scope_type, scope_id) >── Role ──< RolePermission >── Permission (catalog)
```

- **Permission catalog** — `<module>.<resource>.<action>`, defined once in `@hrm/shared-types` (`PERMISSIONS`) and seeded by migration; a test asserts both match.
- **Roles** are per organization. Six **system roles** are created with every organization (owner, admin, hr_admin, finance, manager, employee) and are immutable; organizations add **custom roles**.
- **ABAC scope** lives on the role assignment: `ORGANIZATION | COMPANY | BRANCH | DEPARTMENT | TEAM | SELF`. Phase 02 evaluates `ORGANIZATION` (always) and `SELF` (resource owner = caller). Structural scopes deny until Phase 03 adds the organization structure.

## Enforcement path (every request)

1. `AccessGuard` (global, after the throttler) verifies the JWT and rejects revoked sessions and disabled users.
2. If the token carries `org`, the guard resolves the **active membership** in that organization from the database (cached ≤ 60 s in Redis; any membership/role/permission change bumps an organization version key, invalidating the cache immediately). No active membership → 403. The tenant context (`RequestContext.organizationId`) is set **only** from this verified membership.
3. `@RequirePermissions(...)` requires each permission at ORGANIZATION scope; fine-grained checks use `can(principal, permission, resource)`.
4. Data access runs in `withTenant()` → PostgreSQL RLS. A bug in steps 1–3 still cannot reach another tenant's rows.

Client-supplied tenant hints (`X-Organization-Id`, body `organizationId`) are ignored — verified by tests.

## Invariants

- An organization always keeps ≥ 1 ACTIVE owner (demote/suspend/remove are rejected otherwise).
- Only owners grant/revoke the owner role or act on other owners.
- Members cannot suspend or remove themselves.
- Roles still assigned to members cannot be deleted; system roles cannot be modified.

## RLS additions

- `memberships_own_read` / `organizations_member_read` let a user read **their own** memberships and organizations **only when no tenant context is set** (organization switcher). Inside a tenant transaction only tenant rows are visible (fixed in migration `20261116020000` after an integration test caught the OR-ed policy leaking the caller's other memberships into tenant queries).
- Composite foreign keys `(organization_id, id)` on roles/memberships make cross-tenant assignments impossible at the schema level.
- Invitation acceptance resolves its tenant via `app.invitation_tenant(token_hash)` (SECURITY DEFINER, returns only the organization id); everything else stays under RLS.
- Registration inserts the new organization inside a transaction whose tenant context is the pre-generated organization id, so RLS `WITH CHECK` still applies; the runtime role still cannot delete organizations.
