import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { canReadStudentDetailNow } from "@/server/data/student-detail";
import { createClass, removeCoTeacher } from "@/server/services/classes";
import { enrollStudent } from "@/server/services/enrollments";
import { assignSubstitute, createScheduledSession } from "@/server/services/live-sessions";
import { actor, createTestPrisma } from "../db/prisma";
import { T, U } from "../support/fixture";
import { classWithStudents, endMembership, L, NOW, seedLive } from "../support/live";

// A51 wired to real classes (A137): detailed student data for a Teacher only when they are an
// ACTIVE Teacher of that Markaz, CURRENTLY assigned (Primary / Co-Teacher) to a class in which
// the student holds ACTIVE/GRACE access.
let pg: PGlite;
let db: PrismaClient;
let classId: string;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedLive(pg);
  classId = await classWithStudents(db); // Primary teacherA, Co teacherAB; studentX and s1 enrolled
});

const may = async (who: string, studentProfileId: string, tenantId: string = T.A) =>
  canReadStudentDetailNow(db, await actor(db, who), { tenantId, studentProfileId }, NOW);

describe("teacher detailed student access (A137)", () => {
  it("Primary Teacher → allow; Co-Teacher → allow", async () => {
    expect(await may(U.teacherA, U.studentX)).toBe(true);
    expect(await may(U.teacherAB, U.studentX)).toBe(true);
  });

  it("unrelated Teacher of the same Markaz → deny", async () => {
    expect(await may(L.teacherA3, U.studentX)).toBe(false);
  });

  it("ended Teacher membership → deny (the assignment row alone grants nothing)", async () => {
    await endMembership(pg, T.A, U.teacherA, "TEACHER");
    expect(await may(U.teacherA, U.studentX)).toBe(false);
  });

  it("an ended assignment → deny", async () => {
    const co = await db.classTeacherAssignment.findFirstOrThrow({ where: { classId, role: "CO_TEACHER" } });
    await removeCoTeacher(db, await actor(db, U.adminA), { assignmentId: co.id }, { now: NOW });
    expect(await may(U.teacherAB, U.studentX)).toBe(false);
  });

  it("a teacher assigned in ANOTHER class → deny for students not in their class", async () => {
    const other = await createClass(db, await actor(db, U.adminA), { tenantId: T.A, name: "Other", primaryTeacherProfileId: L.teacherA3 }, { now: NOW });
    await enrollStudent(db, await actor(db, U.adminA), { classId: other, studentProfileId: L.s2 }, { now: NOW });
    expect(await may(L.teacherA3, L.s2)).toBe(true);
    expect(await may(L.teacherA3, U.studentX)).toBe(false); // studentX is not in teacherA3's class
    expect(await may(U.teacherA, L.s2)).toBe(false); // s2 is not in teacherA's class
  });

  it("cross-Markaz → deny (a teacher of both Markaz, a Markaz B admin)", async () => {
    expect(await may(U.teacherAB, U.studentX, T.B)).toBe(false);
    expect(await may(U.adminB, U.studentX)).toBe(false);
    expect(await may(L.teacherB, U.studentX)).toBe(false);
  });

  it("a per-session Substitute gains no ongoing detailed access", async () => {
    const sessionId = await createScheduledSession(db, await actor(db, U.teacherA), { classId, date: "2026-11-03", startTime: "10:00", durationMinutes: 60 }, { now: NOW });
    await assignSubstitute(db, await actor(db, U.teacherA), { sessionId, substituteProfileId: L.teacherA3 }, { now: NOW });
    expect(await may(L.teacherA3, U.studentX)).toBe(false);
  });

  it("the student's access must be ACTIVE/GRACE: suspended, waitlisted, pending payment or ended → deny", async () => {
    for (const status of ["SUSPENDED", "WAITLISTED", "PENDING_PAYMENT"] as const) {
      await db.classEnrollment.updateMany({ where: { classId, studentProfileId: U.studentX }, data: { status, waitlistedAt: NOW } });
      expect(await may(U.teacherA, U.studentX), status).toBe(false);
    }
    // An expired access period counts at once (effective state), before any job runs.
    await db.classEnrollment.updateMany({ where: { classId, studentProfileId: U.studentX }, data: { status: "ACTIVE", accessUntil: new Date("2026-10-01T00:00:00Z") } });
    expect(await may(U.teacherA, U.studentX)).toBe(false);
  });

  it("Markaz Admin keeps own-Markaz access; the student sees themself; a parent is not decided here", async () => {
    expect(await may(U.adminA, L.s2)).toBe(true); // admin: any ACTIVE student of own Markaz
    expect(await may(U.studentX, U.studentX)).toBe(true);
    expect(await may(U.parentActive, U.studentX)).toBe(false); // parents have their own category rules (A41)
    expect(await may(U.teacherA, "not-a-uuid")).toBe(false);
  });
});
