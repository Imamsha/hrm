-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'ON_NOTICE', 'SEPARATED');

-- CreateEnum
CREATE TYPE "employment_type" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT');

-- CreateEnum
CREATE TYPE "probation_status" AS ENUM ('NOT_APPLICABLE', 'ON_PROBATION', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('FEMALE', 'MALE', 'NON_BINARY', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "marital_status" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'SEPARATED', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "employment_change_type" AS ENUM ('JOINING', 'TRANSFER', 'PROMOTION', 'REDESIGNATION', 'MANAGER_CHANGE', 'EMPLOYMENT_TYPE_CHANGE', 'REORGANIZATION', 'REJOINING');

-- CreateEnum
CREATE TYPE "separation_type" AS ENUM ('RESIGNATION', 'TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'OTHER');

-- CreateEnum
CREATE TYPE "address_type" AS ENUM ('CURRENT', 'PERMANENT');

-- CreateEnum
CREATE TYPE "family_relation" AS ENUM ('SPOUSE', 'CHILD', 'FATHER', 'MOTHER', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "skill_level" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "bank_account_type" AS ENUM ('SAVINGS', 'CURRENT');

-- CreateEnum
CREATE TYPE "employee_document_category" AS ENUM ('IDENTITY', 'ADDRESS_PROOF', 'EDUCATION', 'EMPLOYMENT', 'CONTRACT', 'LETTER', 'OTHER');

-- CreateTable
CREATE TABLE "employee_settings" (
    "organization_id" UUID NOT NULL,
    "number_prefix" VARCHAR(10) NOT NULL DEFAULT 'EMP-',
    "number_padding" SMALLINT NOT NULL DEFAULT 4,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_number" VARCHAR(30) NOT NULL,
    "membership_id" UUID,
    "first_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "preferred_name" VARCHAR(100),
    "work_email" CITEXT,
    "work_phone" VARCHAR(25),
    "personal_email" CITEXT,
    "personal_phone" VARCHAR(25),
    "date_of_birth" DATE,
    "gender" "gender",
    "marital_status" "marital_status",
    "nationality" CHAR(2),
    "date_of_joining" DATE NOT NULL,
    "probation_status" "probation_status" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "probation_end_date" DATE,
    "confirmation_date" DATE,
    "notice_period_days" SMALLINT,
    "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
    "resignation_date" DATE,
    "last_working_date" DATE,
    "separation_type" "separation_type",
    "separation_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "change_type" "employment_change_type" NOT NULL,
    "employment_type" "employment_type" NOT NULL,
    "company_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "branch_id" UUID,
    "department_id" UUID,
    "team_id" UUID,
    "designation_id" UUID,
    "job_grade_id" UUID,
    "cost_center_id" UUID,
    "manager_id" UUID,
    "remarks" VARCHAR(500),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_statutory_ids" (
    "employee_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pan_encrypted" TEXT,
    "pan_last4" CHAR(4),
    "uan_encrypted" TEXT,
    "uan_last4" CHAR(4),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_statutory_ids_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "employee_addresses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "address_type" NOT NULL,
    "line1" VARCHAR(200) NOT NULL,
    "line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_emergency_contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "relationship" VARCHAR(50) NOT NULL,
    "phone" VARCHAR(25) NOT NULL,
    "email" CITEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_family_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "relation" "family_relation" NOT NULL,
    "date_of_birth" DATE,
    "gender" "gender",
    "is_dependent" BOOLEAN NOT NULL DEFAULT false,
    "phone" VARCHAR(25),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_education" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "qualification" VARCHAR(200) NOT NULL,
    "field_of_study" VARCHAR(200),
    "institution" VARCHAR(200) NOT NULL,
    "start_year" SMALLINT,
    "end_year" SMALLINT,
    "grade" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_experience" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employer" VARCHAR(200) NOT NULL,
    "job_title" VARCHAR(200) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "location" VARCHAR(200),
    "description" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_certifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "issuer" VARCHAR(200),
    "issued_on" DATE,
    "expires_on" DATE,
    "credential_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_skills" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "level" "skill_level" NOT NULL,
    "years" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_bank_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "account_holder_name" VARCHAR(200) NOT NULL,
    "bank_name" VARCHAR(200) NOT NULL,
    "branch_name" VARCHAR(200),
    "ifsc" CHAR(11) NOT NULL,
    "account_type" "bank_account_type" NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_last4" VARCHAR(4) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "category" "employee_document_category" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_membership_id_key" ON "employees"("membership_id");

-- CreateIndex
CREATE INDEX "employees_organization_id_status_idx" ON "employees"("organization_id", "status");

-- CreateIndex
CREATE INDEX "employees_organization_id_last_name_first_name_idx" ON "employees"("organization_id", "last_name", "first_name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_employee_number_key" ON "employees"("organization_id", "employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_id_key" ON "employees"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organization_id_work_email_key" ON "employees"("organization_id", "work_email");

-- CreateIndex
CREATE INDEX "employment_records_organization_id_employee_id_effective_fr_idx" ON "employment_records"("organization_id", "employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "employment_records_organization_id_company_id_idx" ON "employment_records"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "employment_records_organization_id_department_id_idx" ON "employment_records"("organization_id", "department_id");

-- CreateIndex
CREATE INDEX "employment_records_organization_id_branch_id_idx" ON "employment_records"("organization_id", "branch_id");

-- CreateIndex
CREATE INDEX "employment_records_organization_id_manager_id_idx" ON "employment_records"("organization_id", "manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_statutory_ids_organization_id_employee_id_key" ON "employee_statutory_ids"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_addresses_organization_id_employee_id_idx" ON "employee_addresses"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_addresses_employee_id_type_key" ON "employee_addresses"("employee_id", "type");

-- CreateIndex
CREATE INDEX "employee_emergency_contacts_organization_id_employee_id_idx" ON "employee_emergency_contacts"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_family_members_organization_id_employee_id_idx" ON "employee_family_members"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_education_organization_id_employee_id_idx" ON "employee_education"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_experience_organization_id_employee_id_idx" ON "employee_experience"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_certifications_organization_id_employee_id_idx" ON "employee_certifications"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "employee_skills_organization_id_name_idx" ON "employee_skills"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employee_skills_employee_id_name_key" ON "employee_skills"("employee_id", "name");

-- CreateIndex
CREATE INDEX "employee_bank_accounts_organization_id_employee_id_idx" ON "employee_bank_accounts"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_documents_storage_key_key" ON "employee_documents"("storage_key");

-- CreateIndex
CREATE INDEX "employee_documents_organization_id_employee_id_idx" ON "employee_documents"("organization_id", "employee_id");

-- AddForeignKey
ALTER TABLE "employee_settings" ADD CONSTRAINT "employee_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_job_grade_id_fkey" FOREIGN KEY ("job_grade_id") REFERENCES "job_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_records" ADD CONSTRAINT "employment_records_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_statutory_ids" ADD CONSTRAINT "employee_statutory_ids_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_addresses" ADD CONSTRAINT "employee_addresses_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_emergency_contacts" ADD CONSTRAINT "employee_emergency_contacts_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_family_members" ADD CONSTRAINT "employee_family_members_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_education" ADD CONSTRAINT "employee_education_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_experience" ADD CONSTRAINT "employee_experience_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_certifications" ADD CONSTRAINT "employee_certifications_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written integrity rules (Phase 04 — employee management)
-- =============================================================================================

-- Trusted extension (PostgreSQL 13+): needed for the non-overlap exclusion constraint below.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "employee_settings"
  ADD CONSTRAINT "employee_settings_prefix_chk" CHECK ("number_prefix" ~ '^([A-Z0-9][A-Z0-9/_-]{0,9})?$'),
  ADD CONSTRAINT "employee_settings_padding_chk" CHECK ("number_padding" BETWEEN 1 AND 10),
  ADD CONSTRAINT "employee_settings_next_chk" CHECK ("next_number" BETWEEN 1 AND 999999999);

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_number_chk" CHECK ("employee_number" ~ '^[A-Z0-9][A-Z0-9/_-]{0,29}$'),
  ADD CONSTRAINT "employees_first_name_chk" CHECK (length(btrim("first_name")) > 0),
  ADD CONSTRAINT "employees_work_email_chk" CHECK ("work_email" IS NULL OR "work_email" ~ '^[^@\s]+@[^@\s]+$'),
  ADD CONSTRAINT "employees_personal_email_chk" CHECK ("personal_email" IS NULL OR "personal_email" ~ '^[^@\s]+@[^@\s]+$'),
  ADD CONSTRAINT "employees_nationality_chk" CHECK ("nationality" IS NULL OR "nationality" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "employees_notice_chk" CHECK ("notice_period_days" IS NULL OR "notice_period_days" BETWEEN 0 AND 365),
  ADD CONSTRAINT "employees_dob_chk" CHECK ("date_of_birth" IS NULL OR "date_of_birth" < "date_of_joining"),
  -- Probation: on probation ⇒ an end date after joining; confirmed ⇒ a confirmation date.
  ADD CONSTRAINT "employees_probation_chk" CHECK (
    CASE "probation_status"
      WHEN 'ON_PROBATION' THEN "probation_end_date" IS NOT NULL AND "probation_end_date" > "date_of_joining"
                               AND "confirmation_date" IS NULL
      WHEN 'CONFIRMED' THEN "confirmation_date" IS NOT NULL AND "confirmation_date" >= "date_of_joining"
      ELSE "confirmation_date" IS NULL
    END),
  -- Separation fields exist exactly when the employee is on notice or separated.
  ADD CONSTRAINT "employees_separation_chk" CHECK (
    CASE "status"
      WHEN 'ACTIVE' THEN "resignation_date" IS NULL AND "last_working_date" IS NULL
                         AND "separation_type" IS NULL AND "separation_reason" IS NULL
      ELSE "resignation_date" IS NOT NULL AND "last_working_date" IS NOT NULL
           AND "separation_type" IS NOT NULL AND "last_working_date" >= "resignation_date"
           AND "last_working_date" >= "date_of_joining"
    END);

ALTER TABLE "employment_records"
  ADD CONSTRAINT "employment_records_period_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "employment_records_not_own_manager_chk" CHECK ("manager_id" IS NULL OR "manager_id" <> "employee_id"),
  -- No two assignments of one employee may overlap in time.
  ADD CONSTRAINT "employment_records_no_overlap" EXCLUDE USING gist (
    "employee_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&);
CREATE UNIQUE INDEX "employment_records_one_open_key" ON "employment_records" ("employee_id") WHERE "effective_to" IS NULL;

ALTER TABLE "employee_statutory_ids"
  ADD CONSTRAINT "employee_statutory_ids_pan_chk" CHECK (("pan_encrypted" IS NULL) = ("pan_last4" IS NULL)),
  ADD CONSTRAINT "employee_statutory_ids_uan_chk" CHECK (("uan_encrypted" IS NULL) = ("uan_last4" IS NULL));

ALTER TABLE "employee_addresses"
  ADD CONSTRAINT "employee_addresses_line1_chk" CHECK (length(btrim("line1")) > 0),
  ADD CONSTRAINT "employee_addresses_city_chk" CHECK (length(btrim("city")) > 0),
  ADD CONSTRAINT "employee_addresses_country_chk" CHECK ("country_code" ~ '^[A-Z]{2}$');

ALTER TABLE "employee_emergency_contacts"
  ADD CONSTRAINT "employee_emergency_contacts_name_chk" CHECK (length(btrim("name")) > 0);
CREATE UNIQUE INDEX "employee_emergency_contacts_one_primary_key"
  ON "employee_emergency_contacts" ("employee_id") WHERE "is_primary";

ALTER TABLE "employee_family_members"
  ADD CONSTRAINT "employee_family_members_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "employee_education"
  ADD CONSTRAINT "employee_education_years_chk" CHECK (
    ("start_year" IS NULL OR "start_year" BETWEEN 1900 AND 2200)
    AND ("end_year" IS NULL OR "end_year" BETWEEN 1900 AND 2200)
    AND ("start_year" IS NULL OR "end_year" IS NULL OR "end_year" >= "start_year"));

ALTER TABLE "employee_experience"
  ADD CONSTRAINT "employee_experience_period_chk" CHECK ("end_date" >= "start_date");

ALTER TABLE "employee_certifications"
  ADD CONSTRAINT "employee_certifications_period_chk" CHECK ("issued_on" IS NULL OR "expires_on" IS NULL OR "expires_on" >= "issued_on");

ALTER TABLE "employee_skills"
  ADD CONSTRAINT "employee_skills_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "employee_skills_years_chk" CHECK ("years" IS NULL OR "years" BETWEEN 0 AND 60);

ALTER TABLE "employee_bank_accounts"
  ADD CONSTRAINT "employee_bank_accounts_ifsc_chk" CHECK ("ifsc" ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  ADD CONSTRAINT "employee_bank_accounts_last4_chk" CHECK ("account_last4" ~ '^[A-Z0-9]{1,4}$');
CREATE UNIQUE INDEX "employee_bank_accounts_one_primary_key"
  ON "employee_bank_accounts" ("employee_id") WHERE "is_primary";

ALTER TABLE "employee_documents"
  ADD CONSTRAINT "employee_documents_size_chk" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  ADD CONSTRAINT "employee_documents_sha_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "employee_documents_type_chk" CHECK ("content_type" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  ADD CONSTRAINT "employee_documents_title_chk" CHECK (length(btrim("title")) > 0),
  -- Objects live under the owning tenant's prefix only.
  ADD CONSTRAINT "employee_documents_key_chk" CHECK ("storage_key" LIKE 'org/' || "organization_id"::text || '/%');

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER "employees_same_tenant" BEFORE INSERT OR UPDATE ON "employees"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('membership_id', 'memberships');
CREATE TRIGGER "employment_records_same_tenant" BEFORE INSERT OR UPDATE ON "employment_records"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant(
    'legal_entity_id', 'legal_entities', 'branch_id', 'branches', 'department_id', 'departments',
    'team_id', 'teams', 'designation_id', 'designations', 'job_grade_id', 'job_grades',
    'cost_center_id', 'cost_centers', 'manager_id', 'employees');

-- The placement must be internally consistent: legal entity, branch and department of the
-- record's company; team of the record's department; cost center of the company (or org-wide).
CREATE OR REPLACE FUNCTION app.employment_record_structure_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  other uuid;
BEGIN
  IF NEW.legal_entity_id IS NOT NULL THEN
    SELECT company_id INTO other FROM public.legal_entities WHERE id = NEW.legal_entity_id;
    IF other IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'The legal entity must belong to the selected company' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.branch_id IS NOT NULL THEN
    SELECT company_id INTO other FROM public.branches WHERE id = NEW.branch_id;
    IF other IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'The branch must belong to the selected company' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT company_id INTO other FROM public.departments WHERE id = NEW.department_id;
    IF other IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'The department must belong to the selected company' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.team_id IS NOT NULL THEN
    SELECT department_id INTO other FROM public.teams WHERE id = NEW.team_id;
    IF NEW.department_id IS NULL OR other IS DISTINCT FROM NEW.department_id THEN
      RAISE EXCEPTION 'The team must belong to the selected department' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.cost_center_id IS NOT NULL THEN
    SELECT company_id INTO other FROM public.cost_centers WHERE id = NEW.cost_center_id;
    IF other IS NOT NULL AND other <> NEW.company_id THEN
      RAISE EXCEPTION 'The cost center must belong to the selected company' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "employment_records_structure" BEFORE INSERT OR UPDATE ON "employment_records"
  FOR EACH ROW EXECUTE FUNCTION app.employment_record_structure_guard();

-- Job history is append-only: a record may only be closed (effective_to set once, when it is
-- superseded or the employee separates) and never deleted. Corrections are new records.
CREATE OR REPLACE FUNCTION app.employment_record_history_guard()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employment history cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION 'Employment history records are immutable; record a new change instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "employment_records_history" BEFORE UPDATE OR DELETE ON "employment_records"
  FOR EACH ROW EXECUTE FUNCTION app.employment_record_history_guard();

CREATE TRIGGER "employee_settings_set_updated_at" BEFORE UPDATE ON "employee_settings" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employees_set_updated_at" BEFORE UPDATE ON "employees" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_statutory_ids_set_updated_at" BEFORE UPDATE ON "employee_statutory_ids" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_addresses_set_updated_at" BEFORE UPDATE ON "employee_addresses" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_emergency_contacts_set_updated_at" BEFORE UPDATE ON "employee_emergency_contacts" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_family_members_set_updated_at" BEFORE UPDATE ON "employee_family_members" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_education_set_updated_at" BEFORE UPDATE ON "employee_education" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_experience_set_updated_at" BEFORE UPDATE ON "employee_experience" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_certifications_set_updated_at" BEFORE UPDATE ON "employee_certifications" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_skills_set_updated_at" BEFORE UPDATE ON "employee_skills" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_bank_accounts_set_updated_at" BEFORE UPDATE ON "employee_bank_accounts" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_documents_set_updated_at" BEFORE UPDATE ON "employee_documents" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security: every employee table is tenant-owned
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employee_settings', 'employees', 'employment_records', 'employee_statutory_ids',
    'employee_addresses', 'employee_emergency_contacts', 'employee_family_members',
    'employee_education', 'employee_experience', 'employee_certifications', 'employee_skills',
    'employee_bank_accounts', 'employee_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (organization_id = app.current_organization_id()) '
      'WITH CHECK (organization_id = app.current_organization_id())',
      t || '_tenant_isolation', t);
  END LOOP;
END
$$;

-- Employees are separated, never hard-deleted; job history is permanent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrm_app') THEN
    REVOKE DELETE, TRUNCATE ON "employees", "employment_records" FROM hrm_app;
    REVOKE TRUNCATE ON "employee_documents" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('employees.employee.read',     'employees', 'View the employee directory, profiles, job and background'),
  ('employees.employee.create',   'employees', 'Add employees (joining)'),
  ('employees.employee.update',   'employees', 'Update employee profiles and background records'),
  ('employees.lifecycle.manage',  'employees', 'Record job changes, confirmation, separation and rejoining'),
  ('employees.personal.read',     'employees', 'View personal details, addresses, emergency contacts and family'),
  ('employees.sensitive.read',    'employees', 'View bank accounts and statutory identifiers (reveals are audited)'),
  ('employees.sensitive.manage',  'employees', 'Manage bank accounts and statutory identifiers'),
  ('employees.document.read',     'employees', 'View and download employee documents'),
  ('employees.document.manage',   'employees', 'Upload, update and delete employee documents'),
  ('employees.settings.manage',   'employees', 'Configure employee numbering'),
  ('employees.self.access',       'employees', 'Self-service: view and update your own employee profile');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
JOIN (
  SELECT role_key, key FROM (VALUES ('owner'), ('admin'), ('hr_admin')) AS roles(role_key)
  CROSS JOIN (VALUES
    ('employees.employee.read'), ('employees.employee.create'), ('employees.employee.update'),
    ('employees.lifecycle.manage'), ('employees.personal.read'), ('employees.sensitive.read'),
    ('employees.sensitive.manage'), ('employees.document.read'), ('employees.document.manage'),
    ('employees.settings.manage'), ('employees.self.access')) AS perms(key)
  UNION ALL
  SELECT * FROM (VALUES
    ('finance', 'employees.employee.read'), ('finance', 'employees.sensitive.read'),
    ('finance', 'employees.self.access'),
    ('manager', 'employees.employee.read'), ('manager', 'employees.self.access'),
    ('employee', 'employees.self.access')) AS extra(role_key, key)
) AS p ON p.role_key = r."key"
WHERE r."is_system";
