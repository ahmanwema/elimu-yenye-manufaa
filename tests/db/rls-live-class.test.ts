import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDatabase } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";
import { L, seedLive } from "../support/live";

// Data API (RLS) view of the Live Class tables (2026-10-19). Every table is SERVER-ONLY: their
// read rules depend on class assignments, enrollment access state and per-role stripping (a
// parent must never see raw presence), which a direct Data API read could not honour.
let db: PGlite;
let classId: string;
let sessionId: string;

const LIVE_TABLES = [
  "classes",
  "class_teacher_assignments",
  "class_schedules",
  "class_enrollments",
  "grace_extensions",
  "access_payment_submissions",
  "access_payment_submission_enrollments",
  "live_sessions",
  "live_session_participants",
  "live_session_connections",
  "attendance_records",
  "live_chat_messages",
];
const EVERYONE = [U.superAdmin, U.adminA, U.adminB, U.teacherA, U.teacherAB, U.studentX, U.parentActive, L.s1];

beforeAll(async () => {
  db = await createTestDatabase();
  await seed(db);
  await seedLive(db);
  const c = await db.query<{ id: string }>("INSERT INTO classes (tenant_id, name, created_by_id) VALUES ($1, 'C', $2) RETURNING id", [T.A, U.adminA]);
  classId = c.rows[0].id;
  await db.query("INSERT INTO class_teacher_assignments (tenant_id, class_id, teacher_profile_id, role, assigned_by_id, assigned_at) VALUES ($1, $2, $3, 'PRIMARY', $4, now())", [T.A, classId, U.teacherA, U.adminA]);
  await db.query("INSERT INTO class_enrollments (tenant_id, class_id, student_profile_id, status, enrolled_by_id, enrolled_at, status_changed_at) VALUES ($1, $2, $3, 'ACTIVE', $4, now(), now())", [T.A, classId, U.studentX, U.adminA]);
  const s = await db.query<{ id: string }>(
    `INSERT INTO live_sessions (tenant_id, class_id, kind, status, scheduled_start_at, scheduled_end_at, created_by_id, actual_start_at, started_by_id)
     VALUES ($1, $2, 'SCHEDULED', 'LIVE', now(), now() + interval '1 hour', $3, now(), $3) RETURNING id`,
    [T.A, classId, U.teacherA],
  );
  sessionId = s.rows[0].id;
  const p = await db.query<{ id: string }>(
    "INSERT INTO live_session_participants (tenant_id, session_id, profile_id, role, admission, first_joined_at) VALUES ($1, $2, $3, 'STUDENT', 'ADMITTED', now()) RETURNING id",
    [T.A, sessionId, U.studentX],
  );
  await db.query("INSERT INTO live_session_connections (tenant_id, session_id, participant_id, mode, connected_at, admitted_at) VALUES ($1, $2, $3, 'PRIMARY', now(), now())", [T.A, sessionId, p.rows[0].id]);
  await db.query("INSERT INTO live_chat_messages (tenant_id, class_id, session_id, author_profile_id, author_role, body) VALUES ($1, $2, $3, $4, 'STUDENT', 'hi')", [T.A, classId, sessionId, U.studentX]);
});

describe("Live Class tables are server-only", () => {
  it.each(LIVE_TABLES)("%s: no Data API read for anyone — not even a Super Admin, a teacher of the class, or the student", async (table) => {
    for (const who of EVERYONE) {
      await expect(asUser(db, who, (tx) => tx.query(`SELECT 1 FROM ${table}`)), who).rejects.toThrow(/permission denied/);
    }
    await expect(asAnon(db, (tx) => tx.query(`SELECT 1 FROM ${table}`))).rejects.toThrow(/permission denied/);
  });

  it("no Data API writes (raw presence, chat, enrollment, payment, attendance)", async () => {
    await expect(asUser(db, U.studentX, (tx) => tx.query("INSERT INTO live_chat_messages (tenant_id, class_id, session_id, author_profile_id, author_role, body) VALUES ($1, $2, $3, $4, 'STUDENT', 'x')", [T.A, classId, sessionId, U.studentX]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, U.teacherA, (tx) => tx.query("UPDATE attendance_records SET status = 'PRESENT'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, U.adminA, (tx) => tx.query("DELETE FROM live_session_connections"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, U.studentX, (tx) => tx.query("UPDATE class_enrollments SET status = 'ACTIVE'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, U.teacherA, (tx) => tx.query("UPDATE access_payment_submissions SET status = 'VERIFIED'"))).rejects.toThrow(/permission denied/);
  });

  it("RLS is enabled on every Live Class table (defence in depth if a grant ever slips back)", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`,
      [LIVE_TABLES],
    );
    expect(rows).toHaveLength(LIVE_TABLES.length);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("the membership guard function is not callable by API roles", async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      "SELECT has_function_privilege('authenticated', 'app.require_active_membership()', 'EXECUTE') OR has_function_privilege('anon', 'app.require_active_membership()', 'EXECUTE') AS ok",
    );
    expect(rows[0].ok).toBe(false);
  });
});

describe("integrity rules", () => {
  it("cross-tenant pointers are impossible (composite FKs)", async () => {
    await expect(
      db.query("INSERT INTO class_schedules (tenant_id, class_id, weekday, start_minute, duration_minutes, created_by_id) VALUES ($1, $2, 1, 60, 60, $3)", [T.B, classId, U.adminB]),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query("INSERT INTO live_chat_messages (tenant_id, class_id, session_id, author_profile_id, author_role, body) VALUES ($1, $2, $3, $4, 'STUDENT', 'x')", [T.B, classId, sessionId, U.studentY]),
    ).rejects.toThrow(/foreign key/);
  });

  it("one LIVE session per class; a session's end follows its start", async () => {
    await expect(
      db.query(`INSERT INTO live_sessions (tenant_id, class_id, kind, status, scheduled_start_at, scheduled_end_at, created_by_id, actual_start_at, started_by_id) VALUES ($1, $2, 'AD_HOC', 'LIVE', now(), now() + interval '1 hour', $3, now(), $3)`, [T.A, classId, U.teacherA]),
    ).rejects.toThrow(/live_sessions_one_live_per_class/);
    await expect(
      db.query(`INSERT INTO live_sessions (tenant_id, class_id, kind, status, scheduled_start_at, scheduled_end_at, created_by_id) VALUES ($1, $2, 'SCHEDULED', 'SCHEDULED', now(), now() - interval '1 minute', $3)`, [T.A, classId, U.teacherA]),
    ).rejects.toThrow(/live_session_schedule_order/);
  });

  it("status fields travel together (ended needs a reason; a safety close has no actor; cancelled needs an actor)", async () => {
    await expect(db.query("UPDATE live_sessions SET status = 'ENDED', actual_end_at = now() WHERE id = $1", [sessionId])).rejects.toThrow(/live_session_status_fields/);
    await expect(db.query("UPDATE live_sessions SET status = 'ENDED', actual_end_at = now(), end_reason = 'SAFETY_CLOSE', ended_by_id = $2 WHERE id = $1", [sessionId, U.teacherA])).rejects.toThrow(/live_session_status_fields/);
  });

  it("a capacity override always carries actor, time and reason", async () => {
    await expect(db.query("UPDATE class_enrollments SET capacity_override_by_id = $1, capacity_override_at = now() WHERE class_id = $2", [U.adminA, classId])).rejects.toThrow(/enrollment_capacity_override_fields/);
  });

  it("only students hold mic/whiteboard/hand state; teacher rows have no admission", async () => {
    await expect(
      db.query("INSERT INTO live_session_participants (tenant_id, session_id, profile_id, role, first_joined_at, mic_granted_at, mic_granted_by_id) VALUES ($1, $2, $3, 'CO_TEACHER', now(), now(), $3)", [T.A, sessionId, U.teacherAB]),
    ).rejects.toThrow(/participant_student_only_state/);
  });

  it("one open PRIMARY device per participant", async () => {
    const p = await db.query<{ id: string }>("SELECT id FROM live_session_participants WHERE session_id = $1 AND profile_id = $2", [sessionId, U.studentX]);
    await expect(
      db.query("INSERT INTO live_session_connections (tenant_id, session_id, participant_id, mode, connected_at) VALUES ($1, $2, $3, 'PRIMARY', now())", [T.A, sessionId, p.rows[0].id]),
    ).rejects.toThrow(/one_open_primary/);
  });

  it("chat bodies are non-empty and bounded; attendance adjustments carry actor + reason", async () => {
    await expect(db.query("INSERT INTO live_chat_messages (tenant_id, class_id, session_id, author_profile_id, author_role, body) VALUES ($1, $2, $3, $4, 'STUDENT', '   ')", [T.A, classId, sessionId, U.studentX])).rejects.toThrow(/chat_body_present/);
    await expect(
      db.query(
        `INSERT INTO attendance_records (tenant_id, session_id, student_profile_id, computed_status, status, present_seconds, session_seconds, computed_at) VALUES ($1, $2, $3, 'ABSENT', 'PRESENT', 0, 60, now())`,
        [T.A, sessionId, U.studentX],
      ),
    ).rejects.toThrow(/attendance_adjustment_fields/);
  });

  it("history is never deleted through FKs: a profile with Live Class history cannot be removed", async () => {
    await expect(db.query("DELETE FROM profiles WHERE id = $1", [U.studentX])).rejects.toThrow(/foreign key/);
  });
});
