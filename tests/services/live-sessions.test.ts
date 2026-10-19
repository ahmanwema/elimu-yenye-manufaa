import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import { addClassSchedule, createClass, setTenantTimezone, updateClass } from "@/server/services/classes";
import { endEnrollment, enrollStudent } from "@/server/services/enrollments";
import {
  adjustAttendance,
  assignSubstitute,
  cancelSession,
  closeStaleSessions,
  createScheduledSession,
  endSession,
  generateSessionsFromSchedule,
  getLiveSessionView,
  getMyDeviceCapabilities,
  grantMic,
  grantWhiteboard,
  joinSession,
  leaveSession,
  listChildAttendance,
  listClassChatHistory,
  listMyAttendance,
  listSessionAttendance,
  listSessionChat,
  postChatMessage,
  raiseHand,
  removeParticipant,
  revokeMic,
  revokeWhiteboard,
  startAdHocSession,
  startSession,
} from "@/server/services/live-sessions";
import { actor, createTestPrisma } from "../db/prisma";
import { T, U } from "../support/fixture";
import { enableOptionCFor } from "../support/media";
import { at, auditCount, classWithStudents, endMembership, L, minutes, NOW, seedLive } from "../support/live";

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedLive(pg);
});

const as = (id: string) => actor(db, id);
const When = (m: number) => ({ now: at(m) });

/** Markaz A is Africa/Nairobi (UTC+3): wall time = UTC + 3 h. */
function nairobi(utc: Date) {
  const local = new Date(utc.getTime() + 3 * 3_600_000).toISOString();
  return { date: local.slice(0, 10), startTime: local.slice(11, 16) };
}

/** A scheduled session starting `offset` minutes after NOW. */
async function scheduled(classId: string, offset = 60, durationMinutes = 60, extra: { recordingEnabled?: boolean } = {}) {
  return createScheduledSession(db, await as(U.teacherA), { classId, ...nairobi(at(offset)), durationMinutes, ...extra }, { now: NOW });
}

/** Class + scheduled session at NOW+60, started by the Primary at its start time. */
async function liveSession(opts: { liveCapacity?: number | null; students?: string[] } = {}) {
  const classId = await classWithStudents(db, opts);
  const sessionId = await scheduled(classId);
  await startSession(db, await as(U.teacherA), { sessionId }, When(60));
  return { classId, sessionId };
}

const participant = (sessionId: string, profileId: string) =>
  db.liveSessionParticipant.findUniqueOrThrow({ where: { sessionId_profileId: { sessionId, profileId } } });

describe("Scheduling (A112): UTC storage, Markaz time zone", () => {
  it("a session entered as 10:00 Markaz time is stored as 07:00 UTC (Africa/Nairobi)", async () => {
    const classId = await classWithStudents(db);
    const id = await createScheduledSession(db, await as(U.teacherA), { classId, date: "2026-11-02", startTime: "10:00", durationMinutes: 45 }, { now: NOW });
    const s = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(s.scheduledStartAt.toISOString()).toBe("2026-11-02T07:00:00.000Z");
    expect(s.scheduledEndAt.toISOString()).toBe("2026-11-02T07:45:00.000Z");
    expect(s).toMatchObject({ kind: "SCHEDULED", status: "SCHEDULED", tenantId: T.A, classId });
  });

  it("changing the Markaz zone changes interpretation, not stored instants", async () => {
    const classId = await classWithStudents(db);
    await setTenantTimezone(db, await as(U.adminA), { tenantId: T.A, timezone: "UTC" }, { now: NOW });
    const id = await createScheduledSession(db, await as(U.teacherA), { classId, date: "2026-11-02", startTime: "10:00", durationMinutes: 45 }, { now: NOW });
    expect((await db.liveSession.findUniqueOrThrow({ where: { id } })).scheduledStartAt.toISOString()).toBe("2026-11-02T10:00:00.000Z");
  });

  it("recurring weekly schedule materializes sessions idempotently; past slots are skipped", async () => {
    const classId = await classWithStudents(db);
    const admin = await as(U.adminA);
    await addClassSchedule(db, admin, { classId, weekday: 1, startTime: "08:00", durationMinutes: 30 }, { now: NOW }); // Mon 05:00Z — already over today
    await addClassSchedule(db, admin, { classId, weekday: 3, startTime: "16:00", durationMinutes: 60 }, { now: NOW }); // Wed 13:00Z
    const n = await generateSessionsFromSchedule(db, await as(U.teacherAB), { classId, fromDate: "2026-11-02", days: 14 }, { now: NOW });
    expect(n).toBe(3); // Wed 4, Mon 9, Wed 11 (Mon 2 is past)
    const starts = (await db.liveSession.findMany({ where: { classId }, orderBy: { scheduledStartAt: "asc" } })).map((s) => s.scheduledStartAt.toISOString());
    expect(starts).toEqual(["2026-11-04T13:00:00.000Z", "2026-11-09T05:00:00.000Z", "2026-11-11T13:00:00.000Z"]);
    expect(await generateSessionsFromSchedule(db, await as(U.adminA), { classId, fromDate: "2026-11-02", days: 14 }, { now: NOW })).toBe(0);
    await expect(generateSessionsFromSchedule(db, await as(L.teacherA3), { classId, fromDate: "2026-11-02", days: 14 }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a session cannot be created in the past; creators are assigned teachers and the Markaz Admin", async () => {
    const classId = await classWithStudents(db);
    await expect(scheduled(classId, -120)).rejects.toMatchObject({ code: "invalid_input" });
    for (const who of [L.teacherA3, U.studentX, U.adminB, U.parentActive]) {
      await expect(createScheduledSession(db, await as(who), { classId, ...nairobi(at(60)), durationMinutes: 60 }, { now: NOW }), who).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});

describe("Session lifecycle (A113–A114)", () => {
  it("start is allowed from 15 minutes before the scheduled start (not 16)", async () => {
    const classId = await classWithStudents(db);
    const sessionId = await scheduled(classId);
    await expect(startSession(db, await as(U.teacherA), { sessionId }, When(44))).rejects.toMatchObject({ code: "too_early" });
    await startSession(db, await as(U.teacherA), { sessionId }, When(45));
    const s = await db.liveSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s).toMatchObject({ status: "LIVE", startedById: U.teacherA });
    expect(s.actualStartAt).toEqual(at(45));
    expect(await auditCount(pg, "SESSION_STARTED", sessionId)).toBe(1);
  });

  it("Primary, Co-Teacher, Substitute and Markaz Admin may start/end; others may not", async () => {
    const classId = await classWithStudents(db);
    const ids = [await scheduled(classId, 60), await scheduled(classId, 200), await scheduled(classId, 400), await scheduled(classId, 600)];
    await assignSubstitute(db, await as(U.teacherA), { sessionId: ids[2], substituteProfileId: L.teacherA3 }, { now: NOW });
    for (const who of [L.teacherA3, U.studentX, U.parentActive, U.adminB, U.superAdmin]) {
      await expect(startSession(db, await as(who), { sessionId: ids[0] }, When(60)), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    const starters = [U.teacherA, U.teacherAB, L.teacherA3, U.adminA];
    for (let i = 0; i < 4; i++) {
      const offset = [60, 200, 400, 600][i];
      await startSession(db, await as(starters[i]), { sessionId: ids[i] }, When(offset));
      await endSession(db, await as(starters[i]), { sessionId: ids[i] }, When(offset + 50));
    }
    expect(await db.liveSession.count({ where: { classId, status: "ENDED", endReason: "MANUAL" } })).toBe(4);
  });

  it("cancellation: Primary and Markaz Admin only — not Co-Teacher or Substitute; only while SCHEDULED", async () => {
    const classId = await classWithStudents(db);
    const a = await scheduled(classId, 60);
    const b = await scheduled(classId, 300);
    await assignSubstitute(db, await as(U.adminA), { sessionId: a, substituteProfileId: L.teacherA3 }, { now: NOW });
    await expect(cancelSession(db, await as(U.teacherAB), { sessionId: a }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(cancelSession(db, await as(L.teacherA3), { sessionId: a }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await cancelSession(db, await as(U.teacherA), { sessionId: a, reason: "Teacher unwell" }, { now: NOW });
    expect(await db.liveSession.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ status: "CANCELLED", cancelledById: U.teacherA, cancelReason: "Teacher unwell" });
    await startSession(db, await as(U.teacherA), { sessionId: b }, When(300));
    await expect(cancelSession(db, await as(U.adminA), { sessionId: b }, When(301))).rejects.toMatchObject({ code: "invalid_state" });
    expect(await auditCount(pg, "SESSION_CANCELLED", a)).toBe(1);
  });

  it("safety close at scheduled end + 30 minutes (job entry point, not scheduled); closes presence; audited without actor", async () => {
    const { sessionId } = await liveSession();
    await joinSession(db, await as(U.studentX), { sessionId }, When(60));
    expect(await closeStaleSessions(db, at(120 + 29))).toBe(0);
    expect(await closeStaleSessions(db, at(120 + 31))).toBe(1);
    const s = await db.liveSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s).toMatchObject({ status: "ENDED", endReason: "SAFETY_CLOSE", endedById: null });
    expect(s.actualEndAt).toEqual(at(150)); // the cutoff, not the moment the job ran
    expect(await db.liveSessionConnection.count({ where: { sessionId, disconnectedAt: null } })).toBe(0);
    const { rows } = await pg.query<{ actor_id: string | null }>("SELECT actor_id FROM audit_events WHERE action = 'SESSION_SAFETY_CLOSED'");
    expect(rows).toEqual([{ actor_id: null }]);
    expect(await closeStaleSessions(db, at(500))).toBe(0); // re-runnable
  });

  it("a session past its safety-close time cannot be started", async () => {
    const classId = await classWithStudents(db);
    const sessionId = await scheduled(classId);
    await expect(startSession(db, await as(U.teacherA), { sessionId }, When(151))).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("ad hoc: default 60 minutes, changeable, starts LIVE, same safety close; one LIVE session per class", async () => {
    const classId = await classWithStudents(db);
    const id = await startAdHocSession(db, await as(U.teacherAB), { classId }, { now: NOW });
    const s = await db.liveSession.findUniqueOrThrow({ where: { id } });
    expect(s).toMatchObject({ kind: "AD_HOC", status: "LIVE" });
    expect(s.scheduledEndAt.getTime() - s.scheduledStartAt.getTime()).toBe(minutes(60));
    await expect(startAdHocSession(db, await as(U.teacherA), { classId }, { now: NOW })).rejects.toMatchObject({ code: "conflict" });
    expect(await closeStaleSessions(db, at(91))).toBe(1);
    const custom = await startAdHocSession(db, await as(U.teacherA), { classId, durationMinutes: 150 }, When(100));
    const c = await db.liveSession.findUniqueOrThrow({ where: { id: custom } });
    expect(c.scheduledEndAt.getTime() - c.scheduledStartAt.getTime()).toBe(minutes(150));
    expect(await closeStaleSessions(db, at(100 + 150 + 29))).toBe(0);
  });

  it("Option C is checked when a recording-enabled session begins — not for ordinary sessions (A123)", async () => {
    const classId = await classWithStudents(db);
    const plain = await scheduled(classId, 60);
    const recorded = await scheduled(classId, 300, 60, { recordingEnabled: true });
    await expect(startSession(db, await as(U.teacherA), { sessionId: recorded }, When(300))).rejects.toMatchObject({ code: "feature_not_enabled" });
    await expect(startAdHocSession(db, await as(U.teacherA), { classId, recordingEnabled: true }, { now: NOW })).rejects.toMatchObject({ code: "feature_not_enabled" });
    await startSession(db, await as(U.teacherA), { sessionId: plain }, When(60));
    await endSession(db, await as(U.teacherA), { sessionId: plain }, When(100));
    await enableOptionCFor(pg, T.A);
    await startSession(db, await as(U.teacherA), { sessionId: recorded }, When(300));
  });
});

describe("Substitute teacher (A105)", () => {
  it("assigned per session by Primary or Markaz Admin; an ACTIVE teacher of the same Markaz; never a class assignment", async () => {
    const classId = await classWithStudents(db);
    const sessionId = await scheduled(classId);
    await expect(assignSubstitute(db, await as(U.teacherAB), { sessionId, substituteProfileId: L.teacherA3 }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(assignSubstitute(db, await as(U.teacherA), { sessionId, substituteProfileId: L.teacherB }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(assignSubstitute(db, await as(U.teacherA), { sessionId, substituteProfileId: U.teacherAB }, { now: NOW })).rejects.toMatchObject({ code: "invalid_input" });
    await endMembership(pg, T.A, L.departedTeacher, "TEACHER");
    await expect(assignSubstitute(db, await as(U.adminA), { sessionId, substituteProfileId: L.departedTeacher }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    const before = await db.classTeacherAssignment.count({ where: { classId } });
    await assignSubstitute(db, await as(U.teacherA), { sessionId, substituteProfileId: L.teacherA3 }, { now: NOW });
    expect(await db.classTeacherAssignment.count({ where: { classId } })).toBe(before);
    expect(await auditCount(pg, "SESSION_SUBSTITUTE_ASSIGNED", sessionId)).toBe(1);
    // DB trigger: a raw update to a teacher of another Markaz is refused.
    await expect(pg.query("UPDATE live_sessions SET substitute_profile_id = $1 WHERE id = $2", [L.teacherB, sessionId])).rejects.toThrow(/requires an ACTIVE TEACHER membership/);
  });

  it("the substitute operates THAT session only, cannot cancel, and cannot adjust attendance", async () => {
    const classId = await classWithStudents(db);
    const sessionId = await scheduled(classId);
    const other = await scheduled(classId, 300);
    await assignSubstitute(db, await as(U.adminA), { sessionId, substituteProfileId: L.teacherA3 }, { now: NOW });
    const sub = await as(L.teacherA3);
    await expect(startSession(db, sub, { sessionId: other }, When(300))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(cancelSession(db, sub, { sessionId }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await startSession(db, sub, { sessionId }, When(60));
    await joinSession(db, await as(U.studentX), { sessionId }, When(60));
    await endSession(db, sub, { sessionId }, When(120));
    const rows = await listSessionAttendance(db, sub, sessionId); // may read
    await expect(adjustAttendance(db, sub, { recordId: rows[0].id, status: "PRESENT", reason: "x" }, When(130))).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("Joining, access and live capacity (A106, A110, A121)", () => {
  it("students may wait from 15 minutes before the start", async () => {
    const classId = await classWithStudents(db);
    const sessionId = await scheduled(classId);
    await expect(joinSession(db, await as(U.studentX), { sessionId }, When(44))).rejects.toMatchObject({ code: "too_early" });
    const j = await joinSession(db, await as(U.studentX), { sessionId }, When(45));
    expect(j).toMatchObject({ mode: "PRIMARY", role: "STUDENT", admission: "ADMITTED" });
    const view = await getLiveSessionView(db, await as(U.studentX), sessionId, When(50));
    expect(view.session.waitingRoomOpen).toBe(true);
  });

  it("explicit, active enrollment is required: suspended / waitlisted / ended / none / parent / other Markaz refused", async () => {
    const { classId, sessionId } = await liveSession();
    await db.classEnrollment.updateMany({ where: { classId, studentProfileId: L.s1 }, data: { accessUntil: new Date("2026-10-01T00:00:00Z") } }); // grace over → SUSPENDED
    await expect(joinSession(db, await as(L.s1), { sessionId }, When(61))).rejects.toMatchObject({ code: "access_inactive" });
    await expect(joinSession(db, await as(L.s2), { sessionId }, When(61))).rejects.toBeInstanceOf(AuthorizationError); // member, not enrolled
    for (const who of [U.parentActive, U.studentY, U.adminB, L.teacherA3, U.superAdmin]) {
      await expect(joinSession(db, await as(who), { sessionId }, When(61)), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    await endEnrollment(db, await as(U.adminA), { enrollmentId: (await db.classEnrollment.findFirstOrThrow({ where: { classId, studentProfileId: U.studentX } })).id }, When(61));
    await expect(joinSession(db, await as(U.studentX), { sessionId }, When(62))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a GRACE student may still join", async () => {
    const { classId, sessionId } = await liveSession();
    await db.classEnrollment.updateMany({ where: { classId, studentProfileId: L.s1 }, data: { accessUntil: new Date("2026-10-30T00:00:00Z") } });
    await expect(joinSession(db, await as(L.s1), { sessionId }, When(61))).resolves.toMatchObject({ admission: "ADMITTED" });
  });

  it("live capacity counts students only; a full room → WAITING_FOR_SLOT; a freed slot admits the next in order", async () => {
    const { sessionId } = await liveSession({ liveCapacity: 1, students: [U.studentX, L.s1, L.s2] }); // fixture capacity
    await joinSession(db, await as(U.teacherA), { sessionId }, When(60));
    await joinSession(db, await as(U.adminA), { sessionId }, When(60));
    const x = await joinSession(db, await as(U.studentX), { sessionId }, When(61));
    const s1 = await joinSession(db, await as(L.s1), { sessionId }, When(62));
    const s2 = await joinSession(db, await as(L.s2), { sessionId }, When(63));
    expect([x.admission, s1.admission, s2.admission]).toEqual(["ADMITTED", "WAITING_FOR_SLOT", "WAITING_FOR_SLOT"]);
    await leaveSession(db, await as(U.studentX), { connectionId: x.connectionId }, When(70));
    expect((await participant(sessionId, L.s1)).admission).toBe("ADMITTED");
    expect((await participant(sessionId, L.s2)).admission).toBe("WAITING_FOR_SLOT");
  });

  it("one primary + one view-only device; a third is refused; the second device never takes a second slot", async () => {
    const { sessionId } = await liveSession({ liveCapacity: 1, students: [U.studentX, L.s1] });
    const a = await joinSession(db, await as(U.studentX), { sessionId }, When(61));
    const b = await joinSession(db, await as(U.studentX), { sessionId }, When(62));
    expect([a.mode, b.mode]).toEqual(["PRIMARY", "VIEW_ONLY"]);
    await expect(joinSession(db, await as(U.studentX), { sessionId }, When(63))).rejects.toMatchObject({ code: "limit_exceeded" });
    expect((await joinSession(db, await as(L.s1), { sessionId }, When(64))).admission).toBe("WAITING_FOR_SLOT");
    // The primary leaves: the view-only device takes over as primary; the slot stays held.
    await leaveSession(db, await as(U.studentX), { connectionId: a.connectionId }, When(70));
    expect((await db.liveSessionConnection.findUniqueOrThrow({ where: { id: b.connectionId } })).mode).toBe("PRIMARY");
    expect((await participant(sessionId, L.s1)).admission).toBe("WAITING_FOR_SLOT");
  });

  it("a removed student cannot rejoin; removal frees the slot; audited", async () => {
    const { sessionId } = await liveSession({ liveCapacity: 1 });
    await joinSession(db, await as(U.studentX), { sessionId }, When(61));
    await joinSession(db, await as(L.s1), { sessionId }, When(62));
    const p = await participant(sessionId, U.studentX);
    await expect(removeParticipant(db, await as(U.studentX), { participantId: p.id }, When(63))).rejects.toBeInstanceOf(AuthorizationError);
    await removeParticipant(db, await as(U.adminA), { participantId: p.id }, When(63));
    await expect(joinSession(db, await as(U.studentX), { sessionId }, When(64))).rejects.toBeInstanceOf(AuthorizationError);
    expect((await participant(sessionId, L.s1)).admission).toBe("ADMITTED");
    expect(await auditCount(pg, "SESSION_PARTICIPANT_REMOVED", p.id)).toBe(1);
  });
});

describe("Mic and whiteboard — permission state only (A117–A119)", () => {
  async function room() {
    const ids = await liveSession({ students: [U.studentX, L.s1] });
    const x = await joinSession(db, await as(U.studentX), { sessionId: ids.sessionId }, When(61));
    const s1 = await joinSession(db, await as(L.s1), { sessionId: ids.sessionId }, When(61));
    return { ...ids, x, s1, px: (await participant(ids.sessionId, U.studentX)).id, p1: (await participant(ids.sessionId, L.s1)).id };
  }

  it("only ONE student holds the mic; granting another is a conflict until revoked; audited", async () => {
    const { px, p1, sessionId } = await room();
    await raiseHand(db, await as(U.studentX), { sessionId }, When(62));
    await grantMic(db, await as(U.teacherA), { participantId: px }, When(63));
    expect((await participant(sessionId, U.studentX)).handRaisedAt).toBeNull(); // granting lowers the hand
    await expect(grantMic(db, await as(U.teacherAB), { participantId: p1 }, When(64))).rejects.toMatchObject({ code: "conflict" });
    await revokeMic(db, await as(U.teacherAB), { participantId: px }, When(65));
    await grantMic(db, await as(U.adminA), { participantId: p1 }, When(66)); // the admin operates the mic
    // DB: a second concurrent student mic is impossible.
    await expect(pg.query("UPDATE live_session_participants SET mic_granted_at = now(), mic_granted_by_id = $1 WHERE id = $2", [U.teacherA, px])).rejects.toThrow(/one_student_mic/);
    expect(await auditCount(pg, "MIC_GRANTED")).toBe(2);
    expect(await auditCount(pg, "MIC_REVOKED")).toBe(1);
  });

  it("students, parents, unrelated teachers and other Markaz cannot control mics", async () => {
    const { px } = await room();
    for (const who of [L.s1, U.studentX, U.parentActive, L.teacherA3, U.adminB]) {
      await expect(grantMic(db, await as(who), { participantId: px }, When(62)), who).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("the second (view-only) device never publishes the student's mic or writes the whiteboard", async () => {
    const { px, x, sessionId } = await room();
    const second = await joinSession(db, await as(U.studentX), { sessionId }, When(62));
    await grantMic(db, await as(U.teacherA), { participantId: px }, When(63));
    await grantWhiteboard(db, await as(U.teacherA), { participantId: px }, When(63));
    expect(await getMyDeviceCapabilities(db, await as(U.studentX), { connectionId: x.connectionId }, When(64))).toMatchObject({ publishMic: true, writeWhiteboard: true, screenShare: false });
    expect(await getMyDeviceCapabilities(db, await as(U.studentX), { connectionId: second.connectionId }, When(64))).toMatchObject({ publishMic: false, writeWhiteboard: false, viewOnly: true });
    await expect(getMyDeviceCapabilities(db, await as(L.s1), { connectionId: x.connectionId }, When(64))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("whiteboard: teaching roles grant/revoke per student; a Markaz Admin may not; teachers write, admins do not", async () => {
    const { px, sessionId } = await room();
    await expect(grantWhiteboard(db, await as(U.adminA), { participantId: px }, When(62))).rejects.toBeInstanceOf(AuthorizationError);
    await grantWhiteboard(db, await as(U.teacherAB), { participantId: px }, When(62));
    await revokeWhiteboard(db, await as(U.teacherA), { participantId: px }, When(63));
    expect((await participant(sessionId, U.studentX)).whiteboardGrantedAt).toBeNull();
    const teacher = await joinSession(db, await as(U.teacherA), { sessionId }, When(64));
    const admin = await joinSession(db, await as(U.adminA), { sessionId }, When(64));
    expect(await getMyDeviceCapabilities(db, await as(U.teacherA), { connectionId: teacher.connectionId }, When(65))).toMatchObject({ writeWhiteboard: true, screenShare: true, publishMic: true });
    expect(await getMyDeviceCapabilities(db, await as(U.adminA), { connectionId: admin.connectionId }, When(65))).toMatchObject({ writeWhiteboard: false, screenShare: false, publishMic: false });
    expect(await auditCount(pg, "WHITEBOARD_GRANTED")).toBe(1);
    expect(await auditCount(pg, "WHITEBOARD_REVOKED")).toBe(1);
  });

  it("disconnecting clears a student's grants (audited as a system revocation)", async () => {
    const { px, x } = await room();
    await grantMic(db, await as(U.teacherA), { participantId: px }, When(62));
    await leaveSession(db, await as(U.studentX), { connectionId: x.connectionId }, When(63));
    expect((await db.liveSessionParticipant.findUniqueOrThrow({ where: { id: px } })).micGrantedAt).toBeNull();
    const { rows } = await pg.query<{ actor_id: string | null }>("SELECT actor_id FROM audit_events WHERE action = 'MIC_REVOKED'");
    expect(rows).toEqual([{ actor_id: null }]);
  });

  it("an access lapse removes capabilities immediately (re-checked per call)", async () => {
    const { classId, px, x } = await room();
    await grantMic(db, await as(U.teacherA), { participantId: px }, When(62));
    await db.classEnrollment.updateMany({ where: { classId, studentProfileId: U.studentX }, data: { status: "SUSPENDED" } });
    expect((await getMyDeviceCapabilities(db, await as(U.studentX), { connectionId: x.connectionId }, When(63))).publishMic).toBe(false);
  });
});

describe("Attendance (A122)", () => {
  /** Session 60 min (NOW+60 → NOW+120). */
  async function attended() {
    const { classId, sessionId } = await liveSession({ students: [U.studentX, L.s1, L.s2] });
    const x = await as(U.studentX);
    const a = await joinSession(db, x, { sessionId }, When(60));
    await leaveSession(db, x, { connectionId: a.connectionId }, When(70)); // 10 min
    const b = await joinSession(db, x, { sessionId }, When(72)); // reconnect
    const c = await joinSession(db, x, { sessionId }, When(75)); // second device, overlapping
    await leaveSession(db, x, { connectionId: c.connectionId }, When(90));
    await leaveSession(db, x, { connectionId: b.connectionId }, When(100)); // +28 min
    const late = await joinSession(db, await as(L.s1), { sessionId }, When(105)); // arrives 45 min late
    await endSession(db, await as(U.teacherA), { sessionId }, When(120));
    return { classId, sessionId, late };
  }

  it("join/leave accumulate; reconnects and the second device never double-count; LATE and ABSENT", async () => {
    const { sessionId } = await attended();
    const rows = await listSessionAttendance(db, await as(U.teacherA), sessionId);
    const by = (id: string) => rows.find((r) => r.studentProfileId === id)!;
    expect(by(U.studentX)).toMatchObject({ status: "PRESENT", presentSeconds: 38 * 60, sessionSeconds: 60 * 60 });
    expect(by(L.s1)).toMatchObject({ status: "LATE", presentSeconds: 15 * 60 });
    expect(by(L.s2)).toMatchObject({ status: "ABSENT", presentSeconds: 0 }); // enrolled, never joined
    expect(await db.liveSessionConnection.count({ where: { sessionId, disconnectedAt: null } })).toBe(0);
  });

  it("manual correction: Primary, Co-Teacher, Markaz Admin — audited with from/to; others refused", async () => {
    const { sessionId } = await attended();
    const rows = await listSessionAttendance(db, await as(U.adminA), sessionId);
    const late = rows.find((r) => r.studentProfileId === L.s1)!;
    for (const who of [L.teacherA3, U.studentX, U.parentActive, U.adminB]) {
      await expect(adjustAttendance(db, await as(who), { recordId: late.id, status: "PRESENT", reason: "x" }, When(130)), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    await adjustAttendance(db, await as(U.teacherAB), { recordId: late.id, status: "PRESENT", reason: "Connection problems confirmed" }, When(130));
    const after = await db.attendanceRecord.findUniqueOrThrow({ where: { id: late.id } });
    expect(after).toMatchObject({ status: "PRESENT", computedStatus: "LATE", adjustedById: U.teacherAB });
    const { rows: audit } = await pg.query<{ metadata: { from: string; to: string } }>("SELECT metadata FROM audit_events WHERE action = 'ATTENDANCE_ADJUSTED'");
    expect(audit).toEqual([{ metadata: { from: "LATE", to: "PRESENT" } }]);
  });

  it("a parent sees PRESENT/LATE/ABSENT only — never raw join/leave timestamps or durations", async () => {
    await attended();
    const rows = await listChildAttendance(db, await as(U.parentActive), U.studentX);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["className", "id", "sessionDate", "status", "timezone"]);
    expect(rows[0].status).toBe("PRESENT");
    const json = JSON.stringify(rows);
    for (const forbidden of ["presentSeconds", "firstArrival", "connectedAt", "disconnectedAt", "admittedAt"]) expect(json).not.toContain(forbidden);
    for (const who of [U.parentVerified, U.parentRevoked, U.parentUnlinked, U.teacherA]) {
      await expect(listChildAttendance(db, await as(who), U.studentX), who).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("a student sees their own status history", async () => {
    await attended();
    const rows = await listMyAttendance(db, await as(L.s1));
    expect(rows.map((r) => r.status)).toEqual(["LATE"]);
  });

  it("raw attendance is staff-only: students, parents and other Markaz cannot list a session's attendance", async () => {
    const { sessionId } = await attended();
    for (const who of [U.studentX, U.parentActive, U.adminB, L.teacherA3]) {
      await expect(listSessionAttendance(db, await as(who), sessionId), who).rejects.toBeInstanceOf(AuthorizationError);
    }
  });
});

describe("Class chat (A120)", () => {
  it("public to the class, persistent, authorship kept; waiting students cannot post", async () => {
    const { classId, sessionId } = await liveSession({ liveCapacity: 1 });
    await joinSession(db, await as(U.studentX), { sessionId }, When(61));
    await joinSession(db, await as(L.s1), { sessionId }, When(61)); // waiting for a slot
    await joinSession(db, await as(U.teacherA), { sessionId }, When(61));
    await postChatMessage(db, await as(U.studentX), { sessionId, body: "Swali kuhusu idgham" }, When(62));
    await postChatMessage(db, await as(U.teacherA), { sessionId, body: "Jibu" }, When(63));
    await expect(postChatMessage(db, await as(L.s1), { sessionId, body: "x" }, When(63))).rejects.toMatchObject({ code: "invalid_state" });
    await expect(postChatMessage(db, await as(U.studentX), { sessionId, body: "   " }, When(63))).rejects.toMatchObject({ code: "invalid_input" });
    await endSession(db, await as(U.teacherA), { sessionId }, When(120));
    await expect(postChatMessage(db, await as(U.studentX), { sessionId, body: "after" }, When(121))).rejects.toMatchObject({ code: "invalid_state" });
    const history = await listClassChatHistory(db, await as(L.s1), classId, When(130)); // enrolled with access: may read
    expect(history.map((m) => [m.authorProfileId, m.authorRole, m.body])).toEqual([
      [U.studentX, "STUDENT", "Swali kuhusu idgham"],
      [U.teacherA, "PRIMARY_TEACHER", "Jibu"],
    ]);
  });

  it("isolation: parents, unrelated students/teachers, other classes and other Markaz are denied", async () => {
    const { classId, sessionId } = await liveSession();
    await joinSession(db, await as(U.studentX), { sessionId }, When(61));
    await postChatMessage(db, await as(U.studentX), { sessionId, body: "hello" }, When(62));
    for (const who of [U.parentActive, L.s2, L.teacherA3, U.adminB, U.studentY, U.superAdmin]) {
      await expect(listSessionChat(db, await as(who), sessionId, When(63)), who).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listClassChatHistory(db, await as(who), classId, When(63)), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    const other = await createClass(db, await as(U.adminA), { tenantId: T.A, name: "Other", primaryTeacherProfileId: U.teacherA }, { now: NOW });
    expect(await listClassChatHistory(db, await as(U.teacherA), other, When(63))).toEqual([]);
    // A non-participant cannot post even into a class they can read.
    await expect(postChatMessage(db, await as(U.adminA), { sessionId, body: "x" }, When(64))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a substitute reads the chat of the session they covered, not the whole class history", async () => {
    const classId = await classWithStudents(db);
    const sessionId = await scheduled(classId);
    await assignSubstitute(db, await as(U.teacherA), { sessionId, substituteProfileId: L.teacherA3 }, { now: NOW });
    await startSession(db, await as(L.teacherA3), { sessionId }, When(60));
    expect(await listSessionChat(db, await as(L.teacherA3), sessionId, When(61))).toEqual([]);
    await expect(listClassChatHistory(db, await as(L.teacherA3), classId, When(61))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a suspended student loses chat history access", async () => {
    const { classId } = await liveSession();
    await db.classEnrollment.updateMany({ where: { classId, studentProfileId: U.studentX }, data: { status: "SUSPENDED" } });
    await expect(listClassChatHistory(db, await as(U.studentX), classId, When(61))).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("Markaz Admin is operational, not teaching (A115)", () => {
  it("the shell view: admin may operate and control mics but has no whiteboard/screen-share authority", async () => {
    const { sessionId } = await liveSession();
    const admin = await getLiveSessionView(db, await as(U.adminA), sessionId, When(61));
    expect(admin.role).toBe("MARKAZ_ADMIN");
    expect(admin.can).toMatchObject({ startOrEnd: true, operate: true, controlMic: true, controlWhiteboard: false, authorWhiteboard: false, screenShare: false, readAttendance: true });
    const co = await getLiveSessionView(db, await as(U.teacherAB), sessionId, When(61));
    expect(co.can).toMatchObject({ controlWhiteboard: true, screenShare: true, cancel: false });
    const student = await getLiveSessionView(db, await as(U.studentX), sessionId, When(61));
    expect(student.participants).toBeNull(); // students do not get the operator list
    await expect(getLiveSessionView(db, await as(U.parentActive), sessionId, When(61))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("capacity edits by the admin take effect for the next admissions only", async () => {
    const { classId, sessionId } = await liveSession({ liveCapacity: 1 });
    await joinSession(db, await as(U.studentX), { sessionId }, When(61));
    expect((await joinSession(db, await as(L.s1), { sessionId }, When(62))).admission).toBe("WAITING_FOR_SLOT");
    await updateClass(db, await as(U.adminA), { classId, liveCapacity: 2 }, { now: at(63) });
    expect((await participant(sessionId, U.studentX)).admission).toBe("ADMITTED");
    await enrollStudent(db, await as(U.adminA), { classId, studentProfileId: L.s2 }, { now: at(63) });
    // First come, first served: the waiting s1 takes the new slot before the newcomer s2.
    expect((await joinSession(db, await as(L.s2), { sessionId }, When(64))).admission).toBe("WAITING_FOR_SLOT");
    expect((await participant(sessionId, L.s1)).admission).toBe("ADMITTED");
  });
});
