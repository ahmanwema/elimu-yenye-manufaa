-- CreateEnum
CREATE TYPE "ParentLinkInitiator" AS ENUM ('PARENT', 'STAFF');

-- CreateEnum
CREATE TYPE "InvitationKind" AS ENUM ('MEMBERSHIP', 'PARENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TenantPermission" ADD VALUE 'PARENT_LINK_CREATE';
ALTER TYPE "TenantPermission" ADD VALUE 'PARENT_LINK_ACTIVATE';
ALTER TYPE "TenantPermission" ADD VALUE 'PARENT_LINK_REVOKE';
ALTER TYPE "TenantPermission" ADD VALUE 'INVITATION_CREATE';

-- AlterTable
ALTER TABLE "parent_student_links" ADD COLUMN     "activated_at" TIMESTAMPTZ(6),
ADD COLUMN     "activated_by_id" UUID,
ADD COLUMN     "initiated_by" "ParentLinkInitiator" NOT NULL DEFAULT 'PARENT',
ADD COLUMN     "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "requested_by_id" UUID,
ADD COLUMN     "revoked_at" TIMESTAMPTZ(6),
ADD COLUMN     "revoked_by_id" UUID;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "kind" "InvitationKind" NOT NULL DEFAULT 'MEMBERSHIP',
ADD COLUMN     "proposed_student_id" UUID,
ALTER COLUMN "role" DROP NOT NULL;

-- CreateTable
CREATE TABLE "parent_link_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "link_id" UUID NOT NULL,
    "from_status" "ParentStudentLinkStatus",
    "to_status" "ParentStudentLinkStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_link_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parent_link_events_link_id_idx" ON "parent_link_events"("link_id");

-- AddForeignKey
ALTER TABLE "parent_link_events" ADD CONSTRAINT "parent_link_events_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "parent_student_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
