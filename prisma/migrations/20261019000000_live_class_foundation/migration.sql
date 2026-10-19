-- Generated offline with `prisma migrate diff --from-schema <2c89136 schema> --to-schema prisma/schema.prisma`.
-- Live Class foundation (owner TO-BE approval 2026-10-19, A101-A130). ADDITIVE ONLY: new enums,
-- new enum values, new tables and nullable/defaulted columns. No existing row is rewritten.
-- New AuditAction/AuditTargetType values are first USED by application code after commit.
-- CreateEnum
CREATE TYPE "RecordingParticipantSource" AS ENUM ('LEGACY_MANUAL', 'SESSION_PRESENCE', 'SESSION_LATE_JOIN', 'MANUAL_CORRECTION');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClassTeacherRole" AS ENUM ('PRIMARY', 'CO_TEACHER');

-- CreateEnum
CREATE TYPE "ClassEnrollmentStatus" AS ENUM ('WAITLISTED', 'ACTIVE', 'GRACE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "AccessPaymentStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LiveSessionKind" AS ENUM ('SCHEDULED', 'AD_HOC');

-- CreateEnum
CREATE TYPE "LiveSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LiveSessionEndReason" AS ENUM ('MANUAL', 'SAFETY_CLOSE');

-- CreateEnum
CREATE TYPE "LiveParticipantRole" AS ENUM ('PRIMARY_TEACHER', 'CO_TEACHER', 'SUBSTITUTE_TEACHER', 'MARKAZ_ADMIN', 'STUDENT');

-- CreateEnum
CREATE TYPE "LiveAdmission" AS ENUM ('ADMITTED', 'WAITING_FOR_SLOT');

-- CreateEnum
CREATE TYPE "LiveDeviceMode" AS ENUM ('PRIMARY', 'VIEW_ONLY');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TENANT_TIMEZONE_SET';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_CAPACITY_LIMITS_SET';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_ARCHIVED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_TEACHER_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_TEACHER_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_CAPACITY_OVERRIDE';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_SCHEDULE_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'CLASS_SCHEDULE_ENDED';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_WAITLISTED';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_ADMITTED_FROM_WAITLIST';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_GRACE_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_SUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_REACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_ENDED';
ALTER TYPE "AuditAction" ADD VALUE 'GRACE_EXTENDED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_ACCESS_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_ACCESS_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_ACCESS_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_ENDED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_SAFETY_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_SUBSTITUTE_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_PARTICIPANT_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'MIC_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'MIC_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'WHITEBOARD_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE 'WHITEBOARD_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'ATTENDANCE_ADJUSTED';
ALTER TYPE "AuditAction" ADD VALUE 'RECORDING_SESSION_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'RECORDING_PARTICIPANTS_ADJUSTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditTargetType" ADD VALUE 'TENANT';
ALTER TYPE "AuditTargetType" ADD VALUE 'CLASS';
ALTER TYPE "AuditTargetType" ADD VALUE 'CLASS_ENROLLMENT';
ALTER TYPE "AuditTargetType" ADD VALUE 'PAYMENT_SUBMISSION';
ALTER TYPE "AuditTargetType" ADD VALUE 'LIVE_SESSION';
ALTER TYPE "AuditTargetType" ADD VALUE 'LIVE_SESSION_PARTICIPANT';
ALTER TYPE "AuditTargetType" ADD VALUE 'ATTENDANCE_RECORD';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "class_enrollment_capacity_max" INTEGER,
ADD COLUMN     "class_live_capacity_max" INTEGER,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "live_session_id" UUID;

-- AlterTable
ALTER TABLE "recording_participants" ADD COLUMN     "audio_included_from" TIMESTAMPTZ(6),
ADD COLUMN     "excluded_at" TIMESTAMPTZ(6),
ADD COLUMN     "excluded_by_id" UUID,
ADD COLUMN     "source" "RecordingParticipantSource" NOT NULL DEFAULT 'LEGACY_MANUAL';

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "description" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrollment_capacity" INTEGER,
    "live_capacity" INTEGER,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by_id" UUID,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_teacher_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "role" "ClassTeacherRole" NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by_id" UUID,

    CONSTRAINT "class_teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "valid_from" DATE,
    "valid_until" DATE,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by_id" UUID,

    CONSTRAINT "class_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_profile_id" UUID NOT NULL,
    "status" "ClassEnrollmentStatus" NOT NULL,
    "enrolled_by_id" UUID NOT NULL,
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL,
    "waitlisted_at" TIMESTAMPTZ(6),
    "access_until" TIMESTAMPTZ(6),
    "grace_until" TIMESTAMPTZ(6),
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL,
    "capacity_override_by_id" UUID,
    "capacity_override_at" TIMESTAMPTZ(6),
    "capacity_override_reason" TEXT,
    "ended_at" TIMESTAMPTZ(6),
    "ended_by_id" UUID,

    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grace_extensions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "previous_grace_until" TIMESTAMPTZ(6),
    "grace_until" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grace_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_payment_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_profile_id" UUID NOT NULL,
    "coverage_note" TEXT NOT NULL,
    "evidence_reference" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "status" "AccessPaymentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_by_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,

    CONSTRAINT "access_payment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_payment_submission_enrollments" (
    "submission_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "access_payment_submission_enrollments_pkey" PRIMARY KEY ("submission_id","enrollment_id")
);

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "kind" "LiveSessionKind" NOT NULL,
    "status" "LiveSessionStatus" NOT NULL,
    "schedule_id" UUID,
    "title" TEXT,
    "scheduled_start_at" TIMESTAMPTZ(6) NOT NULL,
    "scheduled_end_at" TIMESTAMPTZ(6) NOT NULL,
    "recording_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actual_start_at" TIMESTAMPTZ(6),
    "started_by_id" UUID,
    "actual_end_at" TIMESTAMPTZ(6),
    "ended_by_id" UUID,
    "end_reason" "LiveSessionEndReason",
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "substitute_profile_id" UUID,
    "substitute_assigned_by_id" UUID,
    "substitute_assigned_at" TIMESTAMPTZ(6),

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_session_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "LiveParticipantRole" NOT NULL,
    "admission" "LiveAdmission",
    "first_joined_at" TIMESTAMPTZ(6) NOT NULL,
    "hand_raised_at" TIMESTAMPTZ(6),
    "mic_granted_at" TIMESTAMPTZ(6),
    "mic_granted_by_id" UUID,
    "whiteboard_granted_at" TIMESTAMPTZ(6),
    "whiteboard_granted_by_id" UUID,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by_id" UUID,

    CONSTRAINT "live_session_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_session_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "mode" "LiveDeviceMode" NOT NULL,
    "connected_at" TIMESTAMPTZ(6) NOT NULL,
    "admitted_at" TIMESTAMPTZ(6),
    "disconnected_at" TIMESTAMPTZ(6),

    CONSTRAINT "live_session_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_profile_id" UUID NOT NULL,
    "computed_status" "AttendanceStatus" NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "present_seconds" INTEGER NOT NULL,
    "session_seconds" INTEGER NOT NULL,
    "first_arrival_at" TIMESTAMPTZ(6),
    "computed_at" TIMESTAMPTZ(6) NOT NULL,
    "adjusted_by_id" UUID,
    "adjusted_at" TIMESTAMPTZ(6),
    "adjustment_reason" TEXT,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "author_profile_id" UUID NOT NULL,
    "author_role" "LiveParticipantRole" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classes_tenant_id_status_idx" ON "classes"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "classes_id_tenant_id_key" ON "classes"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "class_teacher_assignments_class_id_ended_at_idx" ON "class_teacher_assignments"("class_id", "ended_at");

-- CreateIndex
CREATE INDEX "class_teacher_assignments_teacher_profile_id_ended_at_idx" ON "class_teacher_assignments"("teacher_profile_id", "ended_at");

-- CreateIndex
CREATE INDEX "class_schedules_class_id_idx" ON "class_schedules"("class_id");

-- CreateIndex
CREATE INDEX "class_enrollments_class_id_status_idx" ON "class_enrollments"("class_id", "status");

-- CreateIndex
CREATE INDEX "class_enrollments_student_profile_id_status_idx" ON "class_enrollments"("student_profile_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "class_enrollments_id_tenant_id_key" ON "class_enrollments"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "grace_extensions_enrollment_id_idx" ON "grace_extensions"("enrollment_id");

-- CreateIndex
CREATE INDEX "access_payment_submissions_tenant_id_status_idx" ON "access_payment_submissions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "access_payment_submissions_student_profile_id_idx" ON "access_payment_submissions"("student_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_payment_submissions_id_tenant_id_key" ON "access_payment_submissions"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "access_payment_submission_enrollments_enrollment_id_idx" ON "access_payment_submission_enrollments"("enrollment_id");

-- CreateIndex
CREATE INDEX "live_sessions_class_id_scheduled_start_at_idx" ON "live_sessions"("class_id", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "live_sessions_tenant_id_status_scheduled_start_at_idx" ON "live_sessions"("tenant_id", "status", "scheduled_start_at");

-- CreateIndex
CREATE UNIQUE INDEX "live_sessions_id_tenant_id_key" ON "live_sessions"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_sessions_id_class_id_tenant_id_key" ON "live_sessions"("id", "class_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_sessions_schedule_id_scheduled_start_at_key" ON "live_sessions"("schedule_id", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "live_session_participants_profile_id_idx" ON "live_session_participants"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_session_participants_session_id_profile_id_key" ON "live_session_participants"("session_id", "profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "live_session_participants_id_session_id_tenant_id_key" ON "live_session_participants"("id", "session_id", "tenant_id");

-- CreateIndex
CREATE INDEX "live_session_connections_participant_id_idx" ON "live_session_connections"("participant_id");

-- CreateIndex
CREATE INDEX "live_session_connections_session_id_disconnected_at_idx" ON "live_session_connections"("session_id", "disconnected_at");

-- CreateIndex
CREATE INDEX "attendance_records_student_profile_id_idx" ON "attendance_records"("student_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_session_id_student_profile_id_key" ON "attendance_records"("session_id", "student_profile_id");

-- CreateIndex
CREATE INDEX "live_chat_messages_session_id_created_at_idx" ON "live_chat_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "live_chat_messages_class_id_created_at_idx" ON "live_chat_messages"("class_id", "created_at");

-- CreateIndex
CREATE INDEX "recordings_live_session_id_idx" ON "recordings"("live_session_id");

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_live_session_id_tenant_id_fkey" FOREIGN KEY ("live_session_id", "tenant_id") REFERENCES "live_sessions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teacher_assignments" ADD CONSTRAINT "class_teacher_assignments_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "classes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teacher_assignments" ADD CONSTRAINT "class_teacher_assignments_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "classes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "classes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_student_profile_id_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_accounts"("profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grace_extensions" ADD CONSTRAINT "grace_extensions_enrollment_id_tenant_id_fkey" FOREIGN KEY ("enrollment_id", "tenant_id") REFERENCES "class_enrollments"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_payment_submissions" ADD CONSTRAINT "access_payment_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_payment_submissions" ADD CONSTRAINT "access_payment_submissions_student_profile_id_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_accounts"("profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_payment_submission_enrollments" ADD CONSTRAINT "access_payment_submission_enrollments_submission_id_tenant_fkey" FOREIGN KEY ("submission_id", "tenant_id") REFERENCES "access_payment_submissions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_payment_submission_enrollments" ADD CONSTRAINT "access_payment_submission_enrollments_enrollment_id_tenant_fkey" FOREIGN KEY ("enrollment_id", "tenant_id") REFERENCES "class_enrollments"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_class_id_tenant_id_fkey" FOREIGN KEY ("class_id", "tenant_id") REFERENCES "classes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_substitute_profile_id_fkey" FOREIGN KEY ("substitute_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session_participants" ADD CONSTRAINT "live_session_participants_session_id_tenant_id_fkey" FOREIGN KEY ("session_id", "tenant_id") REFERENCES "live_sessions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session_participants" ADD CONSTRAINT "live_session_participants_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session_connections" ADD CONSTRAINT "live_session_connections_participant_id_session_id_tenant__fkey" FOREIGN KEY ("participant_id", "session_id", "tenant_id") REFERENCES "live_session_participants"("id", "session_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_tenant_id_fkey" FOREIGN KEY ("session_id", "tenant_id") REFERENCES "live_sessions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_profile_id_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_accounts"("profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_chat_messages" ADD CONSTRAINT "live_chat_messages_session_id_class_id_tenant_id_fkey" FOREIGN KEY ("session_id", "class_id", "tenant_id") REFERENCES "live_sessions"("id", "class_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_chat_messages" ADD CONSTRAINT "live_chat_messages_author_profile_id_fkey" FOREIGN KEY ("author_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

