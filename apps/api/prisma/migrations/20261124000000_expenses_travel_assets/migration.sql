-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('PAYROLL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ExpenseClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'MANAGER_APPROVED', 'FINANCE_APPROVED', 'REIMBURSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TravelStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SETTLED');

-- CreateEnum
CREATE TYPE "TravelBookingType" AS ENUM ('FLIGHT', 'TRAIN', 'BUS', 'CAB', 'HOTEL', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'ALLOCATED', 'IN_REPAIR', 'RETIRED', 'LOST');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('GOOD', 'DAMAGED', 'LOST');

-- CreateTable
CREATE TABLE "expense_settings" (
    "organization_id" UUID NOT NULL,
    "claim_window_days" SMALLINT,
    "default_payout_method" "PayoutMethod" NOT NULL DEFAULT 'PAYROLL',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "max_per_item" DECIMAL(14,2),
    "max_per_month" DECIMAL(14,2),
    "receipt_required_above" DECIMAL(14,2),
    "daily_limit" DECIMAL(14,2),
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "trip_id" UUID,
    "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "total_claimed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_approved" DECIMAL(14,2),
    "approver_employee_id" UUID,
    "payout_method" "PayoutMethod",
    "submitted_at" TIMESTAMPTZ(6),
    "manager_decided_by_user_id" UUID,
    "manager_decided_at" TIMESTAMPTZ(6),
    "finance_decided_by_user_id" UUID,
    "finance_decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(1000),
    "payroll_run_id" UUID,
    "paid_on" DATE,
    "paid_reference" VARCHAR(100),
    "reimbursed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "days" SMALLINT NOT NULL DEFAULT 1,
    "description" VARCHAR(300) NOT NULL,
    "merchant" VARCHAR(200),
    "currency" CHAR(3) NOT NULL,
    "original_amount" DECIMAL(14,2) NOT NULL,
    "exchange_rate" DECIMAL(14,6) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "approved_amount" DECIMAL(14,2),
    "finance_note" VARCHAR(500),
    "justification" VARCHAR(1000),
    "issues" JSONB NOT NULL DEFAULT '[]',
    "receipt_storage_key" VARCHAR(500),
    "receipt_file_name" VARCHAR(255),
    "receipt_content_type" VARCHAR(100),
    "receipt_size_bytes" INTEGER,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claim_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "from_status" "ExpenseClaimStatus",
    "to_status" "ExpenseClaimStatus" NOT NULL,
    "note" VARCHAR(1000),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "purpose" VARCHAR(300) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "legs" JSONB NOT NULL,
    "estimated_cost" DECIMAL(14,2),
    "advance_requested" DECIMAL(14,2),
    "notes" VARCHAR(2000),
    "status" "TravelStatus" NOT NULL DEFAULT 'SUBMITTED',
    "approver_employee_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(1000),
    "settlement_balance" DECIMAL(14,2),
    "recovery_method" "PayoutMethod",
    "recovery_reference" VARCHAR(100),
    "recovery_payroll_run_id" UUID,
    "recovered_at" TIMESTAMPTZ(6),
    "settled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "travel_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_bookings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "type" "TravelBookingType" NOT NULL,
    "vendor" VARCHAR(200) NOT NULL,
    "reference" VARCHAR(100),
    "booked_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_by_company" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_advances" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "useful_life_months" SMALLINT,
    "salvage_percent" DECIMAL(5,2),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "tag" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category_id" UUID NOT NULL,
    "serial_number" VARCHAR(100),
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "vendor" VARCHAR(200),
    "purchase_date" DATE,
    "purchase_cost" DECIMAL(14,2),
    "warranty_end" DATE,
    "location_id" UUID,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "notes" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_allocations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "allocated_on" DATE NOT NULL,
    "expected_return_on" DATE,
    "condition_note" VARCHAR(500),
    "acknowledged_at" TIMESTAMPTZ(6),
    "returned_on" DATE,
    "return_condition" "AssetCondition",
    "return_note" VARCHAR(500),
    "allocated_by_user_id" UUID,
    "returned_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "employee_id" UUID,
    "note" VARCHAR(1000),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_maintenance" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "started_on" DATE NOT NULL,
    "completed_on" DATE,
    "vendor" VARCHAR(200),
    "cost" DECIMAL(14,2),
    "description" VARCHAR(1000) NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "software_licenses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "vendor" VARCHAR(200),
    "seats" INTEGER NOT NULL,
    "expires_on" DATE,
    "cost" DECIMAL(14,2),
    "notes" VARCHAR(2000),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "software_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "license_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "assigned_on" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_on" TIMESTAMPTZ(6),
    "assigned_by_user_id" UUID,
    "revoked_by_user_id" UUID,

    CONSTRAINT "license_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_code_key" ON "expense_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_id_key" ON "expense_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "expense_claims_organization_id_employee_id_status_idx" ON "expense_claims"("organization_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "expense_claims_organization_id_status_idx" ON "expense_claims"("organization_id", "status");

-- CreateIndex
CREATE INDEX "expense_claims_organization_id_approver_employee_id_status_idx" ON "expense_claims"("organization_id", "approver_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_organization_id_id_key" ON "expense_claims"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_items_receipt_storage_key_key" ON "expense_items"("receipt_storage_key");

-- CreateIndex
CREATE INDEX "expense_items_organization_id_claim_id_idx" ON "expense_items"("organization_id", "claim_id");

-- CreateIndex
CREATE INDEX "expense_items_organization_id_category_id_date_idx" ON "expense_items"("organization_id", "category_id", "date");

-- CreateIndex
CREATE INDEX "expense_claim_events_organization_id_claim_id_created_at_idx" ON "expense_claim_events"("organization_id", "claim_id", "created_at");

-- CreateIndex
CREATE INDEX "travel_requests_organization_id_employee_id_start_date_idx" ON "travel_requests"("organization_id", "employee_id", "start_date");

-- CreateIndex
CREATE INDEX "travel_requests_organization_id_status_idx" ON "travel_requests"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "travel_requests_organization_id_id_key" ON "travel_requests"("organization_id", "id");

-- CreateIndex
CREATE INDEX "travel_bookings_organization_id_trip_id_idx" ON "travel_bookings"("organization_id", "trip_id");

-- CreateIndex
CREATE INDEX "travel_advances_organization_id_trip_id_idx" ON "travel_advances"("organization_id", "trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_organization_id_code_key" ON "asset_categories"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_organization_id_id_key" ON "asset_categories"("organization_id", "id");

-- CreateIndex
CREATE INDEX "assets_organization_id_status_idx" ON "assets"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organization_id_tag_key" ON "assets"("organization_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organization_id_id_key" ON "assets"("organization_id", "id");

-- CreateIndex
CREATE INDEX "asset_allocations_organization_id_asset_id_allocated_on_idx" ON "asset_allocations"("organization_id", "asset_id", "allocated_on");

-- CreateIndex
CREATE INDEX "asset_allocations_organization_id_employee_id_idx" ON "asset_allocations"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "asset_events_organization_id_asset_id_created_at_idx" ON "asset_events"("organization_id", "asset_id", "created_at");

-- CreateIndex
CREATE INDEX "asset_maintenance_organization_id_asset_id_started_on_idx" ON "asset_maintenance"("organization_id", "asset_id", "started_on");

-- CreateIndex
CREATE UNIQUE INDEX "software_licenses_organization_id_name_key" ON "software_licenses"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "software_licenses_organization_id_id_key" ON "software_licenses"("organization_id", "id");

-- CreateIndex
CREATE INDEX "license_assignments_organization_id_license_id_idx" ON "license_assignments"("organization_id", "license_id");

-- CreateIndex
CREATE INDEX "license_assignments_organization_id_employee_id_idx" ON "license_assignments"("organization_id", "employee_id");

-- AddForeignKey
ALTER TABLE "expense_settings" ADD CONSTRAINT "expense_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "travel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_organization_id_claim_id_fkey" FOREIGN KEY ("organization_id", "claim_id") REFERENCES "expense_claims"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "expense_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claim_events" ADD CONSTRAINT "expense_claim_events_organization_id_claim_id_fkey" FOREIGN KEY ("organization_id", "claim_id") REFERENCES "expense_claims"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_organization_id_trip_id_fkey" FOREIGN KEY ("organization_id", "trip_id") REFERENCES "travel_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_advances" ADD CONSTRAINT "travel_advances_organization_id_trip_id_fkey" FOREIGN KEY ("organization_id", "trip_id") REFERENCES "travel_requests"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_category_id_fkey" FOREIGN KEY ("organization_id", "category_id") REFERENCES "asset_categories"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_allocations" ADD CONSTRAINT "asset_allocations_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_organization_id_asset_id_fkey" FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "software_licenses" ADD CONSTRAINT "software_licenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_organization_id_license_id_fkey" FOREIGN KEY ("organization_id", "license_id") REFERENCES "software_licenses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_assignments" ADD CONSTRAINT "license_assignments_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written integrity rules (ADR-015). No policy limit is stored by this migration.
-- =============================================================================================

ALTER TABLE "expense_settings"
  ADD CONSTRAINT "expense_settings_window_chk" CHECK ("claim_window_days" IS NULL OR "claim_window_days" BETWEEN 1 AND 3650);

ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  ADD CONSTRAINT "expense_categories_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "expense_categories_limits_chk" CHECK (
    COALESCE("max_per_item", 0) >= 0 AND COALESCE("max_per_month", 0) >= 0
    AND COALESCE("receipt_required_above", 0) >= 0 AND COALESCE("daily_limit", 0) >= 0);

ALTER TABLE "expense_claims"
  ADD CONSTRAINT "expense_claims_title_chk" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "expense_claims_totals_chk" CHECK ("total_claimed" >= 0 AND ("total_approved" IS NULL OR "total_approved" BETWEEN 0 AND "total_claimed")),
  ADD CONSTRAINT "expense_claims_state_chk" CHECK (
    ("status" = 'DRAFT' OR "submitted_at" IS NOT NULL)
    AND ("status" NOT IN ('FINANCE_APPROVED', 'REIMBURSED') OR ("finance_decided_at" IS NOT NULL AND "total_approved" IS NOT NULL AND "payout_method" IS NOT NULL))
    AND ("status" <> 'REIMBURSED' OR "reimbursed_at" IS NOT NULL)
    AND ("paid_on" IS NULL) = ("paid_reference" IS NULL));

-- Reimbursed and cancelled claims never change.
CREATE OR REPLACE FUNCTION app.expense_claim_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('REIMBURSED', 'CANCELLED') THEN
    RAISE EXCEPTION 'A % claim cannot change', lower(OLD.status::text) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "expense_claims_guard" BEFORE UPDATE ON "expense_claims"
  FOR EACH ROW EXECUTE FUNCTION app.expense_claim_guard();

ALTER TABLE "expense_items"
  ADD CONSTRAINT "expense_items_days_chk" CHECK ("days" BETWEEN 1 AND 90),
  ADD CONSTRAINT "expense_items_amounts_chk" CHECK (
    "original_amount" > 0 AND "exchange_rate" > 0 AND "amount" >= 0
    AND ("approved_amount" IS NULL OR "approved_amount" BETWEEN 0 AND "amount")),
  ADD CONSTRAINT "expense_items_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "expense_items_description_chk" CHECK (length(btrim("description")) > 0),
  ADD CONSTRAINT "expense_items_issues_chk" CHECK (jsonb_typeof("issues") = 'array'),
  ADD CONSTRAINT "expense_items_receipt_chk" CHECK (
    ("receipt_storage_key" IS NULL) = ("receipt_file_name" IS NULL)
    AND ("receipt_storage_key" IS NULL) = ("receipt_content_type" IS NULL)
    AND ("receipt_storage_key" IS NULL) = ("receipt_size_bytes" IS NULL));

-- Items are editable only while the claim is a draft; during verification finance may set only
-- the approved amount and its note.
CREATE OR REPLACE FUNCTION app.expense_item_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status::text INTO v_status FROM public.expense_claims WHERE id = COALESCE(NEW.claim_id, OLD.claim_id);
  IF v_status IS NULL OR v_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'MANAGER_APPROVED'
     AND (to_jsonb(NEW) - 'approved_amount' - 'finance_note') = (to_jsonb(OLD) - 'approved_amount' - 'finance_note') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Items of a % claim cannot change', lower(v_status) USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER "expense_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "expense_items"
  FOR EACH ROW EXECUTE FUNCTION app.expense_item_guard();

ALTER TABLE "travel_requests"
  ADD CONSTRAINT "travel_requests_purpose_chk" CHECK (length(btrim("purpose")) > 0),
  ADD CONSTRAINT "travel_requests_dates_chk" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "travel_requests_legs_chk" CHECK (jsonb_typeof("legs") = 'array' AND jsonb_array_length("legs") >= 1),
  ADD CONSTRAINT "travel_requests_amounts_chk" CHECK (COALESCE("estimated_cost", 0) >= 0 AND COALESCE("advance_requested", 0) >= 0),
  ADD CONSTRAINT "travel_requests_decision_chk" CHECK ("status" IN ('SUBMITTED', 'CANCELLED') OR "decided_at" IS NOT NULL),
  ADD CONSTRAINT "travel_requests_settled_chk" CHECK ("status" <> 'SETTLED' OR ("settled_at" IS NOT NULL AND "settlement_balance" IS NOT NULL));
CREATE OR REPLACE FUNCTION app.travel_request_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('CANCELLED', 'REJECTED') THEN
    RAISE EXCEPTION 'A % travel request cannot change', lower(OLD.status::text) USING ERRCODE = 'check_violation';
  END IF;
  -- A settled trip may still record the recovery of its balance, nothing else.
  IF OLD.status = 'SETTLED' AND (to_jsonb(NEW) - 'recovery_method' - 'recovery_reference' - 'recovery_payroll_run_id' - 'recovered_at' - 'updated_at')
       <> (to_jsonb(OLD) - 'recovery_method' - 'recovery_reference' - 'recovery_payroll_run_id' - 'recovered_at' - 'updated_at') THEN
    RAISE EXCEPTION 'A settled travel request cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "travel_requests_guard" BEFORE UPDATE ON "travel_requests"
  FOR EACH ROW EXECUTE FUNCTION app.travel_request_guard();

ALTER TABLE "travel_bookings"
  ADD CONSTRAINT "travel_bookings_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "travel_bookings_vendor_chk" CHECK (length(btrim("vendor")) > 0);
ALTER TABLE "travel_advances"
  ADD CONSTRAINT "travel_advances_amount_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "travel_advances_reference_chk" CHECK (length(btrim("reference")) > 0);

ALTER TABLE "asset_categories"
  ADD CONSTRAINT "asset_categories_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  ADD CONSTRAINT "asset_categories_depreciation_chk" CHECK (
    ("useful_life_months" IS NULL OR "useful_life_months" > 0) AND ("salvage_percent" IS NULL OR "salvage_percent" BETWEEN 0 AND 100));

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_tag_chk" CHECK ("tag" ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  ADD CONSTRAINT "assets_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "assets_cost_chk" CHECK ("purchase_cost" IS NULL OR "purchase_cost" >= 0),
  ADD CONSTRAINT "assets_warranty_chk" CHECK ("warranty_end" IS NULL OR "purchase_date" IS NULL OR "warranty_end" >= "purchase_date");

ALTER TABLE "asset_allocations"
  ADD CONSTRAINT "asset_allocations_return_chk" CHECK (
    ("returned_on" IS NULL) = ("return_condition" IS NULL)
    AND ("returned_on" IS NULL OR "returned_on" >= "allocated_on")
    AND ("expected_return_on" IS NULL OR "expected_return_on" >= "allocated_on"));
CREATE UNIQUE INDEX "asset_allocations_one_open_key" ON "asset_allocations" ("asset_id") WHERE "returned_on" IS NULL;

ALTER TABLE "asset_maintenance"
  ADD CONSTRAINT "asset_maintenance_chk" CHECK (
    ("cost" IS NULL OR "cost" >= 0) AND ("completed_on" IS NULL OR "completed_on" >= "started_on")
    AND length(btrim("description")) > 0);

ALTER TABLE "software_licenses"
  ADD CONSTRAINT "software_licenses_seats_chk" CHECK ("seats" > 0),
  ADD CONSTRAINT "software_licenses_cost_chk" CHECK ("cost" IS NULL OR "cost" >= 0);
ALTER TABLE "license_assignments"
  ADD CONSTRAINT "license_assignments_revoked_chk" CHECK ("revoked_on" IS NULL OR "revoked_on" >= "assigned_on");
CREATE UNIQUE INDEX "license_assignments_one_open_key" ON "license_assignments" ("license_id", "employee_id") WHERE "revoked_on" IS NULL;

-- Optional references stay inside the tenant.
CREATE TRIGGER "expense_claims_same_tenant" BEFORE INSERT OR UPDATE ON "expense_claims"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant(
    'trip_id', 'travel_requests', 'approver_employee_id', 'employees', 'payroll_run_id', 'payroll_runs');
CREATE TRIGGER "travel_requests_same_tenant" BEFORE INSERT OR UPDATE ON "travel_requests"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant(
    'approver_employee_id', 'employees', 'recovery_payroll_run_id', 'payroll_runs');
CREATE TRIGGER "assets_same_tenant" BEFORE INSERT OR UPDATE ON "assets"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('location_id', 'locations');

-- Histories are append-only.
CREATE TRIGGER "expense_claim_events_append_only" BEFORE UPDATE OR DELETE ON "expense_claim_events"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "expense_claim_events_no_truncate" BEFORE TRUNCATE ON "expense_claim_events"
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "asset_events_append_only" BEFORE UPDATE OR DELETE ON "asset_events"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "asset_events_no_truncate" BEFORE TRUNCATE ON "asset_events"
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER "expense_settings_set_updated_at" BEFORE UPDATE ON "expense_settings" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "expense_categories_set_updated_at" BEFORE UPDATE ON "expense_categories" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "expense_claims_set_updated_at" BEFORE UPDATE ON "expense_claims" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "travel_requests_set_updated_at" BEFORE UPDATE ON "travel_requests" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "asset_categories_set_updated_at" BEFORE UPDATE ON "asset_categories" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "assets_set_updated_at" BEFORE UPDATE ON "assets" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "software_licenses_set_updated_at" BEFORE UPDATE ON "software_licenses" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense_settings', 'expense_categories', 'expense_claims', 'expense_items',
    'expense_claim_events', 'travel_requests', 'travel_bookings', 'travel_advances',
    'asset_categories', 'assets', 'asset_allocations', 'asset_events', 'asset_maintenance',
    'software_licenses', 'license_assignments'
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
    REVOKE UPDATE, DELETE, TRUNCATE ON "expense_claim_events", "asset_events" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "expense_claims", "travel_requests", "assets", "asset_allocations",
      "license_assignments", "travel_advances", "software_licenses", "expense_categories", "asset_categories" FROM hrm_app;
    REVOKE TRUNCATE ON "expense_items", "travel_bookings", "asset_maintenance" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('expenses.category.manage', 'expenses', 'Expense categories, policy limits and settings'),
  ('expenses.claim.read',      'expenses', 'View all expense claims'),
  ('expenses.claim.verify',    'expenses', 'Verify, approve amounts and pay expense claims'),
  ('travel.request.read',      'travel',   'View all travel requests'),
  ('travel.request.approve',   'travel',   'Approve travel requests of employees without a manager'),
  ('travel.desk.manage',       'travel',   'Record bookings and advances and settle trips'),
  ('assets.asset.read',        'assets',   'View the asset register'),
  ('assets.asset.manage',      'assets',   'Manage assets, allocations, returns and maintenance'),
  ('assets.license.manage',    'assets',   'Manage software licences and seat assignments');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
JOIN (
  SELECT role_key, key FROM (VALUES ('owner'), ('admin')) AS roles(role_key)
  CROSS JOIN (VALUES
    ('expenses.category.manage'), ('expenses.claim.read'), ('expenses.claim.verify'),
    ('travel.request.read'), ('travel.request.approve'), ('travel.desk.manage'),
    ('assets.asset.read'), ('assets.asset.manage'), ('assets.license.manage')) AS perms(key)
  UNION ALL
  SELECT * FROM (VALUES
    ('finance', 'expenses.category.manage'), ('finance', 'expenses.claim.read'), ('finance', 'expenses.claim.verify'),
    ('finance', 'travel.request.read'), ('finance', 'travel.desk.manage'),
    ('hr_admin', 'expenses.claim.read'), ('hr_admin', 'travel.request.read'), ('hr_admin', 'travel.request.approve'),
    ('hr_admin', 'travel.desk.manage'), ('hr_admin', 'assets.asset.read'), ('hr_admin', 'assets.asset.manage'),
    ('hr_admin', 'assets.license.manage')) AS extra(role_key, key)
) AS p ON p.role_key = r."key"
WHERE r."is_system";
