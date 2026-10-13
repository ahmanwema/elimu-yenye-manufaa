-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('MARKAZ_ADMIN', 'TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "ParentStudentLinkStatus" AS ENUM ('PENDING', 'VERIFIED', 'ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_accounts" (
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_accounts_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "parent_accounts" (
    "profile_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_accounts_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "parent_student_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_profile_id" UUID NOT NULL,
    "student_profile_id" UUID NOT NULL,
    "status" "ParentStudentLinkStatus" NOT NULL DEFAULT 'PENDING',
    "status_changed_by_id" UUID,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_student_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "memberships_profile_id_idx" ON "memberships"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_profile_id_role_key" ON "memberships"("tenant_id", "profile_id", "role");

-- CreateIndex
CREATE INDEX "parent_student_links_student_profile_id_idx" ON "parent_student_links"("student_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_student_links_parent_profile_id_student_profile_id_key" ON "parent_student_links"("parent_profile_id", "student_profile_id");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_accounts" ADD CONSTRAINT "student_accounts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_accounts" ADD CONSTRAINT "parent_accounts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_parent_profile_id_fkey" FOREIGN KEY ("parent_profile_id") REFERENCES "parent_accounts"("profile_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_student_profile_id_fkey" FOREIGN KEY ("student_profile_id") REFERENCES "student_accounts"("profile_id") ON DELETE CASCADE ON UPDATE CASCADE;
