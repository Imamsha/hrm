-- CreateEnum
CREATE TYPE "billing_type" AS ENUM ('TIME_AND_MATERIALS', 'FIXED_FEE', 'NON_BILLABLE');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "project_role" AS ENUM ('MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "board_category" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "sprint_status" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "work_item_type" AS ENUM ('EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG', 'SUBTASK');

-- CreateEnum
CREATE TYPE "work_item_priority" AS ENUM ('LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST');

-- CreateEnum
CREATE TYPE "bug_severity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER');

-- CreateEnum
CREATE TYPE "timesheet_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "invoice_line_source" AS ENUM ('TIME', 'MANUAL');

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "billing_address" VARCHAR(1000),
    "tax_number" VARCHAR(40),
    "email" VARCHAR(254),
    "notes" VARCHAR(2000),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(30),
    "role" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_portal_users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(10) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "client_id" UUID,
    "billing_type" "billing_type" NOT NULL,
    "hourly_rate" DECIMAL(14,2),
    "budget_amount" DECIMAL(14,2),
    "budget_hours" DECIMAL(10,2),
    "start_date" DATE,
    "end_date" DATE,
    "status" "project_status" NOT NULL DEFAULT 'ACTIVE',
    "portal_enabled" BOOLEAN NOT NULL DEFAULT false,
    "next_item_number" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "role" "project_role" NOT NULL DEFAULT 'MEMBER',
    "billing_rate" DECIMAL(14,2),
    "allocation_percent" DECIMAL(7,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_columns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "category" "board_category" NOT NULL,
    "position" INTEGER NOT NULL,
    "wip_limit" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "goal" VARCHAR(1000),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "sprint_status" NOT NULL DEFAULT 'PLANNED',
    "committed_points" DECIMAL(8,1),
    "completed_points" DECIMAL(8,1),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "work_item_type" NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" VARCHAR(20000),
    "parent_id" UUID,
    "column_id" UUID NOT NULL,
    "priority" "work_item_priority" NOT NULL DEFAULT 'MEDIUM',
    "assignee_employee_id" UUID,
    "reporter_user_id" UUID,
    "from_client" BOOLEAN NOT NULL DEFAULT false,
    "sprint_id" UUID,
    "story_points" DECIMAL(5,1),
    "estimate_hours" DECIMAL(9,2),
    "due_date" DATE,
    "labels" VARCHAR(30)[] DEFAULT ARRAY[]::VARCHAR(30)[],
    "severity" "bug_severity",
    "steps_to_reproduce" VARCHAR(5000),
    "environment" VARCHAR(300),
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_item_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "work_item_id" UUID NOT NULL,
    "body" VARCHAR(10000) NOT NULL,
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "from_client" BOOLEAN NOT NULL DEFAULT false,
    "author_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_item_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "work_item_id" UUID NOT NULL,
    "field" VARCHAR(40) NOT NULL,
    "from_value" VARCHAR(300),
    "to_value" VARCHAR(300),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "status" "timesheet_status" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ(6),
    "approver_employee_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "timesheet_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "work_item_id" UUID,
    "date" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "invoice_line_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_settings" (
    "organization_id" UUID NOT NULL,
    "invoice_prefix" VARCHAR(10) NOT NULL DEFAULT 'INV',
    "next_sequence" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "number" VARCHAR(30),
    "currency" CHAR(3) NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "issued_on" DATE,
    "due_on" DATE,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(2000),
    "void_reason" VARCHAR(500),
    "voided_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "invoice_line_source" NOT NULL,
    "project_id" UUID,
    "description" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "tax_rate_id" UUID,
    "tax_name" VARCHAR(60),
    "tax_percent" DECIMAL(7,4),
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "received_on" DATE NOT NULL,
    "reference" VARCHAR(100),
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_code_key" ON "clients"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organization_id_id_key" ON "clients"("organization_id", "id");

-- CreateIndex
CREATE INDEX "client_contacts_organization_id_client_id_idx" ON "client_contacts"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "client_portal_users_organization_id_client_id_idx" ON "client_portal_users"("organization_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_users_organization_id_membership_id_key" ON "client_portal_users"("organization_id", "membership_id");

-- CreateIndex
CREATE INDEX "projects_organization_id_client_id_idx" ON "projects"("organization_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_key_key" ON "projects"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_id_key" ON "projects"("organization_id", "id");

-- CreateIndex
CREATE INDEX "project_members_organization_id_employee_id_idx" ON "project_members"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_employee_id_key" ON "project_members"("project_id", "employee_id");

-- CreateIndex
CREATE INDEX "board_columns_organization_id_project_id_position_idx" ON "board_columns"("organization_id", "project_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "board_columns_organization_id_id_key" ON "board_columns"("organization_id", "id");

-- CreateIndex
CREATE INDEX "sprints_organization_id_project_id_status_idx" ON "sprints"("organization_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_organization_id_id_key" ON "sprints"("organization_id", "id");

-- CreateIndex
CREATE INDEX "work_items_organization_id_project_id_column_id_rank_idx" ON "work_items"("organization_id", "project_id", "column_id", "rank");

-- CreateIndex
CREATE INDEX "work_items_organization_id_sprint_id_idx" ON "work_items"("organization_id", "sprint_id");

-- CreateIndex
CREATE INDEX "work_items_organization_id_assignee_employee_id_idx" ON "work_items"("organization_id", "assignee_employee_id");

-- CreateIndex
CREATE INDEX "work_items_organization_id_parent_id_idx" ON "work_items"("organization_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_project_id_number_key" ON "work_items"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_organization_id_id_key" ON "work_items"("organization_id", "id");

-- CreateIndex
CREATE INDEX "work_item_comments_organization_id_work_item_id_created_at_idx" ON "work_item_comments"("organization_id", "work_item_id", "created_at");

-- CreateIndex
CREATE INDEX "work_item_events_organization_id_work_item_id_created_at_idx" ON "work_item_events"("organization_id", "work_item_id", "created_at");

-- CreateIndex
CREATE INDEX "timesheets_organization_id_status_week_start_idx" ON "timesheets"("organization_id", "status", "week_start");

-- CreateIndex
CREATE INDEX "timesheets_organization_id_approver_employee_id_status_idx" ON "timesheets"("organization_id", "approver_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_employee_id_week_start_key" ON "timesheets"("employee_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "timesheets_organization_id_id_key" ON "timesheets"("organization_id", "id");

-- CreateIndex
CREATE INDEX "time_entries_organization_id_project_id_date_idx" ON "time_entries"("organization_id", "project_id", "date");

-- CreateIndex
CREATE INDEX "time_entries_organization_id_employee_id_date_idx" ON "time_entries"("organization_id", "employee_id", "date");

-- CreateIndex
CREATE INDEX "time_entries_organization_id_timesheet_id_idx" ON "time_entries"("organization_id", "timesheet_id");

-- CreateIndex
CREATE INDEX "time_entries_organization_id_invoice_line_id_idx" ON "time_entries"("organization_id", "invoice_line_id");

-- CreateIndex
CREATE INDEX "tax_rates_organization_id_name_idx" ON "tax_rates"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_organization_id_id_key" ON "tax_rates"("organization_id", "id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_client_id_status_idx" ON "invoices"("organization_id", "client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_number_key" ON "invoices"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organization_id_id_key" ON "invoices"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_position_key" ON "invoice_lines"("invoice_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_organization_id_id_key" ON "invoice_lines"("organization_id", "id");

-- CreateIndex
CREATE INDEX "invoice_payments_organization_id_invoice_id_idx" ON "invoice_payments"("organization_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_users" ADD CONSTRAINT "client_portal_users_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_users" ADD CONSTRAINT "client_portal_users_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_parent_id_fkey" FOREIGN KEY ("organization_id", "parent_id") REFERENCES "work_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_column_id_fkey" FOREIGN KEY ("organization_id", "column_id") REFERENCES "board_columns"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_assignee_employee_id_fkey" FOREIGN KEY ("organization_id", "assignee_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_organization_id_sprint_id_fkey" FOREIGN KEY ("organization_id", "sprint_id") REFERENCES "sprints"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_organization_id_work_item_id_fkey" FOREIGN KEY ("organization_id", "work_item_id") REFERENCES "work_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_events" ADD CONSTRAINT "work_item_events_organization_id_work_item_id_fkey" FOREIGN KEY ("organization_id", "work_item_id") REFERENCES "work_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_organization_id_approver_employee_id_fkey" FOREIGN KEY ("organization_id", "approver_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_timesheet_id_fkey" FOREIGN KEY ("organization_id", "timesheet_id") REFERENCES "timesheets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_work_item_id_fkey" FOREIGN KEY ("organization_id", "work_item_id") REFERENCES "work_items"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_invoice_line_id_fkey" FOREIGN KEY ("organization_id", "invoice_line_id") REFERENCES "invoice_lines"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_client_id_fkey" FOREIGN KEY ("organization_id", "client_id") REFERENCES "clients"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_tax_rate_id_fkey" FOREIGN KEY ("organization_id", "tax_rate_id") REFERENCES "tax_rates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_organization_id_invoice_id_fkey" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Phase 10 — integrity rules beyond what Prisma expresses (ADR-017)
-- =============================================================================================

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "clients_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "clients_terms_chk" CHECK ("payment_terms_days" BETWEEN 0 AND 365),
  ADD CONSTRAINT "clients_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_key_chk" CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
  ADD CONSTRAINT "projects_dates_chk" CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"),
  ADD CONSTRAINT "projects_money_chk" CHECK (
    ("hourly_rate" IS NULL OR "hourly_rate" >= 0) AND ("budget_amount" IS NULL OR "budget_amount" >= 0)
    AND ("budget_hours" IS NULL OR "budget_hours" >= 0)),
  ADD CONSTRAINT "projects_client_chk" CHECK ("billing_type" = 'NON_BILLABLE' OR "client_id" IS NOT NULL),
  ADD CONSTRAINT "projects_portal_chk" CHECK (NOT "portal_enabled" OR "client_id" IS NOT NULL),
  ADD CONSTRAINT "projects_counter_chk" CHECK ("next_item_number" >= 1);

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_values_chk" CHECK (
    ("billing_rate" IS NULL OR "billing_rate" >= 0)
    AND ("allocation_percent" IS NULL OR "allocation_percent" BETWEEN 0 AND 100));

ALTER TABLE "board_columns"
  ADD CONSTRAINT "board_columns_chk" CHECK (length(btrim("name")) > 0 AND "position" >= 0 AND ("wip_limit" IS NULL OR "wip_limit" > 0));

ALTER TABLE "sprints"
  ADD CONSTRAINT "sprints_dates_chk" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "sprints_state_chk" CHECK (
    ("status" = 'PLANNED' AND "started_at" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'ACTIVE' AND "started_at" IS NOT NULL AND "completed_at" IS NULL)
    OR ("status" = 'COMPLETED' AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "committed_points" IS NOT NULL AND "completed_points" IS NOT NULL));
-- One active sprint per project.
CREATE UNIQUE INDEX "sprints_one_active_key" ON "sprints" ("project_id") WHERE "status" = 'ACTIVE';

ALTER TABLE "work_items"
  ADD CONSTRAINT "work_items_values_chk" CHECK (
    "number" >= 1 AND length(btrim("title")) > 0 AND "rank" >= 0
    AND ("story_points" IS NULL OR "story_points" >= 0) AND ("estimate_hours" IS NULL OR "estimate_hours" >= 0)
    AND "parent_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "work_items_bug_chk" CHECK (
    ("type" = 'BUG' AND "severity" IS NOT NULL)
    OR ("type" <> 'BUG' AND "severity" IS NULL AND "steps_to_reproduce" IS NULL AND "environment" IS NULL)),
  ADD CONSTRAINT "work_items_client_chk" CHECK (NOT "from_client" OR "client_visible");

-- Parent, column and sprint belong to the item's project; the parent type fits the hierarchy;
-- no cycles.
CREATE OR REPLACE FUNCTION app.work_item_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  p record;
  cur uuid;
  depth int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM board_columns c WHERE c.id = NEW.column_id AND c.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'The status column belongs to another project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sprint_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sprints s WHERE s.id = NEW.sprint_id AND s.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'The sprint belongs to another project' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'A work item cannot move to another project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_id IS NULL THEN
    IF NEW.type = 'SUBTASK' THEN
      RAISE EXCEPTION 'A subtask needs a parent' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT w.project_id, w.type INTO p FROM work_items w WHERE w.id = NEW.parent_id;
  IF p.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'The parent belongs to another project' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (
    (NEW.type = 'FEATURE' AND p.type = 'EPIC')
    OR (NEW.type = 'STORY' AND p.type IN ('EPIC', 'FEATURE'))
    OR (NEW.type = 'TASK' AND p.type = 'STORY')
    OR (NEW.type = 'BUG' AND p.type IN ('STORY', 'EPIC', 'FEATURE'))
    OR (NEW.type = 'SUBTASK' AND p.type IN ('STORY', 'TASK', 'BUG'))
  ) THEN
    RAISE EXCEPTION 'A % cannot sit under a %', lower(NEW.type::text), lower(p.type::text) USING ERRCODE = 'check_violation';
  END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id OR depth > 50 THEN
      RAISE EXCEPTION 'A work item cannot be its own ancestor' USING ERRCODE = 'check_violation';
    END IF;
    SELECT w.parent_id INTO cur FROM work_items w WHERE w.id = cur;
    depth := depth + 1;
  END LOOP;
  RETURN NEW;
END
$$;
CREATE TRIGGER "work_items_guard" BEFORE INSERT OR UPDATE ON "work_items"
  FOR EACH ROW EXECUTE FUNCTION app.work_item_guard();

ALTER TABLE "timesheets"
  ADD CONSTRAINT "timesheets_week_chk" CHECK (EXTRACT(ISODOW FROM "week_start") = 1),
  ADD CONSTRAINT "timesheets_state_chk" CHECK (
    ("status" = 'DRAFT' AND "decided_at" IS NULL)
    OR ("status" = 'SUBMITTED' AND "submitted_at" IS NOT NULL AND "decided_at" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "submitted_at" IS NOT NULL AND "decided_at" IS NOT NULL)),
  ADD CONSTRAINT "timesheets_reject_chk" CHECK ("status" <> 'REJECTED' OR "decision_note" IS NOT NULL),
  ADD CONSTRAINT "timesheets_not_self_chk" CHECK ("approver_employee_id" IS DISTINCT FROM "employee_id");

-- An approved timesheet never changes.
CREATE OR REPLACE FUNCTION app.timesheet_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'An approved timesheet cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "timesheets_guard" BEFORE UPDATE OR DELETE ON "timesheets"
  FOR EACH ROW EXECUTE FUNCTION app.timesheet_guard();

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_hours_chk" CHECK ("hours" >= 0.25 AND "hours" <= 24 AND ("hours" * 4) = trunc("hours" * 4));

-- Entries change only while their week is a draft (or rejected); once submitted only the
-- invoice link may change. The entry belongs to the timesheet's employee and week.
CREATE OR REPLACE FUNCTION app.time_entry_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  t record;
BEGIN
  SELECT ts.status, ts.employee_id, ts.week_start INTO t FROM timesheets ts
    WHERE ts.id = COALESCE(NEW.timesheet_id, OLD.timesheet_id);
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'invoice_line_id') = (to_jsonb(OLD) - 'invoice_line_id') THEN
    IF t.status <> 'APPROVED' AND NEW.invoice_line_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only approved time can be invoiced' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF t.status NOT IN ('DRAFT', 'REJECTED') THEN
    RAISE EXCEPTION 'Time entries of a submitted or approved week cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.employee_id <> t.employee_id OR NEW.date < t.week_start OR NEW.date > t.week_start + 6 THEN
    RAISE EXCEPTION 'The entry is not in this timesheet''s week' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.invoice_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only approved time can be invoiced' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "time_entries_guard" BEFORE INSERT OR UPDATE OR DELETE ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION app.time_entry_guard();

ALTER TABLE "tax_rates"
  ADD CONSTRAINT "tax_rates_chk" CHECK (
    "rate_percent" BETWEEN 0 AND 100 AND length(btrim("name")) > 0
    AND ("effective_to" IS NULL OR "effective_to" >= "effective_from"));

ALTER TABLE "billing_settings"
  ADD CONSTRAINT "billing_settings_chk" CHECK ("invoice_prefix" ~ '^[A-Z][A-Z0-9]{0,9}$' AND "next_sequence" >= 1);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "invoices_totals_chk" CHECK (
    "subtotal" >= 0 AND "tax_total" >= 0 AND "total" = "subtotal" + "tax_total"
    AND "paid_total" >= 0 AND "paid_total" <= "total"),
  ADD CONSTRAINT "invoices_state_chk" CHECK (
    ("status" = 'DRAFT' AND "number" IS NULL AND "issued_on" IS NULL AND "paid_total" = 0)
    OR ("status" IN ('ISSUED', 'PAID') AND "number" IS NOT NULL AND "issued_on" IS NOT NULL AND "due_on" IS NOT NULL)
    OR ("status" = 'VOID' AND "void_reason" IS NOT NULL AND "voided_at" IS NOT NULL)),
  ADD CONSTRAINT "invoices_paid_chk" CHECK ("status" <> 'PAID' OR "paid_total" = "total");

-- Issued invoices keep their content: only status, payments and voiding may change. Paid and
-- void invoices never change.
CREATE OR REPLACE FUNCTION app.invoice_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only a draft invoice can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('PAID', 'VOID') THEN
    RAISE EXCEPTION 'A paid or void invoice cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ISSUED' AND (
       NEW.client_id <> OLD.client_id OR NEW.number IS DISTINCT FROM OLD.number
       OR NEW.currency <> OLD.currency OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
       OR NEW.due_on IS DISTINCT FROM OLD.due_on OR NEW.subtotal <> OLD.subtotal
       OR NEW.tax_total <> OLD.tax_total OR NEW.total <> OLD.total
       OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.status = 'DRAFT') THEN
    RAISE EXCEPTION 'An issued invoice cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "invoices_guard" BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION app.invoice_guard();

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_chk" CHECK (
    "quantity" > 0 AND "unit_price" >= 0 AND "amount" >= 0 AND "tax" >= 0 AND "total" = "amount" + "tax"
    AND ("tax_percent" IS NULL OR "tax_percent" BETWEEN 0 AND 100)
    AND (("tax_rate_id" IS NULL) = ("tax_percent" IS NULL)));

CREATE OR REPLACE FUNCTION app.invoice_line_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT i.status FROM invoices i WHERE i.id = COALESCE(NEW.invoice_id, OLD.invoice_id)) <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines of an issued invoice cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER "invoice_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION app.invoice_line_guard();

ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_amount_chk" CHECK ("amount" > 0);

-- Histories and payments are append-only; updated_at is maintained by the database.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_item_comments', 'work_item_events', 'invoice_payments'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation()', t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'clients', 'projects', 'project_members', 'sprints', 'work_items', 'timesheets',
    'billing_settings', 'invoices'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'client_contacts', 'client_portal_users', 'projects', 'project_members',
    'board_columns', 'sprints', 'work_items', 'work_item_comments', 'work_item_events',
    'timesheets', 'time_entries', 'tax_rates', 'billing_settings', 'invoices', 'invoice_lines',
    'invoice_payments'
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
    REVOKE UPDATE, DELETE, TRUNCATE ON "work_item_comments", "work_item_events", "invoice_payments" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "clients", "projects", "work_items", "timesheets", "invoice_lines" FROM hrm_app;
    REVOKE TRUNCATE ON "invoices", "time_entries" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types), the `client` system role for EXISTING organizations,
-- and grants to existing system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('projects.client.manage',      'projects', 'Clients, contacts and client portal users'),
  ('projects.project.read',       'projects', 'See every project'),
  ('projects.project.manage',     'projects', 'Create projects; manage members, rates and any project''s work'),
  ('projects.timesheet.read',     'projects', 'All timesheets and time reports'),
  ('projects.timesheet.approve',  'projects', 'Approve timesheets of employees without a reporting manager'),
  ('projects.billing.manage',     'projects', 'Tax rates, invoices and payments'),
  ('projects.portal.access',      'projects', 'Client portal (client contacts)');

INSERT INTO "roles" ("id", "organization_id", "key", "name", "description", "is_system", "updated_at")
SELECT gen_random_uuid(), o."id", 'client', 'Client', 'Client contacts: the client portal only (ADR-017).', true, now()
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."organization_id" = o."id" AND r."key" = 'client');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", g.key
FROM "roles" r
JOIN (VALUES
  ('owner', 'projects.client.manage'), ('owner', 'projects.project.read'), ('owner', 'projects.project.manage'),
  ('owner', 'projects.timesheet.read'), ('owner', 'projects.timesheet.approve'), ('owner', 'projects.billing.manage'),
  ('owner', 'projects.portal.access'),
  ('admin', 'projects.client.manage'), ('admin', 'projects.project.read'), ('admin', 'projects.project.manage'),
  ('admin', 'projects.timesheet.read'), ('admin', 'projects.timesheet.approve'), ('admin', 'projects.billing.manage'),
  ('admin', 'projects.portal.access'),
  ('hr_admin', 'projects.project.read'), ('hr_admin', 'projects.timesheet.read'), ('hr_admin', 'projects.timesheet.approve'),
  ('finance', 'projects.project.read'), ('finance', 'projects.timesheet.read'), ('finance', 'projects.billing.manage'),
  ('manager', 'projects.project.read'),
  ('client', 'projects.portal.access')) AS g(role_key, key)
  ON g.role_key = r."key"
WHERE r."is_system";
