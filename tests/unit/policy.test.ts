import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  canReadStudentAccount,
  hasTenantPermission,
  requireTenantPermission,
} from "@/server/authz/policy";
import { actorFor, activeTenantsOf } from "../support/actors";
import { T, U } from "../support/fixture";

const canReadStudent = (actorId: string, studentId: string) =>
  canReadStudentAccount(actorFor(actorId), studentId, activeTenantsOf(studentId));

describe("Markaz Administrator is bound to their own Markaz", () => {
  it("can read and see members of Markaz A", () => {
    expect(hasTenantPermission(actorFor(U.adminA), T.A, "tenant.read")).toBe(true);
    expect(hasTenantPermission(actorFor(U.adminA), T.A, "tenant.members.read")).toBe(true);
  });

  it("cannot read or list members of Markaz B", () => {
    expect(hasTenantPermission(actorFor(U.adminA), T.B, "tenant.read")).toBe(false);
    expect(hasTenantPermission(actorFor(U.adminA), T.B, "tenant.members.read")).toBe(false);
    expect(() => requireTenantPermission(actorFor(U.adminA), T.B, "tenant.read")).toThrow(AuthorizationError);
  });

  it("is not a platform admin", () => {
    expect(actorFor(U.adminA).isPlatformAdmin).toBe(false);
  });
});

describe("Teacher multi-Markaz membership", () => {
  it("a teacher in A and B can operate in both independently", () => {
    expect(hasTenantPermission(actorFor(U.teacherAB), T.A, "tenant.read")).toBe(true);
    expect(hasTenantPermission(actorFor(U.teacherAB), T.B, "tenant.read")).toBe(true);
  });

  it("a teacher in A only cannot access B", () => {
    expect(hasTenantPermission(actorFor(U.teacherA), T.B, "tenant.read")).toBe(false);
  });

  it("a teacher role never grants admin-only permissions, in any Markaz", () => {
    expect(hasTenantPermission(actorFor(U.teacherAB), T.A, "tenant.members.read")).toBe(false);
    expect(hasTenantPermission(actorFor(U.teacherAB), T.B, "tenant.members.read")).toBe(false);
  });

  it("a role held in one Markaz is not carried into another", () => {
    // adminA is admin in A; that must not make them anything in B.
    const actor = actorFor(U.adminA);
    expect(hasTenantPermission(actor, T.B, "tenant.read")).toBe(false);
  });
});

describe("Student isolation", () => {
  it("a student in A can read A but not B", () => {
    expect(hasTenantPermission(actorFor(U.studentX), T.A, "tenant.read")).toBe(true);
    expect(hasTenantPermission(actorFor(U.studentX), T.B, "tenant.read")).toBe(false);
  });

  it("a student cannot list members of their own Markaz", () => {
    expect(hasTenantPermission(actorFor(U.studentX), T.A, "tenant.members.read")).toBe(false);
  });

  it("Student X cannot read Student Y", () => {
    expect(canReadStudent(U.studentX, U.studentY)).toBe(false);
    expect(canReadStudent(U.studentY, U.studentX)).toBe(false);
  });

  it("a student can always read their own account", () => {
    expect(canReadStudent(U.studentX, U.studentX)).toBe(true);
  });
});

describe("Departed student (A32)", () => {
  it("keeps access to their own account after the membership ENDED", () => {
    expect(canReadStudent(U.studentLeft, U.studentLeft)).toBe(true);
  });

  it("loses tenant access to the Markaz they left", () => {
    expect(hasTenantPermission(actorFor(U.studentLeft), T.A, "tenant.read")).toBe(false);
  });
});

describe("Parent access requires an ACTIVE link", () => {
  it("an ACTIVE-linked parent can read the linked student", () => {
    expect(canReadStudent(U.parentActive, U.studentX)).toBe(true);
  });

  it("the same parent cannot read an unrelated student", () => {
    expect(canReadStudent(U.parentActive, U.studentY)).toBe(false);
  });

  it.each([
    ["VERIFIED", U.parentVerified, U.studentX],
    ["PENDING", U.parentPending, U.studentY],
    ["REVOKED", U.parentRevoked, U.studentX],
    ["no link", U.parentUnlinked, U.studentX],
  ])("a %s parent cannot read the student", (_label, parent, student) => {
    expect(canReadStudent(parent, student)).toBe(false);
  });

  it("a parent gets no tenant permissions from a link", () => {
    expect(hasTenantPermission(actorFor(U.parentActive), T.A, "tenant.read")).toBe(false);
  });
});

describe("Markaz Admin and students", () => {
  it("can read an active student of their own Markaz", () => {
    expect(canReadStudent(U.adminA, U.studentX)).toBe(true);
  });

  it("cannot read a student of another Markaz", () => {
    expect(canReadStudent(U.adminA, U.studentY)).toBe(false);
    expect(canReadStudent(U.adminB, U.studentX)).toBe(false);
  });

  it("a teacher cannot read student accounts (roster visibility not decided)", () => {
    expect(canReadStudent(U.teacherA, U.studentX)).toBe(false);
  });
});

describe("Platform (Super) Admin", () => {
  it("has tenant access across Markaz", () => {
    expect(hasTenantPermission(actorFor(U.superAdmin), T.A, "tenant.members.read")).toBe(true);
    expect(hasTenantPermission(actorFor(U.superAdmin), T.B, "tenant.members.read")).toBe(true);
  });
});

describe("Tenant ID manipulation", () => {
  it.each([
    ["another tenant's id", T.B],
    ["a random uuid", "11111111-2222-4333-8444-555555555555"],
    ["a non-uuid string", "A"],
    ["SQL-looking input", "' OR 1=1 --"],
    ["an array", [T.A]],
    ["an object", { id: T.A }],
    ["null", null],
    ["undefined", undefined],
  ])("%s does not grant access", (_label, input) => {
    expect(hasTenantPermission(actorFor(U.adminA), input, "tenant.read")).toBe(false);
  });

  it("a malformed student id is denied, even for a platform admin", () => {
    expect(canReadStudentAccount(actorFor(U.superAdmin), "not-a-uuid", [])).toBe(false);
  });

  it("only ACTIVE memberships count — a forged ENDED membership grants nothing", () => {
    const actor = { ...actorFor(U.studentX), memberships: [{ tenantId: T.B, role: "MARKAZ_ADMIN" as const, status: "ENDED" as const }] };
    expect(hasTenantPermission(actor, T.B, "tenant.read")).toBe(false);
  });
});
