import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  GRANTABLE_PERMISSION_FROM_DB,
  GRANTABLE_PERMISSION_ROLES,
  type Actor,
  type GrantablePermission,
} from "@/server/authz/policy";

/**
 * Super Admin view: per Markaz, the members eligible for explicit permissions (ACTIVE
 * Markaz Admins and Teachers) and which permissions each currently holds.
 */
export async function listPermissionOverview(db: PrismaClient, actor: Actor) {
  if (!actor.isPlatformAdmin) throw new AuthorizationError();
  const eligibleRoles = [...new Set(Object.values(GRANTABLE_PERMISSION_ROLES).flat())];
  const tenants = await db.tenant.findMany({
    select: {
      id: true,
      name: true,
      memberships: {
        where: { status: "ACTIVE", role: { in: eligibleRoles } },
        select: { role: true, profile: { select: { id: true, displayName: true } } },
      },
      permissionGrants: { where: { revokedAt: null }, select: { id: true, profileId: true, permission: true } },
    },
    orderBy: { name: "asc" },
  });
  return tenants.map((t) => {
    const people = new Map<string, { profileId: string; displayName: string | null; roles: string[] }>();
    for (const m of t.memberships) {
      const entry = people.get(m.profile.id) ?? { profileId: m.profile.id, displayName: m.profile.displayName, roles: [] };
      entry.roles.push(m.role);
      people.set(m.profile.id, entry);
    }
    return {
      id: t.id,
      name: t.name,
      members: [...people.values()].map((p) => ({
        ...p,
        grants: Object.fromEntries(
          t.permissionGrants
            .filter((g) => g.profileId === p.profileId)
            .map((g) => [GRANTABLE_PERMISSION_FROM_DB[g.permission], g.id]),
        ) as Partial<Record<GrantablePermission, string>>,
      })),
    };
  });
}
