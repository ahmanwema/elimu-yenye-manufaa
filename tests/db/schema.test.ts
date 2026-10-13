import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
  await seed(db);
});

afterAll(async () => {
  await db?.close();
});

describe("identity mapping", () => {
  it("creating a Supabase Auth user creates exactly one profile with the same id", async () => {
    const id = "12345678-0000-4000-8000-000000000099";
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    const rows = await db.query("SELECT id FROM profiles WHERE id = $1", [id]);
    expect(rows.rows).toHaveLength(1);
  });

  it("the trigger creates no role, membership or account type", async () => {
    const id = "12345678-0000-4000-8000-000000000098";
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    const counts = await db.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM memberships WHERE profile_id = $1)
            + (SELECT count(*) FROM platform_admins WHERE profile_id = $1)
            + (SELECT count(*) FROM student_accounts WHERE profile_id = $1)
            + (SELECT count(*) FROM parent_accounts WHERE profile_id = $1) AS n`,
      [id],
    );
    expect(Number(counts.rows[0].n)).toBe(0);
  });

  it("a profile cannot exist without a Supabase Auth user", async () => {
    await expect(db.query("INSERT INTO profiles (id) VALUES ('12345678-0000-4000-8000-000000000097')")).rejects.toThrow(
      /foreign key/,
    );
  });

  it("deleting an auth user that has a profile is blocked (deletion mechanics not decided)", async () => {
    await expect(db.query("DELETE FROM auth.users WHERE id = $1", [U.studentX])).rejects.toThrow(/foreign key/);
  });
});

describe("memberships", () => {
  it("a teacher can hold memberships in two Markaz", async () => {
    const rows = await db.query("SELECT tenant_id FROM memberships WHERE profile_id = $1 AND role = 'TEACHER'", [
      U.teacherAB,
    ]);
    expect(rows.rows).toHaveLength(2);
  });

  it("the same person may hold two different roles in one Markaz", async () => {
    await db.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'TEACHER')", [T.A, U.adminA]);
    const rows = await db.query("SELECT role FROM memberships WHERE tenant_id = $1 AND profile_id = $2", [T.A, U.adminA]);
    expect(rows.rows).toHaveLength(2);
  });

  it("the same role cannot be granted twice in the same Markaz", async () => {
    await expect(
      db.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'TEACHER')", [T.A, U.teacherA]),
    ).rejects.toThrow(/unique/);
  });

  it("an ENDED membership must record when it ended, and an ACTIVE one must not", async () => {
    await expect(
      db.query("UPDATE memberships SET status = 'ENDED' WHERE profile_id = $1 AND tenant_id = $2", [U.studentX, T.A]),
    ).rejects.toThrow(/memberships_ended_at_matches_status/);
    await expect(
      db.query("UPDATE memberships SET ended_at = now() WHERE profile_id = $1", [U.teacherA]),
    ).rejects.toThrow(/memberships_ended_at_matches_status/);
  });

  it("rejects unknown roles at the type level (SUPER_ADMIN and PARENT are not tenant roles)", async () => {
    for (const role of ["SUPER_ADMIN", "PARENT"]) {
      await expect(
        db.query(`INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, '${role}')`, [T.A, U.studentY]),
      ).rejects.toThrow(/invalid input value for enum/);
    }
  });
});

describe("parent–student links", () => {
  it("default status is PENDING", async () => {
    await db.query(
      "INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id) VALUES ($1, $2, $3)",
      [U.parentUnlinked, U.studentY, T.B],
    );
    const rows = await db.query<{ status: string }>(
      "SELECT status FROM parent_student_links WHERE parent_profile_id = $1",
      [U.parentUnlinked],
    );
    expect(rows.rows[0].status).toBe("PENDING");
  });

  it("one parent may be linked to several students", async () => {
    await db.query(
      "INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id, status) VALUES ($1, $2, $3, 'PENDING')",
      [U.parentActive, U.studentY, T.B],
    );
    const rows = await db.query("SELECT 1 FROM parent_student_links WHERE parent_profile_id = $1", [U.parentActive]);
    expect(rows.rows).toHaveLength(2);
  });

  it("duplicate links are rejected", async () => {
    await expect(
      db.query("INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id) VALUES ($1, $2, $3)", [
        U.parentActive,
        U.studentX,
        T.A,
      ]),
    ).rejects.toThrow(/unique/);
  });

  it("a link requires a parent account on one side and a student account on the other", async () => {
    // teacherA has neither account type.
    await expect(
      db.query("INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id) VALUES ($1, $2, $3)", [
        U.teacherA,
        U.studentX,
        T.A,
      ]),
    ).rejects.toThrow(/foreign key/);
  });

  it("a profile cannot be linked to itself", async () => {
    const id = "12345678-0000-4000-8000-000000000096";
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    await db.query("INSERT INTO student_accounts (profile_id) VALUES ($1)", [id]);
    await db.query("INSERT INTO parent_accounts (profile_id) VALUES ($1)", [id]);
    await expect(
      db.query("INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id) VALUES ($1, $1, $2)", [id, T.A]),
    ).rejects.toThrow(/parent_student_links_not_self/);
  });
});
