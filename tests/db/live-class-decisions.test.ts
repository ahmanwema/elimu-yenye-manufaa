import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, asUser, createTestDatabase, migrationNames } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";

// Migrations 20261019000200 / 20261019000300 (owner decisions A131–A137), checked on a database
// that already holds rows from BEFORE them — exactly the situation of a DEV apply.
const BEFORE = "20261019000100_live_class_foundation_rls";
let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase(BEFORE);
  await seed(db);
  // Markaz A: a Markaz Admin explicitly chose a zone (audited). Markaz B: only the old DEFAULT 'UTC'.
  await db.query("UPDATE tenants SET timezone = 'Africa/Nairobi' WHERE id = $1", [T.A]);
  await db.query("INSERT INTO audit_events (actor_id, tenant_id, action, target_type, target_id) VALUES ($1, $2, 'TENANT_TIMEZONE_SET', 'TENANT', $2)", [U.adminA, T.A]);
  expect((await db.query<{ timezone: string }>("SELECT timezone FROM tenants WHERE id = $1", [T.B])).rows[0].timezone).toBe("UTC");
  await applyMigrations(db, migrationNames().filter((n) => n > BEFORE));
});

afterAll(async () => {
  await db?.close();
});

describe("A131: Markaz time zone is never invented", () => {
  it("a zone that was only the old column DEFAULT is cleared; an explicitly chosen zone is kept", async () => {
    const { rows } = await db.query<{ id: string; timezone: string | null }>("SELECT id, timezone FROM tenants ORDER BY name");
    expect(Object.fromEntries(rows.map((r) => [r.id, r.timezone]))).toEqual({ [T.A]: "Africa/Nairobi", [T.B]: null });
  });

  it("new Markaz get no zone (no default); blank zones are refused", async () => {
    await db.query("INSERT INTO tenants (name, slug) VALUES ('Markaz C', 'markaz-c')");
    expect((await db.query<{ timezone: string | null }>("SELECT timezone FROM tenants WHERE slug = 'markaz-c'")).rows[0].timezone).toBeNull();
    await expect(db.query("UPDATE tenants SET timezone = '  ' WHERE slug = 'markaz-c'")).rejects.toThrow(/tenant_timezone_present/);
  });
});

describe("schema of the decision fixes", () => {
  it("classes are NOT paid by default (no class is assumed to be paid)", async () => {
    const { rows } = await db.query<{ column_default: string; is_nullable: string }>(
      "SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'classes' AND column_name = 'payment_required'",
    );
    expect(rows[0]).toEqual({ column_default: "false", is_nullable: "NO" });
  });

  it("punctuality exists exactly when the student arrived; attendance is PRESENT/ABSENT only", async () => {
    const c = await db.query<{ id: string }>("INSERT INTO classes (tenant_id, name, created_by_id) VALUES ($1, 'C', $2) RETURNING id", [T.A, U.adminA]);
    const s = await db.query<{ id: string }>(
      `INSERT INTO live_sessions (tenant_id, class_id, kind, status, scheduled_start_at, scheduled_end_at, created_by_id) VALUES ($1, $2, 'SCHEDULED', 'SCHEDULED', now(), now() + interval '1 hour', $3) RETURNING id`,
      [T.A, c.rows[0].id, U.teacherA],
    );
    const insert = (status: string, punctuality: string | null, arrival: string | null) =>
      db.query(
        `INSERT INTO attendance_records (tenant_id, session_id, student_profile_id, computed_status, status, computed_punctuality, punctuality, present_seconds, session_seconds, first_arrival_at, computed_at)
         VALUES ($1, $2, $3, $4::"AttendanceStatus", $4::"AttendanceStatus", $5::"Punctuality", $5::"Punctuality", 0, 60, $6::timestamptz, now())`,
        [T.A, s.rows[0].id, U.studentX, status, punctuality, arrival],
      );
    await expect(insert("LATE", "LATE", "2026-11-02T06:20:00Z")).rejects.toThrow(/attendance_presence_only/);
    await expect(insert("ABSENT", "LATE", null)).rejects.toThrow(/attendance_punctuality_with_arrival/);
    await expect(insert("ABSENT", null, "2026-11-02T06:20:00Z")).rejects.toThrow(/attendance_punctuality_with_arrival/);
    await insert("ABSENT", "LATE", "2026-11-02T06:20:00Z"); // ABSENT + LATE is a valid combination
  });

  // Superseded (A140): "payment.verify is a grantable tenant permission". It can no longer be granted to anyone.
  it("A140: PAYMENT_VERIFY can never be granted — not to a Teacher, not to anyone", async () => {
    await expect(
      db.query("INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id) VALUES ($1, $2, 'PAYMENT_VERIFY', $3)", [T.A, U.teacherA, U.adminA]),
    ).rejects.toThrow(/grant_not_payment_verify/);
  });

  it("A140: FINANCE_OFFICER is a real tenant role; a finance-only member reads their own Markaz row and nothing of the student/Live Class data", async () => {
    const id = "00000000-0000-4000-8000-00000000fff2";
    await db.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
    await db.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'FINANCE_OFFICER')", [T.A, id]);
    const rows = (sql: string) => asUser(db, id, async (tx) => (await tx.query(sql)).rows.length);
    expect(await rows("SELECT id FROM tenants")).toBe(1); // own Markaz only
    expect(await rows("SELECT 1 FROM corrections")).toBe(0);
    expect(await rows("SELECT 1 FROM student_accounts")).toBe(0);
    for (const table of ["classes", "class_enrollments", "access_payment_submissions", "attendance_records", "live_chat_messages", "recordings"]) {
      await expect(asUser(db, id, (tx) => tx.query(`SELECT 1 FROM ${table}`)), table).rejects.toThrow(/permission denied/);
    }
    // Ending the membership removes even the Markaz row.
    await db.query("UPDATE memberships SET status = 'ENDED', ended_at = now() WHERE profile_id = $1", [id]);
    expect(await rows("SELECT id FROM tenants")).toBe(0);
  });

  it("the Live Class tables stay server-only after the fixes", async () => {
    for (const table of ["classes", "class_enrollments", "attendance_records"]) {
      await expect(asUser(db, U.adminA, (tx) => tx.query(`SELECT 1 FROM ${table}`))).rejects.toThrow(/permission denied/);
    }
  });
});
