-- Phase 02: identity, sessions, tenant access control (RBAC/ABAC), invitations, subscriptions.
-- Generated DDL (prisma migrate diff) followed by hand-written constraints, RLS, grants and seeds.

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "auth_event_type" AS ENUM ('REGISTERED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'MFA_CHALLENGE_FAILED', 'LOGOUT', 'LOGOUT_ALL', 'TOKEN_REUSE_DETECTED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGED', 'MFA_ENABLED', 'MFA_DISABLED', 'MFA_RECOVERY_CODE_USED', 'ORGANIZATION_SWITCHED', 'SESSION_REVOKED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "access_scope_type" AS ENUM ('ORGANIZATION', 'COMPANY', 'BRANCH', 'DEPARTMENT', 'TEAM', 'SELF');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "email_verified_at" TIMESTAMPTZ(6),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_encrypted" TEXT,
    "mfa_recovery_code_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "active_organization_id" UUID,
    "user_agent" VARCHAR(512),
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" VARCHAR(50),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_events" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" CITEXT,
    "type" "auth_event_type" NOT NULL,
    "session_id" UUID,
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(64),
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" VARCHAR(100) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "description" VARCHAR(300) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "access_scope_type" NOT NULL DEFAULT 'ORGANIZATION',
    "scope_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "full_name" VARCHAR(200),
    "role_ids" UUID[],
    "token_hash" CHAR(64) NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'PENDING',
    "invited_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "limits" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL,
    "trial_ends_at" TIMESTAMPTZ(6),
    "current_period_start" TIMESTAMPTZ(6) NOT NULL,
    "current_period_end" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "auth_events_user_id_occurred_at_idx" ON "auth_events"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "auth_events_email_occurred_at_idx" ON "auth_events"("email", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_organization_id_id_key" ON "memberships"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_id_key" ON "roles"("organization_id", "id");

-- CreateIndex
CREATE INDEX "role_permissions_organization_id_idx" ON "role_permissions"("organization_id");

-- CreateIndex
CREATE INDEX "membership_roles_organization_id_membership_id_idx" ON "membership_roles"("organization_id", "membership_id");

-- CreateIndex
CREATE INDEX "membership_roles_organization_id_role_id_idx" ON "membership_roles"("organization_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_organization_id_status_idx" ON "invitations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_key_key" ON "subscription_plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_fkey" FOREIGN KEY ("active_organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_role_id_fkey" FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_organization_id_role_id_fkey" FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written section
-- =============================================================================================

-- User context (set per transaction alongside the tenant): lets a signed-in user read their own
-- memberships across organizations (organization switcher) without any tenant context.
CREATE OR REPLACE FUNCTION app.current_user_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_format_chk" CHECK ("email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length("email") <= 254),
  ADD CONSTRAINT "users_full_name_not_blank_chk" CHECK (length(btrim("full_name")) > 0),
  ADD CONSTRAINT "users_failed_login_count_chk" CHECK ("failed_login_count" >= 0),
  ADD CONSTRAINT "users_mfa_secret_when_enabled_chk" CHECK (NOT "mfa_enabled" OR "mfa_secret_encrypted" IS NOT NULL);

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_chk" CHECK ("expires_at" > "created_at");

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_hash_format_chk" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "refresh_tokens_expiry_chk" CHECK ("expires_at" > "created_at");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_hash_format_chk" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "password_reset_tokens_expiry_chk" CHECK ("expires_at" > "created_at");

ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_key_format_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$');

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_key_format_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,63}$'),
  ADD CONSTRAINT "roles_name_not_blank_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "membership_roles"
  ADD CONSTRAINT "membership_roles_scope_id_chk" CHECK (
    ("scope_type" IN ('ORGANIZATION', 'SELF') AND "scope_id" IS NULL)
    OR ("scope_type" NOT IN ('ORGANIZATION', 'SELF') AND "scope_id" IS NOT NULL)
  );

-- One assignment per (membership, role, scope); NULL scope_id values compare equal.
CREATE UNIQUE INDEX "membership_roles_assignment_key"
  ON "membership_roles" ("membership_id", "role_id", "scope_type", "scope_id") NULLS NOT DISTINCT;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_hash_format_chk" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "invitations_expiry_chk" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "invitations_roles_present_chk" CHECK (cardinality("role_ids") >= 1);

-- At most one pending invitation per e-mail per organization.
CREATE UNIQUE INDEX "invitations_pending_email_key"
  ON "invitations" ("organization_id", "email") WHERE "status" = 'PENDING';

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_period_chk" CHECK ("current_period_end" IS NULL OR "current_period_end" > "current_period_start"),
  ADD CONSTRAINT "subscriptions_trial_chk" CHECK ("status" <> 'TRIALING' OR "trial_ends_at" IS NOT NULL);

-- ---------------------------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER "users_set_updated_at" BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "memberships_set_updated_at" BEFORE UPDATE ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "roles_set_updated_at" BEFORE UPDATE ON "roles"
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "invitations_set_updated_at" BEFORE UPDATE ON "invitations"
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "subscriptions_set_updated_at" BEFORE UPDATE ON "subscriptions"
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER "auth_events_append_only" BEFORE UPDATE OR DELETE ON "auth_events"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "auth_events_no_truncate" BEFORE TRUNCATE ON "auth_events"
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security for tenant-owned tables
-- Identity tables (users, sessions, refresh_tokens, auth_events, password_reset_tokens) are
-- global (a user spans organizations) and are accessed only through identity services.
-- ---------------------------------------------------------------------------------------------

-- organizations: members may read the organizations they belong to (organization switcher).
CREATE POLICY "organizations_member_read" ON "organizations"
  FOR SELECT
  USING ("id" IN (
    SELECT m."organization_id" FROM "memberships" m
    WHERE m."user_id" = app.current_user_id() AND m."status" = 'ACTIVE'
  ));

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
  FOR ALL
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());
CREATE POLICY "memberships_own_read" ON "memberships"
  FOR SELECT
  USING ("user_id" = app.current_user_id());

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_tenant_isolation" ON "roles"
  FOR ALL
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "role_permissions_tenant_isolation" ON "role_permissions"
  FOR ALL
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());

ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "membership_roles_tenant_isolation" ON "membership_roles"
  FOR ALL
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invitations_tenant_isolation" ON "invitations"
  FOR ALL
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions"
  FOR ALL
  USING ("organization_id" = app.current_organization_id())
  WITH CHECK ("organization_id" = app.current_organization_id());

-- Invitation acceptance arrives without a tenant context (the invitee only has the token).
-- This SECURITY DEFINER function resolves ONLY the tenant of a token hash; all further reads and
-- writes happen through withTenant() under RLS.
CREATE OR REPLACE FUNCTION app.invitation_tenant(p_token_hash text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT "organization_id" FROM public."invitations"
  WHERE "token_hash" = p_token_hash
$$;
REVOKE ALL ON FUNCTION app.invitation_tenant(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- Privileges for the runtime role
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    GRANT EXECUTE ON FUNCTION app.current_user_id() TO hrm_app;
    GRANT EXECUTE ON FUNCTION app.invitation_tenant(text) TO hrm_app;
    -- Tenant registration inserts the new organization under its own (pre-generated) tenant
    -- context, so the RLS WITH CHECK still applies. Deleting organizations remains impossible.
    GRANT INSERT ON TABLE "organizations" TO hrm_app;
    -- Catalogs are read-only at runtime (changed only by migrations).
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "permissions" FROM hrm_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "subscription_plans" FROM hrm_app;
    -- Security audit history is append-only.
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "auth_events" FROM hrm_app;
    -- Subscriptions are never deleted; status changes record history.
    REVOKE DELETE, TRUNCATE ON TABLE "subscriptions" FROM hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Seeds: permission catalog (must mirror PERMISSIONS in @hrm/shared-types; verified by tests)
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('organization.settings.read',   'organization', 'View organization profile and settings'),
  ('organization.settings.update', 'organization', 'Update organization profile and settings'),
  ('users.member.read',            'users',        'View members of the organization'),
  ('users.member.invite',          'users',        'Invite people to the organization'),
  ('users.member.update',          'users',        'Change member status and role assignments'),
  ('users.member.remove',          'users',        'Remove members from the organization'),
  ('roles.role.read',              'roles',        'View roles and their permissions'),
  ('roles.role.manage',            'roles',        'Create, update and delete custom roles'),
  ('audit.log.read',               'audit',        'View the organization audit log'),
  ('subscription.plan.read',       'subscription', 'View the organization subscription');

-- Default plan for new organizations. Limits and trial length are configuration, not pricing.
INSERT INTO "subscription_plans" ("id", "key", "name", "description", "limits") VALUES
  ('019a8b7e-0000-7000-8000-000000000001', 'trial', 'Trial',
   'Default plan assigned at registration. Commercial plans are defined when billing is introduced.',
   '{}');
