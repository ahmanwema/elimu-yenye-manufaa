-- Generated offline with `prisma migrate diff --from-schema <a3d1655 schema> --to-schema prisma/schema.prisma`.
-- Live Class decision fixes (owner decisions 2026-10-19, A131-A137). ADDITIVE ONLY: a new enum,
-- new enum values, new nullable/defaulted columns; tenants.timezone becomes nullable (no default).
-- New enum values are first USED in the next migration (they must be committed first).
-- CreateEnum
CREATE TYPE "Punctuality" AS ENUM ('ON_TIME', 'LATE');

-- AlterEnum
ALTER TYPE "TenantPermission" ADD VALUE 'PAYMENT_VERIFY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_WAITLIST_ORDER_OVERRIDE';
ALTER TYPE "AuditAction" ADD VALUE 'ENROLLMENT_PENDING_PAYMENT';

-- AlterEnum
ALTER TYPE "ClassEnrollmentStatus" ADD VALUE 'PENDING_PAYMENT';

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "timezone" DROP NOT NULL,
ALTER COLUMN "timezone" DROP DEFAULT;

-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "payment_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "class_enrollments" ADD COLUMN     "queue_override_at" TIMESTAMPTZ(6),
ADD COLUMN     "queue_override_by_id" UUID,
ADD COLUMN     "queue_override_reason" TEXT;

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "computed_punctuality" "Punctuality",
ADD COLUMN     "punctuality" "Punctuality";

