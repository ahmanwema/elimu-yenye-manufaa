import { describe, expect, it } from "vitest";
import {
  canAssignPermission,
  GRANTABLE_PERMISSIONS,
  hasGrantedPermission,
  invitableTargets,
  type Actor,
  type GrantablePermission,
} from "@/server/authz/policy";
import { actorFor } from "../support/actors";
import { T, U } from "../support/fixture";

const withGrants = (who: string, grants: [string, GrantablePermission][]): Actor => ({
  ...actorFor(who),
  permissionGrants: grants.map(([tenantId, permission]) => ({ tenantId, permission })),
});

describe("explicit permissions are never implied by role", () => {
  it.each(GRANTABLE_PERMISSIONS)("%s: Markaz Admin without a grant does not have it", (p) => {
    expect(hasGrantedPermission(actorFor(U.adminB), T.B, p)).toBe(false);
  });
  it.each(GRANTABLE_PERMISSIONS)("%s: Super Admin without a grant does not have it", (p) => {
    expect(hasGrantedPermission(actorFor(U.superAdmin), T.A, p)).toBe(false);
  });
  it.each(GRANTABLE_PERMISSIONS)("%s: a grant to a student is useless (ineligible role)", (p) => {
    expect(hasGrantedPermission(withGrants(U.studentX, [[T.A, p]]), T.A, p)).toBe(false);
  });
});

describe("invitable targets", () => {
  it("a teacher with invitation.create may invite STUDENT and PARENT only, only in that Markaz", () => {
    const t = withGrants(U.teacherAB, [[T.A, "invitation.create"]]);
    expect(invitableTargets(t, T.A)).toEqual(["STUDENT", "PARENT"]);
    expect(invitableTargets(t, T.B)).toEqual([]);
  });
  it("a teacher without it may invite nobody", () => {
    expect(invitableTargets(actorFor(U.teacherA), T.A)).toEqual([]);
  });
  it("Markaz Admin never MARKAZ_ADMIN; Super Admin may", () => {
    expect(invitableTargets(actorFor(U.adminA), T.A)).not.toContain("MARKAZ_ADMIN");
    expect(invitableTargets(actorFor(U.superAdmin), T.A)).toContain("MARKAZ_ADMIN");
  });
});

describe("who may assign a permission (A58)", () => {
  const base = { tenantId: T.A, granteeProfileId: U.teacherA, granteeActiveRoles: ["TEACHER"] as const };

  // Superseded 2026-10-13 by A62: Markaz Admins may assign ALL five (previously verify only).
  it("Markaz Admin: any of the five, to a Teacher of own Markaz only", () => {
    for (const p of GRANTABLE_PERMISSIONS) {
      expect(canAssignPermission(actorFor(U.adminA), { ...base, permission: p }), p).toBe(true);
      expect(canAssignPermission(actorFor(U.adminA), { ...base, tenantId: T.B, permission: p }), p).toBe(false);
    }
    expect(canAssignPermission(actorFor(U.adminA), { ...base, tenantId: T.B, permission: "parent_link.verify" })).toBe(false);
    expect(
      canAssignPermission(actorFor(U.adminA), { ...base, granteeActiveRoles: ["MARKAZ_ADMIN"], permission: "parent_link.verify" }),
    ).toBe(false);
    expect(
      canAssignPermission(actorFor(U.adminA), { ...base, granteeProfileId: U.adminA, permission: "parent_link.verify" }),
    ).toBe(false);
  });

  it("Super Admin: any permission, any Markaz — but only to an eligible grantee", () => {
    for (const p of GRANTABLE_PERMISSIONS) {
      expect(canAssignPermission(actorFor(U.superAdmin), { ...base, tenantId: T.B, permission: p })).toBe(true);
      expect(canAssignPermission(actorFor(U.superAdmin), { ...base, granteeActiveRoles: ["STUDENT"], permission: p })).toBe(false);
    }
  });

  it("Teachers never, even when they hold the permission", () => {
    const t = withGrants(U.teacherAB, [[T.A, "parent_link.verify"]]);
    expect(canAssignPermission(t, { ...base, permission: "parent_link.verify" })).toBe(false);
  });
});
