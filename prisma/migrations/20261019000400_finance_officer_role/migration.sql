-- Generated offline with `prisma migrate diff --from-schema <4e1b2d8 schema> --to-schema prisma/schema.prisma`.
-- Finance Officer / Accountant (owner decision 2026-10-19, A140). ADDITIVE ONLY: one new enum value.
-- It is first USED in the next migration (it must be committed first).
-- AlterEnum
ALTER TYPE "TenantRole" ADD VALUE 'FINANCE_OFFICER';
