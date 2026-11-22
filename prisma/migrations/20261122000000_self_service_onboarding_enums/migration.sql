-- Self-service onboarding (owner decisions 2026-11-22). ADDITIVE ONLY: new enum values, no table
-- is touched and no row is changed.
--
-- PostgreSQL refuses to USE an enum value that was added in the same transaction, and Prisma runs
-- each migration in one. The values are therefore added here alone, and are first used by the next
-- migration and at runtime -- the same split the FINANCE_OFFICER role used (20261019000400).

-- Stage 1: creating a Markaz and its first Markaz Admin in one authorized operation.
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_CREATED';

-- Stage 2: shareable join links (one link, many students, shared over WhatsApp or email).
ALTER TYPE "AuditAction" ADD VALUE 'JOIN_LINK_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'JOIN_LINK_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'JOIN_LINK_REDEEMED';
ALTER TYPE "AuditTargetType" ADD VALUE 'JOIN_LINK';
