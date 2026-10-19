import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, GRANTABLE_PERMISSIONS, hasGrantedPermission } from "@/server/authz/policy";
import { acceptInvitation, createInvitation } from "@/server/services/invitations";
import { normalizeRegistrationNumber, requestLinkAsParent } from "@/server/services/parent-links";
import { grantTenantPermission } from "@/server/services/permissions";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;

async function grant(tenantId: string, profileId: string, permission: string) {
  await pg.query(
    `INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id) VALUES ($1, $2, $3::"TenantPermission", $4)`,
    [tenantId, profileId, permission, U.superAdmin],
  );
}
const regOf = async (profileId: string, tenantId: string) =>
  (await db.membership.findFirstOrThrow({ where: { profileId, tenantId, role: "STUDENT" } })).registrationNumber as string;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await pg.query("UPDATE auth.users SET email = 'amina@example.com' WHERE id = $1", [U.studentX]);
  await pg.query("UPDATE auth.users SET email = 'yusuf@example.com' WHERE id = $1", [U.studentY]);
});

// ---------------------------------------------------------------------------------------
describe("permission delegation by a Markaz Admin (A62)", () => {
  it.each(GRANTABLE_PERMISSIONS)("assigns %s to an ACTIVE Teacher of their own Markaz", async (permission) => {
    await grantTenantPermission(db, await actor(db, U.adminA), { tenantId: T.A, profileId: U.teacherA, permission });
    expect(hasGrantedPermission(await actor(db, U.teacherA), T.A, permission)).toBe(true);
  });

  it.each(GRANTABLE_PERMISSIONS)("cannot assign %s across tenants", async (permission) => {
    await expect(
      grantTenantPermission(db, await actor(db, U.adminA), { tenantId: T.B, profileId: U.teacherAB, permission }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cannot assign to a Teacher whose membership has ENDED", async () => {
    await pg.query("UPDATE memberships SET status='ENDED', ended_at=now() WHERE profile_id=$1 AND tenant_id=$2", [U.teacherA, T.A]);
    await expect(
      grantTenantPermission(db, await actor(db, U.adminA), { tenantId: T.A, profileId: U.teacherA, permission: "invitation.create" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it.each([
    ["a student", U.studentX],
    ["a parent with no membership", U.parentActive],
    ["another Markaz Admin's profile from another Markaz", U.adminB],
    ["themselves", U.adminA],
  ])("cannot assign to %s", async (_l, profileId) => {
    await expect(
      grantTenantPermission(db, await actor(db, U.adminA), { tenantId: T.A, profileId, permission: "parent_link.create" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a Teacher cannot grant (to others or themselves), even holding the permission — no DB call", async () => {
    await grant(T.A, U.teacherAB, "INVITATION_CREATE");
    for (const target of [U.teacherA, U.teacherAB]) {
      const a = await actor(db, U.teacherAB);
      const spy = spyDb(db);
      await expect(
        grantTenantPermission(spy.db, a, { tenantId: T.A, profileId: target, permission: "invitation.create" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(spy.calls).toEqual([]);
    }
  });

  it("only the five tenant permissions exist (payment.verify was removed by A140) — no platform/global privilege can be named", async () => {
    await expect(
      grantTenantPermission(db, await actor(db, U.adminA), { tenantId: T.A, profileId: U.teacherA, permission: "platform.admin" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

// ---------------------------------------------------------------------------------------
describe("parent invitation with a proposed child needs BOTH grants (A63)", () => {
  const input = (extra: Record<string, unknown> = {}) => ({ tenantId: T.A, email: "p@example.com", target: "PARENT", ...extra });

  it("without a child, invitation.create alone is enough (teacher)", async () => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    expect((await createInvitation(db, await actor(db, U.teacherA), input())).target).toBe("PARENT");
  });

  it.each([
    ["invitation.create alone", ["INVITATION_CREATE"]],
    ["parent_link.create alone", ["PARENT_LINK_CREATE"]],
    ["neither", []],
  ])("with a child, %s is denied (teacher)", async (_l, perms) => {
    for (const p of perms) await grant(T.A, U.teacherA, p);
    await expect(createInvitation(db, await actor(db, U.teacherA), input({ proposedStudentId: U.studentX }))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("with a child, a Markaz Admin also needs both explicit grants (role alone is not enough)", async () => {
    await expect(createInvitation(db, await actor(db, U.adminA), input({ proposedStudentId: U.studentX }))).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await grant(T.A, U.adminA, "INVITATION_CREATE");
    await grant(T.A, U.adminA, "PARENT_LINK_CREATE");
    await createInvitation(db, await actor(db, U.adminA), input({ proposedStudentId: U.studentX }));
  });

  it("with both grants: works, and acceptance yields only a PENDING link", async () => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    await grant(T.A, U.teacherA, "PARENT_LINK_CREATE");
    const inv = await createInvitation(db, await actor(db, U.teacherA), input({ proposedStudentId: U.studentX }));
    const NEW = "33333333-0000-4000-8000-000000000001";
    await pg.query("INSERT INTO auth.users (id, email) VALUES ($1, 'p@example.com')", [NEW]);
    await acceptInvitation(db, { userId: NEW, email: "p@example.com" }, { token: inv.token });
    expect((await db.parentStudentLink.findFirstOrThrow({ where: { parentProfileId: NEW } })).status).toBe("PENDING");
  });

  it("a student of another Markaz cannot be proposed, even with both grants", async () => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    await grant(T.A, U.teacherA, "PARENT_LINK_CREATE");
    await expect(createInvitation(db, await actor(db, U.teacherA), input({ proposedStudentId: U.studentY }))).rejects.toMatchObject({
      code: "invalid_state",
    });
  });
});

// ---------------------------------------------------------------------------------------
describe("student registration number (technical implementation of A64)", () => {
  it("every ACTIVE student membership has one, in the approved format; other roles have none", async () => {
    expect(await regOf(U.studentX, T.A)).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    const teacher = await db.membership.findFirstOrThrow({ where: { profileId: U.teacherA } });
    expect(teacher.registrationNumber).toBeNull();
  });

  it("is assigned to new student memberships automatically and is unique per Markaz", async () => {
    const id = "44444444-0000-4000-8000-000000000001";
    await pg.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    await pg.query("INSERT INTO student_accounts (profile_id) VALUES ($1)", [id]);
    await pg.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'STUDENT')", [T.A, id]);
    const mine = await regOf(id, T.A);
    expect(mine).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    await expect(
      pg.query("UPDATE memberships SET registration_number = $1 WHERE profile_id = $2 AND tenant_id = $3", [mine, U.studentX, T.A]),
    ).rejects.toThrow(/immutable/);
  });

  it("never changes — not even when a departed student is re-activated", async () => {
    const before = (await db.membership.findFirstOrThrow({ where: { profileId: U.studentLeft } })).registrationNumber;
    await pg.query("UPDATE memberships SET status='ACTIVE', ended_at=NULL WHERE profile_id=$1", [U.studentLeft]);
    expect((await db.membership.findFirstOrThrow({ where: { profileId: U.studentLeft } })).registrationNumber).toBe(before);
  });

  it("a non-student row cannot carry one", async () => {
    await expect(
      pg.query("UPDATE memberships SET registration_number = 'ABCDEFGH' WHERE profile_id = $1", [U.teacherA]),
    ).rejects.toThrow(/registration_number_student_only/);
  });

  it("typed input is normalized (case, spaces, dashes)", () => {
    expect(normalizeRegistrationNumber(" k7m4-9pqx ")).toBe("K7M49PQX");
  });
});

// ---------------------------------------------------------------------------------------
describe("parent self-request: email OR registration number, non-enumerating (A64)", () => {
  const links = (parent: string) => db.parentStudentLink.count({ where: { parentProfileId: parent } });

  it("the email path creates a PENDING request", async () => {
    await requestLinkAsParent(db, await actor(db, U.parentUnlinked), { tenantSlug: "markaz-a", studentEmail: "amina@example.com" });
    expect(await links(U.parentUnlinked)).toBe(1);
  });

  it("the registration-number path creates a PENDING request (with dashes/lower-case typed)", async () => {
    const reg = await regOf(U.studentX, T.A);
    const typed = `${reg.slice(0, 4)}-${reg.slice(4)}`.toLowerCase();
    await requestLinkAsParent(db, await actor(db, U.parentUnlinked), { tenantSlug: "markaz-a", studentRegistrationNumber: typed });
    const link = await db.parentStudentLink.findFirstOrThrow({ where: { parentProfileId: U.parentUnlinked } });
    expect(link).toMatchObject({ status: "PENDING", studentProfileId: U.studentX, tenantId: T.A, initiatedBy: "PARENT" });
  });

  it("form input with one identifier empty is accepted; both filled is rejected", async () => {
    const a = await actor(db, U.parentUnlinked);
    await requestLinkAsParent(db, a, { tenantSlug: "markaz-a", studentEmail: "amina@example.com", studentRegistrationNumber: "" });
    await expect(
      requestLinkAsParent(db, a, { tenantSlug: "markaz-a", studentEmail: "amina@example.com", studentRegistrationNumber: "ABCDEFGH" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("every outcome looks identical to the requester: same return value, no error", async () => {
    const regX = await regOf(U.studentX, T.A);
    const regY = await regOf(U.studentY, T.B);
    const a = await actor(db, U.parentActive); // already ACTIVE-linked to studentX
    const outcomes: Record<string, Record<string, string>> = {
      "success (new child)": { tenantSlug: "markaz-b", studentEmail: "yusuf@example.com" },
      "student not found (email)": { tenantSlug: "markaz-a", studentEmail: "nobody@example.com" },
      "student not found (registration number)": { tenantSlug: "markaz-a", studentRegistrationNumber: "ZZZZZZZZ" },
      "right number, wrong Markaz": { tenantSlug: "markaz-a", studentRegistrationNumber: regY },
      "right email, wrong Markaz": { tenantSlug: "markaz-b", studentEmail: "amina@example.com" },
      "unknown Markaz code": { tenantSlug: "no-such-markaz", studentRegistrationNumber: regX },
      "existing relationship (email)": { tenantSlug: "markaz-a", studentEmail: "amina@example.com" },
      "existing relationship (number)": { tenantSlug: "markaz-a", studentRegistrationNumber: regX },
    };
    const results: Record<string, unknown> = {};
    for (const [label, input] of Object.entries(outcomes)) {
      results[label] = await requestLinkAsParent(db, a, input).then(
        (v) => ({ ok: true, value: v }),
        (e) => ({ ok: false, error: String(e) }),
      );
    }
    const distinct = new Set(Object.values(results).map((r) => JSON.stringify(r)));
    expect(distinct.size).toBe(1);
    expect([...distinct][0]).toBe(JSON.stringify({ ok: true }));
    // Only the genuine new request had an effect; the existing ACTIVE link is untouched.
    expect(await db.parentStudentLink.count({ where: { parentProfileId: U.parentActive } })).toBe(2);
    expect((await db.parentStudentLink.findFirstOrThrow({ where: { parentProfileId: U.parentActive, studentProfileId: U.studentX } })).status).toBe(
      "ACTIVE",
    );
  });

  it("a departed student cannot be found by their old number", async () => {
    const regLeft = (await db.membership.findFirstOrThrow({ where: { profileId: U.studentLeft } })).registrationNumber as string;
    await requestLinkAsParent(db, await actor(db, U.parentUnlinked), { tenantSlug: "markaz-a", studentRegistrationNumber: regLeft });
    expect(await links(U.parentUnlinked)).toBe(0);
  });
});
