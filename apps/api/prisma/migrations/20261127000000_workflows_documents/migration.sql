-- CreateEnum
CREATE TYPE "workflow_process" AS ENUM ('LEAVE_REQUEST', 'EXPENSE_CLAIM', 'TRAVEL_REQUEST', 'TIMESHEET');

-- CreateEnum
CREATE TYPE "workflow_instance_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "workflow_task_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "template_category" AS ENUM ('OFFER_LETTER', 'APPOINTMENT_LETTER', 'EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'SALARY_CERTIFICATE', 'POLICY', 'OTHER');

-- CreateEnum
CREATE TYPE "generated_document_status" AS ENUM ('FINAL', 'AWAITING_ACCEPTANCE', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "signer_kind" AS ENUM ('EMPLOYEE', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "signer_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "signature_method" AS ENUM ('LOGIN', 'EMAIL_OTP');

-- CreateEnum
CREATE TYPE "library_document_status" AS ENUM ('PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "process" "workflow_process" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'INACTIVE',
    "steps" JSONB NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "process" "workflow_process" NOT NULL,
    "subject_id" UUID NOT NULL,
    "requester_employee_id" UUID NOT NULL,
    "measure" DECIMAL(14,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "workflow_instance_status" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_number" INTEGER NOT NULL,
    "step_name" VARCHAR(80) NOT NULL,
    "status" "workflow_task_status" NOT NULL DEFAULT 'PENDING',
    "assignee_ids" UUID[],
    "on_behalf_of_employee_id" UUID,
    "escalated_from_employee_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "skipped_reason" VARCHAR(200),
    "decided_by_user_id" UUID,
    "decided_by_employee_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "delegator_employee_id" UUID NOT NULL,
    "delegate_employee_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "processes" "workflow_process"[],
    "note" VARCHAR(300),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "template_category" NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_template_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(50000) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "category" "template_category" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "employee_id" UUID,
    "offer_id" UUID,
    "storage_key" VARCHAR(500) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "merged_values" JSONB NOT NULL,
    "status" "generated_document_status" NOT NULL DEFAULT 'FINAL',
    "certificate_key" VARCHAR(500),
    "certificate_sha256" CHAR(64),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "signer_kind" NOT NULL,
    "employee_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254),
    "status" "signer_status" NOT NULL DEFAULT 'PENDING',
    "method" "signature_method",
    "signed_at" TIMESTAMPTZ(6),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "accepted_sha256" CHAR(64),
    "decline_reason" VARCHAR(500),
    "access_token_hash" CHAR(64),
    "otp_hash" CHAR(64),
    "otp_expires_at" TIMESTAMPTZ(6),
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_signers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "description" VARCHAR(2000),
    "requires_acknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "status" "library_document_status" NOT NULL DEFAULT 'PUBLISHED',
    "audience_company_id" UUID,
    "audience_department_id" UUID,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "library_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_document_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_acknowledgements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "employee_id" UUID NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_definitions_organization_id_process_status_idx" ON "workflow_definitions"("organization_id", "process", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_organization_id_id_key" ON "workflow_definitions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "workflow_instances_organization_id_process_subject_id_idx" ON "workflow_instances"("organization_id", "process", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_instances_organization_id_id_key" ON "workflow_instances"("organization_id", "id");

-- CreateIndex
CREATE INDEX "workflow_tasks_organization_id_status_idx" ON "workflow_tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "workflow_tasks_organization_id_instance_id_idx" ON "workflow_tasks"("organization_id", "instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_tasks_instance_id_step_index_key" ON "workflow_tasks"("instance_id", "step_index");

-- CreateIndex
CREATE INDEX "approval_delegations_organization_id_delegator_employee_id__idx" ON "approval_delegations"("organization_id", "delegator_employee_id", "from_date");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_organization_id_name_key" ON "document_templates"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_organization_id_id_key" ON "document_templates"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_versions_template_id_version_key" ON "document_template_versions"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_versions_organization_id_id_key" ON "document_template_versions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "generated_documents_organization_id_employee_id_idx" ON "generated_documents"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "generated_documents_organization_id_offer_id_idx" ON "generated_documents"("organization_id", "offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_organization_id_id_key" ON "generated_documents"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_signers_access_token_hash_key" ON "document_signers"("access_token_hash");

-- CreateIndex
CREATE INDEX "document_signers_organization_id_employee_id_status_idx" ON "document_signers"("organization_id", "employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_signers_document_id_order_key" ON "document_signers"("document_id", "order");

-- CreateIndex
CREATE INDEX "library_documents_organization_id_status_idx" ON "library_documents"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "library_documents_organization_id_id_key" ON "library_documents"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "library_document_versions_document_id_version_key" ON "library_document_versions"("document_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "library_acknowledgements_document_id_version_employee_id_key" ON "library_acknowledgements"("document_id", "version", "employee_id");

-- AddForeignKey
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_definition_id_fkey" FOREIGN KEY ("organization_id", "definition_id") REFERENCES "workflow_definitions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_requester_employee_id_fkey" FOREIGN KEY ("organization_id", "requester_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organization_id_instance_id_fkey" FOREIGN KEY ("organization_id", "instance_id") REFERENCES "workflow_instances"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_organization_id_delegator_employee_id_fkey" FOREIGN KEY ("organization_id", "delegator_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_organization_id_delegate_employee_id_fkey" FOREIGN KEY ("organization_id", "delegate_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_organization_id_template_id_fkey" FOREIGN KEY ("organization_id", "template_id") REFERENCES "document_templates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_organization_id_template_version_id_fkey" FOREIGN KEY ("organization_id", "template_version_id") REFERENCES "document_template_versions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signers" ADD CONSTRAINT "document_signers_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "generated_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_documents" ADD CONSTRAINT "library_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_document_versions" ADD CONSTRAINT "library_document_versions_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "library_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_acknowledgements" ADD CONSTRAINT "library_acknowledgements_organization_id_document_id_fkey" FOREIGN KEY ("organization_id", "document_id") REFERENCES "library_documents"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_acknowledgements" ADD CONSTRAINT "library_acknowledgements_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Phase 11a — integrity rules beyond what Prisma expresses (ADR-018)
-- =============================================================================================

ALTER TABLE "workflow_definitions"
  ADD CONSTRAINT "workflow_definitions_steps_chk" CHECK (
    jsonb_typeof("steps") = 'array' AND jsonb_array_length("steps") BETWEEN 1 AND 10),
  ADD CONSTRAINT "workflow_definitions_name_chk" CHECK (length(btrim("name")) > 0);
-- At most one active workflow per process.
CREATE UNIQUE INDEX "workflow_definitions_one_active_key"
  ON "workflow_definitions" ("organization_id", "process") WHERE "status" = 'ACTIVE';

ALTER TABLE "workflow_instances"
  ADD CONSTRAINT "workflow_instances_chk" CHECK (
    jsonb_typeof("snapshot") = 'array' AND "measure" >= 0
    AND (("status" = 'PENDING') = ("completed_at" IS NULL)));
-- One live approval per request.
CREATE UNIQUE INDEX "workflow_instances_one_pending_key"
  ON "workflow_instances" ("process", "subject_id") WHERE "status" = 'PENDING';

ALTER TABLE "workflow_tasks"
  ADD CONSTRAINT "workflow_tasks_chk" CHECK (
    "step_index" >= 0 AND "step_number" >= 1
    AND ("status" <> 'SKIPPED' OR "skipped_reason" IS NOT NULL)
    AND ("status" NOT IN ('APPROVED', 'REJECTED') OR ("decided_at" IS NOT NULL AND "decided_by_user_id" IS NOT NULL))
    AND ("status" <> 'REJECTED' OR "note" IS NOT NULL)
    AND ("status" <> 'PENDING' OR cardinality("assignee_ids") > 0));

-- A finished instance and a decided task never change.
CREATE OR REPLACE FUNCTION app.workflow_instance_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A finished approval cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.subject_id <> OLD.subject_id
     OR NEW.requester_employee_id <> OLD.requester_employee_id THEN
    RAISE EXCEPTION 'An approval keeps its request and steps' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "workflow_instances_guard" BEFORE UPDATE OR DELETE ON "workflow_instances"
  FOR EACH ROW EXECUTE FUNCTION app.workflow_instance_guard();

CREATE OR REPLACE FUNCTION app.workflow_task_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided approval step cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "workflow_tasks_guard" BEFORE UPDATE OR DELETE ON "workflow_tasks"
  FOR EACH ROW EXECUTE FUNCTION app.workflow_task_guard();

ALTER TABLE "approval_delegations"
  ADD CONSTRAINT "approval_delegations_chk" CHECK (
    "delegator_employee_id" <> "delegate_employee_id" AND "to_date" >= "from_date");

ALTER TABLE "document_templates"
  ADD CONSTRAINT "document_templates_chk" CHECK (length(btrim("name")) > 0 AND "current_version" >= 1);
ALTER TABLE "document_template_versions"
  ADD CONSTRAINT "document_template_versions_chk" CHECK ("version" >= 1 AND length(btrim("body")) > 0);

ALTER TABLE "generated_documents"
  ADD CONSTRAINT "generated_documents_subject_chk" CHECK (("employee_id" IS NULL) <> ("offer_id" IS NULL)),
  ADD CONSTRAINT "generated_documents_hash_chk" CHECK (
    "sha256" ~ '^[0-9a-f]{64}$' AND "file_size" > 0
    AND ("certificate_key" IS NULL) = ("certificate_sha256" IS NULL)
    AND ("certificate_sha256" IS NULL OR "certificate_sha256" ~ '^[0-9a-f]{64}$')
    AND ("certificate_key" IS NULL OR "status" = 'ACCEPTED'));

-- A generated document's file and values never change; only its acceptance status and
-- certificate are added.
CREATE OR REPLACE FUNCTION app.generated_document_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.storage_key <> OLD.storage_key OR NEW.sha256 <> OLD.sha256 OR NEW.merged_values <> OLD.merged_values
     OR NEW.template_version_id <> OLD.template_version_id OR NEW.title <> OLD.title
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.offer_id IS DISTINCT FROM OLD.offer_id THEN
    RAISE EXCEPTION 'A generated document cannot be altered' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('ACCEPTED', 'DECLINED', 'FINAL') AND OLD.certificate_key IS NOT NULL THEN
    RAISE EXCEPTION 'A completed document cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "generated_documents_guard" BEFORE UPDATE ON "generated_documents"
  FOR EACH ROW EXECUTE FUNCTION app.generated_document_guard();

ALTER TABLE "document_signers"
  ADD CONSTRAINT "document_signers_kind_chk" CHECK (
    ("kind" = 'EMPLOYEE' AND "employee_id" IS NOT NULL)
    OR ("kind" = 'CANDIDATE' AND "employee_id" IS NULL AND "email" IS NOT NULL)),
  ADD CONSTRAINT "document_signers_state_chk" CHECK (
    ("status" = 'PENDING' AND "signed_at" IS NULL)
    OR ("status" = 'ACCEPTED' AND "signed_at" IS NOT NULL AND "method" IS NOT NULL AND "accepted_sha256" ~ '^[0-9a-f]{64}$')
    OR ("status" = 'DECLINED' AND "signed_at" IS NOT NULL AND "decline_reason" IS NOT NULL)),
  ADD CONSTRAINT "document_signers_otp_chk" CHECK ("otp_attempts" BETWEEN 0 AND 10 AND "order" >= 1);

-- A recorded acceptance or decline never changes.
CREATE OR REPLACE FUNCTION app.document_signer_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A recorded acceptance cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "document_signers_guard" BEFORE UPDATE OR DELETE ON "document_signers"
  FOR EACH ROW EXECUTE FUNCTION app.document_signer_guard();

ALTER TABLE "library_documents"
  ADD CONSTRAINT "library_documents_chk" CHECK (length(btrim("title")) > 0 AND "current_version" >= 1);
ALTER TABLE "library_document_versions"
  ADD CONSTRAINT "library_document_versions_chk" CHECK ("version" >= 1 AND "size" > 0 AND "sha256" ~ '^[0-9a-f]{64}$');

CREATE TRIGGER "library_documents_same_tenant" BEFORE INSERT OR UPDATE ON "library_documents"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('audience_company_id', 'companies', 'audience_department_id', 'departments');

-- Versions and acknowledgements are append-only; updated_at is maintained by the database.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_template_versions', 'library_document_versions', 'library_acknowledgements'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation()', t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'workflow_definitions', 'workflow_instances', 'workflow_tasks', 'document_templates',
    'generated_documents', 'document_signers', 'library_documents'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Candidate acceptance link: resolve the tenant of a token hash without exposing anything else
-- (the acceptance then runs inside that tenant's RLS context).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.signer_token_tenant(p_hash text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT s.organization_id FROM public.document_signers s
  JOIN public.organizations o ON o.id = s.organization_id AND o.status = 'ACTIVE' AND o.deleted_at IS NULL
  WHERE s.access_token_hash = p_hash
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_definitions', 'workflow_instances', 'workflow_tasks', 'approval_delegations',
    'document_templates', 'document_template_versions', 'generated_documents', 'document_signers',
    'library_documents', 'library_document_versions', 'library_acknowledgements'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (organization_id = app.current_organization_id()) '
      'WITH CHECK (organization_id = app.current_organization_id())',
      t || '_tenant_isolation', t);
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "document_template_versions", "library_document_versions", "library_acknowledgements" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "workflow_instances", "workflow_tasks", "generated_documents", "document_signers", "document_templates", "workflow_definitions" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('workflows.definition.manage',  'workflows', 'Create and activate approval workflows'),
  ('workflows.instance.read',      'workflows', 'See all approvals and who decided them'),
  ('documents.template.manage',    'documents', 'Document templates and versions'),
  ('documents.document.generate',  'documents', 'Generate documents and request acceptance'),
  ('documents.library.manage',     'documents', 'Company documents, versions and acknowledgements');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", g.key
FROM "roles" r
JOIN (VALUES
  ('owner', 'workflows.definition.manage'), ('owner', 'workflows.instance.read'), ('owner', 'documents.template.manage'),
  ('owner', 'documents.document.generate'), ('owner', 'documents.library.manage'),
  ('admin', 'workflows.definition.manage'), ('admin', 'workflows.instance.read'), ('admin', 'documents.template.manage'),
  ('admin', 'documents.document.generate'), ('admin', 'documents.library.manage'),
  ('hr_admin', 'workflows.definition.manage'), ('hr_admin', 'workflows.instance.read'), ('hr_admin', 'documents.template.manage'),
  ('hr_admin', 'documents.document.generate'), ('hr_admin', 'documents.library.manage'),
  ('finance', 'workflows.instance.read')) AS g(role_key, key)
  ON g.role_key = r."key"
WHERE r."is_system";

-- ---------------------------------------------------------------------------------------------
-- Escalation sweep: the ids of tenants with overdue approval steps, and nothing else.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tenants_with_overdue_workflow_tasks()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT t.organization_id FROM public.workflow_tasks t
  WHERE t.status = 'PENDING' AND t.due_at < now() AND t.escalated_from_employee_id IS NULL
$$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    GRANT EXECUTE ON FUNCTION app.tenants_with_overdue_workflow_tasks() TO hrm_app;
  END IF;
END
$$;
