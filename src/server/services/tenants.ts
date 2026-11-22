import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, canCreateTenant, type Actor } from "@/server/authz/policy";
import { recordAudit } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";

// Creating a Markaz (owner decision 2026-11-22, Stage 1 of docs/features/self-service-onboarding.md).
//
// Before this, the application had NO path to create a tenant: the three bootstrap rows (the
// tenant, its first Markaz Admin membership, the platform-admin row) had to be inserted by hand,
// which is why a brand-new Markaz could never be opened through the product. Invite-first
// onboarding (A45) cannot start one either — a new Markaz has nobody to issue the first
// invitation — so the first Markaz Admin is established here, at creation time.
//
// This service is pure database work and performs its own authorization. Creating the Supabase
// auth account for the first admin happens in the action layer (src/server/actions/tenants.ts)
// before this is called, exactly as the invitation flow does; the profile row is created by the
// auth.users trigger. That split is what keeps this testable on PGlite with no Supabase.

/**
 * Markaz code, used in URLs and as the code a student quotes when self-requesting a parent link
 * (A64). Lower case, digits and single hyphens; never leading, trailing or doubled hyphens.
 */
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * The first Markaz Admin's address. Exported so the action can validate it BEFORE asking
 * Supabase to prepare an account — a helper, not an endpoint (CLAUDE.md rule 8).
 */
export const tenantAdminEmailSchema = z.string().trim().toLowerCase().pipe(z.email());

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
  /** The profile that becomes the first Markaz Admin. Its auth account must already exist. */
  adminProfileId: z.uuid(),
  /**
   * Also give that person an ACTIVE TEACHER membership.
   *
   * A one-person Madrasa needs it: the owner both administers and teaches. It is OFF by default
   * and must be asked for, because it has a consequence worth seeing — `canVerifyPayment` (A140)
   * admits a Markaz Admin by role, so one person holding both roles verifies the payments of the
   * students they teach, which is the separation A140 created the Finance Officer to provide.
   */
  alsoTeacher: z.boolean().optional().default(false),
});

export type CreateTenantInput = z.input<typeof createSchema>;

/**
 * Creates a Markaz and its first ACTIVE Markaz Admin in one transaction, with an audit event.
 * Super Admin only. Returns the new tenant.
 */
export async function createTenant(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { name, slug, adminProfileId, alsoTeacher } = parsed.data;
  if (!canCreateTenant(actor)) throw new AuthorizationError();

  const admin = await db.profile.findUnique({ where: { id: adminProfileId }, select: { id: true } });
  if (!admin) throw new DomainError("not_found");

  try {
    return await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name, slug, createdAt: now, updatedAt: now },
        select: { id: true, name: true, slug: true },
      });
      const roles = alsoTeacher ? (["MARKAZ_ADMIN", "TEACHER"] as const) : (["MARKAZ_ADMIN"] as const);
      for (const role of roles) {
        await tx.membership.create({
          data: { tenantId: tenant.id, profileId: adminProfileId, role, status: "ACTIVE", createdAt: now },
        });
      }
      await recordAudit(tx, {
        actorId: actor.profileId,
        tenantId: tenant.id,
        action: "TENANT_CREATED",
        targetType: "TENANT",
        targetId: tenant.id,
        metadata: { slug: tenant.slug, firstAdminId: adminProfileId, alsoTeacher },
        now,
      });
      return tenant;
    });
  } catch (error) {
    // A duplicate slug is the expected collision; a duplicate membership cannot happen here.
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

/** Every Markaz, newest first. Super Admin only — this is a platform-wide listing. */
export async function listTenants(db: PrismaClient, actor: Actor) {
  if (!actor.isPlatformAdmin) throw new AuthorizationError();
  return db.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, slug: true, createdAt: true },
  });
}
