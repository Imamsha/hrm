-- CreateEnum
CREATE TYPE "punch_direction" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "punch_source" AS ENUM ('WEB', 'MOBILE', 'QR', 'BIOMETRIC_IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "accrual_method" AS ENUM ('NONE', 'YEARLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "leave_session" AS ENUM ('FULL', 'FIRST_HALF', 'SECOND_HALF');

-- CreateEnum
CREATE TYPE "leave_ledger_entry_type" AS ENUM ('OPENING', 'ACCRUAL', 'ADJUSTMENT', 'USAGE', 'REVERSAL', 'CARRY_FORWARD', 'LAPSE');

-- CreateTable
CREATE TABLE "time_settings" (
    "organization_id" UUID NOT NULL,
    "leave_year_start_month" SMALLINT NOT NULL DEFAULT 1,
    "web_punch_enabled" BOOLEAN NOT NULL DEFAULT true,
    "mobile_punch_enabled" BOOLEAN NOT NULL DEFAULT true,
    "qr_punch_enabled" BOOLEAN NOT NULL DEFAULT true,
    "geolocation_required" BOOLEAN NOT NULL DEFAULT false,
    "qr_rotation_seconds" SMALLINT NOT NULL DEFAULT 30,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "time_settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "start_minutes" SMALLINT NOT NULL,
    "end_minutes" SMALLINT NOT NULL,
    "break_minutes" SMALLINT NOT NULL DEFAULT 0,
    "grace_in_minutes" SMALLINT NOT NULL DEFAULT 0,
    "grace_out_minutes" SMALLINT NOT NULL DEFAULT 0,
    "full_day_minutes" SMALLINT NOT NULL,
    "half_day_minutes" SMALLINT NOT NULL,
    "overtime_after_minutes" SMALLINT,
    "window_before_minutes" SMALLINT NOT NULL DEFAULT 240,
    "window_after_minutes" SMALLINT NOT NULL DEFAULT 360,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" UUID,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roster_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_punches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "punched_at" TIMESTAMPTZ(6) NOT NULL,
    "direction" "punch_direction" NOT NULL,
    "source" "punch_source" NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "ip_address" INET,
    "device_label" VARCHAR(100),
    "branch_id" UUID,
    "note" VARCHAR(500),
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_regularizations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "requested_in" TIMESTAMPTZ(6) NOT NULL,
    "requested_out" TIMESTAMPTZ(6) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "request_status" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_regularizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "tracks_balance" BOOLEAN NOT NULL DEFAULT true,
    "accrual_method" "accrual_method" NOT NULL DEFAULT 'YEARLY',
    "annual_quota" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "prorate_on_joining" BOOLEAN NOT NULL DEFAULT false,
    "carry_forward_max" DECIMAL(6,2),
    "allow_negative_balance" BOOLEAN NOT NULL DEFAULT false,
    "allow_half_day" BOOLEAN NOT NULL DEFAULT true,
    "count_weekly_offs" BOOLEAN NOT NULL DEFAULT false,
    "count_holidays" BOOLEAN NOT NULL DEFAULT false,
    "min_notice_days" SMALLINT NOT NULL DEFAULT 0,
    "max_consecutive_days" DECIMAL(6,2),
    "allow_during_probation" BOOLEAN NOT NULL DEFAULT true,
    "employment_types" "employment_type"[] DEFAULT ARRAY[]::"employment_type"[],
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "start_session" "leave_session" NOT NULL DEFAULT 'FULL',
    "end_session" "leave_session" NOT NULL DEFAULT 'FULL',
    "days" DECIMAL(6,2) NOT NULL,
    "reason" VARCHAR(1000),
    "status" "request_status" NOT NULL DEFAULT 'PENDING',
    "approver_employee_id" UUID,
    "requested_by_user_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_ledger_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "entry_type" "leave_ledger_entry_type" NOT NULL,
    "period" SMALLINT NOT NULL DEFAULT 0,
    "days" DECIMAL(6,2) NOT NULL,
    "effective_date" DATE NOT NULL,
    "leave_request_id" UUID,
    "note" VARCHAR(500),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shifts_organization_id_code_key" ON "shifts"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_organization_id_id_key" ON "shifts"("organization_id", "id");

-- CreateIndex
CREATE INDEX "shift_assignments_organization_id_employee_id_effective_fro_idx" ON "shift_assignments"("organization_id", "employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "shift_assignments_organization_id_shift_id_idx" ON "shift_assignments"("organization_id", "shift_id");

-- CreateIndex
CREATE INDEX "roster_entries_organization_id_date_idx" ON "roster_entries"("organization_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "roster_entries_employee_id_date_key" ON "roster_entries"("employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_punches_organization_id_employee_id_punched_at_idx" ON "attendance_punches"("organization_id", "employee_id", "punched_at");

-- CreateIndex
CREATE INDEX "attendance_punches_organization_id_punched_at_idx" ON "attendance_punches"("organization_id", "punched_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_punches_employee_id_punched_at_direction_key" ON "attendance_punches"("employee_id", "punched_at", "direction");

-- CreateIndex
CREATE INDEX "attendance_regularizations_organization_id_employee_id_date_idx" ON "attendance_regularizations"("organization_id", "employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_regularizations_organization_id_status_idx" ON "attendance_regularizations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_organization_id_code_key" ON "leave_types"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_organization_id_id_key" ON "leave_types"("organization_id", "id");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_employee_id_start_date_idx" ON "leave_requests"("organization_id", "employee_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_status_idx" ON "leave_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_approver_employee_id_status_idx" ON "leave_requests"("organization_id", "approver_employee_id", "status");

-- CreateIndex
CREATE INDEX "leave_ledger_entries_organization_id_employee_id_leave_type_idx" ON "leave_ledger_entries"("organization_id", "employee_id", "leave_type_id", "year");

-- AddForeignKey
ALTER TABLE "time_settings" ADD CONSTRAINT "time_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_organization_id_shift_id_fkey" FOREIGN KEY ("organization_id", "shift_id") REFERENCES "shifts"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_regularizations" ADD CONSTRAINT "attendance_regularizations_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organization_id_leave_type_id_fkey" FOREIGN KEY ("organization_id", "leave_type_id") REFERENCES "leave_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approver_employee_id_fkey" FOREIGN KEY ("approver_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_organization_id_leave_type_id_fkey" FOREIGN KEY ("organization_id", "leave_type_id") REFERENCES "leave_types"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written integrity rules (Phase 05 — shifts, attendance and leave)
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- CHECK constraints
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "time_settings"
  ADD CONSTRAINT "time_settings_month_chk" CHECK ("leave_year_start_month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "time_settings_rotation_chk" CHECK ("qr_rotation_seconds" BETWEEN 15 AND 300);

ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "shifts_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "shifts_times_chk" CHECK ("start_minutes" BETWEEN 0 AND 1439 AND "end_minutes" BETWEEN 0 AND 1439 AND "start_minutes" <> "end_minutes"),
  ADD CONSTRAINT "shifts_minutes_chk" CHECK (
    "break_minutes" >= 0 AND "grace_in_minutes" >= 0 AND "grace_out_minutes" >= 0
    AND "half_day_minutes" >= 0 AND "half_day_minutes" <= "full_day_minutes"
    AND ("overtime_after_minutes" IS NULL OR "overtime_after_minutes" >= 0)
    AND "window_before_minutes" BETWEEN 0 AND 720 AND "window_after_minutes" BETWEEN 0 AND 720);
CREATE UNIQUE INDEX "shifts_one_default_key" ON "shifts" ("organization_id") WHERE "is_default";

ALTER TABLE "shift_assignments"
  ADD CONSTRAINT "shift_assignments_period_chk" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  ADD CONSTRAINT "shift_assignments_no_overlap" EXCLUDE USING gist (
    "employee_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&);

ALTER TABLE "attendance_punches"
  ADD CONSTRAINT "attendance_punches_coordinates_chk" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))),
  ADD CONSTRAINT "attendance_punches_manual_note_chk" CHECK ("source" <> 'MANUAL' OR "note" IS NOT NULL);

ALTER TABLE "attendance_regularizations"
  ADD CONSTRAINT "attendance_regularizations_times_chk" CHECK (
    "requested_out" > "requested_in" AND "requested_out" - "requested_in" <= interval '24 hours'),
  ADD CONSTRAINT "attendance_regularizations_reason_chk" CHECK (length(btrim("reason")) > 0),
  -- A decision is timestamped; cancelled requests keep the time they were approved, if any.
  ADD CONSTRAINT "attendance_regularizations_decision_chk" CHECK (
    "status" NOT IN ('APPROVED', 'REJECTED') OR "decided_at" IS NOT NULL);
-- One open request per employee and day.
CREATE UNIQUE INDEX "attendance_regularizations_one_pending_key"
  ON "attendance_regularizations" ("employee_id", "date") WHERE "status" = 'PENDING';

ALTER TABLE "leave_types"
  ADD CONSTRAINT "leave_types_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  ADD CONSTRAINT "leave_types_name_chk" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "leave_types_quota_chk" CHECK (
    "annual_quota" >= 0 AND ("carry_forward_max" IS NULL OR "carry_forward_max" >= 0)
    AND ("max_consecutive_days" IS NULL OR "max_consecutive_days" > 0)
    AND "min_notice_days" BETWEEN 0 AND 365);

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_period_chk" CHECK ("end_date" >= "start_date"),
  ADD CONSTRAINT "leave_requests_days_chk" CHECK ("days" >= 0 AND ("days" * 2) = trunc("days" * 2)),
  ADD CONSTRAINT "leave_requests_decision_chk" CHECK (
    "status" NOT IN ('APPROVED', 'REJECTED') OR "decided_at" IS NOT NULL);

ALTER TABLE "leave_ledger_entries"
  ADD CONSTRAINT "leave_ledger_period_chk" CHECK ("period" BETWEEN 0 AND 12),
  ADD CONSTRAINT "leave_ledger_sign_chk" CHECK (
    CASE "entry_type"
      WHEN 'ACCRUAL' THEN "days" >= 0
      WHEN 'CARRY_FORWARD' THEN "days" >= 0
      WHEN 'USAGE' THEN "days" <= 0
      WHEN 'LAPSE' THEN "days" <= 0
      WHEN 'REVERSAL' THEN "days" >= 0
      ELSE true
    END),
  ADD CONSTRAINT "leave_ledger_request_chk" CHECK (
    ("entry_type" IN ('USAGE', 'REVERSAL')) = ("leave_request_id" IS NOT NULL));
-- Idempotency: accruals per period, one carry-forward / lapse per year, one usage/reversal per request.
CREATE UNIQUE INDEX "leave_ledger_accrual_key" ON "leave_ledger_entries" ("employee_id", "leave_type_id", "year", "period")
  WHERE "entry_type" = 'ACCRUAL';
CREATE UNIQUE INDEX "leave_ledger_rollover_key" ON "leave_ledger_entries" ("employee_id", "leave_type_id", "year", "entry_type")
  WHERE "entry_type" IN ('CARRY_FORWARD', 'LAPSE');
CREATE UNIQUE INDEX "leave_ledger_request_key" ON "leave_ledger_entries" ("leave_request_id", "entry_type")
  WHERE "leave_request_id" IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER "roster_entries_same_tenant" BEFORE INSERT OR UPDATE ON "roster_entries"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('shift_id', 'shifts');
CREATE TRIGGER "attendance_punches_same_tenant" BEFORE INSERT OR UPDATE ON "attendance_punches"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('branch_id', 'branches');
CREATE TRIGGER "leave_requests_same_tenant" BEFORE INSERT OR UPDATE ON "leave_requests"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('approver_employee_id', 'employees');
CREATE TRIGGER "leave_ledger_same_tenant" BEFORE INSERT OR UPDATE ON "leave_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('leave_request_id', 'leave_requests');

-- Punches and the leave ledger are append-only: corrections are regularizations / new entries.
CREATE TRIGGER "attendance_punches_append_only" BEFORE UPDATE OR DELETE ON "attendance_punches"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "attendance_punches_no_truncate" BEFORE TRUNCATE ON "attendance_punches"
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "leave_ledger_append_only" BEFORE UPDATE OR DELETE ON "leave_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
CREATE TRIGGER "leave_ledger_no_truncate" BEFORE TRUNCATE ON "leave_ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER "time_settings_set_updated_at" BEFORE UPDATE ON "time_settings" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "shifts_set_updated_at" BEFORE UPDATE ON "shifts" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "roster_entries_set_updated_at" BEFORE UPDATE ON "roster_entries" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "attendance_regularizations_set_updated_at" BEFORE UPDATE ON "attendance_regularizations" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "leave_types_set_updated_at" BEFORE UPDATE ON "leave_types" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER "leave_requests_set_updated_at" BEFORE UPDATE ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'time_settings', 'shifts', 'shift_assignments', 'roster_entries', 'attendance_punches',
    'attendance_regularizations', 'leave_types', 'leave_requests', 'leave_ledger_entries'
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
    REVOKE UPDATE, DELETE, TRUNCATE ON "attendance_punches", "leave_ledger_entries" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "leave_requests", "attendance_regularizations" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('shifts.shift.read',          'shifts',     'View shifts, assignments and rosters'),
  ('shifts.shift.manage',        'shifts',     'Manage shifts, assignments and rosters'),
  ('attendance.self.use',        'attendance', 'Clock in/out, view own attendance, request regularizations'),
  ('attendance.record.read',     'attendance', 'View attendance of employees in scope'),
  ('attendance.record.manage',   'attendance', 'Record manual punches and decide regularizations in scope'),
  ('attendance.punch.import',    'attendance', 'Import punches from attendance devices'),
  ('attendance.kiosk.operate',   'attendance', 'Run the QR clock-in kiosk for a branch'),
  ('attendance.settings.manage', 'attendance', 'Configure attendance and leave-year settings'),
  ('leave.self.use',             'leave',      'Apply for leave and view own balances'),
  ('leave.type.manage',          'leave',      'Configure leave types and policies'),
  ('leave.request.read',         'leave',      'View leave of employees in scope'),
  ('leave.request.approve',      'leave',      'Approve or reject leave in scope'),
  ('leave.balance.adjust',       'leave',      'Adjust leave balances in scope');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
JOIN (
  SELECT role_key, key FROM (VALUES ('owner'), ('admin'), ('hr_admin')) AS roles(role_key)
  CROSS JOIN (VALUES
    ('shifts.shift.read'), ('shifts.shift.manage'), ('attendance.self.use'),
    ('attendance.record.read'), ('attendance.record.manage'), ('attendance.punch.import'),
    ('attendance.kiosk.operate'), ('attendance.settings.manage'), ('leave.self.use'),
    ('leave.type.manage'), ('leave.request.read'), ('leave.request.approve'),
    ('leave.balance.adjust')) AS perms(key)
  UNION ALL
  SELECT role_key, key FROM (VALUES ('finance'), ('manager')) AS roles(role_key)
  CROSS JOIN (VALUES
    ('shifts.shift.read'), ('attendance.self.use'), ('attendance.record.read'),
    ('leave.self.use'), ('leave.request.read')) AS perms(key)
  UNION ALL
  SELECT * FROM (VALUES ('employee', 'attendance.self.use'), ('employee', 'leave.self.use')) AS extra(role_key, key)
) AS p ON p.role_key = r."key"
WHERE r."is_system";
