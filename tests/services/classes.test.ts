import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import {
  addClassSchedule,
  archiveClass,
  assignClassTeacher,
  createClass,
  getClassOverview,
  listClasses,
  removeCoTeacher,
  setTenantCapacityLimits,
  setTenantTimezone,
  updateClass,
} from "@/server/services/classes";
import {
  admitFromWaitlist,
  advanceEnrollmentStates,
  endEnrollment,
  enrollStudent,
  extendGrace,
  rejectPayment,
  submitPaymentEvidence,
  verifyPayment,
} from "@/server/services/enrollments";
import { effectiveEnrollmentState } from "@/server/services/live-rules";
import { grantTenantPermission } from "@/server/services/permissions";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";
import { auditCount, classWithStudents, endMembership, L, NOW, seedLive } from "../support/live";

let pg: PGlite;
let db: PrismaClient;
const O = { now: NOW };
const DAY = 86_400_000;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedLive(pg);
});

const as = (id: string) => actor(db, id);
const enrollmentOf = (classId: string, studentProfileId: string) =>
  db.classEnrollment.findFirstOrThrow({ where: { classId, studentProfileId }, orderBy: { enrolledAt: "desc" } });

describe("Class (A102) — tenant-scoped, one Primary Teacher", () => {
  it("a Markaz Admin creates a class in their own Markaz with exactly one Primary; audited", async () => {
    const classId = await createClass(db, await as(U.adminA), { tenantId: T.A, name: "Hifdh", primaryTeacherProfileId: U.teacherA }, O);
    const row = await db.class.findUniqueOrThrow({ where: { id: classId }, include: { teachers: true } });
    expect(row.tenantId).toBe(T.A);
    expect(row.teachers).toMatchObject([{ teacherProfileId: U.teacherA, role: "PRIMARY", endedAt: null }]);
    expect(await auditCount(pg, "CLASS_CREATED", classId)).toBe(1);
  });

  it("refused: another Markaz's admin, a teacher, a Super Admin; and nothing is queried first", async () => {
    for (const who of [U.adminB, U.teacherA, U.superAdmin, U.studentX, U.parentActive]) {
      const { db: spy, calls } = spyDb(db);
      await expect(createClass(spy, await as(who), { tenantId: T.A, name: "X", primaryTeacherProfileId: U.teacherA }, O)).rejects.toBeInstanceOf(AuthorizationError);
      expect(calls, who).toEqual([]);
    }
  });

  it("the Primary must be an ACTIVE Teacher of the SAME Markaz (service + DB trigger)", async () => {
    const admin = await as(U.adminA);
    await expect(createClass(db, admin, { tenantId: T.A, name: "X", primaryTeacherProfileId: L.teacherB }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await endMembership(pg, T.A, L.departedTeacher, "TEACHER");
    await expect(createClass(db, admin, { tenantId: T.A, name: "X", primaryTeacherProfileId: L.departedTeacher }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createClass(db, admin, { tenantId: T.A, name: "X", primaryTeacherProfileId: U.studentX }, O)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("many Co-Teachers; never two active Primaries; a Primary is replaced explicitly, never silently", async () => {
    const admin = await as(U.adminA);
    const classId = await classWithStudents(db);
    await assignClassTeacher(db, admin, { classId, teacherProfileId: L.teacherA3, role: "CO_TEACHER" }, O);
    let active = await db.classTeacherAssignment.findMany({ where: { classId, endedAt: null } });
    expect(active.filter((a) => a.role === "CO_TEACHER")).toHaveLength(2);
    // DB: a second active PRIMARY is impossible.
    await expect(
      pg.query(`INSERT INTO class_teacher_assignments (tenant_id, class_id, teacher_profile_id, role, assigned_by_id, assigned_at) VALUES ($1, $2, $3, 'PRIMARY', $4, now())`, [T.A, classId, L.departedTeacher, U.adminA]),
    ).rejects.toThrow(/class_teacher_assignments_one_active_primary/);
    // Replacement: the Co-Teacher teacherA3 becomes Primary; teacherA's row is ended, kept, audited.
    await assignClassTeacher(db, admin, { classId, teacherProfileId: L.teacherA3, role: "PRIMARY" }, O);
    active = await db.classTeacherAssignment.findMany({ where: { classId, endedAt: null } });
    expect(active.filter((a) => a.role === "PRIMARY").map((a) => a.teacherProfileId)).toEqual([L.teacherA3]);
    expect(await db.classTeacherAssignment.count({ where: { classId, teacherProfileId: U.teacherA, endedAt: { not: null } } })).toBe(1);
    expect(await auditCount(pg, "CLASS_TEACHER_REMOVED", classId)).toBe(2); // old Primary + teacherA3's Co row
  });

  it("the Primary cannot be removed (only replaced); a Co-Teacher can; Co-Teachers cannot change configuration", async () => {
    const classId = await classWithStudents(db);
    const rows = await db.classTeacherAssignment.findMany({ where: { classId } });
    const primary = rows.find((r) => r.role === "PRIMARY")!;
    const co = rows.find((r) => r.role === "CO_TEACHER")!;
    await expect(removeCoTeacher(db, await as(U.adminA), { assignmentId: primary.id }, O)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(removeCoTeacher(db, await as(U.teacherA), { assignmentId: co.id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(updateClass(db, await as(U.teacherAB), { classId, name: "renamed" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(updateClass(db, await as(U.teacherA), { classId, enrollmentCapacity: 3 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await removeCoTeacher(db, await as(U.adminA), { assignmentId: co.id }, O);
    expect((await db.classTeacherAssignment.findUniqueOrThrow({ where: { id: co.id } })).endedAt).not.toBeNull();
  });

  it("cross-tenant assignment is denied", async () => {
    const classId = await classWithStudents(db);
    await expect(assignClassTeacher(db, await as(U.adminA), { classId, teacherProfileId: L.teacherB, role: "CO_TEACHER" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(assignClassTeacher(db, await as(U.adminB), { classId, teacherProfileId: U.teacherAB, role: "CO_TEACHER" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    // DB trigger: even a raw insert of a B teacher into an A class fails.
    await expect(
      pg.query(`INSERT INTO class_teacher_assignments (tenant_id, class_id, teacher_profile_id, role, assigned_by_id, assigned_at) VALUES ($1, $2, $3, 'CO_TEACHER', $4, now())`, [T.A, classId, L.teacherB, U.adminA]),
    ).rejects.toThrow(/requires an ACTIVE TEACHER membership/);
  });

  it("a teacher leaving the Markaz keeps the class and its history; their row grants nothing; an admin replaces them", async () => {
    const classId = await classWithStudents(db);
    await endMembership(pg, T.A, U.teacherA, "TEACHER");
    const departed = await as(U.teacherA);
    await expect(getClassOverview(db, departed, classId, O)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await db.class.count({ where: { id: classId } })).toBe(1);
    expect(await db.classTeacherAssignment.count({ where: { classId, teacherProfileId: U.teacherA } })).toBe(1); // not silently ended or moved
    await assignClassTeacher(db, await as(U.adminA), { classId, teacherProfileId: L.teacherA3, role: "PRIMARY" }, O);
    const primary = await db.classTeacherAssignment.findFirstOrThrow({ where: { classId, role: "PRIMARY", endedAt: null } });
    expect(primary.teacherProfileId).toBe(L.teacherA3);
  });

  it("listing is scoped: admin all, teacher assigned, student enrolled, other Markaz nothing", async () => {
    const classId = await classWithStudents(db);
    expect((await listClasses(db, await as(U.adminA), T.A)).map((c) => c.id)).toEqual([classId]);
    expect((await listClasses(db, await as(U.teacherAB), T.A)).map((c) => c.id)).toEqual([classId]);
    expect(await listClasses(db, await as(L.teacherA3), T.A)).toEqual([]);
    expect((await listClasses(db, await as(U.studentX), T.A)).map((c) => c.id)).toEqual([classId]);
    expect(await listClasses(db, await as(L.s2), T.A)).toEqual([]);
    await expect(listClasses(db, await as(U.adminB), T.A)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listClasses(db, await as(U.parentActive), T.A)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("archiving keeps everything and blocks new enrollments", async () => {
    const classId = await classWithStudents(db);
    await archiveClass(db, await as(U.adminA), { classId }, O);
    await expect(enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2 }, O)).rejects.toMatchObject({ code: "invalid_state" });
    expect(await db.classEnrollment.count({ where: { classId } })).toBe(2);
  });
});

describe("Markaz settings", () => {
  it("time zone: Markaz Admin only, valid IANA names only, audited", async () => {
    await setTenantTimezone(db, await as(U.adminA), { tenantId: T.A, timezone: "Asia/Riyadh" }, O);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: T.A } })).timezone).toBe("Asia/Riyadh");
    await expect(setTenantTimezone(db, await as(U.adminA), { tenantId: T.A, timezone: "Not/AZone" }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(setTenantTimezone(db, await as(U.teacherA), { tenantId: T.A, timezone: "UTC" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setTenantTimezone(db, await as(U.adminB), { tenantId: T.A, timezone: "UTC" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await auditCount(pg, "TENANT_TIMEZONE_SET")).toBe(1);
  });

  // Superseded (A131): "the database default zone is UTC". A Markaz has NO zone until one is chosen.
  it("no zone is invented: a new Markaz has none, and scheduling fails closed until one is set", async () => {
    expect((await db.tenant.findUniqueOrThrow({ where: { id: T.B } })).timezone).toBeNull();
    await pg.query("UPDATE tenants SET timezone = NULL WHERE id = $1", [T.A]);
    const classId = await classWithStudents(db);
    await expect(addClassSchedule(db, await as(U.adminA), { classId, weekday: 1, startTime: "09:00", durationMinutes: 60 }, O)).rejects.toMatchObject({ code: "timezone_required" });
    await setTenantTimezone(db, await as(U.adminA), { tenantId: T.A, timezone: "Africa/Nairobi" }, O);
    await expect(addClassSchedule(db, await as(U.adminA), { classId, weekday: 1, startTime: "09:00", durationMinutes: 60 }, O)).resolves.toBeTypeOf("string");
  });

  it("plan ceilings: Super Admin only; NULL = none; class values must fit; never lowered silently", async () => {
    await expect(setTenantCapacityLimits(db, await as(U.adminA), { tenantId: T.A, classEnrollmentCapacityMax: 5, classLiveCapacityMax: 5 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await setTenantCapacityLimits(db, await as(U.superAdmin), { tenantId: T.A, classEnrollmentCapacityMax: 5, classLiveCapacityMax: 4 }, O);
    const admin = await as(U.adminA);
    await expect(createClass(db, admin, { tenantId: T.A, name: "Big", primaryTeacherProfileId: U.teacherA, enrollmentCapacity: 6 }, O)).rejects.toMatchObject({ code: "limit_exceeded" });
    const classId = await createClass(db, admin, { tenantId: T.A, name: "Ok", primaryTeacherProfileId: U.teacherA, enrollmentCapacity: 5, liveCapacity: 4 }, O);
    await expect(updateClass(db, admin, { classId, liveCapacity: 5 }, O)).rejects.toMatchObject({ code: "limit_exceeded" });
    await expect(setTenantCapacityLimits(db, await as(U.superAdmin), { tenantId: T.A, classEnrollmentCapacityMax: 3, classLiveCapacityMax: 4 }, O)).rejects.toMatchObject({ code: "conflict" });
    await setTenantCapacityLimits(db, await as(U.superAdmin), { tenantId: T.A, classEnrollmentCapacityMax: null, classLiveCapacityMax: null }, O);
    expect(await auditCount(pg, "TENANT_CAPACITY_LIMITS_SET")).toBe(2);
  });

  it("no plan numbers exist anywhere by default", async () => {
    const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM tenants WHERE class_enrollment_capacity_max IS NOT NULL OR class_live_capacity_max IS NOT NULL");
    expect(rows[0].n).toBe(0);
  });
});

describe("Enrollment (A106)", () => {
  it("an ACTIVE student membership in the Markaz is required (other Markaz, ended, non-student refused)", async () => {
    const classId = await classWithStudents(db);
    const admin = await as(U.adminA);
    for (const who of [U.studentY, U.studentLeft, L.teacherA3, U.parentActive]) {
      await expect(enrollStudent(db, admin, { classId, studentProfileId: who }, O), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    // DB trigger as a second line of defence.
    await expect(
      pg.query(`INSERT INTO class_enrollments (tenant_id, class_id, student_profile_id, status, enrolled_by_id, enrolled_at, status_changed_at) VALUES ($1, $2, $3, 'ACTIVE', $4, now(), now())`, [T.A, classId, U.studentY, U.adminA]),
    ).rejects.toThrow(/requires an ACTIVE STUDENT membership/);
  });

  it("assigned teacher and Markaz Admin enroll; an unrelated teacher or another Markaz cannot", async () => {
    const classId = await classWithStudents(db, { students: [] });
    await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: U.studentX }, O);
    await enrollStudent(db, await as(U.teacherAB), { classId, studentProfileId: L.s1 }, O);
    await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2 }, O);
    await expect(enrollStudent(db, await as(L.teacherA3), { classId, studentProfileId: L.s3 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(enrollStudent(db, await as(U.adminB), { classId, studentProfileId: L.s3 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await auditCount(pg, "ENROLLMENT_CREATED")).toBe(3);
  });

  it("explicit enrollment is required; a student may be in several classes; one open enrollment per class", async () => {
    const c1 = await classWithStudents(db);
    const c2 = await createClass(db, await as(U.adminA), { tenantId: T.A, name: "Arabic", primaryTeacherProfileId: U.teacherA }, O);
    await enrollStudent(db, await as(U.teacherA), { classId: c2, studentProfileId: U.studentX }, O);
    expect(await db.classEnrollment.count({ where: { studentProfileId: U.studentX, status: "ACTIVE" } })).toBe(2);
    await expect(enrollStudent(db, await as(U.teacherA), { classId: c1, studentProfileId: U.studentX }, O)).rejects.toMatchObject({ code: "conflict" });
    // Membership alone is not enrollment.
    await expect(getClassOverview(db, await as(L.s2), c1, O)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("history is preserved: ending keeps the row; re-enrolling creates a new one", async () => {
    const classId = await classWithStudents(db);
    const first = await enrollmentOf(classId, U.studentX);
    await endEnrollment(db, await as(U.teacherA), { enrollmentId: first.id }, O);
    await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: U.studentX }, O);
    const rows = await db.classEnrollment.findMany({ where: { classId, studentProfileId: U.studentX }, orderBy: { enrolledAt: "asc" } });
    expect(rows.map((r) => r.status).sort()).toEqual(["ACTIVE", "ENDED"]);
    expect(await auditCount(pg, "ENROLLMENT_ENDED", first.id)).toBe(1);
  });
});

describe("Capacity & waitlist (A109–A110)", () => {
  it("enrollment capacity counts students only; a full class → WAITLIST", async () => {
    // Fixture capacity 2 — not a business default.
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 });
    // Primary + Co-Teacher + admin are not counted: 2 students fit exactly.
    expect((await enrollmentOf(classId, L.s1)).status).toBe("ACTIVE");
    const r = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2 }, O);
    expect(r.status).toBe("WAITLISTED");
    expect(await auditCount(pg, "ENROLLMENT_WAITLISTED", r.enrollmentId)).toBe(1);
  });

  it("a teacher can never exceed capacity; a Markaz Admin overrides with a reason, recorded and audited", async () => {
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 });
    await expect(enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2, overrideReason: "please" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    const r = await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2, overrideReason: "Sibling of an enrolled student" }, O);
    expect(r.status).toBe("ACTIVE");
    const row = await db.classEnrollment.findUniqueOrThrow({ where: { id: r.enrollmentId } });
    expect(row).toMatchObject({ capacityOverrideById: U.adminA, capacityOverrideReason: "Sibling of an enrolled student" });
    expect(row.capacityOverrideAt).toEqual(NOW);
    expect(await auditCount(pg, "CLASS_CAPACITY_OVERRIDE", classId)).toBe(1);
  });

  it("waitlist admission: only when a seat frees up, or by admin override", async () => {
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 });
    const waiting = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2 }, O);
    await expect(admitFromWaitlist(db, await as(U.teacherA), { enrollmentId: waiting.enrollmentId }, O)).rejects.toMatchObject({ code: "limit_exceeded" });
    await endEnrollment(db, await as(U.teacherA), { enrollmentId: (await enrollmentOf(classId, L.s1)).id }, O);
    await admitFromWaitlist(db, await as(U.teacherA), { enrollmentId: waiting.enrollmentId }, O);
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: waiting.enrollmentId } })).status).toBe("ACTIVE");
    expect(await auditCount(pg, "ENROLLMENT_ADMITTED_FROM_WAITLIST", waiting.enrollmentId)).toBe(1);
  });

  it("no capacity configured → no limit", async () => {
    const classId = await classWithStudents(db, { students: [U.studentX, L.s1, L.s2, L.s3] });
    expect(await db.classEnrollment.count({ where: { classId, status: "ACTIVE" } })).toBe(4);
  });
});

describe("Manual payment/access verification (A107)", () => {
  async function lapsed() {
    const classId = await classWithStudents(db);
    const e = await enrollmentOf(classId, U.studentX);
    await db.classEnrollment.update({ where: { id: e.id }, data: { accessUntil: new Date(NOW.getTime() - 10 * DAY) } }); // grace ended 3 days ago
    return { classId, enrollmentId: e.id };
  }

  it("a teacher's submission is NOT verification; only a Markaz Admin verifies; verified access reactivates", async () => {
    const { enrollmentId } = await lapsed();
    expect(effectiveEnrollmentState(await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } }), NOW)).toBe("SUSPENDED");
    const submissionId = await submitPaymentEvidence(
      db,
      await as(U.teacherA),
      { tenantId: T.A, studentProfileId: U.studentX, enrollmentIds: [enrollmentId], coverageNote: "Tajwid 1, November", evidenceReference: "RCPT-001", periodStart: "2026-11-01", periodEnd: "2026-11-30" },
      O,
    );
    // Still suspended: submission grants nothing.
    expect(effectiveEnrollmentState(await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } }), NOW)).toBe("SUSPENDED");
    for (const who of [U.teacherA, U.teacherAB, U.adminB, U.superAdmin, U.studentX]) {
      await expect(verifyPayment(db, await as(who), { submissionId }, O), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    await verifyPayment(db, await as(U.adminA), { submissionId }, O);
    const after = await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(after.status).toBe("ACTIVE");
    expect(after.accessUntil?.toISOString()).toBe("2026-11-30T23:59:59.000Z");
    expect(await auditCount(pg, "PAYMENT_ACCESS_SUBMITTED", submissionId)).toBe(1);
    expect(await auditCount(pg, "PAYMENT_ACCESS_VERIFIED", submissionId)).toBe(1);
    expect(await auditCount(pg, "ENROLLMENT_REACTIVATED", enrollmentId)).toBe(1);
  });

  it("the audit trail never holds the evidence reference", async () => {
    const { enrollmentId } = await lapsed();
    await submitPaymentEvidence(db, await as(U.adminA), { tenantId: T.A, studentProfileId: U.studentX, enrollmentIds: [enrollmentId], coverageNote: "x", evidenceReference: "SECRET-REF-123", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O);
    const { rows } = await pg.query<{ m: string }>("SELECT coalesce(metadata::text, '') AS m FROM audit_events");
    expect(rows.some((r) => r.m.includes("SECRET-REF-123"))).toBe(false);
  });

  it("a package can cover several enrollments; every covered class must be the submitter's", async () => {
    const c1 = await classWithStudents(db);
    const c2 = await createClass(db, await as(U.adminA), { tenantId: T.A, name: "Fiqh", primaryTeacherProfileId: L.teacherA3 }, O);
    await enrollStudent(db, await as(U.adminA), { classId: c2, studentProfileId: U.studentX }, O);
    const ids = [(await enrollmentOf(c1, U.studentX)).id, (await enrollmentOf(c2, U.studentX)).id];
    const input = { tenantId: T.A, studentProfileId: U.studentX, enrollmentIds: ids, coverageNote: "Package", evidenceReference: "R-9", periodStart: "2026-11-01", periodEnd: "2026-11-30" };
    await expect(submitPaymentEvidence(db, await as(U.teacherA), input, O)).rejects.toBeInstanceOf(AuthorizationError); // not c2's teacher
    const id = await submitPaymentEvidence(db, await as(U.adminA), input, O);
    await verifyPayment(db, await as(U.adminA), { submissionId: id }, O);
    expect(await db.classEnrollment.count({ where: { id: { in: ids }, accessUntil: { not: null } } })).toBe(2);
  });

  it("enrollments of another student or Markaz cannot be attached", async () => {
    const classId = await classWithStudents(db);
    const other = await enrollmentOf(classId, L.s1);
    await expect(
      submitPaymentEvidence(db, await as(U.adminA), { tenantId: T.A, studentProfileId: U.studentX, enrollmentIds: [other.id], coverageNote: "x", evidenceReference: "R", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      submitPaymentEvidence(db, await as(U.adminB), { tenantId: T.B, studentProfileId: U.studentX, enrollmentIds: [other.id], coverageNote: "x", evidenceReference: "R", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejection leaves access untouched; a decided submission cannot be decided again", async () => {
    const { enrollmentId } = await lapsed();
    const id = await submitPaymentEvidence(db, await as(U.teacherA), { tenantId: T.A, studentProfileId: U.studentX, enrollmentIds: [enrollmentId], coverageNote: "x", evidenceReference: "R", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O);
    await rejectPayment(db, await as(U.adminA), { submissionId: id, reason: "Receipt unreadable" }, O);
    await expect(verifyPayment(db, await as(U.adminA), { submissionId: id }, O)).rejects.toMatchObject({ code: "invalid_state" });
    expect(effectiveEnrollmentState(await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } }), NOW)).toBe("SUSPENDED");
  });

  it("no amount, currency, provider or price column exists", async () => {
    const { rows } = await pg.query<{ c: string }>("SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'access_payment_submissions'");
    const cols = rows.map((r) => r.c);
    for (const banned of ["amount", "currency", "price", "provider", "invoice", "tax", "refund", "commission"]) {
      expect(cols.some((c) => c.includes(banned)), banned).toBe(false);
    }
  });
});

describe("Grace (A108)", () => {
  async function inGrace() {
    const classId = await classWithStudents(db);
    const e = await enrollmentOf(classId, U.studentX);
    await db.classEnrollment.update({ where: { id: e.id }, data: { accessUntil: new Date(NOW.getTime() - 2 * DAY) } });
    return { classId, enrollmentId: e.id };
  }

  it("expiry → GRACE (7 days) → SUSPENDED, via the re-runnable lifecycle step (audited, no actor)", async () => {
    const { enrollmentId } = await inGrace();
    expect(await advanceEnrollmentStates(db, NOW)).toEqual({ grace: 1, suspended: 0 });
    let row = await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.status).toBe("GRACE");
    expect(row.graceUntil?.getTime()).toBe(NOW.getTime() - 2 * DAY + 7 * DAY);
    expect(await advanceEnrollmentStates(db, NOW)).toEqual({ grace: 0, suspended: 0 }); // idempotent
    expect(await advanceEnrollmentStates(db, new Date(NOW.getTime() + 6 * DAY))).toEqual({ grace: 0, suspended: 1 });
    row = await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.status).toBe("SUSPENDED");
    const { rows } = await pg.query<{ actor_id: string | null }>("SELECT actor_id FROM audit_events WHERE action = 'ENROLLMENT_SUSPENDED'");
    expect(rows).toEqual([{ actor_id: null }]);
  });

  it("assigned teacher and Markaz Admin extend; reason, actor, time and dates are stored; audited", async () => {
    const { enrollmentId } = await inGrace();
    await extendGrace(db, await as(U.teacherAB), { enrollmentId, graceUntil: "2026-12-31", reason: "Family travelling" }, O);
    const ext = await db.graceExtension.findFirstOrThrow({ where: { enrollmentId } });
    expect(ext).toMatchObject({ reason: "Family travelling", grantedById: U.teacherAB, tenantId: T.A });
    expect(ext.grantedAt).toEqual(NOW);
    expect(ext.graceUntil.toISOString()).toBe("2026-12-31T23:59:59.000Z");
    expect(ext.previousGraceUntil?.getTime()).toBe(NOW.getTime() - 2 * DAY + 7 * DAY);
    await extendGrace(db, await as(U.adminA), { enrollmentId, graceUntil: "2027-03-01", reason: "No maximum is imposed" }, O);
    expect(await db.graceExtension.count({ where: { enrollmentId } })).toBe(2);
    expect(await auditCount(pg, "GRACE_EXTENDED", enrollmentId)).toBe(2);
    expect(effectiveEnrollmentState(await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } }), new Date("2027-02-01"))).toBe("GRACE");
  });

  it("an unrelated teacher or another Markaz cannot extend; a past date or an ACTIVE enrollment is refused", async () => {
    const { classId, enrollmentId } = await inGrace();
    for (const who of [L.teacherA3, U.adminB, U.studentX, U.parentActive]) {
      await expect(extendGrace(db, await as(who), { enrollmentId, graceUntil: "2026-12-31", reason: "x" }, O), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    await expect(extendGrace(db, await as(U.adminA), { enrollmentId, graceUntil: "2026-10-01", reason: "x" }, O)).rejects.toMatchObject({ code: "invalid_input" });
    const active = await enrollmentOf(classId, L.s1);
    await expect(extendGrace(db, await as(U.adminA), { enrollmentId: active.id, graceUntil: "2026-12-31", reason: "x" }, O)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("a SUSPENDED student given an extension returns to GRACE", async () => {
    const { enrollmentId } = await inGrace();
    await advanceEnrollmentStates(db, new Date(NOW.getTime() + 6 * DAY));
    await extendGrace(db, await as(U.teacherA), { enrollmentId, graceUntil: "2026-12-20", reason: "x" }, { now: new Date(NOW.getTime() + 6 * DAY) });
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe("GRACE");
  });

  it("schedule: a Markaz Admin adds weekly slots; Co-Teachers cannot", async () => {
    const classId = await classWithStudents(db);
    await addClassSchedule(db, await as(U.adminA), { classId, weekday: 1, startTime: "09:00", durationMinutes: 60 }, O);
    await expect(addClassSchedule(db, await as(U.teacherAB), { classId, weekday: 2, startTime: "09:00", durationMinutes: 60 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await db.classSchedule.count({ where: { classId } })).toBe(1);
  });
});

// =====================================================================================
// Final decision fixes (2026-10-19, A133–A136)
// =====================================================================================

describe("Seats (A133): only ACTIVE and GRACE occupy an active seat", () => {
  it("a SUSPENDED student keeps the enrollment but frees the seat; GRACE still holds one", async () => {
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 }); // fixture capacity
    const x = await enrollmentOf(classId, U.studentX);
    await db.classEnrollment.update({ where: { id: x.id }, data: { accessUntil: new Date(NOW.getTime() - 2 * DAY) } }); // GRACE
    expect((await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2 }, O)).status).toBe("WAITLISTED"); // GRACE holds its seat
    await db.classEnrollment.update({ where: { id: x.id }, data: { accessUntil: new Date(NOW.getTime() - 10 * DAY) } }); // SUSPENDED
    expect(await db.classEnrollment.count({ where: { id: x.id } })).toBe(1); // never deleted
    expect((await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s3 }, O)).status).toBe("ACTIVE"); // seat was free
  });

  it("a SUSPENDED student renewing into a full class is WAITLISTED, never silently above capacity", async () => {
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 });
    const x = await enrollmentOf(classId, U.studentX);
    await db.classEnrollment.update({ where: { id: x.id }, data: { accessUntil: new Date(NOW.getTime() - 10 * DAY) } }); // SUSPENDED, seat freed
    await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2 }, O); // takes the seat
    const id = await submitPaymentEvidence(db, await as(U.teacherA), { tenantId: T.A, studentProfileId: U.studentX, enrollmentIds: [x.id], coverageNote: "x", evidenceReference: "R", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O);
    await verifyPayment(db, await as(U.adminA), { submissionId: id }, O);
    const after = await db.classEnrollment.findUniqueOrThrow({ where: { id: x.id } });
    expect(after.status).toBe("WAITLISTED");
    expect(after.accessUntil?.toISOString()).toBe("2026-11-30T23:59:59.000Z"); // the verified payment is kept
    expect(await auditCount(pg, "ENROLLMENT_WAITLISTED", x.id)).toBe(1);
  });

  it("a SUSPENDED student given a grace extension needs a free seat", async () => {
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 });
    const x = await enrollmentOf(classId, U.studentX);
    await db.classEnrollment.update({ where: { id: x.id }, data: { status: "SUSPENDED", accessUntil: new Date(NOW.getTime() - 10 * DAY) } });
    await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2 }, O);
    await expect(extendGrace(db, await as(U.teacherA), { enrollmentId: x.id, graceUntil: "2026-12-31", reason: "x" }, O)).rejects.toMatchObject({ code: "limit_exceeded" });
  });
});

describe("Waitlist order (A134): FIFO, admin override with reason + audit", () => {
  async function fullClassWithQueue() {
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 });
    const first = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2 }, O);
    const second = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s3 }, { now: new Date(NOW.getTime() + 60_000) });
    await endEnrollment(db, await as(U.adminA), { enrollmentId: (await enrollmentOf(classId, L.s1)).id }, O); // one seat frees
    return { classId, first: first.enrollmentId, second: second.enrollmentId };
  }

  it("default is FIFO: the head of the queue is admitted; skipping it is refused", async () => {
    const { first, second } = await fullClassWithQueue();
    await expect(admitFromWaitlist(db, await as(U.teacherA), { enrollmentId: second }, O)).rejects.toMatchObject({ code: "out_of_order" });
    await admitFromWaitlist(db, await as(U.teacherA), { enrollmentId: first }, O);
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: first } })).status).toBe("ACTIVE");
  });

  it("only a Markaz Admin may admit out of order, with a reason that is recorded and audited", async () => {
    const { first, second } = await fullClassWithQueue();
    await expect(admitFromWaitlist(db, await as(U.teacherA), { enrollmentId: second, queueOverrideReason: "urgent" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await admitFromWaitlist(db, await as(U.adminA), { enrollmentId: second, queueOverrideReason: "Hifdh exam next week" }, O);
    const row = await db.classEnrollment.findUniqueOrThrow({ where: { id: second } });
    expect(row).toMatchObject({ status: "ACTIVE", queueOverrideById: U.adminA, queueOverrideReason: "Hifdh exam next week" });
    expect(row.queueOverrideAt).toEqual(NOW);
    expect(await auditCount(pg, "ENROLLMENT_WAITLIST_ORDER_OVERRIDE", second)).toBe(1);
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: first } })).status).toBe("WAITLISTED"); // queue not silently reordered
    // DB: an override without a reason is impossible.
    await expect(pg.query("UPDATE class_enrollments SET queue_override_reason = NULL WHERE id = $1", [second])).rejects.toThrow(/enrollment_queue_override_fields/);
  });
});

describe("Payment required per class (A135)", () => {
  async function paidClass() {
    return createClass(db, await as(U.adminA), { tenantId: T.A, name: "Paid Hifdh", primaryTeacherProfileId: U.teacherA, paymentRequired: true, enrollmentCapacity: 5 }, O);
  }

  it("a free class (default) activates on enrollment without any payment", async () => {
    const classId = await classWithStudents(db, { students: [] });
    expect((await db.class.findUniqueOrThrow({ where: { id: classId } })).paymentRequired).toBe(false);
    expect((await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2 }, O)).status).toBe("ACTIVE");
  });

  it("a paid class needs VERIFIED access before first access; a teacher's submission grants nothing", async () => {
    const classId = await paidClass();
    const r = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2 }, O);
    expect(r.status).toBe("PENDING_PAYMENT");
    expect(await auditCount(pg, "ENROLLMENT_PENDING_PAYMENT", r.enrollmentId)).toBe(1);
    const id = await submitPaymentEvidence(db, await as(U.teacherA), { tenantId: T.A, studentProfileId: L.s2, enrollmentIds: [r.enrollmentId], coverageNote: "x", evidenceReference: "R", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O);
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: r.enrollmentId } })).status).toBe("PENDING_PAYMENT");
    await expect(verifyPayment(db, await as(U.teacherA), { submissionId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await verifyPayment(db, await as(U.adminA), { submissionId: id }, O);
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: r.enrollmentId } })).status).toBe("ACTIVE");
  });

  it("a waitlisted student of a paid class cannot be admitted without verified access", async () => {
    const classId = await paidClass();
    await db.classEnrollment.create({ data: { tenantId: T.A, classId, studentProfileId: L.s2, status: "WAITLISTED", waitlistedAt: NOW, enrolledById: U.adminA, enrolledAt: NOW, statusChangedAt: NOW } });
    const e = await enrollmentOf(classId, L.s2);
    await expect(admitFromWaitlist(db, await as(U.adminA), { enrollmentId: e.id }, O)).rejects.toMatchObject({ code: "payment_required" });
  });

  it("a capacity override cannot bypass payment", async () => {
    const classId = await paidClass();
    await expect(enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2, overrideReason: "x" }, O)).rejects.toMatchObject({ code: "payment_required" });
  });
});

describe("Finance authority (A136): payment.verify", () => {
  async function pending() {
    const classId = await createClass(db, await as(U.adminA), { tenantId: T.A, name: "Paid", primaryTeacherProfileId: U.teacherA, paymentRequired: true }, O);
    const r = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2 }, O);
    return submitPaymentEvidence(db, await as(U.teacherA), { tenantId: T.A, studentProfileId: L.s2, enrollmentIds: [r.enrollmentId], coverageNote: "x", evidenceReference: "R", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O);
  }

  it("a staff member holding payment.verify (Finance Officer / Accountant) verifies; without it a teacher cannot", async () => {
    const id = await pending();
    await expect(verifyPayment(db, await as(L.teacherA3), { submissionId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await grantTenantPermission(db, await as(U.adminA), { tenantId: T.A, profileId: L.teacherA3, permission: "payment.verify" });
    await verifyPayment(db, await as(L.teacherA3), { submissionId: id }, O);
    expect(await auditCount(pg, "PAYMENT_ACCESS_VERIFIED", id)).toBe(1);
  });

  it("the grant is tenant-scoped, never implied by a role, and a teacher cannot assign it", async () => {
    const id = await pending();
    await expect(grantTenantPermission(db, await as(U.teacherA), { tenantId: T.A, profileId: L.teacherA3, permission: "payment.verify" })).rejects.toBeInstanceOf(AuthorizationError);
    await grantTenantPermission(db, await as(U.superAdmin), { tenantId: T.B, profileId: U.teacherAB, permission: "payment.verify" });
    await expect(verifyPayment(db, await as(U.teacherAB), { submissionId: id }, O)).rejects.toBeInstanceOf(AuthorizationError); // granted in B only
    await expect(verifyPayment(db, await as(U.adminB), { submissionId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(verifyPayment(db, await as(U.superAdmin), { submissionId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
