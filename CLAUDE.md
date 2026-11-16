# HRM Enterprise — instructions for AI coding sessions

Before changing anything in a new session, read in this order:

1. `PROJECT_STATUS.md` — current phase, what is done/verified, known issues, next task.
2. `MASTER_PROJECT_INSTRUCTIONS.md` — product scope and the strict phase rules.
3. `docs/ARCHITECTURE.md` and the ADRs in `docs/architecture/`.
4. Module docs relevant to the task (`docs/MODULE_STATUS.md`, `docs/DATABASE_SCHEMA.md`, `docs/API_DOCUMENTATION.md`).

Never assume earlier work is complete because a previous conversation said so — verify with the
commands in `docs/TESTING_GUIDE.md`.

## Non-negotiables

- Work only on the current, user-approved phase. Do not start the next phase without approval.
- Tenant data is accessed only through `PrismaService.withTenant()`; never trust a client-supplied
  `organization_id`. Every tenant-owned table gets `organization_id` + an RLS policy in its migration.
- No business logic in controllers. Services throw `AppException`, never raw HttpExceptions.
- Money uses `@hrm/business-rules` (Decimal) and `numeric` columns — never JS numbers or floats.
- Statutory payroll values are configuration (effective-dated), never hard-coded.
- No mock data standing in for real functionality. Tests may stub network boundaries only.
- Shared validation lives in `@hrm/validation` (Zod) and is reused by API, web and mobile.
- Pin dependency versions; prefer releases at least two weeks old; record decisions in an ADR.

## Commands

```
pnpm install                      # also generates the Prisma client
pnpm infra:up                     # Postgres+pgvector, Redis, S3 storage, Mailpit (Docker)
pnpm db:deploy                    # apply migrations to the dev database
pnpm dev                          # API :3100, web :5180, Expo
pnpm turbo run typecheck lint test build
pnpm --filter @hrm/api test:integration   # needs infra:up
```

Windows note: PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM, which breaks
`pnpm-workspace.yaml` and JSON. Edit files with the editor tools or Node instead.
