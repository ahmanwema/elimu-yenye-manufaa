import { describe, expect, it } from "vitest";
import {
  canReadCorrection,
  canReadStudentDetail,
  hasGrantedPermission,
  hasTenantPermission,
  invitableTargets,
  parentMaySee,
  PARENT_VISIBLE_CATEGORIES,
  STUDENT_DATA_CATEGORIES,
  type Actor,
} from "@/server/authz/policy";
import { actorFor } from "../support/actors";
import { T, U } from "../support/fixture";

describe("explicit permission parent_link.verify", () => {
  it("requires a grant — the role alone is not enough", () => {
    expect(hasGrantedPermission(actorFor(U.adminB), T.B, "parent_link.verify")).toBe(false); // admin, no grant
    expect(hasGrantedPermission(actorFor(U.teacherA), T.A, "parent_link.verify")).toBe(false); // revoked grant
  });

  it("is tenant-scoped: a grant in A says nothing about B", () => {
    expect(hasGrantedPermission(actorFor(U.teacherAB), T.A, "parent_link.verify")).toBe(true);
    expect(hasGrantedPermission(actorFor(U.teacherAB), T.B, "parent_link.verify")).toBe(false);
    expect(hasGrantedPermission(actorFor(U.adminA), T.B, "parent_link.verify")).toBe(false);
  });

  it("needs an eligible ACTIVE role alongside the grant (a forged grant for a student is useless)", () => {
    const student: Actor = { ...actorFor(U.studentX), permissionGrants: [{ tenantId: T.A, permission: "parent_link.verify" }] };
    expect(hasGrantedPermission(student, T.A, "parent_link.verify")).toBe(false);
  });

  it("gives a Super Admin no implicit bypass", () => {
    expect(hasGrantedPermission(actorFor(U.superAdmin), T.A, "parent_link.verify")).toBe(false);
  });
});

describe("role permissions added in Phase 2A", () => {
  it("teachers read the basic roster of each Markaz they teach in, and only those", () => {
    expect(hasTenantPermission(actorFor(U.teacherA), T.A, "tenant.roster.read")).toBe(true);
    expect(hasTenantPermission(actorFor(U.teacherA), T.B, "tenant.roster.read")).toBe(false);
    expect(hasTenantPermission(actorFor(U.studentX), T.A, "tenant.roster.read")).toBe(false);
  });

  it("only a Markaz Admin of that Markaz may request an admin appointment — not a Super Admin", () => {
    expect(hasTenantPermission(actorFor(U.adminA), T.A, "tenant.admin_appointment.request")).toBe(true);
    expect(hasTenantPermission(actorFor(U.adminA), T.B, "tenant.admin_appointment.request")).toBe(false);
    expect(hasTenantPermission(actorFor(U.superAdmin), T.A, "tenant.admin_appointment.request")).toBe(false);
    expect(hasTenantPermission(actorFor(U.teacherA), T.A, "tenant.admin_appointment.request")).toBe(false);
  });

  it("invitable targets: Markaz Admin → teacher/student/parent in own Markaz; Super Admin → any; teacher without grant → none", () => {
    // Superseded by A59/A61 (2026-10-13): PARENT added; teachers need invitation.create.
    expect(invitableTargets(actorFor(U.adminA), T.A)).toEqual(["TEACHER", "STUDENT", "PARENT"]);
    expect(invitableTargets(actorFor(U.adminA), T.B)).toEqual([]);
    expect(invitableTargets(actorFor(U.superAdmin), T.B)).toEqual(["MARKAZ_ADMIN", "TEACHER", "STUDENT", "PARENT"]);
    expect(invitableTargets(actorFor(U.teacherAB), T.A)).toEqual([]);
    expect(invitableTargets(actorFor(U.adminA), "not-a-uuid")).toEqual([]);
  });
});

describe("parent visibility contract (A41/A48)", () => {
  it.each(PARENT_VISIBLE_CATEGORIES)("an ACTIVE parent may see %s", (category) => {
    expect(parentMaySee(actorFor(U.parentActive), U.studentX, category)).toBe(true);
  });

  it.each(["teacher_private_notes", "admin_notes"] as const)("never %s, even when ACTIVE", (category) => {
    expect(parentMaySee(actorFor(U.parentActive), U.studentX, category)).toBe(false);
  });

  it.each([
    ["VERIFIED", U.parentVerified],
    ["PENDING", U.parentPendingA],
    ["REVOKED", U.parentRevoked],
  ])("a %s parent sees no category at all", (_s, parent) => {
    for (const c of STUDENT_DATA_CATEGORIES) expect(parentMaySee(actorFor(parent), U.studentX, c)).toBe(false);
  });

  it("never an unrelated student, nor another parent's child", () => {
    expect(parentMaySee(actorFor(U.parentActive), U.studentY, "progress")).toBe(false);
    expect(parentMaySee(actorFor(U.parentUnlinked), U.studentX, "progress")).toBe(false);
  });
});

describe("detailed student data (future class hook)", () => {
  const input = { tenantId: T.A, studentProfileId: U.studentX, studentIsActiveInTenant: true };

  it("teachers get NO detailed access until classes exist", () => {
    expect(canReadStudentDetail(actorFor(U.teacherA), input)).toBe(false);
  });

  it("with a class resolver, a teacher gets detail only for students they teach, in that Markaz", () => {
    const teachesX = () => true;
    expect(canReadStudentDetail(actorFor(U.teacherA), input, teachesX)).toBe(true);
    expect(canReadStudentDetail(actorFor(U.teacherA), { ...input, tenantId: T.B }, teachesX)).toBe(false);
  });

  it("a Markaz Admin of that Markaz, and the student, have detail; others do not", () => {
    expect(canReadStudentDetail(actorFor(U.adminA), input)).toBe(true);
    expect(canReadStudentDetail(actorFor(U.studentX), input)).toBe(true);
    expect(canReadStudentDetail(actorFor(U.adminB), input)).toBe(false);
    expect(canReadStudentDetail(actorFor(U.adminA), { ...input, studentIsActiveInTenant: false })).toBe(false);
  });
});

describe("correction visibility", () => {
  const correction = { tenantId: T.A, studentProfileId: U.studentX, teacherProfileId: U.teacherA };
  it.each([
    [U.studentX, true],
    [U.teacherA, true],
    [U.parentActive, true],
    [U.parentVerified, false],
    [U.adminA, false],
    [U.superAdmin, false],
    [U.teacherAB, false],
  ])("%s → %s", (who, expected) => {
    expect(canReadCorrection(actorFor(who), correction)).toBe(expected);
  });
});
