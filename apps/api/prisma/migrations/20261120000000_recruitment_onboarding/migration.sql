-- CreateEnum
CREATE TYPE "requisition_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'FILLED');

-- CreateEnum
CREATE TYPE "opening_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "application_stage" AS ENUM ('APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "candidate_source" AS ENUM ('CAREER_PORTAL', 'REFERRAL', 'AGENCY', 'DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "interview_mode" AS ENUM ('IN_PERSON', 'VIDEO', 'PHONE');

-- CreateEnum
CREATE TYPE "interview_status" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "recommendation" AS ENUM ('STRONG_YES', 'YES', 'NO', 'STRONG_NO');

-- CreateEnum
CREATE TYPE "offer_status" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "onboarding_assignee" AS ENUM ('HR', 'MANAGER', 'EMPLOYEE', 'IT');

-- CreateEnum
CREATE TYPE "onboarding_plan_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "onboarding_task_status" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "job_requisitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "company_id" UUID NOT NULL,
    "department_id" UUID,
    "branch_id" UUID,
    "designation_id" UUID,
    "employment_type" "employment_type" NOT NULL,
    "headcount" SMALLINT NOT NULL DEFAULT 1,
    "target_date" DATE,
    "justification" VARCHAR(2000),
    "budget_min" DECIMAL(14,2),
    "budget_max" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "requisition_status" NOT NULL DEFAULT 'DRAFT',
    "requested_by_user_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_openings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "requisition_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "company_id" UUID NOT NULL,
    "department_id" UUID,
    "branch_id" UUID,
    "location" VARCHAR(200),
    "employment_type" "employment_type" NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "experience_min_years" SMALLINT,
    "experience_max_years" SMALLINT,
    "salary_min" DECIMAL(14,2),
    "salary_max" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "show_salary" BOOLEAN NOT NULL DEFAULT false,
    "positions" SMALLINT NOT NULL DEFAULT 1,
    "hiring_manager_id" UUID,
    "status" "opening_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(6),
    "closes_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "email" CITEXT NOT NULL,
    "phone" VARCHAR(25),
    "current_company" VARCHAR(200),
    "current_title" VARCHAR(200),
    "total_experience_months" SMALLINT,
    "location" VARCHAR(200),
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "candidate_source" NOT NULL DEFAULT 'DIRECT',
    "source_detail" VARCHAR(200),
    "notes" VARCHAR(5000),
    "consent_at" TIMESTAMPTZ(6),
    "resume_storage_key" VARCHAR(500),
    "resume_file_name" VARCHAR(255),
    "resume_content_type" VARCHAR(100),
    "resume_size_bytes" INTEGER,
    "resume_sha256" CHAR(64),
    "employee_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "opening_id" UUID NOT NULL,
    "stage" "application_stage" NOT NULL DEFAULT 'APPLIED',
    "rejection_reason" VARCHAR(500),
    "cover_letter" VARCHAR(5000),
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_stage" "application_stage",
    "to_stage" "application_stage" NOT NULL,
    "note" VARCHAR(1000),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "max_score" DECIMAL(8,2) NOT NULL,
    "assessed_on" DATE NOT NULL,
    "notes" VARCHAR(2000),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "round_name" VARCHAR(100) NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" SMALLINT NOT NULL,
    "mode" "interview_mode" NOT NULL,
    "location_or_link" VARCHAR(500),
    "status" "interview_status" NOT NULL DEFAULT 'SCHEDULED',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_panelists" (
    "organization_id" UUID NOT NULL,
    "interview_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "rating" SMALLINT,
    "recommendation" "recommendation",
    "notes" VARCHAR(5000),
    "submitted_at" TIMESTAMPTZ(6),

    CONSTRAINT "interview_panelists_pkey" PRIMARY KEY ("interview_id","employee_id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "designation_id" UUID,
    "job_grade_id" UUID,
    "joining_date" DATE NOT NULL,
    "annual_ctc" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "notes" VARCHAR(5000),
    "status" "offer_status" NOT NULL DEFAULT 'DRAFT',
    "sent_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "assignee" "onboarding_assignee" NOT NULL,
    "due_offset_days" SMALLINT NOT NULL,
    "document_category" "employee_document_category",
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "onboarding_template_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "template_id" UUID,
    "joining_date" DATE NOT NULL,
    "status" "onboarding_plan_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "assignee" "onboarding_assignee" NOT NULL,
    "assignee_employee_id" UUID,
    "due_date" DATE NOT NULL,
    "document_category" "employee_document_category",
    "status" "onboarding_task_status" NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMPTZ(6),
    "completed_by_user_id" UUID,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_requisitions_organization_id_status_idx" ON "job_requisitions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_requisitions_organization_id_id_key" ON "job_requisitions"("organization_id", "id");

-- CreateIndex
CREATE INDEX "job_openings_organization_id_status_idx" ON "job_openings"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "job_openings_organization_id_slug_key" ON "job_openings"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "job_openings_organization_id_id_key" ON "job_openings"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_resume_storage_key_key" ON "candidates"("resume_storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_employee_id_key" ON "candidates"("employee_id");

-- CreateIndex
CREATE INDEX "candidates_organization_id_created_at_idx" ON "candidates"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_organization_id_email_key" ON "candidates"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_organization_id_id_key" ON "candidates"("organization_id", "id");

-- CreateIndex
CREATE INDEX "job_applications_organization_id_opening_id_stage_idx" ON "job_applications"("organization_id", "opening_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_candidate_id_opening_id_key" ON "job_applications"("candidate_id", "opening_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_organization_id_id_key" ON "job_applications"("organization_id", "id");

-- CreateIndex
CREATE INDEX "application_events_organization_id_application_id_created_a_idx" ON "application_events"("organization_id", "application_id", "created_at");

-- CreateIndex
CREATE INDEX "assessments_organization_id_application_id_idx" ON "assessments"("organization_id", "application_id");

-- CreateIndex
CREATE INDEX "interviews_organization_id_scheduled_at_idx" ON "interviews"("organization_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "interviews_organization_id_id_key" ON "interviews"("organization_id", "id");

-- CreateIndex
CREATE INDEX "interview_panelists_organization_id_employee_id_idx" ON "interview_panelists"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "offers_organization_id_application_id_idx" ON "offers"("organization_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_organization_id_name_key" ON "onboarding_templates"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_organization_id_id_key" ON "onboarding_templates"("organization_id", "id");

-- CreateIndex
CREATE INDEX "onboarding_template_tasks_organization_id_template_id_idx" ON "onboarding_template_tasks"("organization_id", "template_id");

-- CreateIndex
CREATE INDEX "onboarding_plans_organization_id_employee_id_idx" ON "onboarding_plans"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_plans_organization_id_id_key" ON "onboarding_plans"("organization_id", "id");

-- CreateIndex
CREATE INDEX "onboarding_tasks_organization_id_plan_id_idx" ON "onboarding_tasks"("organization_id", "plan_id");

-- CreateIndex
CREATE INDEX "onboarding_tasks_organization_id_assignee_employee_id_statu_idx" ON "onboarding_tasks"("organization_id", "assignee_employee_id", "status");

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_requisitions" ADD CONSTRAINT "job_requisitions_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "job_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_hiring_manager_id_fkey" FOREIGN KEY ("hiring_manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_organization_id_candidate_id_fkey" FOREIGN KEY ("organization_id", "candidate_id") REFERENCES "candidates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_organization_id_opening_id_fkey" FOREIGN KEY ("organization_id", "opening_id") REFERENCES "job_openings"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_organization_id_application_id_fkey" FOREIGN KEY ("organization_id", "application_id") REFERENCES "job_applications"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_organization_id_application_id_fkey" FOREIGN KEY ("organization_id", "application_id") REFERENCES "job_applications"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_organization_id_application_id_fkey" FOREIGN KEY ("organization_id", "application_id") REFERENCES "job_applications"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_organization_id_interview_id_fkey" FOREIGN KEY ("organization_id", "interview_id") REFERENCES "interviews"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_application_id_fkey" FOREIGN KEY ("organization_id", "application_id") REFERENCES "job_applications"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_job_grade_id_fkey" FOREIGN KEY ("job_grade_id") REFERENCES "job_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_tasks" ADD CONSTRAINT "onboarding_template_tasks_organization_id_template_id_fkey" FOREIGN KEY ("organization_id", "template_id") REFERENCES "onboarding_templates"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "onboarding_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "onboarding_plans"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written integrity rules (Phase 06 — recruitment and onboarding)
-- =============================================================================================

ALTER TABLE "job_requisitions"
  ADD CONSTRAINT "job_requisitions_title_chk" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "job_requisitions_headcount_chk" CHECK ("headcount" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "job_requisitions_budget_chk" CHECK (
    ("budget_min" IS NULL OR "budget_min" >= 0) AND ("budget_max" IS NULL OR "budget_max" >= 0)
    AND ("budget_min" IS NULL OR "budget_max" IS NULL OR "budget_max" >= "budget_min")),
  ADD CONSTRAINT "job_requisitions_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "job_requisitions_decision_chk" CHECK (
    "status" NOT IN ('APPROVED', 'REJECTED') OR "decided_at" IS NOT NULL);

ALTER TABLE "job_openings"
  ADD CONSTRAINT "job_openings_title_chk" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "job_openings_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "job_openings_description_chk" CHECK (length(btrim("description")) > 0),
  ADD CONSTRAINT "job_openings_experience_chk" CHECK (
    ("experience_min_years" IS NULL OR "experience_min_years" BETWEEN 0 AND 60)
    AND ("experience_max_years" IS NULL OR "experience_max_years" BETWEEN 0 AND 60)
    AND ("experience_min_years" IS NULL OR "experience_max_years" IS NULL OR "experience_max_years" >= "experience_min_years")),
  ADD CONSTRAINT "job_openings_salary_chk" CHECK (
    ("salary_min" IS NULL OR "salary_min" >= 0) AND ("salary_max" IS NULL OR "salary_max" >= 0)
    AND ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_max" >= "salary_min")),
  ADD CONSTRAINT "job_openings_positions_chk" CHECK ("positions" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "job_openings_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "job_openings_published_chk" CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);

ALTER TABLE "candidates"
  ADD CONSTRAINT "candidates_name_chk" CHECK (length(btrim("first_name")) > 0),
  ADD CONSTRAINT "candidates_email_chk" CHECK ("email" ~ '^[^@\s]+@[^@\s]+$'),
  ADD CONSTRAINT "candidates_experience_chk" CHECK ("total_experience_months" IS NULL OR "total_experience_months" BETWEEN 0 AND 720),
  ADD CONSTRAINT "candidates_portal_consent_chk" CHECK ("source" <> 'CAREER_PORTAL' OR "consent_at" IS NOT NULL),
  -- Resume metadata is all-or-nothing and lives under the tenant's storage prefix.
  ADD CONSTRAINT "candidates_resume_chk" CHECK (
    ("resume_storage_key" IS NULL) = ("resume_sha256" IS NULL)
    AND ("resume_storage_key" IS NULL) = ("resume_size_bytes" IS NULL)
    AND ("resume_storage_key" IS NULL OR (
      "resume_storage_key" LIKE 'org/' || "organization_id"::text || '/%'
      AND "resume_size_bytes" BETWEEN 1 AND 10485760
      AND "resume_sha256" ~ '^[0-9a-f]{64}$'
      AND "resume_content_type" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'))));

ALTER TABLE "assessments"
  ADD CONSTRAINT "assessments_score_chk" CHECK ("max_score" > 0 AND "score" BETWEEN 0 AND "max_score"),
  ADD CONSTRAINT "assessments_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "interviews"
  ADD CONSTRAINT "interviews_duration_chk" CHECK ("duration_minutes" BETWEEN 5 AND 480),
  ADD CONSTRAINT "interviews_round_chk" CHECK (length(btrim("round_name")) > 0);

ALTER TABLE "interview_panelists"
  ADD CONSTRAINT "interview_panelists_rating_chk" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "interview_panelists_submitted_chk" CHECK (
    ("submitted_at" IS NULL) = ("rating" IS NULL) AND ("submitted_at" IS NULL) = ("recommendation" IS NULL));

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_ctc_chk" CHECK ("annual_ctc" >= 0),
  ADD CONSTRAINT "offers_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "offers_sent_chk" CHECK ("status" = 'DRAFT' OR "status" = 'WITHDRAWN' OR "sent_at" IS NOT NULL);
-- At most one live offer per application.
CREATE UNIQUE INDEX "offers_one_live_key" ON "offers" ("application_id") WHERE "status" IN ('DRAFT', 'SENT', 'ACCEPTED');

ALTER TABLE "onboarding_templates"
  ADD CONSTRAINT "onboarding_templates_name_chk" CHECK (length(btrim("name")) > 0);
CREATE UNIQUE INDEX "onboarding_templates_one_default_key" ON "onboarding_templates" ("organization_id") WHERE "is_default";

ALTER TABLE "onboarding_template_tasks"
  ADD CONSTRAINT "onboarding_template_tasks_offset_chk" CHECK ("due_offset_days" BETWEEN -90 AND 365),
  ADD CONSTRAINT "onboarding_template_tasks_title_chk" CHECK (length(btrim("title")) > 0);

ALTER TABLE "onboarding_tasks"
  ADD CONSTRAINT "onboarding_tasks_title_chk" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "onboarding_tasks_completed_chk" CHECK (("status" = 'PENDING') = ("completed_at" IS NULL));
-- One active onboarding plan per employee.
CREATE UNIQUE INDEX "onboarding_plans_one_active_key" ON "onboarding_plans" ("employee_id") WHERE "status" = 'IN_PROGRESS';

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER "job_requisitions_same_tenant" BEFORE INSERT OR UPDATE ON "job_requisitions"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant(
    'department_id', 'departments', 'branch_id', 'branches', 'designation_id', 'designations');
CREATE TRIGGER "job_openings_same_tenant" BEFORE INSERT OR UPDATE ON "job_openings"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant(
    'requisition_id', 'job_requisitions', 'department_id', 'departments', 'branch_id', 'branches',
    'hiring_manager_id', 'employees');
CREATE TRIGGER "candidates_same_tenant" BEFORE INSERT OR UPDATE ON "candidates"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('employee_id', 'employees');
CREATE TRIGGER "offers_same_tenant" BEFORE INSERT OR UPDATE ON "offers"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('designation_id', 'designations', 'job_grade_id', 'job_grades');
CREATE TRIGGER "onboarding_plans_same_tenant" BEFORE INSERT OR UPDATE ON "onboarding_plans"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('template_id', 'onboarding_templates');
CREATE TRIGGER "onboarding_tasks_same_tenant" BEFORE INSERT OR UPDATE ON "onboarding_tasks"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('assignee_employee_id', 'employees');

-- Department and branch of a requisition/opening belong to its company.
CREATE OR REPLACE FUNCTION app.recruitment_structure_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  other uuid;
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT company_id INTO other FROM public.departments WHERE id = NEW.department_id;
    IF other IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'The department must belong to the selected company' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.branch_id IS NOT NULL THEN
    SELECT company_id INTO other FROM public.branches WHERE id = NEW.branch_id;
    IF other IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'The branch must belong to the selected company' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "job_requisitions_structure" BEFORE INSERT OR UPDATE ON "job_requisitions"
  FOR EACH ROW EXECUTE FUNCTION app.recruitment_structure_guard();
CREATE TRIGGER "job_openings_structure" BEFORE INSERT OR UPDATE ON "job_openings"
  FOR EACH ROW EXECUTE FUNCTION app.recruitment_structure_guard();

-- Stage history is append-only.
CREATE TRIGGER "application_events_append_only" BEFORE UPDATE OR DELETE ON "application_events"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "application_events_no_truncate" BEFORE TRUNCATE ON "application_events"
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER "job_requisitions_set_updated_at" BEFORE UPDATE ON "job_requisitions" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "job_openings_set_updated_at" BEFORE UPDATE ON "job_openings" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "candidates_set_updated_at" BEFORE UPDATE ON "candidates" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "job_applications_set_updated_at" BEFORE UPDATE ON "job_applications" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "interviews_set_updated_at" BEFORE UPDATE ON "interviews" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "offers_set_updated_at" BEFORE UPDATE ON "offers" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "onboarding_templates_set_updated_at" BEFORE UPDATE ON "onboarding_templates" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "onboarding_plans_set_updated_at" BEFORE UPDATE ON "onboarding_plans" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "onboarding_tasks_set_updated_at" BEFORE UPDATE ON "onboarding_tasks" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Public career portal: resolve the tenant of an organization slug without exposing anything
-- else (the portal then works inside that tenant's RLS context).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.career_portal_tenant(p_slug text)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT id FROM public.organizations WHERE slug = p_slug::citext AND status = 'ACTIVE' AND deleted_at IS NULL
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_requisitions', 'job_openings', 'candidates', 'job_applications', 'application_events',
    'assessments', 'interviews', 'interview_panelists', 'offers', 'onboarding_templates',
    'onboarding_template_tasks', 'onboarding_plans', 'onboarding_tasks'
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
    REVOKE UPDATE, DELETE, TRUNCATE ON "application_events" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "job_applications", "offers" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('recruitment.requisition.read',    'recruitment', 'View job requisitions'),
  ('recruitment.requisition.manage',  'recruitment', 'Raise and edit job requisitions'),
  ('recruitment.requisition.approve', 'recruitment', 'Approve or reject job requisitions'),
  ('recruitment.opening.manage',      'recruitment', 'Create, publish and close job openings'),
  ('recruitment.candidate.read',      'recruitment', 'View candidates, applications and interviews'),
  ('recruitment.candidate.manage',    'recruitment', 'Manage candidates, the pipeline, assessments and interviews'),
  ('recruitment.offer.manage',        'recruitment', 'Create and track offers and hire candidates'),
  ('onboarding.template.manage',      'onboarding',  'Manage onboarding templates'),
  ('onboarding.plan.read',            'onboarding',  'View onboarding plans'),
  ('onboarding.plan.manage',          'onboarding',  'Start onboarding plans and manage their tasks');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
JOIN (
  SELECT role_key, key FROM (VALUES ('owner'), ('admin'), ('hr_admin')) AS roles(role_key)
  CROSS JOIN (VALUES
    ('recruitment.requisition.read'), ('recruitment.requisition.manage'), ('recruitment.requisition.approve'),
    ('recruitment.opening.manage'), ('recruitment.candidate.read'), ('recruitment.candidate.manage'),
    ('recruitment.offer.manage'), ('onboarding.template.manage'), ('onboarding.plan.read'),
    ('onboarding.plan.manage')) AS perms(key)
  UNION ALL
  SELECT * FROM (VALUES
    ('finance', 'recruitment.requisition.read'),
    ('manager', 'recruitment.requisition.read'), ('manager', 'recruitment.requisition.manage'),
    ('manager', 'recruitment.candidate.read'), ('manager', 'onboarding.plan.read')) AS extra(role_key, key)
) AS p ON p.role_key = r."key"
WHERE r."is_system";
