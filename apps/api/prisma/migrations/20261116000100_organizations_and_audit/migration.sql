-- Tenant root (organizations) and the append-only audit trail, both protected by RLS.

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'SYSTEM', 'API_CLIENT', 'AI_AGENT');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" CITEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(300),
    "status" "organization_status" NOT NULL DEFAULT 'ACTIVE',
    "default_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "default_currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "default_locale" VARCHAR(35) NOT NULL DEFAULT 'en-IN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organizations_slug_format_chk"
      CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
    CONSTRAINT "organizations_name_not_blank_chk" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "organizations_currency_format_chk" CHECK ("default_currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "organizations_deleted_after_created_chk"
      CHECK ("deleted_at" IS NULL OR "deleted_at" >= "created_at")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(64),
    "request_id" VARCHAR(64),
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "changes" JSONB,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_action_format_chk" CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    CONSTRAINT "audit_logs_user_actor_has_id_chk" CHECK ("actor_type" <> 'USER' OR "actor_id" IS NOT NULL)
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_occurred_at_idx" ON "audit_logs"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_actor_id_idx" ON "audit_logs"("organization_id", "actor_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER "organizations_set_updated_at"
  BEFORE UPDATE ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- The runtime role (hrm_app) is NOBYPASSRLS and not the table owner, so these policies always
-- apply to it. With no tenant context set, app.current_organization_id() is NULL and every
-- predicate below is NULL -> zero rows visible / writable.
-- Organization creation (tenant registration) is intentionally impossible for hrm_app until the
-- Phase 02 registration flow introduces a dedicated, audited SECURITY DEFINER path.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizations_tenant_isolation" ON "organizations"
  FOR ALL
  USING ("id" = app.current_organization_id())
  WITH CHECK ("id" = app.current_organization_id());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_tenant_select" ON "audit_logs"
  FOR SELECT
  USING ("organization_id" = app.current_organization_id());

CREATE POLICY "audit_logs_tenant_insert" ON "audit_logs"
  FOR INSERT
  WITH CHECK ("organization_id" = app.current_organization_id());

-- Defence in depth on top of the trigger: the runtime role cannot modify audit history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM hrm_app;
    REVOKE INSERT, DELETE, TRUNCATE ON TABLE "organizations" FROM hrm_app;
  END IF;
END
$$;
