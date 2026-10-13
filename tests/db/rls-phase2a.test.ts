import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";

// Data API (RLS) checks for the Phase 2A tables and policies.

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
  await seed(db);
  await db.query(
    "INSERT INTO invitations (token_hash, email, tenant_id, role, invited_by_id, expires_at) VALUES ('h', 'x@example.com', $1, 'TEACHER', $2, now() + interval '1 day')",
    [T.A, U.adminA],
  );
});

afterAll(async () => {
  await db?.close();
});

const count = (who: string, sql: string, params: unknown[] = []) =>
  asUser(db, who, async (tx) => (await tx.query(sql, params)).rows.length);

describe("server-only tables", () => {
  it.each(["invitations", "markaz_admin_appointment_requests"])("%s cannot be read through the Data API at all", async (table) => {
    for (const who of [U.adminA, U.superAdmin, U.teacherA]) {
      await expect(asUser(db, who, (tx) => tx.query(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("teacher basic roster (RLS)", () => {
  it("a teacher sees the profiles of ACTIVE students of their own Markaz only", async () => {
    expect(await count(U.teacherA, "SELECT id FROM profiles WHERE id = $1", [U.studentX])).toBe(1);
    expect(await count(U.teacherA, "SELECT id FROM profiles WHERE id = $1", [U.studentY])).toBe(0);
    expect(await count(U.teacherA, "SELECT id FROM profiles WHERE id = $1", [U.studentLeft])).toBe(0);
    expect(await count(U.teacherAB, "SELECT id FROM profiles WHERE id = $1", [U.studentY])).toBe(1);
  });

  it("the roster does not unlock detailed records (student accounts) for teachers", async () => {
    expect(await count(U.teacherA, "SELECT profile_id FROM student_accounts")).toBe(0);
  });

  it("a teacher does not see other teachers or admins of their Markaz", async () => {
    expect(await count(U.teacherA, "SELECT id FROM profiles WHERE id IN ($1, $2)", [U.adminA, U.teacherAB])).toBe(0);
  });
});

describe("parent links (RLS)", () => {
  it("a verifier sees links of the Markaz where they hold the permission, not another", async () => {
    expect(await count(U.teacherAB, "SELECT id FROM parent_student_links WHERE tenant_id = $1", [T.A])).toBe(4);
    expect(await count(U.teacherAB, "SELECT id FROM parent_student_links WHERE tenant_id = $1", [T.B])).toBe(0);
  });

  it("a teacher with a revoked grant sees no links", async () => {
    expect(await count(U.teacherA, "SELECT id FROM parent_student_links")).toBe(0);
  });

  it("a Markaz Admin sees the links of their own Markaz only", async () => {
    expect(await count(U.adminB, "SELECT id FROM parent_student_links")).toBe(1);
  });

  it("a platform admin is NOT a verifier in SQL either", async () => {
    const r = await asUser(db, U.superAdmin, (tx) =>
      tx.query<{ ok: boolean }>("SELECT app.has_tenant_permission($1, 'PARENT_LINK_VERIFY') AS ok", [T.A]),
    );
    expect(r.rows[0].ok).toBe(false);
  });
});

describe("permission grants (RLS)", () => {
  it("a holder sees their own live and revoked grants; another teacher sees none of theirs", async () => {
    expect(await count(U.teacherAB, "SELECT id FROM tenant_permission_grants")).toBe(1);
    expect(await count(U.teacherA, "SELECT id FROM tenant_permission_grants WHERE profile_id = $1", [U.teacherAB])).toBe(0);
  });

  it("nobody can grant themselves a permission through the Data API", async () => {
    await expect(
      asUser(db, U.teacherA, (tx) =>
        tx.query(
          "INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id) VALUES ($1, $2, 'PARENT_LINK_VERIFY', $2)",
          [T.A, U.teacherA],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
