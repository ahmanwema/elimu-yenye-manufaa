import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  canAssignPermission,
  canRevokePermission,
  GRANTABLE_PERMISSION_DB,
  GRANTABLE_PERMISSION_FROM_DB,
  GRANTABLE_PERMISSIONS,
  hasActiveRole,
  requireTenantPermission,
  type Actor,
  type GrantablePermission,
  type TenantRole,
} from "@/server/authz/policy";
import { DomainError, isUniqueViolation } from "./errors";

// Explicit permission grants (A47, A58, A62). Nobody holds any of them by default.
// Assignment rules live in canAssignPermission():
//   Super Admin → any grantable permission, any Markaz, eligible grantee.
//   Markaz Admin → any of the five, own Markaz, to an ACTIVE Teacher, never self.

const grantSchema = z.object({
  tenantId: z.uuid(),
  profileId: z.uuid(),
  permission: z.enum(GRANTABLE_PERMISSIONS),
});

async function activeRolesOf(db: PrismaClient, tenantId: string, profileId: string): Promise<TenantRole[]> {
  const rows = await db.membership.findMany({ where: { tenantId, profileId, status: "ACTIVE" }, select: { role: true } });
  return rows.map((r) => r.role);
}

export async function grantTenantPermission(db: PrismaClient, actor: Actor, input: unknown) {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, profileId, permission } = parsed.data;
  // Cheap pre-check before any query: only a Super Admin or a Markaz Admin of THIS Markaz
  // can ever assign anything.
  if (!actor.isPlatformAdmin && !hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) throw new AuthorizationError();

  const granteeActiveRoles = await activeRolesOf(db, tenantId, profileId);
  if (!canAssignPermission(actor, { tenantId, permission, granteeProfileId: profileId, granteeActiveRoles })) {
    throw new AuthorizationError();
  }

  try {
    return await db.tenantPermissionGrant.create({
      data: { tenantId, profileId, permission: GRANTABLE_PERMISSION_DB[permission], grantedById: actor.profileId },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

/** Revocation rules live in canRevokePermission(). */
export async function revokeTenantPermission(db: PrismaClient, actor: Actor, grantId: unknown, now = new Date()) {
  if (!z.uuid().safeParse(grantId).success) throw new AuthorizationError();
  const grant = await db.tenantPermissionGrant.findUnique({
    where: { id: grantId as string },
    select: { id: true, tenantId: true, profileId: true },
  });
  if (!grant) throw new AuthorizationError();
  const holderActiveRoles = await activeRolesOf(db, grant.tenantId, grant.profileId);
  if (!canRevokePermission(actor, { tenantId: grant.tenantId, holderProfileId: grant.profileId, holderActiveRoles })) {
    throw new AuthorizationError();
  }

  const { count } = await db.tenantPermissionGrant.updateMany({
    where: { id: grant.id, revokedAt: null },
    data: { revokedAt: now, revokedById: actor.profileId },
  });
  if (count !== 1) throw new DomainError("invalid_state");
}

/** Live grants in one Markaz, for its admins and for platform admins. */
export async function listTenantPermissionGrants(db: PrismaClient, actor: Actor, tenantId: unknown) {
  const id = requireTenantPermission(actor, tenantId, "tenant.members.read");
  const rows = await db.tenantPermissionGrant.findMany({
    where: { tenantId: id, revokedAt: null },
    select: { id: true, permission: true, createdAt: true, profile: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ ...r, permission: GRANTABLE_PERMISSION_FROM_DB[r.permission] }));
}

/**
 * For a Markaz Admin's delegation panel (A62): ACTIVE Teachers of the Markaz (excluding the
 * admin), each with the ids of their live grants by permission.
 */
export async function listTeacherDelegation(db: PrismaClient, actor: Actor, tenantId: unknown) {
  const id = requireTenantPermission(actor, tenantId, "tenant.members.read");
  if (!actor.isPlatformAdmin && !hasActiveRole(actor, id, "MARKAZ_ADMIN")) throw new AuthorizationError();
  const teachers = await db.membership.findMany({
    where: { tenantId: id, role: "TEACHER", status: "ACTIVE", profileId: { not: actor.profileId } },
    select: { profile: { select: { id: true, displayName: true } } },
  });
  const grants = await db.tenantPermissionGrant.findMany({
    where: { tenantId: id, revokedAt: null, profileId: { in: teachers.map((t) => t.profile.id) } },
    select: { id: true, profileId: true, permission: true },
  });
  return teachers.map((t) => ({
    profileId: t.profile.id,
    displayName: t.profile.displayName,
    grants: Object.fromEntries(
      grants.filter((g) => g.profileId === t.profile.id).map((g) => [GRANTABLE_PERMISSION_FROM_DB[g.permission], g.id]),
    ) as Partial<Record<GrantablePermission, string>>,
  }));
}
