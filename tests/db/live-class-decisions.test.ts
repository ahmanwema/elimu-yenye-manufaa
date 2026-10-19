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

  it("payment.verify is a grantable tenant permission, effective in RLS only for staff roles", async () => {
    await db.query("INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id) VALUES ($1, $2, 'PAYMENT_VERIFY', $3), ($1, $4, 'PAYMENT_VERIFY', $3)", [T.A, U.teacherA, U.adminA, U.studentX]);
    const has = (who: string) => asUser(db, who, async (tx) => (await tx.query<{ ok: boolean }>("SELECT app.has_tenant_permission($1, 'PAYMENT_VERIFY') AS ok", [T.A])).rows[0].ok);
    expect(await has(U.teacherA)).toBe(true);
    expect(await has(U.studentX)).toBe(false); // a grant to an ineligible role is useless
    expect(await has(U.adminA)).toBe(false); // never implied by a role (the admin verifies by role in the service)
  });

  it("the Live Class tables stay server-only after the fixes", async () => {
    for (const table of ["classes", "class_enrollments", "attendance_records"]) {
      await expect(asUser(db, U.adminA, (tx) => tx.query(`SELECT 1 FROM ${table}`))).rejects.toThrow(/permission denied/);
    }
  });
});
