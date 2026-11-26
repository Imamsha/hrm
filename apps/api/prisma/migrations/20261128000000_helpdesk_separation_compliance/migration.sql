-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "article_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "exit_reason_category" AS ENUM ('CAREER', 'COMPENSATION', 'RELOCATION', 'PERSONAL', 'HEALTH', 'STUDIES', 'MANAGER', 'WORK_CULTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "resignation_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "separation_case_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "clearance_kind" AS ENUM ('TEMPLATE', 'ASSET', 'LICENSE', 'KNOWLEDGE_TRANSFER');

-- CreateEnum
CREATE TYPE "clearance_status" AS ENUM ('PENDING', 'CLEARED', 'WAIVED');

-- CreateEnum
CREATE TYPE "obligation_category" AS ENUM ('STATUTORY_FILING', 'LICENCE_RENEWAL', 'AUDIT', 'POLICY_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "recurrence" AS ENUM ('NONE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "compliance_task_status" AS ENUM ('OPEN', 'COMPLETED');

-- AlterEnum
ALTER TYPE "workflow_process" ADD VALUE 'RESIGNATION';

-- CreateTable
CREATE TABLE "helpdesk_settings" (
    "organization_id" UUID NOT NULL,
    "ticket_prefix" VARCHAR(10) NOT NULL DEFAULT 'HD',
    "next_sequence" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "helpdesk_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "helpdesk_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "default_assignee_id" UUID,
    "escalation_employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "helpdesk_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_agents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,

    CONSTRAINT "helpdesk_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpdesk_slas" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "priority" "ticket_priority" NOT NULL,
    "first_response_hours" INTEGER,
    "resolution_hours" INTEGER,

    CONSTRAINT "helpdesk_slas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "category_id" UUID NOT NULL,
    "requester_employee_id" UUID NOT NULL,
    "assignee_employee_id" UUID,
    "subject" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000) NOT NULL,
    "priority" "ticket_priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ticket_status" NOT NULL DEFAULT 'OPEN',
    "first_response_due" TIMESTAMPTZ(6),
    "resolution_due" TIMESTAMPTZ(6),
    "first_responded_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "resolution" VARCHAR(2000),
    "rating" INTEGER,
    "rating_comment" VARCHAR(1000),
    "escalated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "body" VARCHAR(10000) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "by_requester" BOOLEAN NOT NULL DEFAULT false,
    "author_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "from_value" VARCHAR(200),
    "to_value" VARCHAR(200),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "category_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(50000) NOT NULL,
    "status" "article_status" NOT NULL DEFAULT 'DRAFT',
    "author_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_article_votes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_article_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "separation_settings" (
    "organization_id" UUID NOT NULL,
    "notice_days" INTEGER,
    "clearance_template" JSONB NOT NULL DEFAULT '[]',
    "exit_questions" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "separation_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "resignations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reason_category" "exit_reason_category" NOT NULL,
    "note" VARCHAR(2000),
    "submitted_on" DATE NOT NULL,
    "requested_last_day" DATE NOT NULL,
    "notice_last_day" DATE,
    "agreed_last_day" DATE,
    "waived_notice_days" INTEGER NOT NULL DEFAULT 0,
    "status" "resignation_status" NOT NULL DEFAULT 'PENDING',
    "approver_employee_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "resignations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "separation_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "resignation_id" UUID,
    "separation_type" "separation_type" NOT NULL,
    "reason_category" "exit_reason_category" NOT NULL,
    "last_working_day" DATE NOT NULL,
    "status" "separation_case_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "note" VARCHAR(2000),
    "completed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "separation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clearance_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "kind" "clearance_kind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "owner_role_key" VARCHAR(64),
    "owner_employee_id" UUID,
    "asset_allocation_id" UUID,
    "license_assignment_id" UUID,
    "status" "clearance_status" NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(500),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clearance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_interviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "questions" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "recorded_by_user_id" UUID,
    "by_employee" BOOLEAN NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exit_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_obligations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category" "obligation_category" NOT NULL,
    "description" VARCHAR(2000),
    "owner_employee_id" UUID NOT NULL,
    "first_due_on" DATE NOT NULL,
    "recurrence" "recurrence" NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "due_on" DATE NOT NULL,
    "status" "compliance_task_status" NOT NULL DEFAULT 'OPEN',
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_user_id" UUID,
    "note" VARCHAR(2000),
    "evidence_key" VARCHAR(500),
    "evidence_name" VARCHAR(255),
    "evidence_size" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_categories_organization_id_code_key" ON "helpdesk_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_categories_organization_id_id_key" ON "helpdesk_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "helpdesk_agents_organization_id_employee_id_idx" ON "helpdesk_agents"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_agents_category_id_employee_id_key" ON "helpdesk_agents"("category_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpdesk_slas_category_id_priority_key" ON "helpdesk_slas"("category_id", "priority");

-- CreateIndex
CREATE INDEX "tickets_organization_id_category_id_status_idx" ON "tickets"("organization_id", "category_id", "status");

-- CreateIndex
CREATE INDEX "tickets_organization_id_requester_employee_id_idx" ON "tickets"("organization_id", "requester_employee_id");

-- CreateIndex
CREATE INDEX "tickets_organization_id_assignee_employee_id_status_idx" ON "tickets"("organization_id", "assignee_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_organization_id_number_key" ON "tickets"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_organization_id_id_key" ON "tickets"("organization_id", "id");

-- CreateIndex
CREATE INDEX "ticket_comments_organization_id_ticket_id_created_at_idx" ON "ticket_comments"("organization_id", "ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_events_organization_id_ticket_id_created_at_idx" ON "ticket_events"("organization_id", "ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_attachments_organization_id_ticket_id_idx" ON "ticket_attachments"("organization_id", "ticket_id");

-- CreateIndex
CREATE INDEX "kb_articles_organization_id_status_idx" ON "kb_articles"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "kb_articles_organization_id_id_key" ON "kb_articles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "kb_article_votes_article_id_employee_id_key" ON "kb_article_votes"("article_id", "employee_id");

-- CreateIndex
CREATE INDEX "resignations_organization_id_status_idx" ON "resignations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "resignations_organization_id_id_key" ON "resignations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "separation_cases_organization_id_status_idx" ON "separation_cases"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "separation_cases_organization_id_id_key" ON "separation_cases"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "separation_cases_organization_id_resignation_id_key" ON "separation_cases"("organization_id", "resignation_id");

-- CreateIndex
CREATE UNIQUE INDEX "clearance_items_asset_allocation_id_key" ON "clearance_items"("asset_allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "clearance_items_license_assignment_id_key" ON "clearance_items"("license_assignment_id");

-- CreateIndex
CREATE INDEX "clearance_items_organization_id_case_id_idx" ON "clearance_items"("organization_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "exit_interviews_organization_id_case_id_key" ON "exit_interviews"("organization_id", "case_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_obligations_organization_id_id_key" ON "compliance_obligations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "compliance_tasks_organization_id_status_due_on_idx" ON "compliance_tasks"("organization_id", "status", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_tasks_obligation_id_due_on_key" ON "compliance_tasks"("obligation_id", "due_on");

-- AddForeignKey
ALTER TABLE "helpdesk_settings" ADD CONSTRAINT "helpdesk_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_categories" ADD CONSTRAINT "helpdesk_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_agents" ADD CONSTRAINT "helpdesk_agents_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "helpdesk_categories"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_agents" ADD CONSTRAINT "helpdesk_agents_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpdesk_slas" ADD CONSTRAINT "helpdesk_slas_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "helpdesk_categories"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "helpdesk_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_requester_employee_id_fkey" FOREIGN KEY ("organization_id", "requester_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_assignee_employee_id_fkey" FOREIGN KEY ("organization_id", "assignee_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_organization_id_ticket_id_fkey" FOREIGN KEY ("organization_id", "ticket_id") REFERENCES "tickets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_organization_id_ticket_id_fkey" FOREIGN KEY ("organization_id", "ticket_id") REFERENCES "tickets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_organization_id_ticket_id_fkey" FOREIGN KEY ("organization_id", "ticket_id") REFERENCES "tickets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "helpdesk_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_article_votes" ADD CONSTRAINT "kb_article_votes_organization_id_article_id_fkey" FOREIGN KEY ("organization_id", "article_id") REFERENCES "kb_articles"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separation_settings" ADD CONSTRAINT "separation_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resignations" ADD CONSTRAINT "resignations_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separation_cases" ADD CONSTRAINT "separation_cases_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "separation_cases" ADD CONSTRAINT "separation_cases_organization_id_resignation_id_fkey" FOREIGN KEY ("organization_id", "resignation_id") REFERENCES "resignations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_items" ADD CONSTRAINT "clearance_items_organization_id_case_id_fkey" FOREIGN KEY ("organization_id", "case_id") REFERENCES "separation_cases"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_interviews" ADD CONSTRAINT "exit_interviews_organization_id_case_id_fkey" FOREIGN KEY ("organization_id", "case_id") REFERENCES "separation_cases"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_organization_id_owner_employee_id_fkey" FOREIGN KEY ("organization_id", "owner_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_organization_id_obligation_id_fkey" FOREIGN KEY ("organization_id", "obligation_id") REFERENCES "compliance_obligations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Phase 11b — integrity rules beyond what Prisma expresses (ADR-019)
-- =============================================================================================

ALTER TABLE "helpdesk_settings"
  ADD CONSTRAINT "helpdesk_settings_chk" CHECK ("ticket_prefix" ~ '^[A-Z][A-Z0-9]{0,9}$' AND "next_sequence" >= 1);
ALTER TABLE "helpdesk_categories"
  ADD CONSTRAINT "helpdesk_categories_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$' AND length(btrim("name")) > 0);
ALTER TABLE "helpdesk_slas"
  ADD CONSTRAINT "helpdesk_slas_chk" CHECK (
    ("first_response_hours" IS NULL OR "first_response_hours" BETWEEN 1 AND 8760)
    AND ("resolution_hours" IS NULL OR "resolution_hours" BETWEEN 1 AND 8760));

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_chk" CHECK (
    length(btrim("subject")) > 0
    AND ("rating" IS NULL OR "rating" BETWEEN 1 AND 5)
    AND ("status" NOT IN ('RESOLVED', 'CLOSED') OR "resolved_at" IS NOT NULL)
    AND ("status" <> 'CLOSED' OR "closed_at" IS NOT NULL)
    AND ("rating" IS NULL OR "status" IN ('RESOLVED', 'CLOSED')));

-- A closed ticket never changes except for the requester's rating.
CREATE OR REPLACE FUNCTION app.ticket_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED' AND (to_jsonb(NEW) - 'rating' - 'rating_comment' - 'updated_at')
       <> (to_jsonb(OLD) - 'rating' - 'rating_comment' - 'updated_at') THEN
    RAISE EXCEPTION 'A closed ticket cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "tickets_guard" BEFORE UPDATE ON "tickets"
  FOR EACH ROW EXECUTE FUNCTION app.ticket_guard();

ALTER TABLE "ticket_attachments"
  ADD CONSTRAINT "ticket_attachments_chk" CHECK ("size" > 0 AND "sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "kb_articles"
  ADD CONSTRAINT "kb_articles_chk" CHECK (length(btrim("title")) > 0);

ALTER TABLE "separation_settings"
  ADD CONSTRAINT "separation_settings_chk" CHECK (
    ("notice_days" IS NULL OR "notice_days" BETWEEN 0 AND 365)
    AND jsonb_typeof("clearance_template") = 'array' AND jsonb_typeof("exit_questions") = 'array');

ALTER TABLE "resignations"
  ADD CONSTRAINT "resignations_chk" CHECK (
    "requested_last_day" >= "submitted_on" AND "waived_notice_days" >= 0
    AND ("status" = 'PENDING') = ("decided_at" IS NULL)
    AND ("status" <> 'APPROVED' OR ("agreed_last_day" IS NOT NULL AND "decided_at" IS NOT NULL))
    AND ("status" <> 'REJECTED' OR "decision_note" IS NOT NULL));
-- One open resignation per employee.
CREATE UNIQUE INDEX "resignations_one_pending_key" ON "resignations" ("employee_id") WHERE "status" = 'PENDING';

CREATE OR REPLACE FUNCTION app.resignation_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided resignation cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "resignations_guard" BEFORE UPDATE OR DELETE ON "resignations"
  FOR EACH ROW EXECUTE FUNCTION app.resignation_guard();

ALTER TABLE "separation_cases"
  ADD CONSTRAINT "separation_cases_chk" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));
-- One open separation per employee.
CREATE UNIQUE INDEX "separation_cases_one_open_key" ON "separation_cases" ("employee_id") WHERE "status" = 'IN_PROGRESS';

CREATE OR REPLACE FUNCTION app.separation_case_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'A closed separation cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'COMPLETED' AND EXISTS (SELECT 1 FROM clearance_items c WHERE c.case_id = NEW.id AND c.status = 'PENDING') THEN
    RAISE EXCEPTION 'Clearance is not complete' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "separation_cases_guard" BEFORE UPDATE OR DELETE ON "separation_cases"
  FOR EACH ROW EXECUTE FUNCTION app.separation_case_guard();

ALTER TABLE "clearance_items"
  ADD CONSTRAINT "clearance_items_chk" CHECK (
    ("status" = 'PENDING') = ("decided_at" IS NULL)
    AND ("status" <> 'WAIVED' OR "note" IS NOT NULL)
    AND ("kind" <> 'ASSET' OR "asset_allocation_id" IS NOT NULL)
    AND ("kind" <> 'LICENSE' OR "license_assignment_id" IS NOT NULL));

-- A decided clearance item never changes.
CREATE OR REPLACE FUNCTION app.clearance_item_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided clearance item cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "clearance_items_guard" BEFORE UPDATE OR DELETE ON "clearance_items"
  FOR EACH ROW EXECUTE FUNCTION app.clearance_item_guard();

ALTER TABLE "exit_interviews"
  ADD CONSTRAINT "exit_interviews_chk" CHECK (jsonb_typeof("questions") = 'array' AND jsonb_typeof("answers") = 'object');

ALTER TABLE "compliance_obligations"
  ADD CONSTRAINT "compliance_obligations_chk" CHECK (length(btrim("title")) > 0);
ALTER TABLE "compliance_tasks"
  ADD CONSTRAINT "compliance_tasks_chk" CHECK (
    ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
    AND ("status" <> 'COMPLETED' OR "note" IS NOT NULL)
    AND ("evidence_key" IS NULL) = ("evidence_name" IS NULL));

CREATE OR REPLACE FUNCTION app.compliance_task_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'A completed compliance task cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "compliance_tasks_guard" BEFORE UPDATE OR DELETE ON "compliance_tasks"
  FOR EACH ROW EXECUTE FUNCTION app.compliance_task_guard();

-- Histories are append-only; updated_at is maintained by the database.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ticket_comments', 'ticket_events', 'ticket_attachments', 'exit_interviews'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation()', t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'helpdesk_settings', 'helpdesk_categories', 'tickets', 'kb_articles', 'separation_settings',
    'resignations', 'separation_cases', 'clearance_items', 'compliance_obligations', 'compliance_tasks'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Escalation sweep: ids of tenants with tickets past their resolution time, and nothing else.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tenants_with_breached_tickets()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT t.organization_id FROM public.tickets t
  WHERE t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_ON_REQUESTER') AND t.resolution_due < now() AND t.escalated_at IS NULL
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'helpdesk_settings', 'helpdesk_categories', 'helpdesk_agents', 'helpdesk_slas', 'tickets',
    'ticket_comments', 'ticket_events', 'ticket_attachments', 'kb_articles', 'kb_article_votes',
    'separation_settings', 'resignations', 'separation_cases', 'clearance_items', 'exit_interviews',
    'compliance_obligations', 'compliance_tasks'
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
    REVOKE UPDATE, DELETE, TRUNCATE ON "ticket_comments", "ticket_events", "ticket_attachments", "exit_interviews" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "tickets", "resignations", "separation_cases", "clearance_items", "compliance_tasks" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('helpdesk.config.manage',      'helpdesk',   'Helpdesk categories, agents and SLA policies'),
  ('helpdesk.ticket.manage',      'helpdesk',   'Work any ticket'),
  ('helpdesk.knowledge.manage',   'helpdesk',   'Knowledge base articles'),
  ('separation.case.manage',      'separation', 'Resignations, separations, clearance and settings'),
  ('separation.interview.read',   'separation', 'Exit interview answers and analytics'),
  ('compliance.calendar.manage',  'compliance', 'Compliance obligations and tasks'),
  ('compliance.dashboard.read',   'compliance', 'Compliance dashboard and expiry tracker');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
CROSS JOIN (VALUES
  ('helpdesk.config.manage'), ('helpdesk.ticket.manage'), ('helpdesk.knowledge.manage'),
  ('separation.case.manage'), ('separation.interview.read'), ('compliance.calendar.manage'),
  ('compliance.dashboard.read')) AS p(key)
WHERE r."is_system" AND r."key" IN ('owner', 'admin', 'hr_admin');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", 'compliance.dashboard.read'
FROM "roles" r WHERE r."is_system" AND r."key" = 'finance';
