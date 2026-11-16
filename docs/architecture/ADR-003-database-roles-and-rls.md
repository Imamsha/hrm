# ADR-003: Database roles, tenant context and Row-Level Security

- Status: Accepted (2026-11-16). Phase 01 = foundation; Phase 02 = full enforcement.

## Decision

### Roles (`infrastructure/postgres/init/01-roles-and-extensions.sh`)

| Role           | Attributes                                                                                      | Used by                                      |
| -------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `postgres`     | superuser                                                                                       | container bootstrap only (extensions, roles) |
| `hrm_migrator` | LOGIN, CREATEDB, NOSUPERUSER, NOBYPASSRLS; owns DB + `public` schema                            | Prisma CLI / CI                              |
| `hrm_app`      | LOGIN, NOSUPERUSER, NOBYPASSRLS, not owner; DML via default privileges; `statement_timeout=30s` | the running API                              |

`hrm_app` cannot read `_prisma_migrations`, cannot UPDATE/DELETE/TRUNCATE `audit_logs`, and cannot
INSERT/DELETE `organizations`.

### Tenant context

`app.current_organization_id()` reads `current_setting('app.organization_id', true)` and returns
NULL when unset. `PrismaService.withTenant()` sets it with `set_config(..., true)` inside an
interactive transaction, so the value is scoped to that transaction and is discarded on
commit/rollback — safe with connection pooling (including PgBouncer transaction mode).

### Policies

Every tenant-owned table: `ENABLE ROW LEVEL SECURITY` + policies of the form
`USING (organization_id = app.current_organization_id())
 WITH CHECK (organization_id = app.current_organization_id())`.
Separate policies per command where behaviour differs (e.g. audit logs: SELECT + INSERT only).
`FORCE ROW LEVEL SECURITY` is not used because the owner (`hrm_migrator`) is never used at runtime;
the runtime role is subject to RLS regardless.

### Extensions

`pgcrypto`, `citext`, `vector` (pgvector 0.8.7), `pg_stat_statements` are created by the superuser
in both the dev/test databases and `template1` (so Prisma shadow databases inherit them).
Migrations also declare them with `IF NOT EXISTS`.

## Phase 02 additions (implemented 2026-11-16 — see ADR-009)

- Memberships table; tenant resolved from the authenticated session + membership check.
- Composite foreign keys `(organization_id, id)` on child tables to make cross-tenant references
  impossible at the schema level.
- Platform-administration path (separate audited role or SECURITY DEFINER functions) for tenant
  registration and support tooling; never `BYPASSRLS` for the API.
- Lint/test guard asserting every table with `organization_id` has RLS enabled.

## Verification

`apps/api/test/integration/tenant-isolation.int.test.ts` (requires Docker infrastructure).
