# Deployment guide

Status: **local development only (Phase 01).** Production deployment (container images, Nginx,
TLS, secrets management, monitoring, backups) is Phase 14. This guide documents what exists.

## Prerequisites

- Node.js ≥ 22.12 (recommended 22.22+ or 24 LTS — see ADR-001), pnpm 12 (`npm i -g pnpm@12.21.0`
  or Corepack), Docker Desktop (Compose v2), Git.

## Local environment

```bash
cp .env.example .env          # dev-only defaults; never commit .env
pnpm install                  # installs and generates the Prisma client
pnpm infra:up                 # waits until all services are healthy
pnpm db:deploy                # apply migrations (as hrm_migrator)
pnpm dev                      # API :3100 (docs /api/docs), web :5180, Expo dev server
```

| Service                  | Host port           | Notes                                                                                                                                                 |
| ------------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 17 + pgvector | 5434                | DBs `hrm`, `hrm_test`; roles `hrm_migrator`, `hrm_app`; `btree_gist` (trusted) is created by the Phase 04 migration — managed databases must allow it |
| Redis 7.4                | 6380                | password-protected, AOF, `noeviction`                                                                                                                 |
| RustFS (S3)              | 9000 / console 9001 | bucket auto-created in dev                                                                                                                            |
| Mailpit                  | SMTP 1025 / UI 8025 | captures all outgoing email                                                                                                                           |

Ports avoid the natively installed PostgreSQL (5432) / Redis (6379) and ports used by other local
projects on the development machine (5433, 3000, 5173). App ports: API **3100**, web dev **5180**,
web preview **4173** (all in `CORS_ORIGINS`). Every port is overridable in `.env`.
`pnpm infra:up` runs `scripts/check-infra-ports.mjs`, which fails if Docker started a service
without publishing its host port (Docker Desktop does this silently when the port is taken).
Reset everything: `docker compose down -v` (destroys local data).

Do **not** put `NODE_ENV` in the root `.env`: Vite loads that file and would produce a
development build of the web app. The API defaults to `development`; set `NODE_ENV=production`
in the deployment environment instead.

Mobile: Android emulator → set `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3100/api/v1`; physical
device → host LAN IP, and add the Expo origin to `CORS_ORIGINS` if testing Expo web.

## Authentication settings (Phase 02)

| Variable                                                                                                                                                         | Purpose                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_JWT_SECRET`                                                                                                                                                | HS256 key, ≥ 32 chars. Generate with `openssl rand -base64 48`. Dev values are rejected in production                                                                 |
| `DATA_ENCRYPTION_KEY`                                                                                                                                            | base64 of exactly 32 bytes (`openssl rand -base64 32`); encrypts MFA secrets. **Losing it disables every enrolled authenticator** — back it up in the secrets manager |
| `AUTH_COOKIE_SECURE`                                                                                                                                             | must be `true` in production (HTTPS)                                                                                                                                  |
| `APP_WEB_URL`                                                                                                                                                    | origin used in e-mailed links (reset password, invitations)                                                                                                           |
| `SMTP_*`                                                                                                                                                         | outgoing mail; Mailpit in development                                                                                                                                 |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`, `AUTH_SESSION_TTL_DAYS`, `AUTH_LOCKOUT_*`, `AUTH_RATE_LIMIT_MAX`, `AUTH_PASSWORD_RESET_TTL_MINUTES`, `AUTH_INVITATION_TTL_DAYS` | security tuning (safe defaults)                                                                                                                                       |
| `SUBSCRIPTION_TRIAL_DAYS`, `SUBSCRIPTION_DEFAULT_PLAN_KEY`                                                                                                       | trial length (business configuration) and plan assigned at registration                                                                                               |

The web app and API must share a registrable site (e.g. `app.example.com` + `api.example.com`)
for the `SameSite=Strict` refresh cookie; otherwise serve the API under the web origin via the
reverse proxy (Phase 14).

## Production requirements already enforced by configuration

- API refuses to start with invalid/missing env; in `production` it rejects wildcard CORS,
  bucket auto-creation, `_dev_only` credentials, development JWT secrets and non-Secure cookies.
- API connects with `hrm_app` (RLS-bound); migrations run as a separate job with
  `MIGRATION_DATABASE_URL` (`pnpm db:deploy`) before rolling out new API versions.
- Swagger disabled unless `SWAGGER_ENABLED=true`.

## Phase 14 scope

Multi-stage Dockerfiles (API, web static via Nginx), Nginx reverse proxy + TLS + security headers,
separate worker deployment, Redis-backed throttling, secrets manager, managed PostgreSQL with PITR
backups and restore drills, object storage lifecycle/encryption, centralised logs and metrics
(OpenTelemetry), uptime/alerting, CD pipeline with migration gate, k6 performance baselines.
