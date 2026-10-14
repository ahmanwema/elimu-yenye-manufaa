-- Generated offline with `prisma migrate diff --from-schema <2026-10-13 schema> --to-schema prisma/schema.prisma`.
-- Recording & correction media foundation (owner decisions 2026-10-14). ADDITIVE ONLY: new
-- enums/tables/nullable columns; no column is dropped, retyped or made NOT NULL on existing rows.
-- The two new foreign keys on the pre-existing correction_audio_clips table are added NOT VALID,
-- so this migration never fails on (or rewrites) existing rows; new and updated rows are checked.
-- CreateEnum
CREATE TYPE "CorrectionAnchorKind" AS ENUM ('LESSON', 'PAGE', 'CHUNK', 'SEGMENT', 'TIMESTAMP');

-- CreateEnum
CREATE TYPE "RecordingConsentMethod" AS ENUM ('GUARDIAN_ONLINE', 'OFFLINE_VERIFIED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RecordingApprovalScope" AS ENUM ('WHOLE', 'SEGMENTS');

-- CreateEnum
CREATE TYPE "RecordingEligibility" AS ENUM ('CONSENTED', 'NO_CONSENT', 'DATE_OF_BIRTH_MISSING', 'AGE_POLICY_UNSET', 'ADULT_CONSENT_UNDECIDED');

-- CreateEnum
CREATE TYPE "MediaDeletionReason" AS ENUM ('REQUESTED', 'CONSENT_WITHDRAWN');

-- CreateEnum
CREATE TYPE "MediaDeletionStatus" AS ENUM ('PENDING', 'APPROVED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('SUPER_ADMIN_MEDIA_READ', 'RECORDING_SUBMITTED', 'RECORDING_APPROVED', 'RECORDING_APPROVAL_REVOKED', 'MEDIA_DELETION_REQUESTED', 'MEDIA_DELETION_APPROVED', 'MEDIA_PURGED', 'CONSENT_GIVEN', 'CONSENT_OFFLINE_VERIFIED', 'CONSENT_WITHDRAWN', 'DATE_OF_BIRTH_RECORDED', 'CORRECTION_CLIP_REPLACED');

-- CreateEnum
CREATE TYPE "AuditTargetType" AS ENUM ('CORRECTION', 'CORRECTION_AUDIO_CLIP', 'RECORDING', 'RECORDING_SEGMENT', 'MEDIA_DELETION_REQUEST', 'RECORDING_CONSENT', 'STUDENT_ACCOUNT');

-- AlterTable
ALTER TABLE "student_accounts" ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "date_of_birth_recorded_at" TIMESTAMPTZ(6),
ADD COLUMN     "date_of_birth_recorded_by_id" UUID;

-- AlterTable
ALTER TABLE "corrections" ADD COLUMN     "annotation" JSONB,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "correction_audio_clips" ADD COLUMN     "archived_at" TIMESTAMPTZ(6),
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "failed_at" TIMESTAMPTZ(6),
ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purge_eligible_at" TIMESTAMPTZ(6),
ADD COLUMN     "purged_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "correction_anchors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correction_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "CorrectionAnchorKind" NOT NULL,
    "ref_id" TEXT,
    "position" JSONB,
    "snapshot" JSONB NOT NULL,
    "source_removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_profile_id" UUID NOT NULL,
    "method" "RecordingConsentMethod" NOT NULL,
    "tenant_id" UUID,
    "guardian_profile_id" UUID,
    "offline_consenter_description" TEXT,
    "evidence_reference" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL,
    "withdrawn_at" TIMESTAMPTZ(6),
    "withdrawn_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "title" TEXT,
    "status" "RecordingStatus" NOT NULL DEFAULT 'DRAFT',
    "notice_shown_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "storage_bucket" TEXT,
    "storage_object_key" TEXT,
    "mime_type" TEXT,
    "byte_size" INTEGER,
    "duration_ms" INTEGER,
    "media_finalized_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by_id" UUID,
    "approval_scope" "RecordingApprovalScope",
    "approved_at" TIMESTAMPTZ(6),
    "approved_by_id" UUID,
    "approval_revoked_at" TIMESTAMPTZ(6),
    "approval_revoked_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "purge_eligible_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recording_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_profile_id" UUID NOT NULL,
    "audio_included" BOOLEAN NOT NULL,
    "eligibility" "RecordingEligibility" NOT NULL,
    "consent_id" UUID,
    "registered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recording_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "approved_at" TIMESTAMPTZ(6) NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "storage_bucket" TEXT,
    "storage_object_key" TEXT,
    "byte_size" INTEGER,
    "media_finalized_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "clip_id" UUID,
    "recording_id" UUID,
    "reason" "MediaDeletionReason" NOT NULL,
    "consent_id" UUID,
    "status" "MediaDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),

    CONSTRAINT "media_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "tenant_id" UUID,
    "action" "AuditAction" NOT NULL,
    "target_type" "AuditTargetType" NOT NULL,
    "target_id" UUID NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "correction_anchors_correction_id_idx" ON "correction_anchors"("correction_id");

-- CreateIndex
CREATE INDEX "correction_anchors_kind_ref_id_idx" ON "correction_anchors"("kind", "ref_id");

-- CreateIndex
CREATE INDEX "recording_consents_student_profile_id_idx" ON "recording_consents"("student_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_storage_object_key_key" ON "recordings"("storage_object_key");

-- CreateIndex
CREATE INDEX "recordings_tenant_id_status_idx" ON "recordings"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_id_tenant_id_key" ON "recordings"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "recording_participants_student_profile_id_idx" ON "recording_participants"("student_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "recording_participants_recording_id_student_profile_id_key" ON "recording_participants"("recording_id", "student_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "recording_segments_storage_object_key_key" ON "recording_segments"("storage_object_key");

-- CreateIndex
CREATE INDEX "recording_segments_recording_id_idx" ON "recording_segments"("recording_id");

-- CreateIndex
CREATE INDEX "media_deletion_requests_tenant_id_status_idx" ON "media_deletion_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_created_at_idx" ON "audit_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_idx" ON "audit_events"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "correction_audio_clips_source_recording_id_idx" ON "correction_audio_clips"("source_recording_id");

-- AddForeignKey
ALTER TABLE "correction_anchors" ADD CONSTRAINT "correction_anchors_correction_id_tenant_id_fkey" FOREIGN KEY ("correction_id", "tenant_id") REFERENCES "corrections"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_audio_clips" ADD CONSTRAINT "correction_audio_clips_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "correction_audio_clips" ADD CONSTRAINT "correction_audio_clips_source_recording_id_fkey" FOREIGN KEY ("source_recording_id") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "recording_consents" ADD CONSTRAINT "recording_consents_student_profile_id_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_accounts"("profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_consents" ADD CONSTRAINT "recording_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_consents" ADD CONSTRAINT "recording_consents_guardian_profile_id_fkey" FOREIGN KEY ("guardian_profile_id") REFERENCES "parent_accounts"("profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_participants" ADD CONSTRAINT "recording_participants_recording_id_tenant_id_fkey" FOREIGN KEY ("recording_id", "tenant_id") REFERENCES "recordings"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_participants" ADD CONSTRAINT "recording_participants_student_profile_id_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_accounts"("profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_participants" ADD CONSTRAINT "recording_participants_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "recording_consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_recording_id_tenant_id_fkey" FOREIGN KEY ("recording_id", "tenant_id") REFERENCES "recordings"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_deletion_requests" ADD CONSTRAINT "media_deletion_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_deletion_requests" ADD CONSTRAINT "media_deletion_requests_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "correction_audio_clips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_deletion_requests" ADD CONSTRAINT "media_deletion_requests_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_deletion_requests" ADD CONSTRAINT "media_deletion_requests_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "recording_consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

