-- Generated offline with `prisma migrate diff --from-schema <phase1 schema> --to-schema prisma/schema.prisma`.
-- NOTE: adds parent_student_links.tenant_id NOT NULL without a default. This is safe only
-- because no database holds parent links yet. Any database that does needs a backfill first.
-- CreateEnum
CREATE TYPE "TenantPermission" AS ENUM ('PARENT_LINK_VERIFY');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AppointmentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClipSourceType" AS ENUM ('DIRECT_CAPTURE', 'EXTRACTED_FROM_RECORDING');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('AWAITING_UPLOAD', 'AWAITING_EXTRACTION', 'FINALIZED', 'FAILED');

-- AlterTable
ALTER TABLE "parent_student_links" ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by_id" UUID;

-- CreateTable
CREATE TABLE "tenant_permission_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "permission" "TenantPermission" NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,

    CONSTRAINT "tenant_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_by_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_id" UUID,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markaz_admin_appointment_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "candidate_profile_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "status" "AppointmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),

    CONSTRAINT "markaz_admin_appointment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "student_profile_id" UUID NOT NULL,
    "teacher_profile_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_audio_clips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correction_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_type" "ClipSourceType" NOT NULL,
    "source_recording_id" UUID,
    "source_start_ms" INTEGER,
    "source_end_ms" INTEGER,
    "status" "ClipStatus" NOT NULL,
    "storage_bucket" TEXT NOT NULL,
    "storage_object_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "byte_size" INTEGER,
    "duration_ms" INTEGER,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(6),

    CONSTRAINT "correction_audio_clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_permission_grants_profile_id_idx" ON "tenant_permission_grants"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_status_idx" ON "invitations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "markaz_admin_appointment_requests_tenant_id_status_idx" ON "markaz_admin_appointment_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "corrections_student_profile_id_idx" ON "corrections"("student_profile_id");

-- CreateIndex
CREATE INDEX "corrections_tenant_id_idx" ON "corrections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "corrections_id_tenant_id_key" ON "corrections"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "correction_audio_clips_storage_object_key_key" ON "correction_audio_clips"("storage_object_key");

-- CreateIndex
CREATE INDEX "correction_audio_clips_correction_id_idx" ON "correction_audio_clips"("correction_id");

-- CreateIndex
CREATE INDEX "parent_student_links_tenant_id_status_idx" ON "parent_student_links"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_permission_grants" ADD CONSTRAINT "tenant_permission_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_permission_grants" ADD CONSTRAINT "tenant_permission_grants_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markaz_admin_appointment_requests" ADD CONSTRAINT "markaz_admin_appointment_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markaz_admin_appointment_requests" ADD CONSTRAINT "markaz_admin_appointment_requests_candidate_profile_id_fkey" FOREIGN KEY ("candidate_profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_student_profile_id_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_accounts"("profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_teacher_profile_id_fkey" FOREIGN KEY ("teacher_profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_audio_clips" ADD CONSTRAINT "correction_audio_clips_correction_id_tenant_id_fkey" FOREIGN KEY ("correction_id", "tenant_id") REFERENCES "corrections"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
