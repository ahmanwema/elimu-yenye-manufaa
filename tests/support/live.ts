import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "@/generated/prisma/client";
import { assignClassTeacher, createClass } from "@/server/services/classes";
import { enrollStudent } from "@/server/services/enrollments";
import { actor } from "../db/prisma";
import { T, U } from "./fixture";

// Extra cast for Live Class tests, added on top of the shared fixture in each test database only.
// Capacity numbers used in tests are FIXTURES, never business defaults (A33).

export const L = {
  teacherA3: "00000000-0000-4000-8000-0000000000f1", // ACTIVE teacher in A, not assigned to the class
  departedTeacher: "00000000-0000-4000-8000-0000000000f2", // teacher in A whose membership ENDED
  s1: "00000000-0000-4000-8000-0000000000f3", // students in A
  s2: "00000000-0000-4000-8000-0000000000f4",
  s3: "00000000-0000-4000-8000-0000000000f5",
  teacherB: "00000000-0000-4000-8000-0000000000f6", // teacher in B only
} as const;

/** 2026-11-02 is a Monday. 06:00 UTC = 09:00 in Africa/Nairobi (UTC+3, no DST). */
export const NOW = new Date("2026-11-02T06:00:00Z");
export const minutes = (n: number) => n * 60_000;
export const at = (offsetMinutes: number) => new Date(NOW.getTime() + minutes(offsetMinutes));

export async function seedLive(pg: PGlite) {
  for (const id of Object.values(L)) await pg.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  await pg.query(
    `INSERT INTO memberships (tenant_id, profile_id, role, status, ended_at) VALUES
       ($1, $3, 'TEACHER', 'ACTIVE', NULL),
       ($1, $4, 'TEACHER', 'ACTIVE', NULL),
       ($1, $5, 'STUDENT', 'ACTIVE', NULL),
       ($1, $6, 'STUDENT', 'ACTIVE', NULL),
       ($1, $7, 'STUDENT', 'ACTIVE', NULL),
       ($2, $8, 'TEACHER', 'ACTIVE', NULL)`,
    [T.A, T.B, L.teacherA3, L.departedTeacher, L.s1, L.s2, L.s3, L.teacherB],
  );
  for (const id of [L.s1, L.s2, L.s3]) await pg.query("INSERT INTO student_accounts (profile_id) VALUES ($1)", [id]);
  await pg.query("UPDATE tenants SET timezone = 'Africa/Nairobi' WHERE id = $1", [T.A]);
}

/** Ends a membership (owner path), e.g. a teacher leaving the Markaz. */
export async function endMembership(pg: PGlite, tenantId: string, profileId: string, role: string) {
  await pg.query(`UPDATE memberships SET status = 'ENDED', ended_at = now() WHERE tenant_id = $1 AND profile_id = $2 AND role = $3::"TenantRole"`, [tenantId, profileId, role]);
}

/**
 * A class of Markaz A: Primary = teacherA, Co-Teacher = teacherAB; studentX and s1 enrolled.
 * Capacities are test fixtures only.
 */
export async function classWithStudents(db: PrismaClient, opts: { enrollmentCapacity?: number | null; liveCapacity?: number | null; students?: string[] } = {}) {
  const admin = await actor(db, U.adminA);
  const classId = await createClass(
    db,
    admin,
    {
      tenantId: T.A,
      name: "Tajwid 1",
      primaryTeacherProfileId: U.teacherA,
      enrollmentCapacity: opts.enrollmentCapacity ?? null,
      liveCapacity: opts.liveCapacity ?? null,
    },
    { now: NOW },
  );
  await assignClassTeacher(db, admin, { classId, teacherProfileId: U.teacherAB, role: "CO_TEACHER" }, { now: NOW });
  for (const s of opts.students ?? [U.studentX, L.s1]) await enrollStudent(db, admin, { classId, studentProfileId: s }, { now: NOW });
  return classId;
}

export async function auditCount(pg: PGlite, action: string, targetId?: string) {
  const { rows } = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE action = $1::"AuditAction" ${targetId ? "AND target_id = $2" : ""}`,
    targetId ? [action, targetId] : [action],
  );
  return rows[0].n;
}
