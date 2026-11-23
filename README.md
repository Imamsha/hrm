# HRM Enterprise

Multi-tenant, AI-ready Human Resource Management SaaS platform — React web, React Native (Expo)
mobile, NestJS API, PostgreSQL (RLS + pgvector), Redis/BullMQ — in a pnpm + Turborepo monorepo.

**Current phase:** 08 — Expenses, assets & travel (Phases 01–07 delivered: foundation, auth/RBAC,
organization, employees, attendance/leave, recruitment/onboarding, India payroll). See
[`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm infra:up        # Docker Desktop must be running
pnpm db:deploy
pnpm dev
```

- API: http://localhost:3100/api/v1 · Swagger: http://localhost:3100/api/docs
- Web: http://localhost:5180 (Overview, System status)
- Mobile: Expo dev server (press `a` for Android, `w` for web)
- Mail: http://localhost:8025 · Storage console: http://localhost:9001

## Repository

```
apps/        api (NestJS) · web (React/Vite) · mobile (Expo)
packages/    shared-types · validation · api-client · design-tokens · business-rules · ui-web
             eslint-config · typescript-config
infrastructure/  postgres init (roles, extensions) · nginx · monitoring · ci-cd (Phase 14)
docs/        architecture + ADRs, database, API, RBAC, testing, deployment, module status, roadmap
```

## Quality gates

```bash
pnpm turbo run typecheck lint test build
pnpm format:check
pnpm --filter @hrm/api test:integration   # requires pnpm infra:up
```

## Documentation

[Master instructions](MASTER_PROJECT_INSTRUCTIONS.md) · [Project status](PROJECT_STATUS.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE_SCHEMA.md) ·
[API](docs/API_DOCUMENTATION.md) · [RBAC](docs/RBAC_MATRIX.md) · [Modules](docs/MODULE_STATUS.md) ·
[Roadmap](docs/DEVELOPMENT_ROADMAP.md) · [Testing](docs/TESTING_GUIDE.md) ·
[Deployment](docs/DEPLOYMENT_GUIDE.md)
