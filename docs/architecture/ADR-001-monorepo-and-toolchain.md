# ADR-001: Monorepo, toolchain and dependency policy

- Status: Accepted (2026-11-16)

## Decision

- **pnpm 12 workspaces + Turborepo 2.** Shared versions live in the pnpm `catalog:` in
  `pnpm-workspace.yaml`. Install scripts are allow-listed via `allowBuilds` (telemetry-only scripts
  such as `@scarf/scarf` are denied). pnpm's minimum-release-age policy stays enabled; versions are
  pinned rather than exempted.
- **TypeScript 6.0.3.** TypeScript 7 (native port) is newer, but `typescript-eslint` supports
  `<6.1` and `ts-jest`/tooling `<7`; 6.0 satisfies every tool, including Expo SDK 58 (`~6.0.3`).
  TS 6 defaults `types` to `[]`, so every tsconfig declares its ambient types explicitly.
- **ESM everywhere** (`"type": "module"`, `NodeNext` for libraries/API, `Bundler` for Vite apps).
  The mobile app stays CommonJS for Expo config files.
- **Version policy:** pin exact versions; prefer releases at least ~2 weeks old; choose the
  maintained major line; verify peer ranges before adding. Exceptions are documented here.
- **Single React version (19.3.0)** across web and mobile because Expo SDK 58 pins it.
- **Node:** engines `>=22.12`. CI uses Node 22.22.x. The current workstation runs 22.13.1, which
  forced `jsdom@29` (jsdom 30 requires Node ≥ 22.22) and breaks the Nest CLI's `ora` dependency
  (`ERR_REQUIRE_CYCLE_MODULE`). **Recommendation: upgrade local Node to 22.22+ or 24 LTS.**

## Consequences

- Turborepo task graph: `db:generate` precedes API build/lint/typecheck/test (avoids concurrent
  Prisma generation races); `^build` ensures packages compile before consumers.
- Windows: PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM which breaks
  `pnpm-workspace.yaml`; use editor tools/Node for file edits. `.gitattributes` enforces LF.
