import type { PrismaClient } from "@/generated/prisma/client";
import { grantableFromDb, type Actor, type GrantablePermission } from "./policy";

type ProfileReader = Pick<PrismaClient, "profile">;

/**
 * Builds the Actor for a Supabase Auth user id. Returns null when no profile exists.
 * Deliberately not cached: a revoked membership, grant or parent link must take effect
 * on the very next request.
 */
export async function loadActor(db: ProfileReader, profileId: string): Promise<Actor | null> {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      platformAdmin: { select: { profileId: true } },
      memberships: { select: { tenantId: true, role: true, status: true } },
      parentAccount: { select: { studentLinks: { select: { studentProfileId: true, status: true } } } },
      permissionGrants: { where: { revokedAt: null }, select: { tenantId: true, permission: true } },
    },
  });
  if (!profile) return null;

  return {
    profileId: profile.id,
    isPlatformAdmin: profile.platformAdmin !== null,
    memberships: profile.memberships,
    parentLinks: profile.parentAccount?.studentLinks ?? [],
    // A non-grantable legacy value (PAYMENT_VERIFY, refused by a DB CHECK) is dropped, never mapped.
    permissionGrants: profile.permissionGrants
      .map((g) => ({ tenantId: g.tenantId, permission: grantableFromDb(g.permission) }))
      .filter((g): g is { tenantId: string; permission: GrantablePermission } => g.permission !== null),
  };
}
