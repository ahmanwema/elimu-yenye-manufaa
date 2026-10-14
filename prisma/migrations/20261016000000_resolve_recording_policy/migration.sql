-- Generated offline with `prisma migrate diff --from-schema <905108d schema> --to-schema prisma/schema.prisma`.
-- Owner decisions 2026-10-16 (A92–A98). ADDITIVE ONLY: new enum values and nullable columns.
-- New enum values are first USED in the next migration (they must be committed first).
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'OPTION_C_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'OPTION_C_DECLINED';
ALTER TYPE "AuditAction" ADD VALUE 'OPTION_C_DISABLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RecordingEntitlementStatus" ADD VALUE 'DECLINED';
ALTER TYPE "RecordingEntitlementStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "RecordingEntitlementStatus" ADD VALUE 'DISABLED';

-- AlterTable
ALTER TABLE "recording_entitlements" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by_id" UUID,
ADD COLUMN     "declined_at" TIMESTAMPTZ(6),
ADD COLUMN     "declined_by_id" UUID,
ADD COLUMN     "disabled_at" TIMESTAMPTZ(6),
ADD COLUMN     "disabled_by_id" UUID;

