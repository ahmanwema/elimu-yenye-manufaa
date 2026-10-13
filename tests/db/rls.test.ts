import type { PGlite, Transaction } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDatabase } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";

// Runs the real RLS migration and checks it as the `authenticated` role with a
// Supabase-style JWT claim — i.e. how the Supabase Data API would execute queries.

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
  await seed(db);
});

afterAll(async () => {
  await db?.close();
});

const ids = async (tx: Transaction, sql: string, params: unknown[] = []) =>
  (await tx.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort();

const visibleTenants = (userId: string) => asUser(db, userId, (tx) => ids(tx, "SELECT id FROM tenants"));
const visibleProfiles = (userId: string) => asUser(db, userId, (tx) => ids(tx, "SELECT id FROM profiles"));
const visibleStudents = (userId: string) =>
  asUser(db, userId, (tx) => ids(tx, "SELECT profile_id AS id FROM student_accounts"));

describe("tenant isolation (RLS)", () => {
  it("Markaz A admin sees Markaz A only", async () => {
    expect(await visibleTenants(U.adminA)).toEqual([T.A]);
  });

  it("Markaz A admin cannot fetch Markaz B even by id", async () => {
    const rows = await asUser(db, U.adminA, (tx) => ids(tx, "SELECT id FROM tenants WHERE id = $1", [T.B]));
    expect(rows).toEqual([]);
  });

  it("Markaz A admin sees all A memberships and no B memberships", async () => {
    const tenantsOfVisibleMemberships = await asUser(db, U.adminA, async (tx) =>
      [...new Set((await tx.query<{ tenant_id: string }>("SELECT tenant_id FROM memberships")).rows.map((r) => r.tenant_id))],
    );
    expect(tenantsOfVisibleMemberships).toEqual([T.A]);
    const bRows = await asUser(db, U.adminA, (tx) =>
      ids(tx, "SELECT id FROM memberships WHERE tenant_id = $1", [T.B]),
    );
    expect(bRows).toEqual([]);
  });

  it("a teacher in A and B sees both Markaz", async () => {
    expect(await visibleTenants(U.teacherAB)).toEqual([T.A, T.B].sort());
  });

  it("a teacher in A only does not see B", async () => {
    expect(await visibleTenants(U.teacherA)).toEqual([T.A]);
  });

  // Superseded 2026-10-13 by A51 (teacher basic roster). Previously: "a teacher sees only
  // their own memberships". Now: own rows + ACTIVE STUDENT rows of their own Markaz, nothing else.
  it("a teacher sees own memberships plus ACTIVE student rows of their own Markaz only", async () => {
    const rows = await asUser(db, U.teacherA, async (tx) =>
      (await tx.query<{ profile_id: string; role: string; status: string; tenant_id: string }>(
        "SELECT profile_id, role, status, tenant_id FROM memberships",
      )).rows,
    );
    const others = rows.filter((r) => r.profile_id !== U.teacherA);
    expect(others.map((r) => r.profile_id)).toEqual([U.studentX]); // not studentLeft (ENDED), not studentY (B)
    expect(others.every((r) => r.role === "STUDENT" && r.status === "ACTIVE" && r.tenant_id === T.A)).toBe(true);
  });

  it("a student in A sees A only", async () => {
    expect(await visibleTenants(U.studentX)).toEqual([T.A]);
  });

  it("a platform admin sees every Markaz", async () => {
    expect(await visibleTenants(U.superAdmin)).toEqual([T.A, T.B].sort());
  });
});

describe("student privacy (RLS)", () => {
  it("Student X sees only their own profile and student account", async () => {
    expect(await visibleProfiles(U.studentX)).toEqual([U.studentX]);
    expect(await visibleStudents(U.studentX)).toEqual([U.studentX]);
  });

  it("Student X cannot read Student Y even by id", async () => {
    const rows = await asUser(db, U.studentX, (tx) => ids(tx, "SELECT id FROM profiles WHERE id = $1", [U.studentY]));
    expect(rows).toEqual([]);
  });

  it("Markaz A admin sees Student X (active in A) but not Student Y (B)", async () => {
    expect(await visibleStudents(U.adminA)).toEqual([U.studentX]);
  });

  it("a departed student still reads their own records and ENDED membership", async () => {
    expect(await visibleStudents(U.studentLeft)).toEqual([U.studentLeft]);
    const statuses = await asUser(db, U.studentLeft, async (tx) =>
      (await tx.query<{ status: string }>("SELECT status FROM memberships")).rows.map((r) => r.status),
    );
    expect(statuses).toEqual(["ENDED"]);
  });

  it("a departed student no longer sees the Markaz they left", async () => {
    expect(await visibleTenants(U.studentLeft)).toEqual([]);
  });

  it("the former Markaz admin no longer sees a departed student's account (current default — see OQ21)", async () => {
    const rows = await asUser(db, U.adminA, (tx) =>
      ids(tx, "SELECT profile_id AS id FROM student_accounts WHERE profile_id = $1", [U.studentLeft]),
    );
    expect(rows).toEqual([]);
  });
});

describe("parent access (RLS)", () => {
  it("an ACTIVE-linked parent sees the linked student, and only that student", async () => {
    expect(await visibleStudents(U.parentActive)).toEqual([U.studentX]);
    expect(await visibleProfiles(U.parentActive)).toEqual([U.parentActive, U.studentX].sort());
  });

  it.each([
    ["VERIFIED", U.parentVerified],
    ["PENDING", U.parentPending],
    ["REVOKED", U.parentRevoked],
    ["unlinked", U.parentUnlinked],
  ])("a %s parent sees no student", async (_label, parent) => {
    expect(await visibleStudents(parent)).toEqual([]);
    expect(await visibleProfiles(parent)).toEqual([parent]);
  });

  it("a parent can see their own link even while PENDING", async () => {
    const statuses = await asUser(db, U.parentPending, async (tx) =>
      (await tx.query<{ status: string }>("SELECT status FROM parent_student_links")).rows.map((r) => r.status),
    );
    expect(statuses).toEqual(["PENDING"]);
  });

  it("a parent cannot see another parent's links", async () => {
    const parents = await asUser(db, U.parentActive, async (tx) =>
      (await tx.query<{ parent_profile_id: string }>("SELECT parent_profile_id FROM parent_student_links")).rows.map(
        (r) => r.parent_profile_id,
      ),
    );
    expect(parents).toEqual([U.parentActive]);
  });

  it("a parent gets no Markaz visibility from a link", async () => {
    expect(await visibleTenants(U.parentActive)).toEqual([]);
  });
});

describe("write protection (RLS + grants)", () => {
  it.each([
    ["self-grant platform admin", `INSERT INTO platform_admins (profile_id) VALUES ('${U.studentX}')`],
    ["join another Markaz", `INSERT INTO memberships (tenant_id, profile_id, role) VALUES ('${T.B}', '${U.studentX}', 'MARKAZ_ADMIN')`],
    ["self-activate a parent link", `UPDATE parent_student_links SET status = 'ACTIVE' WHERE parent_profile_id = '${U.parentPending}'`],
    ["rename a Markaz", `UPDATE tenants SET name = 'x' WHERE id = '${T.A}'`],
    ["delete a membership", `DELETE FROM memberships WHERE profile_id = '${U.studentX}'`],
  ])("an authenticated user cannot %s directly", async (_label, sql) => {
    const actor = sql.includes(U.parentPending) ? U.parentPending : U.adminA;
    await expect(asUser(db, actor, (tx) => tx.exec(sql))).rejects.toThrow(/permission denied/);
  });

  it("anonymous requests cannot read anything", async () => {
    await expect(asAnon(db, (tx) => tx.query("SELECT id FROM tenants"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(db, (tx) => tx.query("SELECT id FROM profiles"))).rejects.toThrow(/permission denied/);
  });

  it("a forged JWT claim for a non-existent user sees nothing", async () => {
    expect(await visibleTenants("99999999-9999-4999-8999-999999999999")).toEqual([]);
  });
});
