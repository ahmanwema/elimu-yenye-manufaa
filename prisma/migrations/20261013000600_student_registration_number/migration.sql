-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "registration_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_registration_number_key" ON "memberships"("tenant_id", "registration_number");
