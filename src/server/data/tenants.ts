import type { PrismaClient } from "@/generated/prisma/client";
import { requireTenantPermission, type Actor } from "@/server/authz/policy";

// Tenant data access. Every function authorizes BEFORE querying and scopes the
// query by the authorized tenant id. Prisma bypasses RLS, so these checks are the
// enforcement boundary for server traffic.

type TenantDb = Pick<PrismaClient, "tenant" | "membership">;

export async function getTenant(db: TenantDb, actor: Actor, tenantId: unknown) {
  const id = requireTenantPermission(actor, tenantId, "tenant.read");
  return db.tenant.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
}

export async function listTenantMembers(db: TenantDb, actor: Actor, tenantId: unknown) {
  const id = requireTenantPermission(actor, tenantId, "tenant.members.read");
  return db.membership.findMany({
    where: { tenantId: id },
    select: { id: true, profileId: true, role: true, status: true, createdAt: true, endedAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/** The Markaz the actor currently belongs to, with their role(s) in each. */
export async function listMyTenants(db: TenantDb, actor: Actor) {
  const tenantIds = [...new Set(actor.memberships.filter((m) => m.status === "ACTIVE").map((m) => m.tenantId))];
  if (tenantIds.length === 0) return [];
  const tenants = await db.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  return tenants.map((t) => ({
    ...t,
    roles: actor.memberships.filter((m) => m.tenantId === t.id && m.status === "ACTIVE").map((m) => m.role),
  }));
}
