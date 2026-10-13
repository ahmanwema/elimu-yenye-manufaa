import type { Actor } from "@/server/authz/policy";
import { GRANTS, LINKS, MEMBERSHIPS, U } from "./fixture";

/** Builds the Actor the server would load for a fixture user. */
export function actorFor(profileId: string): Actor {
  return {
    profileId,
    isPlatformAdmin: profileId === U.superAdmin,
    memberships: MEMBERSHIPS.filter((m) => m.profileId === profileId).map(({ tenantId, role, status }) => ({
      tenantId,
      role,
      status,
    })),
    parentLinks: LINKS.filter((l) => l.parent === profileId).map((l) => ({
      studentProfileId: l.student,
      status: l.status,
    })),
    permissionGrants: GRANTS.filter((g) => g.profileId === profileId && !g.revoked).map((g) => ({
      tenantId: g.tenantId,
      permission: "parent_link.verify" as const,
    })),
  };
}

/** Tenant ids in which a profile holds an ACTIVE membership (as the data layer computes it). */
export function activeTenantsOf(profileId: string): string[] {
  return MEMBERSHIPS.filter((m) => m.profileId === profileId && m.status === "ACTIVE").map((m) => m.tenantId);
}
