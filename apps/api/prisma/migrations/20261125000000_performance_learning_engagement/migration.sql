-- CreateEnum
CREATE TYPE "ReviewCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CALIBRATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewerRole" AS ENUM ('SELF', 'MANAGER', 'PEER', 'UPWARD');

-- CreateEnum
CREATE TYPE "ReviewResponseStatus" AS ENUM ('PENDING', 'SUBMITTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "PromotionRecommendation" AS ENUM ('NONE', 'RECOMMEND', 'STRONGLY_RECOMMEND');

-- CreateEnum
CREATE TYPE "GoalOwnerType" AS ENUM ('EMPLOYEE', 'DEPARTMENT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "GoalKind" AS ENUM ('GOAL', 'OBJECTIVE', 'KEY_RESULT', 'KPI');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PipStatus" AS ENUM ('ACTIVE', 'PASSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CourseFormat" AS ENUM ('ONLINE', 'VIDEO', 'DOCUMENT', 'CLASSROOM', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseModuleType" AS ENUM ('CONTENT', 'QUIZ');

-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('SELF', 'ASSIGNED', 'PATH');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SurveyKind" AS ENUM ('SURVEY', 'PULSE');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RsvpResponse" AS ENUM ('GOING', 'MAYBE', 'NOT_GOING');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'ACCEPTED', 'IMPLEMENTED', 'DECLINED');

-- CreateTable
CREATE TABLE "rating_scales" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "points" JSONB NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rating_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competencies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1000),
    "category" VARCHAR(60),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rating_scale_id" UUID NOT NULL,
    "goals_weight_percent" DECIMAL(5,2) NOT NULL,
    "competencies" JSONB NOT NULL DEFAULT '[]',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "include_self" BOOLEAN NOT NULL,
    "include_manager" BOOLEAN NOT NULL,
    "peer_min" SMALLINT NOT NULL,
    "peer_max" SMALLINT NOT NULL,
    "include_upward" BOOLEAN NOT NULL,
    "anonymity_minimum" SMALLINT NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_cycles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "template_id" UUID NOT NULL,
    "template_snapshot" JSONB,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "self_due_on" DATE,
    "manager_due_on" DATE,
    "audience_company_id" UUID,
    "audience_department_id" UUID,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "launched_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_participants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "manager_employee_id" UUID,
    "computed_score" DECIMAL(6,2),
    "computed_rating" DECIMAL(6,2),
    "final_rating" DECIMAL(6,2),
    "calibration_reason" VARCHAR(1000),
    "calibrated_by_user_id" UUID,
    "calibrated_at" TIMESTAMPTZ(6),
    "promotion" "PromotionRecommendation" NOT NULL DEFAULT 'NONE',
    "promotion_justification" VARCHAR(2000),
    "acknowledged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "reviewer_employee_id" UUID NOT NULL,
    "role" "ReviewerRole" NOT NULL,
    "status" "ReviewResponseStatus" NOT NULL DEFAULT 'PENDING',
    "content" JSONB NOT NULL DEFAULT '{}',
    "nominated_by_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "owner_type" "GoalOwnerType" NOT NULL,
    "employee_id" UUID,
    "department_id" UUID,
    "parent_id" UUID,
    "cycle_id" UUID,
    "kind" "GoalKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "weight" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "measure_start" DECIMAL(18,4),
    "measure_target" DECIMAL(18,4),
    "measure_current" DECIMAL(18,4),
    "unit" VARCHAR(20),
    "progress" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "due_on" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_check_ins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "progress" DECIMAL(5,2) NOT NULL,
    "current" DECIMAL(18,4),
    "note" VARCHAR(1000) NOT NULL,
    "author_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_plans" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "manager_employee_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "objectives" JSONB NOT NULL,
    "status" "PipStatus" NOT NULL DEFAULT 'ACTIVE',
    "outcome_note" VARCHAR(2000),
    "closed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "improvement_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pip_check_ins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "author_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pip_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "format" "CourseFormat" NOT NULL,
    "duration_minutes" INTEGER,
    "pass_percent" SMALLINT NOT NULL DEFAULT 0,
    "certification_validity_months" SMALLINT,
    "skills" VARCHAR(60)[] DEFAULT ARRAY[]::VARCHAR(60)[],
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "CourseModuleType" NOT NULL,
    "content" VARCHAR(20000),
    "url" VARCHAR(2000),
    "questions" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_paths" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(2000),
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "learning_paths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_path_courses" (
    "organization_id" UUID NOT NULL,
    "path_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "learning_path_courses_pkey" PRIMARY KEY ("path_id","course_id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "source" "EnrollmentSource" NOT NULL,
    "path_id" UUID,
    "assigned_by_user_id" UUID,
    "due_on" DATE,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "completed_modules" UUID[] DEFAULT ARRAY[]::UUID[],
    "score_percent" DECIMAL(5,2),
    "completed_at" TIMESTAMPTZ(6),
    "certification_id" UUID,
    "feedback_rating" SMALLINT,
    "feedback_comment" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "score_percent" DECIMAL(5,2) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "kind" "SurveyKind" NOT NULL,
    "anonymous" BOOLEAN NOT NULL,
    "minimum_group_size" SMALLINT NOT NULL,
    "audience_company_id" UUID,
    "audience_department_id" UUID,
    "opens_at" TIMESTAMPTZ(6) NOT NULL,
    "closes_at" TIMESTAMPTZ(6) NOT NULL,
    "questions" JSONB NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_invitations" (
    "organization_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "survey_invitations_pkey" PRIMARY KEY ("survey_id","employee_id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "survey_id" UUID NOT NULL,
    "employee_id" UUID,
    "department_id" UUID,
    "answers" JSONB NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recognition_badges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300),
    "points" INTEGER NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recognition_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recognitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_employee_id" UUID NOT NULL,
    "to_employee_id" UUID NOT NULL,
    "badge_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recognitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "points_cost" INTEGER NOT NULL,
    "stock" INTEGER,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reward_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "points_cost" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(500),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(20000) NOT NULL,
    "audience_company_id" UUID,
    "audience_department_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "requires_acknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "publish_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "organization_id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcement_id","employee_id")
);

-- CreateTable
CREATE TABLE "company_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "location" VARCHAR(300),
    "capacity" INTEGER,
    "audience_company_id" UUID,
    "audience_department_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_rsvps" (
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "response" "RsvpResponse" NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("event_id","employee_id")
);

-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "author_employee_id" UUID,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "category" VARCHAR(60),
    "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "response" VARCHAR(2000),
    "responded_by_user_id" UUID,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_votes" (
    "organization_id" UUID NOT NULL,
    "suggestion_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_votes_pkey" PRIMARY KEY ("suggestion_id","employee_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rating_scales_organization_id_name_key" ON "rating_scales"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rating_scales_organization_id_id_key" ON "rating_scales"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "competencies_organization_id_code_key" ON "competencies"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "competencies_organization_id_id_key" ON "competencies"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "review_templates_organization_id_name_key" ON "review_templates"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "review_templates_organization_id_id_key" ON "review_templates"("organization_id", "id");

-- CreateIndex
CREATE INDEX "review_cycles_organization_id_status_idx" ON "review_cycles"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_cycles_organization_id_id_key" ON "review_cycles"("organization_id", "id");

-- CreateIndex
CREATE INDEX "review_participants_organization_id_manager_employee_id_idx" ON "review_participants"("organization_id", "manager_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_participants_cycle_id_employee_id_key" ON "review_participants"("cycle_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_participants_organization_id_id_key" ON "review_participants"("organization_id", "id");

-- CreateIndex
CREATE INDEX "review_responses_organization_id_reviewer_employee_id_statu_idx" ON "review_responses"("organization_id", "reviewer_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_responses_participant_id_reviewer_employee_id_role_key" ON "review_responses"("participant_id", "reviewer_employee_id", "role");

-- CreateIndex
CREATE INDEX "goals_organization_id_owner_type_employee_id_idx" ON "goals"("organization_id", "owner_type", "employee_id");

-- CreateIndex
CREATE INDEX "goals_organization_id_parent_id_idx" ON "goals"("organization_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "goals_organization_id_id_key" ON "goals"("organization_id", "id");

-- CreateIndex
CREATE INDEX "goal_check_ins_organization_id_goal_id_created_at_idx" ON "goal_check_ins"("organization_id", "goal_id", "created_at");

-- CreateIndex
CREATE INDEX "improvement_plans_organization_id_employee_id_idx" ON "improvement_plans"("organization_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "improvement_plans_organization_id_id_key" ON "improvement_plans"("organization_id", "id");

-- CreateIndex
CREATE INDEX "pip_check_ins_organization_id_plan_id_created_at_idx" ON "pip_check_ins"("organization_id", "plan_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "courses_organization_id_code_key" ON "courses"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_organization_id_id_key" ON "courses"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "course_modules_course_id_sort_order_key" ON "course_modules"("course_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "course_modules_organization_id_id_key" ON "course_modules"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_paths_organization_id_name_key" ON "learning_paths"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "learning_paths_organization_id_id_key" ON "learning_paths"("organization_id", "id");

-- CreateIndex
CREATE INDEX "enrollments_organization_id_employee_id_status_idx" ON "enrollments"("organization_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_organization_id_course_id_idx" ON "enrollments"("organization_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_organization_id_id_key" ON "enrollments"("organization_id", "id");

-- CreateIndex
CREATE INDEX "quiz_attempts_organization_id_enrollment_id_module_id_idx" ON "quiz_attempts"("organization_id", "enrollment_id", "module_id");

-- CreateIndex
CREATE INDEX "surveys_organization_id_status_closes_at_idx" ON "surveys"("organization_id", "status", "closes_at");

-- CreateIndex
CREATE UNIQUE INDEX "surveys_organization_id_id_key" ON "surveys"("organization_id", "id");

-- CreateIndex
CREATE INDEX "survey_invitations_organization_id_employee_id_idx" ON "survey_invitations"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "survey_responses_organization_id_survey_id_idx" ON "survey_responses"("organization_id", "survey_id");

-- CreateIndex
CREATE UNIQUE INDEX "recognition_badges_organization_id_name_key" ON "recognition_badges"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "recognition_badges_organization_id_id_key" ON "recognition_badges"("organization_id", "id");

-- CreateIndex
CREATE INDEX "recognitions_organization_id_to_employee_id_idx" ON "recognitions"("organization_id", "to_employee_id");

-- CreateIndex
CREATE INDEX "recognitions_organization_id_created_at_idx" ON "recognitions"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_organization_id_name_key" ON "rewards"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_organization_id_id_key" ON "rewards"("organization_id", "id");

-- CreateIndex
CREATE INDEX "reward_redemptions_organization_id_employee_id_idx" ON "reward_redemptions"("organization_id", "employee_id");

-- CreateIndex
CREATE INDEX "reward_redemptions_organization_id_status_idx" ON "reward_redemptions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "announcements_organization_id_publish_at_idx" ON "announcements"("organization_id", "publish_at");

-- CreateIndex
CREATE UNIQUE INDEX "announcements_organization_id_id_key" ON "announcements"("organization_id", "id");

-- CreateIndex
CREATE INDEX "company_events_organization_id_starts_at_idx" ON "company_events"("organization_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_events_organization_id_id_key" ON "company_events"("organization_id", "id");

-- CreateIndex
CREATE INDEX "suggestions_organization_id_status_idx" ON "suggestions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suggestions_organization_id_id_key" ON "suggestions"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "rating_scales" ADD CONSTRAINT "rating_scales_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competencies" ADD CONSTRAINT "competencies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_organization_id_rating_scale_id_fkey" FOREIGN KEY ("organization_id", "rating_scale_id") REFERENCES "rating_scales"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_organization_id_template_id_fkey" FOREIGN KEY ("organization_id", "template_id") REFERENCES "review_templates"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_participants" ADD CONSTRAINT "review_participants_organization_id_cycle_id_fkey" FOREIGN KEY ("organization_id", "cycle_id") REFERENCES "review_cycles"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_participants" ADD CONSTRAINT "review_participants_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_organization_id_participant_id_fkey" FOREIGN KEY ("organization_id", "participant_id") REFERENCES "review_participants"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_organization_id_reviewer_employee_id_fkey" FOREIGN KEY ("organization_id", "reviewer_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "review_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_check_ins" ADD CONSTRAINT "goal_check_ins_organization_id_goal_id_fkey" FOREIGN KEY ("organization_id", "goal_id") REFERENCES "goals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_plans" ADD CONSTRAINT "improvement_plans_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pip_check_ins" ADD CONSTRAINT "pip_check_ins_organization_id_plan_id_fkey" FOREIGN KEY ("organization_id", "plan_id") REFERENCES "improvement_plans"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_organization_id_course_id_fkey" FOREIGN KEY ("organization_id", "course_id") REFERENCES "courses"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_path_courses" ADD CONSTRAINT "learning_path_courses_organization_id_path_id_fkey" FOREIGN KEY ("organization_id", "path_id") REFERENCES "learning_paths"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_path_courses" ADD CONSTRAINT "learning_path_courses_organization_id_course_id_fkey" FOREIGN KEY ("organization_id", "course_id") REFERENCES "courses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_organization_id_course_id_fkey" FOREIGN KEY ("organization_id", "course_id") REFERENCES "courses"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_organization_id_enrollment_id_fkey" FOREIGN KEY ("organization_id", "enrollment_id") REFERENCES "enrollments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_organization_id_module_id_fkey" FOREIGN KEY ("organization_id", "module_id") REFERENCES "course_modules"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_invitations" ADD CONSTRAINT "survey_invitations_organization_id_survey_id_fkey" FOREIGN KEY ("organization_id", "survey_id") REFERENCES "surveys"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_invitations" ADD CONSTRAINT "survey_invitations_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_organization_id_survey_id_fkey" FOREIGN KEY ("organization_id", "survey_id") REFERENCES "surveys"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_badges" ADD CONSTRAINT "recognition_badges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_organization_id_badge_id_fkey" FOREIGN KEY ("organization_id", "badge_id") REFERENCES "recognition_badges"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_organization_id_from_employee_id_fkey" FOREIGN KEY ("organization_id", "from_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognitions" ADD CONSTRAINT "recognitions_organization_id_to_employee_id_fkey" FOREIGN KEY ("organization_id", "to_employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_organization_id_reward_id_fkey" FOREIGN KEY ("organization_id", "reward_id") REFERENCES "rewards"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_organization_id_announcement_id_fkey" FOREIGN KEY ("organization_id", "announcement_id") REFERENCES "announcements"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_events" ADD CONSTRAINT "company_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_organization_id_event_id_fkey" FOREIGN KEY ("organization_id", "event_id") REFERENCES "company_events"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_organization_id_employee_id_fkey" FOREIGN KEY ("organization_id", "employee_id") REFERENCES "employees"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_votes" ADD CONSTRAINT "suggestion_votes_organization_id_suggestion_id_fkey" FOREIGN KEY ("organization_id", "suggestion_id") REFERENCES "suggestions"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================================
-- Hand-written integrity rules (ADR-016). No scale, weight, pass mark or minimum is stored here.
-- =============================================================================================

ALTER TABLE "rating_scales"
  ADD CONSTRAINT "rating_scales_points_chk" CHECK (jsonb_typeof("points") = 'array' AND jsonb_array_length("points") >= 2);

ALTER TABLE "competencies"
  ADD CONSTRAINT "competencies_code_chk" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$');

ALTER TABLE "review_templates"
  ADD CONSTRAINT "review_templates_chk" CHECK (
    "goals_weight_percent" BETWEEN 0 AND 100 AND "peer_min" >= 0 AND "peer_min" <= "peer_max"
    AND "anonymity_minimum" >= 1
    AND jsonb_typeof("competencies") = 'array' AND jsonb_typeof("questions") = 'array'
    AND ("include_self" OR "include_manager" OR "peer_max" > 0 OR "include_upward"));

ALTER TABLE "review_cycles"
  ADD CONSTRAINT "review_cycles_chk" CHECK (
    "period_end" >= "period_start"
    AND ("status" = 'DRAFT' OR ("launched_at" IS NOT NULL AND "template_snapshot" IS NOT NULL))
    AND ("status" <> 'CLOSED' OR "closed_at" IS NOT NULL));

ALTER TABLE "review_participants"
  ADD CONSTRAINT "review_participants_chk" CHECK (
    ("promotion" = 'NONE' OR "promotion_justification" IS NOT NULL)
    AND ("calibrated_at" IS NULL OR "calibration_reason" IS NOT NULL)
    AND "manager_employee_id" IS DISTINCT FROM "employee_id");

ALTER TABLE "review_responses"
  ADD CONSTRAINT "review_responses_chk" CHECK (
    ("status" = 'SUBMITTED') = ("submitted_at" IS NOT NULL) AND jsonb_typeof("content") = 'object');

ALTER TABLE "goals"
  ADD CONSTRAINT "goals_owner_chk" CHECK (
    CASE "owner_type"
      WHEN 'EMPLOYEE' THEN "employee_id" IS NOT NULL AND "department_id" IS NULL
      WHEN 'DEPARTMENT' THEN "department_id" IS NOT NULL AND "employee_id" IS NULL
      ELSE "employee_id" IS NULL AND "department_id" IS NULL
    END),
  ADD CONSTRAINT "goals_measure_chk" CHECK (
    ("kind" NOT IN ('KPI', 'KEY_RESULT') OR ("measure_start" IS NOT NULL AND "measure_target" IS NOT NULL AND "measure_current" IS NOT NULL))
    AND ("kind" <> 'KEY_RESULT' OR "parent_id" IS NOT NULL)),
  ADD CONSTRAINT "goals_values_chk" CHECK ("progress" BETWEEN 0 AND 100 AND "weight" >= 0 AND "parent_id" IS DISTINCT FROM "id"),
  ADD CONSTRAINT "goals_title_chk" CHECK (length(btrim("title")) > 0);

ALTER TABLE "goal_check_ins"
  ADD CONSTRAINT "goal_check_ins_progress_chk" CHECK ("progress" BETWEEN 0 AND 100);

ALTER TABLE "improvement_plans"
  ADD CONSTRAINT "improvement_plans_chk" CHECK (
    "end_date" > "start_date"
    AND jsonb_typeof("objectives") = 'array' AND jsonb_array_length("objectives") >= 1
    AND (("status" = 'ACTIVE') = ("closed_at" IS NULL))
    AND "manager_employee_id" IS DISTINCT FROM "employee_id");

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_chk" CHECK (
    "code" ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$' AND "pass_percent" BETWEEN 0 AND 100
    AND ("certification_validity_months" IS NULL OR "certification_validity_months" > 0)
    AND ("duration_minutes" IS NULL OR "duration_minutes" > 0));

ALTER TABLE "course_modules"
  ADD CONSTRAINT "course_modules_chk" CHECK (
    jsonb_typeof("questions") = 'array'
    AND ("type" <> 'QUIZ' OR jsonb_array_length("questions") >= 1)
    AND ("type" <> 'CONTENT' OR "content" IS NOT NULL OR "url" IS NOT NULL));

ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_chk" CHECK (
    ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
    AND ("score_percent" IS NULL OR "score_percent" BETWEEN 0 AND 100)
    AND ("feedback_rating" IS NULL OR "feedback_rating" BETWEEN 1 AND 5));
CREATE UNIQUE INDEX "enrollments_one_active_key" ON "enrollments" ("course_id", "employee_id") WHERE "status" <> 'WITHDRAWN';

ALTER TABLE "surveys"
  ADD CONSTRAINT "surveys_chk" CHECK (
    "minimum_group_size" >= 1 AND "closes_at" > "opens_at"
    AND jsonb_typeof("questions") = 'array' AND jsonb_array_length("questions") >= 1);

-- Anonymous surveys never store who answered; named surveys always do.
CREATE OR REPLACE FUNCTION app.survey_response_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_anonymous boolean;
BEGIN
  SELECT anonymous INTO v_anonymous FROM public.surveys WHERE id = NEW.survey_id;
  IF v_anonymous AND NEW.employee_id IS NOT NULL THEN
    RAISE EXCEPTION 'Responses to an anonymous survey cannot identify the respondent' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_anonymous AND NEW.employee_id IS NULL THEN
    RAISE EXCEPTION 'Responses to a named survey must identify the respondent' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "survey_responses_guard" BEFORE INSERT ON "survey_responses"
  FOR EACH ROW EXECUTE FUNCTION app.survey_response_guard();
ALTER TABLE "survey_responses"
  ADD CONSTRAINT "survey_responses_answers_chk" CHECK (jsonb_typeof("answers") = 'object');

ALTER TABLE "recognition_badges" ADD CONSTRAINT "recognition_badges_points_chk" CHECK ("points" >= 0);
ALTER TABLE "recognitions"
  ADD CONSTRAINT "recognitions_chk" CHECK ("from_employee_id" <> "to_employee_id" AND "points" >= 0 AND length(btrim("message")) > 0);
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_chk" CHECK ("points_cost" > 0 AND ("stock" IS NULL OR "stock" >= 0));
ALTER TABLE "reward_redemptions"
  ADD CONSTRAINT "reward_redemptions_chk" CHECK ("points_cost" > 0 AND (("status" = 'PENDING') = ("decided_at" IS NULL)));

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_chk" CHECK ("expires_at" IS NULL OR "expires_at" > "publish_at");
ALTER TABLE "company_events" ADD CONSTRAINT "company_events_chk" CHECK ("ends_at" > "starts_at" AND ("capacity" IS NULL OR "capacity" > 0));
ALTER TABLE "suggestions"
  ADD CONSTRAINT "suggestions_author_chk" CHECK ("anonymous" = ("author_employee_id" IS NULL)),
  ADD CONSTRAINT "suggestions_response_chk" CHECK ("status" IN ('NEW', 'UNDER_REVIEW') OR "response" IS NOT NULL);

-- Optional references stay inside the tenant.
CREATE TRIGGER "review_cycles_same_tenant" BEFORE INSERT OR UPDATE ON "review_cycles"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('audience_company_id', 'companies', 'audience_department_id', 'departments');
CREATE TRIGGER "review_participants_same_tenant" BEFORE INSERT OR UPDATE ON "review_participants"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('manager_employee_id', 'employees');
CREATE TRIGGER "goals_same_tenant" BEFORE INSERT OR UPDATE ON "goals"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant(
    'employee_id', 'employees', 'department_id', 'departments', 'parent_id', 'goals', 'cycle_id', 'review_cycles');
CREATE TRIGGER "improvement_plans_same_tenant" BEFORE INSERT OR UPDATE ON "improvement_plans"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('manager_employee_id', 'employees');
CREATE TRIGGER "enrollments_same_tenant" BEFORE INSERT OR UPDATE ON "enrollments"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('path_id', 'learning_paths', 'certification_id', 'employee_certifications');
CREATE TRIGGER "surveys_same_tenant" BEFORE INSERT OR UPDATE ON "surveys"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('audience_company_id', 'companies', 'audience_department_id', 'departments');
CREATE TRIGGER "survey_responses_same_tenant" BEFORE INSERT ON "survey_responses"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('department_id', 'departments');
CREATE TRIGGER "announcements_same_tenant" BEFORE INSERT OR UPDATE ON "announcements"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('audience_company_id', 'companies', 'audience_department_id', 'departments');
CREATE TRIGGER "company_events_same_tenant" BEFORE INSERT OR UPDATE ON "company_events"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('audience_company_id', 'companies', 'audience_department_id', 'departments');
CREATE TRIGGER "suggestions_same_tenant" BEFORE INSERT OR UPDATE ON "suggestions"
  FOR EACH ROW EXECUTE FUNCTION app.enforce_same_tenant('author_employee_id', 'employees');

-- Histories and anonymous answers are append-only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['goal_check_ins', 'pip_check_ins', 'quiz_attempts', 'survey_responses', 'recognitions'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation()', t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'rating_scales', 'competencies', 'review_templates', 'review_cycles', 'review_participants',
    'review_responses', 'goals', 'improvement_plans', 'courses', 'learning_paths', 'enrollments',
    'surveys', 'recognition_badges', 'rewards', 'announcements', 'company_events', 'event_rsvps',
    'suggestions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t || '_set_updated_at', t);
  END LOOP;
END
$$;

-- A closed review cycle and its results never change.
CREATE OR REPLACE FUNCTION app.review_cycle_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'A closed review cycle cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "review_cycles_guard" BEFORE UPDATE ON "review_cycles"
  FOR EACH ROW EXECUTE FUNCTION app.review_cycle_guard();

-- ---------------------------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rating_scales', 'competencies', 'review_templates', 'review_cycles', 'review_participants',
    'review_responses', 'goals', 'goal_check_ins', 'improvement_plans', 'pip_check_ins', 'courses',
    'course_modules', 'learning_paths', 'learning_path_courses', 'enrollments', 'quiz_attempts',
    'surveys', 'survey_invitations', 'survey_responses', 'recognition_badges', 'recognitions',
    'rewards', 'reward_redemptions', 'announcements', 'announcement_reads', 'company_events',
    'event_rsvps', 'suggestions', 'suggestion_votes'
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
    REVOKE UPDATE, DELETE, TRUNCATE ON "goal_check_ins", "pip_check_ins", "quiz_attempts", "survey_responses", "recognitions" FROM hrm_app;
    REVOKE DELETE, TRUNCATE ON "review_cycles", "review_participants", "improvement_plans", "surveys", "enrollments", "reward_redemptions" FROM hrm_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO hrm_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissions (mirror @hrm/shared-types) and grants for EXISTING organizations' system roles.
-- ---------------------------------------------------------------------------------------------
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('performance.config.manage',     'performance', 'Rating scales, competencies and review templates'),
  ('performance.cycle.manage',      'performance', 'Review cycles, all reviews, calibration and results'),
  ('performance.goal.manage',       'performance', 'Organization and department goals and all employees'' goals'),
  ('performance.pip.manage',        'performance', 'Performance improvement plans'),
  ('learning.course.manage',        'learning',    'Courses, modules, quizzes and learning paths'),
  ('learning.assignment.manage',    'learning',    'Assign learning, all enrollments, skill matrix and certifications'),
  ('engagement.survey.manage',      'engagement',  'Surveys, pulses and their results'),
  ('engagement.content.manage',     'engagement',  'Announcements, events, badges, rewards and redemptions'),
  ('engagement.suggestion.manage',  'engagement',  'Review and respond to suggestions');

INSERT INTO "role_permissions" ("organization_id", "role_id", "permission_key")
SELECT r."organization_id", r."id", p.key
FROM "roles" r
CROSS JOIN (VALUES
  ('performance.config.manage'), ('performance.cycle.manage'), ('performance.goal.manage'),
  ('performance.pip.manage'), ('learning.course.manage'), ('learning.assignment.manage'),
  ('engagement.survey.manage'), ('engagement.content.manage'), ('engagement.suggestion.manage')) AS p(key)
WHERE r."is_system" AND r."key" IN ('owner', 'admin', 'hr_admin');
