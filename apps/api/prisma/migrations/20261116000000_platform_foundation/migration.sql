-- Platform foundation: extensions, the `app` helper schema and tenant-context functions.
-- See docs/architecture/ADR-003-database-roles-and-rls.md

-- Extensions are pre-created by the superuser in infrastructure/postgres/init (pgvector is not
-- a trusted extension). IF NOT EXISTS makes this a no-op there and documents the requirement.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS app;
COMMENT ON SCHEMA app IS 'Platform helper functions (tenant context, triggers). No tenant data.';

-- Tenant context is set per transaction by the API:
--   SELECT set_config('app.organization_id', '<uuid>', true);   -- true = transaction-local
-- Returns NULL when unset, so RLS predicates evaluate to NULL (= no rows) by default.
CREATE OR REPLACE FUNCTION app.current_organization_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

COMMENT ON FUNCTION app.current_organization_id() IS
  'Organization of the current transaction, set via set_config(''app.organization_id'', id, true). NULL if unset.';

-- Generic trigger keeping updated_at correct even for raw SQL writes.
CREATE OR REPLACE FUNCTION app.set_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Generic trigger making a table append-only.
CREATE OR REPLACE FUNCTION app.prevent_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- The runtime role may call helper functions but never touch migration bookkeeping.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    GRANT USAGE ON SCHEMA app TO hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON TABLE public._prisma_migrations FROM hrm_app;
    END IF;
  END IF;
END
$$;
