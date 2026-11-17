-- Phase 03: organization structure, job catalog, work weeks, holiday calendars, scoped access.
-- Generated DDL (prisma migrate diff) followed by hand-written constraints, triggers, RLS and seeds.

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "day_type" AS ENUM ('FULL', 'HALF', 'OFF');

-- CreateEnum
CREATE TYPE "holiday_kind" AS ENUM ('PUBLIC', 'OPTIONAL');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "default_currency" CHAR(3),
    "timezone" VARCHAR(64),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "legal_name" VARCHAR(300) NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "pan" CHAR(10),
    "tan" CHAR(10),
    "gstin" CHAR(15),
    "cin" CHAR(21),
    "registration_number" VARCHAR(50),
    "registered_location_id" UUID,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address_line1" VARCHAR(200) NOT NULL,
    "address_line2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "timezone" VARCHAR(64),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "legal_entity_id" UUID,
    "location_id" UUID,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "timezone" VARCHAR(64),
    "work_week_id" UUID,
    "holiday_calendar_id" UUID,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_id" UUID,
    "cost_center_id" UUID,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_grades" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rank" INTEGER NOT NULL,
    "description" VARCHAR(500),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "job_grade_id" UUID,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_weeks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_week_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "work_week_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "occurrence" SMALLINT NOT NULL DEFAULT 0,
    "day_type" "day_type" NOT NULL,

    CONSTRAINT "work_week_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday_calendars" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "holiday_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "kind" "holiday_kind" NOT NULL DEFAULT 'PUBLIC',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_organization_id_code_key" ON "companies"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organization_id_id_key" ON "companies"("organization_id", "id");

-- CreateIndex
CREATE INDEX "legal_entities_organization_id_company_id_idx" ON "legal_entities"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_entities_organization_id_code_key" ON "legal_entities"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "legal_entities_organization_id_id_key" ON "legal_entities"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_organization_id_code_key" ON "locations"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "locations_organization_id_id_key" ON "locations"("organization_id", "id");

-- CreateIndex
CREATE INDEX "branches_organization_id_company_id_idx" ON "branches"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_id_id_key" ON "branches"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_organization_id_code_key" ON "cost_centers"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_organization_id_id_key" ON "cost_centers"("organization_id", "id");

-- CreateIndex
CREATE INDEX "departments_organization_id_company_id_idx" ON "departments"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "departments_organization_id_parent_id_idx" ON "departments"("organization_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_code_key" ON "departments"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_id_key" ON "departments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "teams_organization_id_department_id_idx" ON "teams"("organization_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organization_id_code_key" ON "teams"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organization_id_id_key" ON "teams"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "job_grades_organization_id_code_key" ON "job_grades"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "job_grades_organization_id_rank_key" ON "job_grades"("organization_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "job_grades_organization_id_id_key" ON "job_grades"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "designations_organization_id_code_key" ON "designations"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "designations_organization_id_id_key" ON "designations"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "work_weeks_organization_id_name_key" ON "work_weeks"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "work_weeks_organization_id_id_key" ON "work_weeks"("organization_id", "id");

-- CreateIndex
CREATE INDEX "work_week_rules_organization_id_idx" ON "work_week_rules"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_week_rules_work_week_id_weekday_occurrence_key" ON "work_week_rules"("work_week_id", "weekday", "occurrence");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendars_organization_id_name_key" ON "holiday_calendars"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "holiday_calendars_organization_id_id_key" ON "holiday_calendars"("organization_id", "id");

-- CreateIndex
CREATE INDEX "holidays_organization_id_date_idx" ON "holidays"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_calendar_id_date_key" ON "holidays"("calendar_id", "date");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_registered_location_id_fkey" FOREIGN KEY ("registered_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_work_week_id_fkey" FOREIGN KEY ("work_week_id") REFERENCES "work_weeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_holiday_calendar_id_fkey" FOREIGN KEY ("holiday_calendar_id") REFERENCES "holiday_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_department_id_fkey" FOREIGN KEY ("organization_id", "department_id") REFERENCES "departments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_grades" ADD CONSTRAINT "job_grades_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_job_grade_id_fkey" FOREIGN KEY ("job_grade_id") REFERENCES "job_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_weeks" ADD CONSTRAINT "work_weeks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_week_rules" ADD CONSTRAINT "work_week_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_week_rules" ADD CONSTRAINT "work_week_rules_organization_id_work_week_id_fkey" FOREIGN KEY ("organization_id", "work_week_id") REFERENCES "work_weeks"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holiday_calendars" ADD CONSTRAINT "holiday_calendars_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organization_id_calendar_id_fkey" FOREIGN KEY ("organization_id", "calendar_id") REFERENCES "holiday_calendars"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written section
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "companies_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "companies_country_chk" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "companies_currency_chk" CHECK ("default_currency" IS NULL OR "default_currency" ~ '^[A-Z]{3}$');

-- Indian statutory identifier formats (structure only; issuing authorities validate existence).
ALTER TABLE "legal_entities"
  ADD CONSTRAINT "legal_entities_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "legal_entities_name_chk" CHECK (length(btrim("legal_name")) > 0),
  ADD CONSTRAINT "legal_entities_country_chk" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "legal_entities_pan_chk" CHECK ("pan" IS NULL OR "pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  ADD CONSTRAINT "legal_entities_tan_chk" CHECK ("tan" IS NULL OR "tan" ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  ADD CONSTRAINT "legal_entities_gstin_chk" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  ADD CONSTRAINT "legal_entities_gstin_pan_chk" CHECK ("gstin" IS NULL OR "pan" IS NULL OR substring("gstin" from 3 for 10) = "pan"),
  ADD CONSTRAINT "legal_entities_cin_chk" CHECK ("cin" IS NULL OR "cin" ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$');

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "locations_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "locations_country_chk" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "locations_coordinates_chk" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
    AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
  );

ALTER TABLE "branches"
  ADD CONSTRAINT "branches_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "branches_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "cost_centers"
  ADD CONSTRAINT "cost_centers_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "cost_centers_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "departments"
  ADD CONSTRAINT "departments_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "departments_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "departments_not_own_parent_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");

ALTER TABLE "teams"
  ADD CONSTRAINT "teams_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "teams_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "job_grades"
  ADD CONSTRAINT "job_grades_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "job_grades_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "job_grades_rank_chk" CHECK ("rank" BETWEEN 1 AND 1000);

ALTER TABLE "designations"
  ADD CONSTRAINT "designations_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "designations_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "work_weeks"
  ADD CONSTRAINT "work_weeks_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "work_week_rules"
  ADD CONSTRAINT "work_week_rules_weekday_chk" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "work_week_rules_occurrence_chk" CHECK ("occurrence" BETWEEN 0 AND 5);

ALTER TABLE "holiday_calendars"
  ADD CONSTRAINT "holiday_calendars_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "holidays"
  ADD CONSTRAINT "holidays_name_chk" CHECK (length(btrim("name")) > 0);

-- At most one default work week / holiday calendar per organization.
CREATE UNIQUE INDEX "work_weeks_one_default_key" ON "work_weeks" ("organization_id") WHERE "is_default";
CREATE UNIQUE INDEX "holiday_calendars_one_default_key" ON "holiday_calendars" ("organization_id") WHERE "is_default";

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers (SECURITY DEFINER: checks must see rows regardless of RLS)
-- ---------------------------------------------------------------------------------------------

-- Optional references cannot use composite FKs in Prisma; this trigger guarantees that every
-- referenced row belongs to the same organization. Arguments: (column, table) pairs.
CREATE OR REPLACE FUNCTION app.enforce_same_tenant()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  i int;
  ref_id uuid;
  ref_org uuid;
BEGIN
  FOR i IN 0 .. (TG_NARGS / 2) - 1 LOOP
    ref_id := (to_jsonb(NEW) ->> TG_ARGV[i * 2])::uuid;
    IF ref_id IS NOT NULL THEN
      EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', TG_ARGV[i * 2 + 1])
        INTO ref_org USING ref_id;
      IF ref_org IS DISTINCT FROM NEW.organization_id THEN
        RAISE EXCEPTION '%.% must reference a % row of the same organization',
          TG_TABLE_NAME, TG_ARGV[i * 2], TG_ARGV[i * 2 + 1]
          USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "legal_entities_same_tenant" BEFORE INSERT OR UPDATE ON "legal_entities"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('registered_location_id', 'locations');
CREATE TRIGGER "branches_same_tenant" BEFORE INSERT OR UPDATE ON "branches"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant(
    'legal_entity_id', 'legal_entities', 'location_id', 'locations',
    'work_week_id', 'work_weeks', 'holiday_calendar_id', 'holiday_calendars');
CREATE TRIGGER "cost_centers_same_tenant" BEFORE INSERT OR UPDATE ON "cost_centers"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('company_id', 'companies');
CREATE TRIGGER "departments_same_tenant" BEFORE INSERT OR UPDATE ON "departments"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('parent_id', 'departments', 'cost_center_id', 'cost_centers');
CREATE TRIGGER "designations_same_tenant" BEFORE INSERT OR UPDATE ON "designations"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('job_grade_id', 'job_grades');

-- A branch's legal entity must belong to the branch's company.
CREATE OR REPLACE FUNCTION app.branch_legal_entity_same_company()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.legal_entity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.legal_entities le WHERE le.id = NEW.legal_entity_id AND le.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'The legal entity must belong to the branch''s company' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "branches_legal_entity_company" BEFORE INSERT OR UPDATE ON "branches"
  FOR EACH ROW EXECUTE FUNCTION app.branch_legal_entity_same_company();

-- Sub-departments: same company as the parent, no cycles, bounded depth.
CREATE OR REPLACE FUNCTION app.department_hierarchy_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  parent_company uuid;
  depth int;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT company_id INTO parent_company FROM public.departments WHERE id = NEW.parent_id;
  IF parent_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'A sub-department must belong to the same company as its parent' USING ERRCODE = 'check_violation';
  END IF;
  WITH RECURSIVE ancestors(id, parent_id, depth) AS (
    SELECT d.id, d.parent_id, 1 FROM public.departments d WHERE d.id = NEW.parent_id
    UNION ALL
    SELECT d.id, d.parent_id, a.depth + 1
    FROM public.departments d JOIN ancestors a ON d.id = a.parent_id
    WHERE a.depth < 50
  )
  SELECT max(a.depth) INTO depth FROM ancestors a;
  IF EXISTS (
    WITH RECURSIVE ancestors(id, parent_id, depth) AS (
      SELECT d.id, d.parent_id, 1 FROM public.departments d WHERE d.id = NEW.parent_id
      UNION ALL
      SELECT d.id, d.parent_id, a.depth + 1
      FROM public.departments d JOIN ancestors a ON d.id = a.parent_id
      WHERE a.depth < 50
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A department cannot be moved under itself or one of its sub-departments'
      USING ERRCODE = 'check_violation';
  END IF;
  IF depth >= 10 THEN
    RAISE EXCEPTION 'Departments can be nested at most 10 levels deep' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "departments_hierarchy" BEFORE INSERT OR UPDATE OF parent_id, company_id ON "departments"
  FOR EACH ROW EXECUTE FUNCTION app.department_hierarchy_guard();

-- Scoped role assignments must target an existing structure node of the same organization ...
CREATE OR REPLACE FUNCTION app.membership_role_scope_target()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  target_table text;
  target_org uuid;
BEGIN
  target_table := CASE NEW.scope_type
    WHEN 'COMPANY' THEN 'companies'
    WHEN 'BRANCH' THEN 'branches'
    WHEN 'DEPARTMENT' THEN 'departments'
    WHEN 'TEAM' THEN 'teams'
    ELSE NULL
  END;
  IF target_table IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT organization_id FROM public.%I WHERE id = $1', target_table)
    INTO target_org USING NEW.scope_id;
  IF target_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Scope % % does not exist in this organization', NEW.scope_type, NEW.scope_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "membership_roles_scope_target" BEFORE INSERT OR UPDATE ON "membership_roles"
  FOR EACH ROW EXECUTE FUNCTION app.membership_role_scope_target();

-- ... and a structure node referenced by role scopes cannot be deleted.
CREATE OR REPLACE FUNCTION app.prevent_delete_scope_target()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.membership_roles WHERE scope_id = OLD.id) THEN
    RAISE EXCEPTION 'This % is used by scoped role assignments', TG_TABLE_NAME
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "companies_scope_delete" BEFORE DELETE ON "companies"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_delete_scope_target();
CREATE TRIGGER "branches_scope_delete" BEFORE DELETE ON "branches"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_delete_scope_target();
CREATE TRIGGER "departments_scope_delete" BEFORE DELETE ON "departments"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_delete_scope_target();
CREATE TRIGGER "teams_scope_delete" BEFORE DELETE ON "teams"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_delete_scope_target();

-- updated_at maintenance
CREATE TRIGGER "companies_set_updated_at" BEFORE UPDATE ON "companies" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "legal_entities_set_updated_at" BEFORE UPDATE ON "legal_entities" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "locations_set_updated_at" BEFORE UPDATE ON "locations" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "branches_set_updated_at" BEFORE UPDATE ON "branches" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "cost_centers_set_updated_at" BEFORE UPDATE ON "cost_centers" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "departments_set_updated_at" BEFORE UPDATE ON "departments" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "teams_set_updated_at" BEFORE UPDATE ON "teams" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "job_grades_set_updated_at" BEFORE UPDATE ON "job_grades" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "designations_set_updated_at" BEFORE UPDATE ON "designations" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "work_weeks_set_updated_at" BEFORE UPDATE ON "work_weeks" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "holiday_calendars_set_updated_at" BEFORE UPDATE ON "holiday_calendars" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security: every structure table is tenant-owned
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies', 'legal_entities', 'locations', 'branches', 'cost_centers', 'departments', 'teams',
    'job_grades', 'designations', 'work_weeks', 'work_week_rules', 'holiday_calendars', 'holidays'
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
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- New organizations receive them from SYSTEM_ROLES at registration.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('organization.structure.read',     'organization', 'View companies, legal entities, branches, locations, departments, teams and cost centers'),
  ('organization.structure.manage',   'organization', 'Create, update and archive organization structure'),
  ('organization.job_catalog.read',   'organization', 'View designations and job grades'),
  ('organization.job_catalog.manage', 'organization', 'Create, update and archive designations and job grades'),
  ('organization.calendar.read',      'organization', 'View work weeks and holiday calendars'),
  ('organization.calendar.manage',    'organization', 'Manage work weeks and holiday calendars');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
JOIN (VALUES
  ('owner', 'organization.structure.read'), ('owner', 'organization.structure.manage'),
  ('owner', 'organization.job_catalog.read'), ('owner', 'organization.job_catalog.manage'),
  ('owner', 'organization.calendar.read'), ('owner', 'organization.calendar.manage'),
  ('admin', 'organization.structure.read'), ('admin', 'organization.structure.manage'),
  ('admin', 'organization.job_catalog.read'), ('admin', 'organization.job_catalog.manage'),
  ('admin', 'organization.calendar.read'), ('admin', 'organization.calendar.manage'),
  ('hr_admin', 'organization.structure.read'), ('hr_admin', 'organization.structure.manage'),
  ('hr_admin', 'organization.job_catalog.read'), ('hr_admin', 'organization.job_catalog.manage'),
  ('hr_admin', 'organization.calendar.read'), ('hr_admin', 'organization.calendar.manage'),
  ('finance', 'organization.structure.read'), ('finance', 'organization.job_catalog.read'),
  ('finance', 'organization.calendar.read'),
  ('manager', 'organization.structure.read'), ('manager', 'organization.job_catalog.read'),
  ('manager', 'organization.calendar.read'),
  ('employee', 'organization.structure.read'), ('employee', 'organization.calendar.read')
) AS p(role_key, key) ON p.role_key = r."key"
WHERE r."is_system";
