#!/usr/bin/env bash
# Runs once, on first initialisation of an empty data volume (as the superuser).
# Also used by CI to provision the service container identically.
#
# Role model (see docs/architecture/ADR-003-database-roles-and-rls.md):
#   hrm_migrator  - owns the schema, runs Prisma migrations. Never used by the running API.
#   hrm_app       - runtime role used by the API. NOSUPERUSER + NOBYPASSRLS so that
#                   PostgreSQL Row-Level Security policies can never be skipped.
#
# Databases: $POSTGRES_DB (development) and ${POSTGRES_DB}_test (integration tests).
set -euo pipefail

: "${HRM_MIGRATOR_PASSWORD:?HRM_MIGRATOR_PASSWORD is required}"
: "${HRM_APP_PASSWORD:?HRM_APP_PASSWORD is required}"
TEST_DB="${POSTGRES_DB}_test"

psql_super() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "$@"
}

# Roles and template extensions (template1 -> Prisma shadow databases inherit them).
psql_super --dbname "$POSTGRES_DB" \
  -v migrator_pw="$HRM_MIGRATOR_PASSWORD" \
  -v app_pw="$HRM_APP_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_migrator') THEN
    CREATE ROLE hrm_migrator LOGIN CREATEDB NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    CREATE ROLE hrm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE hrm_migrator PASSWORD :'migrator_pw';
ALTER ROLE hrm_app PASSWORD :'app_pw';

-- Sessions of the app role always run in UTC with bounded statement time.
ALTER ROLE hrm_app SET timezone = 'UTC';
ALTER ROLE hrm_app SET statement_timeout = '30s';
ALTER ROLE hrm_app SET idle_in_transaction_session_timeout = '60s';

\connect template1
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
SQL

if ! psql_super --dbname postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${TEST_DB}'" | grep -q 1; then
  psql_super --dbname postgres -c "CREATE DATABASE \"${TEST_DB}\""
fi

for DB in "$POSTGRES_DB" "$TEST_DB"; do
  psql_super --dbname "$DB" -v db="$DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

ALTER DATABASE :"db" OWNER TO hrm_migrator;
ALTER SCHEMA public OWNER TO hrm_migrator;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hrm_app;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO hrm_app;

-- Every object the migrator creates is automatically usable (DML only) by the app role.
ALTER DEFAULT PRIVILEGES FOR ROLE hrm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hrm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hrm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hrm_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO hrm_app;
SQL
done

echo "hrm: roles, extensions and databases (${POSTGRES_DB}, ${TEST_DB}) initialised"
