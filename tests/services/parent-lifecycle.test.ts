import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, hasGrantedPermission, parentMaySee } from "@/server/authz/policy";
import {
  activateParentLink,
  createLinkAsStaff,
  requestLinkAsParent,
  revokeOwnParentLink,
  revokeParentLinkAsStaff,
  verifyParentLink,
} from "@/server/services/parent-links";
import { grantTenantPermission, revokeTenantPermission } from "@/server/services/permissions";
import { asUser } from "../db/harness";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;

type Perm = "PARENT_LINK_CREATE" | "PARENT_LINK_VERIFY" | "PARENT_LINK_ACTIVATE" | "PARENT_LINK_REVOKE" | "INVITATION_CREATE";
async function grant(tenantId: string, profileId: string, permission: Perm) {
  await pg.query(
    `INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id) VALUES ($1, $2, $3::"TenantPermission", $4)`,
    [tenantId, profileId, permission, U.superAdmin],
  );
}
async function setEmail(profileId: string, email: string) {
  await pg.query("UPDATE auth.users SET email = $2 WHERE id = $1", [profileId, email]);
}
const linkOf = (parent: string, student: string = U.studentX) =>
  db.parentStudentLink.findUniqueOrThrow({ where: { parentProfileId_studentProfileId: { parentProfileId: parent, studentProfileId: student } } });
const events = (linkId: string) =>
  db.parentLinkEvent.findMany({ where: { linkId }, orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, actorId: true } });
const parentSeesStudent = async (parent: string, student = U.studentX) =>
  (await asUser(pg, parent, (tx) => tx.query("SELECT 1 FROM student_accounts WHERE profile_id = $1", [student]))).rows.length === 1;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await setEmail(U.studentX, "amina@example.com");
  await setEmail(U.studentY, "yusuf@example.com");
  await setEmail(U.parentUnlinked, "mama@example.com");
});

describe("create / request (PENDING)", () => {
  it("a parent requests their own link, bound to the Markaz they name", async () => {
    await requestLinkAsParent(db, await actor(db, U.parentUnlinked), { tenantSlug: "markaz-a", studentEmail: "Amina@Example.com" });
    const link = await linkOf(U.parentUnlinked);
    expect(link).toMatchObject({ status: "PENDING", tenantId: T.A, initiatedBy: "PARENT", requestedById: U.parentUnlinked });
    expect(await events(link.id)).toEqual([{ fromStatus: null, toStatus: "PENDING", actorId: U.parentUnlinked }]);
  });

  it("the parent is always the caller — a parent id in the input is ignored", async () => {
    await requestLinkAsParent(db, await actor(db, U.parentUnlinked), {
      tenantSlug: "markaz-a",
      studentEmail: "amina@example.com",
      parentProfileId: U.parentPending,
    });
    expect((await linkOf(U.parentUnlinked)).status).toBe("PENDING");
    expect(await db.parentStudentLink.count({ where: { parentProfileId: U.parentPending, studentProfileId: U.studentX } })).toBe(0);
  });

  it.each([
    ["an unknown Markaz code", { tenantSlug: "no-such-markaz", studentEmail: "amina@example.com" }],
    ["an unknown email", { tenantSlug: "markaz-a", studentEmail: "nobody@example.com" }],
    ["a student of another Markaz", { tenantSlug: "markaz-a", studentEmail: "yusuf@example.com" }],
  ])("%s creates nothing and gives the same answer (no enumeration)", async (_l, input) => {
    await expect(requestLinkAsParent(db, await actor(db, U.parentUnlinked), input)).resolves.toBeUndefined();
    expect(await db.parentStudentLink.count({ where: { parentProfileId: U.parentUnlinked } })).toBe(0);
  });

  it("someone without a parent account cannot request", async () => {
    await expect(
      requestLinkAsParent(db, await actor(db, U.teacherA), { tenantSlug: "markaz-a", studentEmail: "amina@example.com" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("staff WITH parent_link.create start a link (initiated by STAFF)", async () => {
    await grant(T.A, U.teacherA, "PARENT_LINK_CREATE");
    await createLinkAsStaff(db, await actor(db, U.teacherA), { tenantId: T.A, parentEmail: "mama@example.com", studentProfileId: U.studentX });
    expect(await linkOf(U.parentUnlinked)).toMatchObject({ status: "PENDING", initiatedBy: "STAFF", requestedById: U.teacherA });
  });

  it.each([
    ["a Markaz Admin without the permission", U.adminA],
    ["a teacher without the permission", U.teacherAB],
    ["a Super Admin (no bypass)", U.superAdmin],
  ])("staff create is denied for %s, before any query", async (_l, who) => {
    const a = await actor(db, who);
    const spy = spyDb(db);
    await expect(
      createLinkAsStaff(spy.db, a, { tenantId: T.A, parentEmail: "mama@example.com", studentProfileId: U.studentX }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(spy.calls).toEqual([]);
  });

  it("staff create is tenant-bound: no grant in B, and no B student under an A grant", async () => {
    await grant(T.A, U.teacherAB, "PARENT_LINK_CREATE");
    const a = await actor(db, U.teacherAB);
    await expect(
      createLinkAsStaff(db, a, { tenantId: T.B, parentEmail: "mama@example.com", studentProfileId: U.studentY }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      createLinkAsStaff(db, a, { tenantId: T.A, parentEmail: "mama@example.com", studentProfileId: U.studentY }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("an already-open link cannot be requested again", async () => {
    await grant(T.A, U.teacherA, "PARENT_LINK_CREATE");
    await setEmail(U.parentActive, "active@example.com");
    await expect(
      createLinkAsStaff(db, await actor(db, U.teacherA), { tenantId: T.A, parentEmail: "active@example.com", studentProfileId: U.studentX }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("verify (PENDING → VERIFIED)", () => {
  it("records actor and time, and an event", async () => {
    const link = await linkOf(U.parentPendingA);
    await verifyParentLink(db, await actor(db, U.teacherAB), { linkId: link.id });
    const after = await linkOf(U.parentPendingA);
    expect(after).toMatchObject({ status: "VERIFIED", verifiedById: U.teacherAB });
    expect((await events(link.id)).at(-1)).toEqual({ fromStatus: "PENDING", toStatus: "VERIFIED", actorId: U.teacherAB });
  });
});

describe("activate (VERIFIED → ACTIVE)", () => {
  it("a Markaz Admin with parent_link.activate activates; the parent then gains access", async () => {
    await grant(T.A, U.adminA, "PARENT_LINK_ACTIVATE");
    const link = await linkOf(U.parentVerified);
    expect(await parentSeesStudent(U.parentVerified)).toBe(false);
    await activateParentLink(db, await actor(db, U.adminA), { linkId: link.id });
    expect(await linkOf(U.parentVerified)).toMatchObject({ status: "ACTIVE", activatedById: U.adminA });
    expect(parentMaySee(await actor(db, U.parentVerified), U.studentX, "progress")).toBe(true);
    expect(await parentSeesStudent(U.parentVerified)).toBe(true);
  });

  it("a Teacher with parent_link.activate activates", async () => {
    await grant(T.A, U.teacherA, "PARENT_LINK_ACTIVATE");
    await activateParentLink(db, await actor(db, U.teacherA), { linkId: (await linkOf(U.parentVerified)).id });
    expect((await linkOf(U.parentVerified)).status).toBe("ACTIVE");
  });

  it.each([
    ["a Markaz Admin without the permission (verify is not enough)", U.adminA],
    ["a teacher without the permission", U.teacherA],
    ["a Super Admin (no bypass)", U.superAdmin],
    ["the parent themself", U.parentVerified],
  ])("is denied for %s", async (_l, who) => {
    await expect(activateParentLink(db, await actor(db, who), { linkId: (await linkOf(U.parentVerified)).id })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect((await linkOf(U.parentVerified)).status).toBe("VERIFIED");
  });

  it("PENDING cannot jump to ACTIVE, and REVOKED cannot return to ACTIVE", async () => {
    await grant(T.A, U.adminA, "PARENT_LINK_ACTIVATE");
    const a = await actor(db, U.adminA);
    await expect(activateParentLink(db, a, { linkId: (await linkOf(U.parentPendingA)).id })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(activateParentLink(db, a, { linkId: (await linkOf(U.parentRevoked)).id })).rejects.toMatchObject({ code: "invalid_state" });
    expect((await linkOf(U.parentPendingA)).status).toBe("PENDING");
    expect((await linkOf(U.parentRevoked)).status).toBe("REVOKED");
  });

  it("is tenant-bound: an A grant does not activate a B link", async () => {
    await grant(T.A, U.teacherAB, "PARENT_LINK_ACTIVATE");
    await pg.query(
      `UPDATE parent_student_links SET status='VERIFIED', verified_by_id=$1, verified_at=now() WHERE parent_profile_id=$2`,
      [U.adminB, U.parentPending],
    );
    await expect(
      activateParentLink(db, await actor(db, U.teacherAB), { linkId: (await linkOf(U.parentPending, U.studentY)).id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("the database itself refuses ACTIVE without a recorded verification and activation", async () => {
    await expect(
      pg.query(`UPDATE parent_student_links SET status='ACTIVE', activated_by_id=$1, activated_at=now() WHERE parent_profile_id=$2`, [
        U.adminA,
        U.parentPendingA,
      ]),
    ).rejects.toThrow(/parent_student_links_state_fields/);
    await expect(
      pg.query(`UPDATE parent_student_links SET status='ACTIVE' WHERE parent_profile_id=$1`, [U.parentVerified]),
    ).rejects.toThrow(/parent_student_links_state_fields/);
  });
});

describe("revoke (→ REVOKED)", () => {
  it("a parent withdraws their own ACTIVE link and loses access", async () => {
    const link = await linkOf(U.parentActive);
    await revokeOwnParentLink(db, await actor(db, U.parentActive), { linkId: link.id });
    expect(await linkOf(U.parentActive)).toMatchObject({ status: "REVOKED", revokedById: U.parentActive });
    expect(await parentSeesStudent(U.parentActive)).toBe(false);
    expect(parentMaySee(await actor(db, U.parentActive), U.studentX, "corrections")).toBe(false);
  });

  it("a parent cannot revoke another parent's link", async () => {
    await expect(
      revokeOwnParentLink(db, await actor(db, U.parentPendingA), { linkId: (await linkOf(U.parentActive)).id }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect((await linkOf(U.parentActive)).status).toBe("ACTIVE");
  });

  it("staff with parent_link.revoke revoke in their Markaz; staff without it, or from another Markaz, cannot", async () => {
    const id = (await linkOf(U.parentActive)).id;
    await expect(revokeParentLinkAsStaff(db, await actor(db, U.teacherA), { linkId: id })).rejects.toBeInstanceOf(AuthorizationError);
    await grant(T.B, U.teacherAB, "PARENT_LINK_REVOKE");
    await expect(revokeParentLinkAsStaff(db, await actor(db, U.teacherAB), { linkId: id })).rejects.toBeInstanceOf(AuthorizationError);
    await grant(T.A, U.teacherA, "PARENT_LINK_REVOKE");
    await revokeParentLinkAsStaff(db, await actor(db, U.teacherA), { linkId: id });
    expect(await linkOf(U.parentActive)).toMatchObject({ status: "REVOKED", revokedById: U.teacherA });
  });

  it("revoking an already REVOKED link is an illegal transition", async () => {
    await expect(
      revokeOwnParentLink(db, await actor(db, U.parentRevoked), { linkId: (await linkOf(U.parentRevoked)).id }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("after REVOKED a new request re-opens the cycle at PENDING; the history is kept", async () => {
    await setEmail(U.studentX, "amina@example.com");
    const link = await linkOf(U.parentActive);
    await revokeOwnParentLink(db, await actor(db, U.parentActive), { linkId: link.id });
    await requestLinkAsParent(db, await actor(db, U.parentActive), { tenantSlug: "markaz-a", studentEmail: "amina@example.com" });
    const after = await linkOf(U.parentActive);
    expect(after).toMatchObject({ status: "PENDING", verifiedAt: null, activatedAt: null, revokedAt: null });
    expect((await events(link.id)).map((e) => `${e.fromStatus}→${e.toStatus}`)).toEqual(["ACTIVE→REVOKED", "REVOKED→PENDING"]);
    expect(await parentSeesStudent(U.parentActive)).toBe(false);
  });
});

describe("full happy path, end to end", () => {
  it("request → verify → activate → withdraw, each by the right actor", async () => {
    await grant(T.A, U.teacherA, "PARENT_LINK_ACTIVATE");
    await requestLinkAsParent(db, await actor(db, U.parentUnlinked), { tenantSlug: "markaz-a", studentEmail: "amina@example.com" });
    const id = (await linkOf(U.parentUnlinked)).id;
    expect(await parentSeesStudent(U.parentUnlinked)).toBe(false);
    await verifyParentLink(db, await actor(db, U.teacherAB), { linkId: id });
    expect(await parentSeesStudent(U.parentUnlinked)).toBe(false);
    await activateParentLink(db, await actor(db, U.teacherA), { linkId: id });
    expect(await parentSeesStudent(U.parentUnlinked)).toBe(true);
    await revokeOwnParentLink(db, await actor(db, U.parentUnlinked), { linkId: id });
    expect(await parentSeesStudent(U.parentUnlinked)).toBe(false);
    expect((await events(id)).map((e) => `${e.fromStatus ?? "∅"}→${e.toStatus}:${e.actorId.slice(-2)}`)).toEqual([
      "∅→PENDING:d5",
      "PENDING→VERIFIED:ab",
      "VERIFIED→ACTIVE:a2",
      "ACTIVE→REVOKED:d5",
    ]);
  });
});

describe("permission delegation (A58)", () => {
  const verifyFor = (tenantId: string, profileId: string) => ({ tenantId, profileId, permission: "parent_link.verify" });

  it("a Markaz Admin assigns verify to a Teacher of their own Markaz, and can remove it", async () => {
    await grantTenantPermission(db, await actor(db, U.adminA), verifyFor(T.A, U.teacherA));
    expect(hasGrantedPermission(await actor(db, U.teacherA), T.A, "parent_link.verify")).toBe(true);
    const g = await db.tenantPermissionGrant.findFirstOrThrow({ where: { profileId: U.teacherA, revokedAt: null } });
    await revokeTenantPermission(db, await actor(db, U.adminA), g.id);
    expect(hasGrantedPermission(await actor(db, U.teacherA), T.A, "parent_link.verify")).toBe(false);
  });

  it.each([
    ["across tenants (teacher of A+B, in B)", U.adminA, verifyFor(T.B, U.teacherAB)],
    ["to a student", U.adminA, verifyFor(T.A, U.studentX)],
    ["to someone outside the Markaz", U.adminA, verifyFor(T.A, U.adminB)],
    ["to themselves", U.adminA, verifyFor(T.A, U.adminA)],
    ["by a teacher, to themselves", U.teacherA, verifyFor(T.A, U.teacherA)],
    ["by a teacher holding verify, to another teacher", U.teacherAB, verifyFor(T.A, U.teacherA)],
  ])("is denied: %s", async (_l, who, input) => {
    await expect(grantTenantPermission(db, await actor(db, who), input)).rejects.toBeInstanceOf(AuthorizationError);
  });

  // Superseded 2026-10-13 by A62: a Markaz Admin may now remove any of the five from their
  // own Teachers. What they still cannot remove: grants held by a Markaz Admin, or grants in
  // another Markaz.
  it("a Markaz Admin removes a Teacher's activate grant, but not another admin's grant or another Markaz's", async () => {
    await grant(T.A, U.teacherA, "PARENT_LINK_ACTIVATE");
    const teacherGrant = await db.tenantPermissionGrant.findFirstOrThrow({ where: { profileId: U.teacherA, permission: "PARENT_LINK_ACTIVATE" } });
    await revokeTenantPermission(db, await actor(db, U.adminA), teacherGrant.id);
    await pg.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'MARKAZ_ADMIN')", [T.A, U.teacherAB]);
    const adminGrant = await db.tenantPermissionGrant.findFirstOrThrow({ where: { profileId: U.teacherAB, revokedAt: null } });
    await expect(revokeTenantPermission(db, await actor(db, U.adminA), adminGrant.id)).rejects.toBeInstanceOf(AuthorizationError);
    await grant(T.B, U.teacherAB, "PARENT_LINK_REVOKE");
    const bGrant = await db.tenantPermissionGrant.findFirstOrThrow({ where: { tenantId: T.B, profileId: U.teacherAB } });
    await expect(revokeTenantPermission(db, await actor(db, U.adminA), bGrant.id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("the Super Admin path still works, for any permission in any Markaz", async () => {
    const sa = await actor(db, U.superAdmin);
    await grantTenantPermission(db, sa, { tenantId: T.B, profileId: U.teacherAB, permission: "parent_link.activate" });
    await grantTenantPermission(db, sa, { tenantId: T.B, profileId: U.adminB, permission: "invitation.create" });
    const t = await actor(db, U.teacherAB);
    expect(hasGrantedPermission(t, T.B, "parent_link.activate")).toBe(true);
    expect(hasGrantedPermission(t, T.A, "parent_link.activate")).toBe(false);
  });
});
