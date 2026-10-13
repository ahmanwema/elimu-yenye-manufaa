import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, parentMaySee } from "@/server/authz/policy";
import { listMyParentLinks, listTenantParentLinks, verifyParentLink } from "@/server/services/parent-links";
import { asUser } from "../db/harness";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
});

async function linkId(parent: string) {
  const link = await db.parentStudentLink.findFirstOrThrow({ where: { parentProfileId: parent } });
  return link.id;
}

describe("verifying a parent link (PENDING → VERIFIED)", () => {
  it("a teacher with parent_link.verify in Markaz A verifies an A link; audit fields are recorded", async () => {
    const id = await linkId(U.parentPendingA);
    await verifyParentLink(db, await actor(db, U.teacherAB), { linkId: id });
    const link = await db.parentStudentLink.findUniqueOrThrow({ where: { id } });
    expect(link).toMatchObject({ status: "VERIFIED", verifiedById: U.teacherAB, statusChangedById: U.teacherAB });
    expect(link.verifiedAt).toBeInstanceOf(Date);
  });

  it("a Markaz Admin with the permission verifies in their own Markaz", async () => {
    await verifyParentLink(db, await actor(db, U.adminA), { linkId: await linkId(U.parentPendingA) });
  });

  it.each([
    ["a teacher granted in A, for a Markaz B link", U.teacherAB, U.parentPending],
    ["a Markaz Admin granted in A, for a Markaz B link", U.adminA, U.parentPending],
    ["Markaz B's admin, who has the role but no grant", U.adminB, U.parentPending],
    ["a teacher whose grant was revoked", U.teacherA, U.parentPendingA],
    ["a Super Admin (no bypass for explicit permissions)", U.superAdmin, U.parentPendingA],
    ["the student", U.studentX, U.parentPendingA],
    ["a parent", U.parentActive, U.parentPendingA],
  ])("is denied for %s — no update is attempted", async (_label, who, parent) => {
    const id = await linkId(parent);
    const a = await actor(db, who);
    const spy = spyDb(db);
    await expect(verifyParentLink(spy.db, a, { linkId: id })).rejects.toBeInstanceOf(AuthorizationError);
    expect(spy.calls).toEqual(["parentStudentLink.findUnique"]);
    expect((await db.parentStudentLink.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
  });

  it("a verifier cannot verify a link they are party to", async () => {
    // teacherAB (holds the A grant) also becomes a parent with a PENDING A link.
    await pg.query("INSERT INTO parent_accounts (profile_id) VALUES ($1)", [U.teacherAB]);
    const { rows } = await pg.query<{ id: string }>(
      "INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id) VALUES ($1, $2, $3) RETURNING id",
      [U.teacherAB, U.studentX, T.A],
    );
    await expect(verifyParentLink(db, await actor(db, U.teacherAB), { linkId: rows[0].id })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("only PENDING links can be verified", async () => {
    const id = await linkId(U.parentActive);
    await expect(verifyParentLink(db, await actor(db, U.teacherAB), { linkId: id })).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("an unknown or malformed link id is indistinguishable from a forbidden one", async () => {
    const a = await actor(db, U.teacherAB);
    await expect(verifyParentLink(db, a, { linkId: "11111111-2222-4333-8444-555555555555" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(verifyParentLink(db, a, { linkId: "x" })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("only ACTIVE grants parent access", () => {
  it("VERIFIED (just verified) grants no access — server and RLS agree", async () => {
    await verifyParentLink(db, await actor(db, U.teacherAB), { linkId: await linkId(U.parentPendingA) });
    expect(parentMaySee(await actor(db, U.parentPendingA), U.studentX, "progress")).toBe(false);
    const visible = await asUser(pg, U.parentPendingA, (tx) => tx.query("SELECT profile_id FROM student_accounts"));
    expect(visible.rows).toEqual([]);
  });

  it.each([
    ["ACTIVE", U.parentActive, true],
    ["VERIFIED", U.parentVerified, false],
    ["PENDING", U.parentPendingA, false],
    ["REVOKED", U.parentRevoked, false],
  ])("%s link → corrections visible: %s", async (_s, parent, expected) => {
    expect(parentMaySee(await actor(db, parent), U.studentX, "corrections")).toBe(expected);
  });
});

describe("listing links", () => {
  it("Markaz A's admin sees Markaz A links only", async () => {
    const links = await listTenantParentLinks(db, await actor(db, U.adminA), T.A);
    expect(links).toHaveLength(4);
    await expect(listTenantParentLinks(db, await actor(db, U.adminA), T.B)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a verifier sees links of the Markaz where they hold the permission, not elsewhere", async () => {
    expect(await listTenantParentLinks(db, await actor(db, U.teacherAB), T.A)).toHaveLength(4);
    await expect(listTenantParentLinks(db, await actor(db, U.teacherAB), T.B)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a teacher without the permission sees no links", async () => {
    await expect(listTenantParentLinks(db, await actor(db, U.teacherA), T.A)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a parent sees their own links; the child's name only once ACTIVE", async () => {
    await pg.query("UPDATE profiles SET display_name = 'Amina' WHERE id = $1", [U.studentX]);
    expect(await listMyParentLinks(db, await actor(db, U.parentActive))).toEqual([
      expect.objectContaining({ status: "ACTIVE", studentName: "Amina" }),
    ]);
    expect(await listMyParentLinks(db, await actor(db, U.parentPendingA))).toEqual([
      expect.objectContaining({ status: "PENDING", studentName: null }),
    ]);
  });
});
