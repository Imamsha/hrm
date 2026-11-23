-- CreateEnum
CREATE TYPE "PayableDaysMethod" AS ENUM ('CALENDAR_DAYS', 'FIXED_DAYS', 'WORKING_DAYS');

-- CreateEnum
CREATE TYPE "StatutoryRuleType" AS ENUM ('EPF', 'ESI', 'PT', 'INCOME_TAX', 'GRATUITY');

-- CreateEnum
CREATE TYPE "RuleSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD', 'NEW');

-- CreateEnum
CREATE TYPE "SalaryComponentKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "ComponentCalcType" AS ENUM ('FIXED', 'PERCENT_OF_CTC', 'PERCENT_OF_COMPONENT', 'BALANCING');

-- CreateEnum
CREATE TYPE "SalaryRevisionReason" AS ENUM ('JOINING', 'REVISION', 'PROMOTION', 'CORRECTION');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayLineCategory" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "PayLineSource" AS ENUM ('STRUCTURE', 'ADJUSTMENT', 'ARREARS', 'STATUTORY', 'SETTLEMENT');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'FINALIZED', 'CANCELLED');

-- CreateTable
CREATE TABLE "payroll_settings" (
    "organization_id" UUID NOT NULL,
    "payable_days_method" "PayableDaysMethod" NOT NULL DEFAULT 'CALENDAR_DAYS',
    "fixed_days" SMALLINT,
    "absent_is_loss_of_pay" BOOLEAN NOT NULL DEFAULT true,
    "hra_component_code" VARCHAR(20),
    "basic_component_codes" VARCHAR(20)[] DEFAULT ARRAY[]::VARCHAR(20)[],
    "default_tax_regime" "TaxRegime",
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "statutory_rule_sets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "StatutoryRuleType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "state_code" VARCHAR(6),
    "regime" "TaxRegime",
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "RuleSetStatus" NOT NULL DEFAULT 'DRAFT',
    "source_reference" VARCHAR(1000) NOT NULL,
    "notes" VARCHAR(2000),
    "config" JSONB NOT NULL,
    "created_by_user_id" UUID,
    "activated_by_user_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "statutory_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_components" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "kind" "SalaryComponentKind" NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "pf_wage" BOOLEAN NOT NULL DEFAULT false,
    "esi_wage" BOOLEAN NOT NULL DEFAULT false,
    "pt_wage" BOOLEAN NOT NULL DEFAULT false,
    "prorate" BOOLEAN NOT NULL DEFAULT true,
    "payslip_order" SMALLINT NOT NULL DEFAULT 100,
    "description" VARCHAR(500),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "employer_statutory_in_ctc" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_structure_components" (
    "organization_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "calc_type" "ComponentCalcType" NOT NULL,
    "percent" DECIMAL(7,4),
    "monthly_amount" DECIMAL(14,2),
    "base_component_id" UUID,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "salary_structure_components_pkey" PRIMARY KEY ("structure_id","component_id")
);

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "annual_ctc" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "reason" "SalaryRevisionReason" NOT NULL,
    "note" VARCHAR(1000),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payroll_profiles" (
    "employee_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "pf_applicable" BOOLEAN NOT NULL DEFAULT false,
    "voluntary_pf_full_wages" BOOLEAN NOT NULL DEFAULT false,
    "eps_eligible" BOOLEAN NOT NULL DEFAULT true,
    "esi_applicable" BOOLEAN NOT NULL DEFAULT false,
    "esi_number" VARCHAR(17),
    "pt_state_code" VARCHAR(6),
    "metro_city" BOOLEAN NOT NULL DEFAULT false,
    "tax_applicable" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_payroll_profiles_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "tax_declarations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "financial_year" CHAR(7) NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "rent_paid_annual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" JSONB NOT NULL DEFAULT '{}',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tax_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "month" SMALLINT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "problem_count" INTEGER NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_employer_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "note" VARCHAR(1000),
    "created_by_user_id" UUID,
    "calculated_by_user_id" UUID,
    "calculated_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "finalized_by_user_id" UUID,
    "finalized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" "PayLineCategory" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "pf_wage" BOOLEAN NOT NULL DEFAULT false,
    "esi_wage" BOOLEAN NOT NULL DEFAULT false,
    "pt_wage" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_results" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "payable_days" DECIMAL(5,2) NOT NULL,
    "period_days" DECIMAL(5,2) NOT NULL,
    "loss_of_pay_days" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "gross" DECIMAL(14,2) NOT NULL,
    "total_deductions" DECIMAL(14,2) NOT NULL,
    "net_pay" DECIMAL(14,2) NOT NULL,
    "employer_cost" DECIMAL(14,2) NOT NULL,
    "taxable_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pf_wages" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_wages" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pt_wages" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_covered" BOOLEAN NOT NULL DEFAULT false,
    "annual_tax_projection" DECIMAL(14,2),
    "snapshot" JSONB NOT NULL,
    "tax_trace" JSONB,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_result_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "PayLineCategory" NOT NULL,
    "source" "PayLineSource" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "for_year" SMALLINT,
    "for_month" SMALLINT,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "payroll_result_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settlements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "last_working_date" DATE NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "inputs" JSONB NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "gratuity" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "leave_encashment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notice_pay" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_earnings" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "note" VARCHAR(1000),
    "calculated_by_user_id" UUID,
    "calculated_at" TIMESTAMPTZ(6),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "finalized_by_user_id" UUID,
    "finalized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "statutory_rule_sets_organization_id_type_status_effective_f_idx" ON "statutory_rule_sets"("organization_id", "type", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "statutory_rule_sets_organization_id_id_key" ON "statutory_rule_sets"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_organization_id_code_key" ON "salary_components"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_organization_id_id_key" ON "salary_components"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_organization_id_name_key" ON "salary_structures"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "salary_structures_organization_id_id_key" ON "salary_structures"("organization_id", "id");

-- CreateIndex
CREATE INDEX "salary_structure_components_organization_id_structure_id_idx" ON "salary_structure_components"("organization_id", "structure_id");

-- CreateIndex
CREATE INDEX "employee_salaries_organization_id_employee_id_effective_fro_idx" ON "employee_salaries"("organization_id", "employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salaries_employee_id_effective_from_key" ON "employee_salaries"("employee_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payroll_profiles_organization_id_employee_id_key" ON "employee_payroll_profiles"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "tax_declarations_organization_id_financial_year_idx" ON "tax_declarations"("organization_id", "financial_year");

-- CreateIndex
CREATE UNIQUE INDEX "tax_declarations_employee_id_financial_year_key" ON "tax_declarations"("employee_id", "financial_year");

-- CreateIndex
CREATE INDEX "payroll_runs_organization_id_company_id_year_month_idx" ON "payroll_runs"("organization_id", "company_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_organization_id_id_key" ON "payroll_runs"("organization_id", "id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_organization_id_run_id_employee_id_idx" ON "payroll_adjustments"("organization_id", "run_id", "employee_id");

-- CreateIndex
CREATE INDEX "payroll_results_organization_id_employee_id_idx" ON "payroll_results"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_results_run_id_employee_id_key" ON "payroll_results"("run_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_results_organization_id_id_key" ON "payroll_results"("organization_id", "id");

-- CreateIndex
CREATE INDEX "payroll_result_lines_organization_id_result_id_idx" ON "payroll_result_lines"("organization_id", "result_id");

-- CreateIndex
CREATE INDEX "payroll_settlements_organization_id_status_idx" ON "payroll_settlements"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settlements_organization_id_id_key" ON "payroll_settlements"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_rule_sets" ADD CONSTRAINT "statutory_rule_sets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_organization_id_structure_id_fkey" FOREIGN KEY ("organization_id", "structure_id") REFERENCES "salary_structures"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_organization_id_component_id_fkey" FOREIGN KEY ("organization_id", "component_id") REFERENCES "salary_components"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structure_components" ADD CONSTRAINT "salary_structure_components_base_component_id_fkey" FOREIGN KEY ("base_component_id") REFERENCES "salary_components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_organization_id_structure_id_fkey" FOREIGN KEY ("organization_id", "structure_id") REFERENCES "salary_structures"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_payroll_profiles" ADD CONSTRAINT "employee_payroll_profiles_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organization_id_company_id_fkey" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_organization_id_run_id_fkey" FOREIGN KEY ("organization_id", "run_id") REFERENCES "payroll_runs"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_organization_id_run_id_fkey" FOREIGN KEY ("organization_id", "run_id") REFERENCES "payroll_runs"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_result_lines" ADD CONSTRAINT "payroll_result_lines_organization_id_result_id_fkey" FOREIGN KEY ("organization_id", "result_id") REFERENCES "payroll_results"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written integrity rules (ADR-014). No statutory value is stored by this migration.
-- =============================================================================================

ALTER TABLE "payroll_settings"
  ADD CONSTRAINT "payroll_settings_fixed_days_chk" CHECK (
    ("payable_days_method" <> 'FIXED_DAYS' OR "fixed_days" IS NOT NULL)
    AND ("fixed_days" IS NULL OR "fixed_days" BETWEEN 1 AND 31));

ALTER TABLE "statutory_rule_sets"
  ADD CONSTRAINT "statutory_rule_sets_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "statutory_rule_sets_source_chk" CHECK (length(btrim("source_reference")) >= 5),
  ADD CONSTRAINT "statutory_rule_sets_state_chk" CHECK (
    ("type" = 'PT') = ("state_code" IS NOT NULL) AND ("state_code" IS NULL OR "state_code" ~ '^IN-[A-Z]{2}$')),
  ADD CONSTRAINT "statutory_rule_sets_regime_chk" CHECK (("type" = 'INCOME_TAX') = ("regime" IS NOT NULL)),
  ADD CONSTRAINT "statutory_rule_sets_dates_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "statutory_rule_sets_activation_chk" CHECK ("status" = 'DRAFT' OR "activated_at" IS NOT NULL),
  ADD CONSTRAINT "statutory_rule_sets_config_chk" CHECK (jsonb_typeof("config") = 'object');

-- Active rule sets of the same type and scope never overlap in time.
ALTER TABLE "statutory_rule_sets"
  ADD CONSTRAINT "statutory_rule_sets_no_overlap" EXCLUDE USING gist (
    "organization_id" WITH =,
    "type" WITH =,
    (COALESCE("state_code", '')) WITH =,
    -- regime is NULL only for non-tax types, which never share a type with tax rule sets.
    (COALESCE("regime", 'OLD')) WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');

-- Only a DRAFT may change its content; an ACTIVE rule set may only be closed (end date) or retired.
CREATE OR REPLACE FUNCTION app.statutory_rule_set_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only draft rule sets can be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'A retired rule set cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'ACTIVE' AND (
       NEW.config IS DISTINCT FROM OLD.config OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.state_code IS DISTINCT FROM OLD.state_code OR NEW.regime IS DISTINCT FROM OLD.regime
    OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
    OR NEW.status = 'DRAFT') THEN
    RAISE EXCEPTION 'An active rule set cannot be edited; create a new version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "statutory_rule_sets_guard" BEFORE UPDATE OR DELETE ON "statutory_rule_sets"
  FOR EACH ROW EXECUTE FUNCTION app.statutory_rule_set_guard();

ALTER TABLE "salary_components"
  ADD CONSTRAINT "salary_components_code_chk" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,19}$' AND "code" NOT LIKE 'ARR\_%'),
  ADD CONSTRAINT "salary_components_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "salary_components_order_chk" CHECK ("payslip_order" >= 0);

ALTER TABLE "salary_structures"
  ADD CONSTRAINT "salary_structures_name_chk" CHECK (length(btrim("name")) > 0);

ALTER TABLE "salary_structure_components"
  ADD CONSTRAINT "salary_structure_components_calc_chk" CHECK (
    CASE "calc_type"
      WHEN 'FIXED' THEN "monthly_amount" IS NOT NULL AND "monthly_amount" >= 0 AND "percent" IS NULL AND "base_component_id" IS NULL
      WHEN 'PERCENT_OF_CTC' THEN "percent" BETWEEN 0 AND 100 AND "monthly_amount" IS NULL AND "base_component_id" IS NULL
      WHEN 'PERCENT_OF_COMPONENT' THEN "percent" BETWEEN 0 AND 100 AND "monthly_amount" IS NULL
        AND "base_component_id" IS NOT NULL AND "base_component_id" <> "component_id"
      ELSE "percent" IS NULL AND "monthly_amount" IS NULL AND "base_component_id" IS NULL
    END);
CREATE UNIQUE INDEX "salary_structure_components_one_balancing_key"
  ON "salary_structure_components" ("structure_id") WHERE "calc_type" = 'BALANCING';

ALTER TABLE "employee_salaries"
  ADD CONSTRAINT "employee_salaries_ctc_chk" CHECK ("annual_ctc" > 0);

ALTER TABLE "employee_payroll_profiles"
  ADD CONSTRAINT "employee_payroll_profiles_esi_chk" CHECK ("esi_number" IS NULL OR "esi_number" ~ '^\d{10,17}$'),
  ADD CONSTRAINT "employee_payroll_profiles_state_chk" CHECK ("pt_state_code" IS NULL OR "pt_state_code" ~ '^IN-[A-Z]{2}$');

ALTER TABLE "tax_declarations"
  ADD CONSTRAINT "tax_declarations_fy_chk" CHECK ("financial_year" ~ '^\d{4}-\d{2}$'),
  ADD CONSTRAINT "tax_declarations_rent_chk" CHECK ("rent_paid_annual" >= 0),
  ADD CONSTRAINT "tax_declarations_deductions_chk" CHECK (jsonb_typeof("deductions") = 'object');

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_period_chk" CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 2100 AND "period_end" >= "period_start"),
  ADD CONSTRAINT "payroll_runs_approval_chk" CHECK (
    ("status" NOT IN ('APPROVED', 'FINALIZED') OR ("approved_at" IS NOT NULL AND "approved_by_user_id" IS NOT NULL))
    AND ("status" <> 'FINALIZED' OR "finalized_at" IS NOT NULL)
    AND ("approved_by_user_id" IS NULL OR "approved_by_user_id" IS DISTINCT FROM "calculated_by_user_id"));
CREATE UNIQUE INDEX "payroll_runs_one_live_key"
  ON "payroll_runs" ("organization_id", "company_id", "year", "month") WHERE "status" <> 'CANCELLED';

-- A finalized or cancelled run never changes; a finalized run is never cancelled.
CREATE OR REPLACE FUNCTION app.payroll_run_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('FINALIZED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % payroll run cannot change', lower(OLD.status::text) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "payroll_runs_guard" BEFORE UPDATE ON "payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION app.payroll_run_guard();

-- Results, lines and adjustments change only while their run is DRAFT or CALCULATED.
CREATE OR REPLACE FUNCTION app.payroll_run_child_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_run uuid;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'payroll_result_lines' THEN
    SELECT r.run_id INTO v_run FROM public.payroll_results r WHERE r.id = COALESCE(NEW.result_id, OLD.result_id);
  ELSIF TG_OP = 'DELETE' THEN
    v_run := OLD.run_id;
  ELSE
    v_run := NEW.run_id;
  END IF;
  SELECT status::text INTO v_status FROM public.payroll_runs WHERE id = v_run;
  IF v_status IS NOT NULL AND v_status NOT IN ('DRAFT', 'CALCULATED') THEN
    RAISE EXCEPTION 'The payroll run is % and its results cannot change', lower(v_status) USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER "payroll_results_run_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_results"
  FOR EACH ROW EXECUTE FUNCTION app.payroll_run_child_guard();
CREATE TRIGGER "payroll_result_lines_run_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_result_lines"
  FOR EACH ROW EXECUTE FUNCTION app.payroll_run_child_guard();
CREATE TRIGGER "payroll_adjustments_run_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_adjustments"
  FOR EACH ROW EXECUTE FUNCTION app.payroll_run_child_guard();

ALTER TABLE "payroll_adjustments"
  ADD CONSTRAINT "payroll_adjustments_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "payroll_adjustments_code_chk" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,19}$'),
  ADD CONSTRAINT "payroll_adjustments_category_chk" CHECK ("category" IN ('EARNING', 'DEDUCTION'));

ALTER TABLE "payroll_results"
  ADD CONSTRAINT "payroll_results_days_chk" CHECK ("payable_days" >= 0 AND "period_days" > 0 AND "payable_days" <= "period_days" AND "loss_of_pay_days" >= 0),
  ADD CONSTRAINT "payroll_results_totals_chk" CHECK ("gross" >= 0 AND "total_deductions" >= 0 AND "net_pay" = "gross" - "total_deductions"),
  ADD CONSTRAINT "payroll_results_snapshot_chk" CHECK (jsonb_typeof("snapshot") = 'object' AND jsonb_typeof("problems") = 'array');

ALTER TABLE "payroll_result_lines"
  ADD CONSTRAINT "payroll_result_lines_period_chk" CHECK (
    ("for_year" IS NULL) = ("for_month" IS NULL) AND ("for_month" IS NULL OR "for_month" BETWEEN 1 AND 12));

ALTER TABLE "payroll_settlements"
  ADD CONSTRAINT "payroll_settlements_json_chk" CHECK (
    jsonb_typeof("inputs") = 'object' AND jsonb_typeof("lines") = 'array' AND jsonb_typeof("problems") = 'array'),
  ADD CONSTRAINT "payroll_settlements_totals_chk" CHECK ("net_payable" = "total_earnings" - "total_deductions"),
  ADD CONSTRAINT "payroll_settlements_approval_chk" CHECK (
    ("status" NOT IN ('APPROVED', 'FINALIZED') OR ("approved_at" IS NOT NULL AND "approved_by_user_id" IS NOT NULL))
    AND ("status" <> 'FINALIZED' OR "finalized_at" IS NOT NULL)
    AND ("approved_by_user_id" IS NULL OR "approved_by_user_id" IS DISTINCT FROM "calculated_by_user_id"));
CREATE UNIQUE INDEX "payroll_settlements_one_live_key"
  ON "payroll_settlements" ("employee_id") WHERE "status" <> 'CANCELLED';
CREATE TRIGGER "payroll_settlements_guard" BEFORE UPDATE ON "payroll_settlements"
  FOR EACH ROW EXECUTE FUNCTION app.payroll_run_guard();

-- Structure lines are immutable (a salary's breakdown must stay reproducible).
CREATE TRIGGER "salary_structure_components_immutable" BEFORE UPDATE ON "salary_structure_components"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "salary_structure_components_same_tenant" BEFORE INSERT ON "salary_structure_components"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('base_component_id', 'salary_components');

CREATE TRIGGER "payroll_settings_set_updated_at" BEFORE UPDATE ON "payroll_settings" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "statutory_rule_sets_set_updated_at" BEFORE UPDATE ON "statutory_rule_sets" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "salary_components_set_updated_at" BEFORE UPDATE ON "salary_components" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "salary_structures_set_updated_at" BEFORE UPDATE ON "salary_structures" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "employee_payroll_profiles_set_updated_at" BEFORE UPDATE ON "employee_payroll_profiles" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "tax_declarations_set_updated_at" BEFORE UPDATE ON "tax_declarations" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "payroll_runs_set_updated_at" BEFORE UPDATE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "payroll_settlements_set_updated_at" BEFORE UPDATE ON "payroll_settlements" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_settings', 'statutory_rule_sets', 'salary_components', 'salary_structures',
    'salary_structure_components', 'employee_salaries', 'employee_payroll_profiles',
    'tax_declarations', 'payroll_runs', 'payroll_adjustments', 'payroll_results',
    'payroll_result_lines', 'payroll_settlements'
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
    REVOKE UPDATE, DELETE, TRUNCATE ON "salary_structure_components" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "salary_structures", "salary_components", "payroll_runs", "payroll_settlements" FROM hrm_app;
    REVOKE TRUNCATE ON "statutory_rule_sets", "employee_salaries", "payroll_results", "payroll_result_lines", "payroll_adjustments" FROM hrm_app;
    REVOKE UPDATE ON "employee_salaries" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('payroll.settings.manage',   'payroll', 'Payroll settings, salary components and structures'),
  ('payroll.statutory.manage',  'payroll', 'Statutory rule sets (EPF, ESI, PT, income tax, gratuity)'),
  ('payroll.salary.read',       'payroll', 'View employee salaries, payroll profiles and declarations'),
  ('payroll.salary.manage',     'payroll', 'Set salaries and revisions, payroll profiles and declarations'),
  ('payroll.run.read',          'payroll', 'View payroll runs, results and payslips'),
  ('payroll.run.manage',        'payroll', 'Create, calculate, adjust and finalize payroll runs'),
  ('payroll.run.approve',       'payroll', 'Approve or reject calculated payroll runs and settlements'),
  ('payroll.bank_file.export',  'payroll', 'Export bank payment files for finalized runs'),
  ('payroll.settlement.manage', 'payroll', 'Prepare and finalize full and final settlements');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
JOIN (
  SELECT role_key, key FROM (VALUES ('owner'), ('admin'), ('finance')) AS roles(role_key)
  CROSS JOIN (VALUES
    ('payroll.settings.manage'), ('payroll.statutory.manage'), ('payroll.salary.read'),
    ('payroll.salary.manage'), ('payroll.run.read'), ('payroll.run.manage'), ('payroll.run.approve'),
    ('payroll.bank_file.export'), ('payroll.settlement.manage')) AS perms(key)
  UNION ALL
  SELECT * FROM (VALUES
    ('hr_admin', 'payroll.salary.read'), ('hr_admin', 'payroll.salary.manage'),
    ('hr_admin', 'payroll.run.read'), ('hr_admin', 'payroll.run.manage'),
    ('hr_admin', 'payroll.settlement.manage')) AS extra(role_key, key)
) AS p ON p.role_key = r."key"
WHERE r."is_system";
