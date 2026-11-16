# ADR-002: NestJS 12 ESM runtime, validation and test runners

- Status: Accepted (2026-11-16)

## Context

NestJS 12 (Aug 2026) ships ESM-only. The Nest CLI 12 crashes on Node 22.13
(`ERR_REQUIRE_CYCLE_MODULE` in `@angular-devkit` → `ora`). Nest DI requires
`emitDecoratorMetadata`, which esbuild/oxc-based runners do not emit.

## Decision

1. **NestJS 12.3.2 without the Nest CLI.** Build with `tsc -p tsconfig.build.json`; dev mode uses
   `scripts/dev.mjs` (`tsc --watch` + `node --watch`). Nothing depends on CLI-only features.
2. **Vitest 5 + `unplugin-swc` for the API and shared packages** (SWC emits decorator metadata).
   The master prompt lists Jest; Vitest keeps a Jest-compatible API and works natively with ESM,
   whereas Jest's ESM mode is still experimental. **Supertest** is used for HTTP tests as specified.
   **Jest** (via `jest-expo`) remains the runner for React Native, where it is the supported path.
   Playwright covers web E2E. Maestro (mobile E2E) and k6 (load) arrive with Phases 13–14.
3. **Zod (via `@hrm/validation`) instead of class-validator.** One schema validates the API input
   (`ZodValidationPipe`), web forms and mobile forms. Zod 4 exports JSON Schema for OpenAPI.
4. **Prisma 7.10.1** (`prisma-client` generator, ESM, driver adapter `@prisma/adapter-pg`).
   Prisma's `latest` tag points at an 8.0 release candidate; the stable 7.x line is used.
5. **BullMQ 5.81.x** rather than 6.x: v6 (Jul 2026) switched to pluggable backends with a new
   connection model; 5.x is still maintained and is what `@nestjs/bullmq` 12 documents.

## Consequences

- Tests import `reflect-metadata` explicitly; unit and integration suites are separate Vitest
  projects (`--project unit|integration`).
- Upgrading Node allows re-evaluating the Nest CLI, but it is not required.
