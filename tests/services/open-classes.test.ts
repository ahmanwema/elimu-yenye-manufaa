import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createClass, updateClass } from "@/server/services/classes";
import { activateMembership } from "@/server/services/invitations";
import { joinSession, startAdHocSession } from "@/server/services/live-sessions";
import { actor, createTestPrisma } from "../db/prisma";
import { T, U } from "../support/fixture";
import { L, NOW, seedLive } from "../support/live";

// A159 (owner decision 2026-11-27): an OPEN class enrolls every ACTIVE student of its Markaz
// automatically — when it is created or opened, and when a student joins the Markaz later — so
// nobody has to enroll students class by class. Seat and payment rules are the manual ones.

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedLive(pg);
});

const as = (id: string) => actor(db, id);
const ACTIVE_STUDENTS_A = [U.studentX, L.s1, L.s2, L.s3].sort();

async function newClass(extra: Record<string, unknown> = {}) {
  return createClass(db, await as(U.adminA), { tenantId: T.A, name: "Open", primaryTeacherProfileId: U.teacherA, ...extra }, { now: NOW });
}
const enrollments = (classId: string) =>
  db.classEnrollment.findMany({ where: { classId }, select: { studentProfileId: true, status: true }, orderBy: { studentProfileId: "asc" } });

describe("open classes (A159)", () => {
  it("a class created open enrolls every ACTIVE student of its Markaz — not ended members, not other Markaz", async () => {
    const classId = await newClass({ openToMarkaz: true });
    const rows = await enrollments(classId);
    expect(rows.map((r) => r.studentProfileId).sort()).toEqual(ACTIVE_STUDENTS_A);
    expect(rows.every((r) => r.status === "ACTIVE")).toBe(true);
    expect(rows.map((r) => r.studentProfileId)).not.toContain(U.studentLeft); // membership ENDED
    expect(rows.map((r) => r.studentProfileId)).not.toContain(U.studentY); // Markaz B
    const { rows: audits } = await pg.query<{ n: number }>(`SELECT count(*)::int n FROM audit_events WHERE action = 'ENROLLMENT_CREATED' AND metadata->>'source' = 'OPEN_CLASS'`);
    expect(audits[0].n).toBe(4);
  });

  it("a closed class (the service default) enrolls nobody", async () => {
    expect(await enrollments(await newClass())).toEqual([]);
  });

  it("capacity still applies: extra students are waitlisted", async () => {
    const rows = await enrollments(await newClass({ openToMarkaz: true, enrollmentCapacity: 2 }));
    expect(rows.filter((r) => r.status === "ACTIVE")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "WAITLISTED")).toHaveLength(2);
  });

  it("a paid open class gives no access before a verified payment", async () => {
    const rows = await enrollments(await newClass({ openToMarkaz: true, paymentRequired: true }));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "PENDING_PAYMENT")).toBe(true);
  });

  it("opening an existing class enrolls the current students once; re-saving changes nothing", async () => {
    const classId = await newClass();
    await updateClass(db, await as(U.adminA), { classId, openToMarkaz: true }, { now: NOW });
    expect((await enrollments(classId)).map((r) => r.studentProfileId).sort()).toEqual(ACTIVE_STUDENTS_A);
    await updateClass(db, await as(U.adminA), { classId, openToMarkaz: true, name: "Renamed" }, { now: NOW });
    expect(await enrollments(classId)).toHaveLength(4);
  });

  it("a student who joins the Markaz later is enrolled into its open classes only", async () => {
    const open = await newClass({ openToMarkaz: true });
    const closed = await newClass();
    const newcomer = "00000000-0000-4000-8000-0000000000fa";
    await pg.query("INSERT INTO auth.users (id) VALUES ($1)", [newcomer]);
    await pg.query("INSERT INTO student_accounts (profile_id) VALUES ($1)", [newcomer]);
    await db.$transaction((tx) => activateMembership(tx, T.A, newcomer, "STUDENT"));
    expect((await enrollments(open)).map((r) => r.studentProfileId)).toContain(newcomer);
    expect(await enrollments(closed)).toEqual([]);
    // Activating again (e.g. a second link) does not create a duplicate.
    await db.$transaction((tx) => activateMembership(tx, T.A, newcomer, "STUDENT"));
    expect((await enrollments(open)).filter((r) => r.studentProfileId === newcomer)).toHaveLength(1);
  });

  it("a teacher membership is never enrolled", async () => {
    const open = await newClass({ openToMarkaz: true });
    await db.$transaction((tx) => activateMembership(tx, T.A, L.teacherA3, "TEACHER"));
    expect((await enrollments(open)).map((r) => r.studentProfileId)).not.toContain(L.teacherA3);
  });

  it("a Markaz student joins a live session of an open class with no manual enrollment", async () => {
    const classId = await newClass({ openToMarkaz: true });
    const sessionId = await startAdHocSession(db, await as(U.teacherA), { classId }, { now: NOW });
    const joined = await joinSession(db, await as(L.s2), { sessionId }, { now: NOW });
    expect(joined).toMatchObject({ role: "STUDENT", admission: "ADMITTED", mode: "PRIMARY" });
  });
});
