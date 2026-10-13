import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, hasGrantedPermission } from "@/server/authz/policy";
import { grantTenantPermission, revokeTenantPermission } from "@/server/services/permissions";
import { BASIC_ROSTER_FIELDS, listStudentRoster } from "@/server/services/roster";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
});

describe("teacher basic roster", () => {
  it("a teacher sees ACTIVE students of their own Markaz with basic fields only", async () => {
    const roster = await listStudentRoster(db, await actor(db, U.teacherA), T.A);
    expect(roster.map((r) => r.profileId)).toEqual([U.studentX]); // not studentLeft (ENDED)
    for (const entry of roster) expect(Object.keys(entry).sort()).toEqual([...BASIC_ROSTER_FIELDS].sort());
  });

  it("a teacher in two Markaz sees each roster separately", async () => {
    const a = await actor(db, U.teacherAB);
    expect((await listStudentRoster(db, a, T.A)).map((r) => r.profileId)).toEqual([U.studentX]);
    expect((await listStudentRoster(db, a, T.B)).map((r) => r.profileId)).toEqual([U.studentY]);
  });

  it.each([
    ["a teacher of A, for Markaz B", U.teacherA, T.B],
    ["a student", U.studentX, T.A],
    ["a parent", U.parentActive, T.A],
    ["Markaz A's admin, for Markaz B", U.adminA, T.B],
  ])("is denied for %s, before any query", async (_l, who, tenant) => {
    const a = await actor(db, who);
    const spy = spyDb(db);
    await expect(listStudentRoster(spy.db, a, tenant)).rejects.toBeInstanceOf(AuthorizationError);
    expect(spy.calls).toEqual([]);
  });
});

describe("explicit permission grants", () => {
  it("nobody holds parent_link.verify by default — a teacher without a grant does not", async () => {
    expect(hasGrantedPermission(await actor(db, U.teacherA), T.A, "parent_link.verify")).toBe(false);
  });

  it("a Super Admin grants it to an eligible teacher; it then takes effect", async () => {
    await grantTenantPermission(db, await actor(db, U.superAdmin), {
      tenantId: T.B,
      profileId: U.teacherAB,
      permission: "parent_link.verify",
    });
    expect(hasGrantedPermission(await actor(db, U.teacherAB), T.B, "parent_link.verify")).toBe(true);
  });

  // Superseded 2026-10-13 by A58: a Markaz Admin MAY now assign parent_link.verify to a
  // Teacher of their own Markaz. Previously "cannot be granted by a Markaz Admin".
  it("a Markaz Admin assigns parent_link.verify to a Teacher of their own Markaz", async () => {
    await grantTenantPermission(db, await actor(db, U.adminA), {
      tenantId: T.A,
      profileId: U.teacherA,
      permission: "parent_link.verify",
    });
    expect(hasGrantedPermission(await actor(db, U.teacherA), T.A, "parent_link.verify")).toBe(true);
  });

  it.each([
    ["a Markaz Admin, to themselves", U.adminB, U.adminB],
    ["a teacher", U.teacherAB, U.teacherA],
  ])("cannot be granted by %s", async (_l, who, target) => {
    await expect(
      grantTenantPermission(db, await actor(db, who), { tenantId: T.A, profileId: target, permission: "parent_link.verify" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cannot be granted to a student (ineligible role)", async () => {
    await expect(
      grantTenantPermission(db, await actor(db, U.superAdmin), {
        tenantId: T.A,
        profileId: U.studentX,
        permission: "parent_link.verify",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("stops working when the holder's eligible membership ends, even though the grant row remains", async () => {
    await pg.query("UPDATE memberships SET status = 'ENDED', ended_at = now() WHERE profile_id = $1 AND tenant_id = $2", [
      U.teacherAB,
      T.A,
    ]);
    expect(hasGrantedPermission(await actor(db, U.teacherAB), T.A, "parent_link.verify")).toBe(false);
  });

  it("duplicate live grants are rejected; after revocation it can be granted again", async () => {
    const sa = await actor(db, U.superAdmin);
    const input = { tenantId: T.A, profileId: U.teacherAB, permission: "parent_link.verify" };
    await expect(grantTenantPermission(db, sa, input)).rejects.toMatchObject({ code: "conflict" });
    const grant = await db.tenantPermissionGrant.findFirstOrThrow({ where: { profileId: U.teacherAB, revokedAt: null } });
    await revokeTenantPermission(db, sa, grant.id);
    expect(hasGrantedPermission(await actor(db, U.teacherAB), T.A, "parent_link.verify")).toBe(false);
    await grantTenantPermission(db, sa, input);
  });
});
