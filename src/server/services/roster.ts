import type { PrismaClient } from "@/generated/prisma/client";
import { requireTenantPermission, type Actor } from "@/server/authz/policy";

/**
 * BASIC roster fields (A51). This is the complete list — nothing else about a student
 * is returned by the roster. Detailed data needs canReadStudentDetail() and, for
 * teachers, a current class assignment — see src/server/data/student-detail.ts (A137).
 */
export const BASIC_ROSTER_FIELDS = ["profileId", "displayName"] as const;

export type BasicRosterEntry = { profileId: string; displayName: string | null };

/** ACTIVE students of one Markaz, basic fields only. Teachers and Markaz Admins of that Markaz. */
export async function listStudentRoster(db: PrismaClient, actor: Actor, tenantId: unknown): Promise<BasicRosterEntry[]> {
  const id = requireTenantPermission(actor, tenantId, "tenant.roster.read");
  const rows = await db.membership.findMany({
    where: { tenantId: id, role: "STUDENT", status: "ACTIVE" },
    select: { profileId: true, profile: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ profileId: r.profileId, displayName: r.profile.displayName }));
}
