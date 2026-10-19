import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { DICTIONARIES } from "@/i18n/dictionaries";
import { LOCALES } from "@/i18n/config";
import { canReadStudentDetailNow } from "@/server/data/student-detail";
import { AuthorizationError, GRANTABLE_PERMISSIONS, invitableTargets } from "@/server/authz/policy";
import { addClassSchedule, createClass, getClassOverview, listClasses, updateClass } from "@/server/services/classes";
import { listTenantCorrections } from "@/server/services/corrections";
import {
  admitFromWaitlist,
  enrollStudent,
  extendGrace,
  listFinanceEnrollments,
  listPaymentSubmissions,
  rejectPayment,
  submitPaymentEvidence,
  verifyPayment,
} from "@/server/services/enrollments";
import { acceptInvitation, createInvitation } from "@/server/services/invitations";
import {
  adjustAttendance,
  createScheduledSession,
  endSession,
  getLiveSessionView,
  grantMic,
  grantWhiteboard,
  joinSession,
  listClassChatHistory,
  listSessionAttendance,
  removeParticipant,
  startAdHocSession,
  startSession,
} from "@/server/services/live-sessions";
import { grantTenantPermission } from "@/server/services/permissions";
import { listTenantRecordings } from "@/server/services/recordings";
import { listStudentRoster } from "@/server/services/roster";
import { actor, createTestPrisma } from "../db/prisma";
import { T, U } from "../support/fixture";
import { at, auditCount, classWithStudents, endMembership, L, NOW, seedLive } from "../support/live";

// A140 (owner decision 2026-10-19): Finance Officer / Accountant is a real NON-TEACHING Markaz role.
// Payment verification/rejection: ACTIVE Markaz Admin or ACTIVE Finance Officer of that Markaz.
// A Teacher never verifies and can never receive payment.verify.
let pg: PGlite;
let db: PrismaClient;
const O = { now: NOW };
const as = (id: string) => actor(db, id);

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedLive(pg);
});

async function paidSubmission(opts: { enrollmentCapacity?: number } = {}) {
  const classId = await createClass(db, await as(U.adminA), { tenantId: T.A, name: "Paid Hifdh", primaryTeacherProfileId: U.teacherA, paymentRequired: true, enrollmentCapacity: opts.enrollmentCapacity }, O);
  const r = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s2 }, O);
  const submissionId = await submitPaymentEvidence(
    db,
    await as(U.teacherA),
    { tenantId: T.A, studentProfileId: L.s2, enrollmentIds: [r.enrollmentId], coverageNote: "Paid Hifdh, November", evidenceReference: "RCPT-77", periodStart: "2026-11-01", periodEnd: "2026-11-30" },
    O,
  );
  return { classId, enrollmentId: r.enrollmentId, submissionId };
}

describe("membership & invitations", () => {
  it("a Markaz Admin (and a Super Admin) can invite a Finance Officer; a Teacher with invitation.create cannot", async () => {
    expect(invitableTargets(await as(U.adminA), T.A)).toContain("FINANCE_OFFICER");
    expect(invitableTargets(await as(U.superAdmin), T.A)).toContain("FINANCE_OFFICER");
    await grantTenantPermission(db, await as(U.adminA), { tenantId: T.A, profileId: U.teacherA, permission: "invitation.create" });
    expect(invitableTargets(await as(U.teacherA), T.A)).not.toContain("FINANCE_OFFICER");
    await expect(createInvitation(db, await as(U.teacherA), { tenantId: T.A, email: "acc@example.com", target: "FINANCE_OFFICER" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("accepting the invitation creates exactly an ACTIVE FINANCE_OFFICER membership — never a Teacher", async () => {
    const inv = await createInvitation(db, await as(U.adminA), { tenantId: T.A, email: "accountant@example.com", target: "FINANCE_OFFICER" });
    const id = "11111111-0000-4000-8000-0000000000aa";
    await pg.query("INSERT INTO auth.users (id, email) VALUES ($1, 'accountant@example.com')", [id]);
    expect(await acceptInvitation(db, { userId: id, email: "accountant@example.com" }, { token: inv.token })).toEqual({ tenantId: T.A, target: "FINANCE_OFFICER" });
    const memberships = await db.membership.findMany({ where: { profileId: id } });
    expect(memberships).toEqual([expect.objectContaining({ tenantId: T.A, role: "FINANCE_OFFICER", status: "ACTIVE", registrationNumber: null })]);
  });

  it("a Finance Officer can never hold an explicit permission (not eligible), and nobody can be granted payment.verify", async () => {
    expect(GRANTABLE_PERMISSIONS).not.toContain("payment.verify");
    await expect(grantTenantPermission(db, await as(U.adminA), { tenantId: T.A, profileId: L.financeA, permission: "invitation.create" })).rejects.toBeInstanceOf(AuthorizationError);
    for (const who of [U.adminA, U.superAdmin]) {
      await expect(grantTenantPermission(db, await as(who), { tenantId: T.A, profileId: U.teacherA, permission: "payment.verify" }), who).rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it("i18n: the role is labelled in every language", () => {
    for (const l of LOCALES) expect(DICTIONARIES[l].roles.FINANCE_OFFICER.trim().length, l).toBeGreaterThan(0);
  });
});

describe("payment authorization", () => {
  it("Markaz Admin verify = ALLOW; Finance Officer verify = ALLOW", async () => {
    const a = await paidSubmission();
    await verifyPayment(db, await as(U.adminA), { submissionId: a.submissionId }, O);
    const b = await submitPaymentEvidence(db, await as(L.financeA), { tenantId: T.A, studentProfileId: U.studentX, enrollmentIds: [(await enrollStudent(db, await as(U.adminA), { classId: a.classId, studentProfileId: U.studentX }, O)).enrollmentId], coverageNote: "x", evidenceReference: "R2", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O);
    await verifyPayment(db, await as(L.financeA), { submissionId: b }, O);
    expect(await auditCount(pg, "PAYMENT_ACCESS_VERIFIED")).toBe(2);
  });

  it("Teacher (Primary, Co, Substitute) verify/reject = DENY; students and parents too", async () => {
    const { submissionId } = await paidSubmission();
    for (const who of [U.teacherA, U.teacherAB, L.teacherA3, U.studentX, U.parentActive]) {
      await expect(verifyPayment(db, await as(who), { submissionId }, O), who).rejects.toBeInstanceOf(AuthorizationError);
      await expect(rejectPayment(db, await as(who), { submissionId }, O), who).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("Finance Officer reject = ALLOW (access untouched)", async () => {
    const { submissionId, enrollmentId } = await paidSubmission();
    await rejectPayment(db, await as(L.financeA), { submissionId, reason: "Reference not found" }, O);
    expect(await db.accessPaymentSubmission.findUniqueOrThrow({ where: { id: submissionId } })).toMatchObject({ status: "REJECTED", rejectedById: L.financeA });
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe("PENDING_PAYMENT");
  });

  it("verification activates paid-class access (side effect only), or WAITLISTs when the class is full", async () => {
    const { submissionId, enrollmentId, classId } = await paidSubmission({ enrollmentCapacity: 1 });
    await verifyPayment(db, await as(L.financeA), { submissionId }, O);
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe("ACTIVE");
    const second = await enrollStudent(db, await as(U.teacherA), { classId, studentProfileId: L.s3 }, O);
    const id2 = await submitPaymentEvidence(db, await as(L.financeA), { tenantId: T.A, studentProfileId: L.s3, enrollmentIds: [second.enrollmentId], coverageNote: "x", evidenceReference: "R3", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O);
    await verifyPayment(db, await as(L.financeA), { submissionId: id2 }, O);
    expect((await db.classEnrollment.findUniqueOrThrow({ where: { id: second.enrollmentId } })).status).toBe("WAITLISTED");
  });

  it("an ENDED Finance Officer loses all finance authority; payment history stays", async () => {
    const { submissionId } = await paidSubmission();
    await verifyPayment(db, await as(L.financeA), { submissionId }, O);
    await endMembership(pg, T.A, L.financeA, "FINANCE_OFFICER");
    const later = await paidSubmission();
    await expect(verifyPayment(db, await as(L.financeA), { submissionId: later.submissionId }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listPaymentSubmissions(db, await as(L.financeA), T.A)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await db.accessPaymentSubmission.findUniqueOrThrow({ where: { id: submissionId } })).toMatchObject({ status: "VERIFIED", verifiedById: L.financeA });
    await expect(verifyPayment(db, await as(L.financeEnded), { submissionId: later.submissionId }, O)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("tenant isolation", () => {
  it("a Markaz B Finance Officer cannot verify, list or submit Markaz A finance records", async () => {
    const { submissionId, enrollmentId } = await paidSubmission();
    await expect(verifyPayment(db, await as(L.financeB), { submissionId }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(rejectPayment(db, await as(L.financeB), { submissionId }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listPaymentSubmissions(db, await as(L.financeB), T.A)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listFinanceEnrollments(db, await as(L.financeB), T.A)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      submitPaymentEvidence(db, await as(L.financeB), { tenantId: T.A, studentProfileId: L.s2, enrollmentIds: [enrollmentId], coverageNote: "x", evidenceReference: "R", periodStart: "2026-11-01", periodEnd: "2026-11-30" }, O),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await listPaymentSubmissions(db, await as(L.financeB), T.B)).toEqual([]);
  });
});

describe("least privilege (A140)", () => {
  it("finance listings carry only payment/access fields — no academic data", async () => {
    await paidSubmission();
    const rows = await listFinanceEnrollments(db, await as(L.financeA), T.A, O);
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).sort()).toEqual(["accessUntil", "class", "effectiveStatus", "graceUntil", "id", "status", "student", "studentProfileId"]);
    expect(Object.keys(rows[0].class).sort()).toEqual(["name", "paymentRequired"]);
  });

  it("no class configuration, enrollment management, grace, waitlist or capacity override", async () => {
    const classId = await classWithStudents(db, { enrollmentCapacity: 2 });
    const f = await as(L.financeA);
    await expect(createClass(db, f, { tenantId: T.A, name: "X", primaryTeacherProfileId: U.teacherA }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(updateClass(db, f, { classId, name: "X" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(addClassSchedule(db, f, { classId, weekday: 1, startTime: "09:00", durationMinutes: 60 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(enrollStudent(db, f, { classId, studentProfileId: L.s2 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    const x = await db.classEnrollment.findFirstOrThrow({ where: { classId, studentProfileId: U.studentX } });
    await db.classEnrollment.update({ where: { id: x.id }, data: { accessUntil: new Date("2026-10-30T00:00:00Z") } });
    await expect(extendGrace(db, f, { enrollmentId: x.id, graceUntil: "2026-12-31", reason: "x" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    const w = await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2 }, O);
    await expect(admitFromWaitlist(db, f, { enrollmentId: w.enrollmentId, overrideReason: "x", queueOverrideReason: "y" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listClasses(db, f, T.A)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getClassOverview(db, f, classId, O)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("no live-session control, attendance, mic, whiteboard or chat", async () => {
    const classId = await classWithStudents(db);
    const f = await as(L.financeA);
    await expect(startAdHocSession(db, f, { classId }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createScheduledSession(db, f, { classId, date: "2026-11-02", startTime: "10:00", durationMinutes: 60 }, O)).rejects.toBeInstanceOf(AuthorizationError);
    const sessionId = await startAdHocSession(db, await as(U.teacherA), { classId }, O);
    await expect(startSession(db, f, { sessionId }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(joinSession(db, f, { sessionId }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getLiveSessionView(db, f, sessionId, O)).rejects.toBeInstanceOf(AuthorizationError);
    await joinSession(db, await as(U.studentX), { sessionId }, O);
    const p = await db.liveSessionParticipant.findFirstOrThrow({ where: { sessionId, profileId: U.studentX } });
    await expect(grantMic(db, f, { participantId: p.id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(grantWhiteboard(db, f, { participantId: p.id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(removeParticipant(db, f, { participantId: p.id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listClassChatHistory(db, f, classId, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(endSession(db, f, { sessionId }, { now: at(10) })).rejects.toBeInstanceOf(AuthorizationError);
    await endSession(db, await as(U.teacherA), { sessionId }, { now: at(30) });
    await expect(listSessionAttendance(db, f, sessionId)).rejects.toBeInstanceOf(AuthorizationError);
    const rec = await db.attendanceRecord.findFirstOrThrow({ where: { sessionId } });
    await expect(adjustAttendance(db, f, { recordId: rec.id, status: "PRESENT", reason: "x" }, O)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("no corrections, recordings, roster or detailed student data", async () => {
    await classWithStudents(db);
    const f = await as(L.financeA);
    await expect(listTenantCorrections(db, f, T.A)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listTenantRecordings(db, f, T.A)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listStudentRoster(db, f, T.A)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await canReadStudentDetailNow(db, f, { tenantId: T.A, studentProfileId: U.studentX }, NOW)).toBe(false);
  });
});
