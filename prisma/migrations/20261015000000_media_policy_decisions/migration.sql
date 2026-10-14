-- Generated offline with `prisma migrate diff --from-schema <51fec87 schema> --to-schema prisma/schema.prisma`,
-- then hand-edited (DOB column RENAME instead of DROP/ADD). Owner decisions 2026-10-15 (A81–A91).
-- ADDITIVE: new enum values, nullable columns, one new table. No data is dropped or rewritten.
-- Enum values added here are first USED in the next migration (PostgreSQL requires the
-- ADD VALUE to be committed before use).
-- CreateEnum
CREATE TYPE "RecordingEntitlementStatus" AS ENUM ('NOT_ENABLED', 'PENDING', 'ENABLED');

-- AlterEnum
ALTER TYPE "RecordingConsentMethod" ADD VALUE 'SELF_ONLINE';

-- AlterEnum
ALTER TYPE "RecordingStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "RecordingEligibility" ADD VALUE 'DATE_OF_BIRTH_UNVERIFIED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaDeletionStatus" ADD VALUE 'DECLINED';
ALTER TYPE "MediaDeletionStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'DATE_OF_BIRTH_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_DELETION_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'MEDIA_DELETION_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE 'ABANDONED_UPLOAD_CLEANED';
ALTER TYPE "AuditAction" ADD VALUE 'RECORDING_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'RECORDING_RESUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'CORRECTION_CLIP_PROMOTED';
ALTER TYPE "AuditAction" ADD VALUE 'RECORDING_TEACHER_NOTICE_ACKNOWLEDGED';
ALTER TYPE "AuditAction" ADD VALUE 'OPTION_C_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'OPTION_C_ENABLED';

-- AlterEnum
ALTER TYPE "AuditTargetType" ADD VALUE 'RECORDING_ENTITLEMENT';

-- AlterTable
-- Hand-edited: Prisma proposed DROP + ADD for the renamed columns; a RENAME keeps any existing
-- data. Existing DOBs become "entered, not yet verified" (fail-closed, A82).
ALTER TABLE "student_accounts" RENAME COLUMN "date_of_birth_recorded_by_id" TO "date_of_birth_entered_by_id";
ALTER TABLE "student_accounts" RENAME COLUMN "date_of_birth_recorded_at" TO "date_of_birth_entered_at";
ALTER TABLE "student_accounts" ADD COLUMN     "date_of_birth_verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "date_of_birth_verified_by_id" UUID;

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "rejected_at" TIMESTAMPTZ(6),
ADD COLUMN     "rejected_by_id" UUID,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "teacher_notice_acknowledged_at" TIMESTAMPTZ(6),
ADD COLUMN     "teacher_notice_acknowledged_by_id" UUID;

-- AlterTable
ALTER TABLE "recording_segments" ADD COLUMN     "withdrawn_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "media_deletion_requests" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by_id" UUID,
ADD COLUMN     "decline_reason" TEXT,
ADD COLUMN     "declined_at" TIMESTAMPTZ(6),
ADD COLUMN     "declined_by_id" UUID;

-- CreateTable
CREATE TABLE "recording_entitlements" (
    "tenant_id" UUID NOT NULL,
    "status" "RecordingEntitlementStatus" NOT NULL DEFAULT 'NOT_ENABLED',
    "requested_by_id" UUID,
    "requested_at" TIMESTAMPTZ(6),
    "enabled_by_id" UUID,
    "enabled_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_entitlements_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
ALTER TABLE "recording_entitlements" ADD CONSTRAINT "recording_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

