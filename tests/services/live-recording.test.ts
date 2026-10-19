import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import { disableOptionC } from "@/server/services/option-c";
import { assignSubstitute, createScheduledSession, endSession, grantMic, joinSession, leaveSession, startSession } from "@/server/services/live-sessions";
import {
  finalizeRecordingMedia,
  getCapturePlan,
  listStudentVisibleRecordings,
  registerRecordingMedia,
  registerRecordingParticipants,
} from "@/server/services/recordings";
import { correctRecordingParticipants, startSessionRecording, stopSessionRecording } from "@/server/services/session-recording";
import { actor, createTestPrisma, FakeStorage } from "../db/prisma";
import { T, U } from "../support/fixture";
import { at, auditCount, classWithStudents, L, NOW, seedLive } from "../support/live";
import { ADULT_DOB, enableOptionCFor, insertGuardianConsent, insertSelfConsent, MINOR_DOB, seedMedia, setDob, TEST_POLICY } from "../support/media";

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
  await seedLive(pg);
  // studentX: verified minor with ACTIVE guardian consent → recording-eligible. s1, s2: no consent.
  await setDob(pg, U.studentX, MINOR_DOB);
  await insertGuardianConsent(pg, U.studentX);
  await enableOptionCFor(pg, T.A);
});

const as = (id: string) => actor(db, id);
const When = (m: number) => ({ now: at(m), policy: TEST_POLICY });
const START = { noticeShown: true, teacherNoticeAcknowledged: true } as const;

function nairobi(utc: Date) {
  const local = new Date(utc.getTime() + 3 * 3_600_000).toISOString();
  return { date: local.slice(0, 10), startTime: local.slice(11, 16) };
}

/** Recording-enabled session (NOW+60 → NOW+120), LIVE, with studentX and s1 connected. */
async function recordedSession() {
  const classId = await classWithStudents(db, { students: [U.studentX, L.s1, L.s2] });
  const sessionId = await createScheduledSession(db, await as(U.teacherA), { classId, ...nairobi(at(60)), durationMinutes: 60, recordingEnabled: true }, { now: NOW });
  await startSession(db, await as(U.teacherA), { sessionId }, When(60));
  await joinSession(db, await as(U.studentX), { sessionId }, When(60));
  await joinSession(db, await as(L.s1), { sessionId }, When(61));
  return { classId, sessionId };
}

const rp = (recordingId: string, studentProfileId: string) =>
  db.recordingParticipant.findUnique({ where: { recordingId_studentProfileId: { recordingId, studentProfileId } } });

describe("Recording ↔ LiveSession (A123)", () => {
  it("a session recording links to its LiveSession (composite FK, same Markaz)", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    const r = await db.recording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(r).toMatchObject({ liveSessionId: sessionId, tenantId: T.A, teacherProfileId: U.teacherA, status: "DRAFT" });
    expect(r.startedAt).toEqual(at(65));
    await expect(
      pg.query("INSERT INTO recordings (tenant_id, teacher_profile_id, live_session_id) VALUES ($1, $2, $3)", [T.B, U.teacherAB, sessionId]),
    ).rejects.toThrow(/foreign key/);
    expect(await auditCount(pg, "RECORDING_SESSION_STARTED", recordingId)).toBe(1);
  });

  it("Option C is checked again when recording starts; a session without recording mode cannot record", async () => {
    const { sessionId, classId } = await recordedSession();
    await disableOptionC(db, await as(U.superAdmin), { tenantId: T.A }, { now: at(62) });
    await expect(startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65))).rejects.toMatchObject({ code: "feature_not_enabled" });
    // Live participation continues regardless.
    await expect(joinSession(db, await as(L.s2), { sessionId }, When(66))).resolves.toMatchObject({ admission: "ADMITTED" });
    await endSession(db, await as(U.teacherA), { sessionId }, When(70));
    const plain = await createScheduledSession(db, await as(U.teacherA), { classId, ...nairobi(at(300)), durationMinutes: 60 }, { now: NOW });
    await startSession(db, await as(U.teacherA), { sessionId: plain }, When(300));
    await expect(startSessionRecording(db, await as(U.teacherA), { sessionId: plain, ...START }, When(301))).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("the notices are mandatory; only a teaching role starts it (not the Markaz Admin, not a student)", async () => {
    const { sessionId } = await recordedSession();
    await expect(startSessionRecording(db, await as(U.teacherA), { sessionId, noticeShown: true }, When(65))).rejects.toMatchObject({ code: "invalid_input" });
    for (const who of [U.adminA, U.studentX, L.teacherA3, U.adminB]) {
      await expect(startSessionRecording(db, await as(who), { sessionId, ...START }, When(65)), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    await startSessionRecording(db, await as(U.teacherAB), { sessionId, ...START }, When(65));
    await expect(startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(66))).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("Participants from presence + consent at capture (A124–A125)", () => {
  it("everyone admitted and connected at recording start is a participant; consent is snapshotted then", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    expect(await rp(recordingId, U.studentX)).toMatchObject({ source: "SESSION_PRESENCE", audioIncluded: true, eligibility: "CONSENTED", audioIncludedFrom: at(65) });
    expect(await rp(recordingId, L.s1)).toMatchObject({ source: "SESSION_PRESENCE", audioIncluded: false, eligibility: "DATE_OF_BIRTH_MISSING", audioIncludedFrom: null });
    expect(await rp(recordingId, L.s2)).toBeNull(); // enrolled but not present
    expect(await getCapturePlan(db, await as(U.teacherA), { recordingId })).toEqual(
      expect.arrayContaining([
        { studentProfileId: U.studentX, includeAudio: true, eligibility: "CONSENTED", includeAudioFrom: at(65) },
        { studentProfileId: L.s1, includeAudio: false, eligibility: "DATE_OF_BIRTH_MISSING", includeAudioFrom: null },
      ]),
    );
  });

  it("a late joiner may join and take part live, but their audio is excluded until their consent check passes", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    const j = await joinSession(db, await as(L.s2), { sessionId }, When(70));
    expect(j.admission).toBe("ADMITTED");
    expect(await rp(recordingId, L.s2)).toMatchObject({ source: "SESSION_LATE_JOIN", audioIncluded: false, audioIncludedFrom: null });
    // Live participation is independent of recording consent: the mic may still be granted.
    const p = await db.liveSessionParticipant.findUniqueOrThrow({ where: { sessionId_profileId: { sessionId, profileId: L.s2 } } });
    await grantMic(db, await as(U.teacherA), { participantId: p.id }, When(71));
    // Consent becomes valid (adult, verified DOB, own consent); a re-check on rejoin includes audio FROM THEN.
    await setDob(pg, L.s2, ADULT_DOB);
    await insertSelfConsent(pg, L.s2);
    await leaveSession(db, await as(L.s2), { connectionId: j.connectionId }, When(80));
    await joinSession(db, await as(L.s2), { sessionId }, When(82));
    const after = await rp(recordingId, L.s2);
    expect(after).toMatchObject({ audioIncluded: true, eligibility: "CONSENTED", audioIncludedFrom: at(82) });
  });

  it("a later rejoin never re-includes someone excluded by a correction", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    await correctRecordingParticipants(db, await as(U.teacherA), { recordingId, remove: [U.studentX] }, When(66));
    const conn = await db.liveSessionConnection.findFirstOrThrow({ where: { sessionId, participant: { profileId: U.studentX }, disconnectedAt: null } });
    await leaveSession(db, await as(U.studentX), { connectionId: conn.id }, When(67));
    await joinSession(db, await as(U.studentX), { sessionId }, When(68));
    expect((await rp(recordingId, U.studentX))?.excludedAt).toEqual(at(66));
  });

  it("the free-form teacher list is refused for session recordings (legacy recordings unaffected)", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    await expect(registerRecordingParticipants(db, await as(U.teacherA), { recordingId, studentProfileIds: [L.s2] }, When(66))).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("ending the session stops capture", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    await endSession(db, await as(U.teacherAB), { sessionId }, When(110));
    expect((await db.recording.findUniqueOrThrow({ where: { id: recordingId } })).endedAt).toEqual(at(110));
    await expect(stopSessionRecording(db, await as(U.teacherA), { recordingId }, When(111))).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("Participant-list correction before finalization (A124)", () => {
  it("Primary, Co-Teacher, Markaz Admin may correct; substitute, students and outsiders may not; audited", async () => {
    const { sessionId } = await recordedSession();
    await assignSubstitute(db, await as(U.adminA), { sessionId, substituteProfileId: L.teacherA3 }, When(62));
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    for (const who of [L.teacherA3, U.studentX, U.parentActive, U.adminB]) {
      await expect(correctRecordingParticipants(db, await as(who), { recordingId, add: [L.s2] }, When(66)), who).rejects.toBeInstanceOf(AuthorizationError);
    }
    await correctRecordingParticipants(db, await as(U.teacherAB), { recordingId, add: [L.s2] }, When(66));
    expect(await rp(recordingId, L.s2)).toMatchObject({ source: "MANUAL_CORRECTION", audioIncluded: false });
    await correctRecordingParticipants(db, await as(U.adminA), { recordingId, remove: [L.s1] }, When(67));
    expect((await rp(recordingId, L.s1))?.excludedById).toBe(U.adminA);
    const plan = await getCapturePlan(db, await as(U.teacherA), { recordingId });
    expect(plan.map((p) => p.studentProfileId).sort()).toEqual([U.studentX, L.s2].sort());
    expect(await auditCount(pg, "RECORDING_PARTICIPANTS_ADJUSTED", recordingId)).toBe(2);
  });

  it("only students enrolled in the class or present in the session may be added", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    await expect(correctRecordingParticipants(db, await as(U.teacherA), { recordingId, add: [L.s3] }, When(66))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(correctRecordingParticipants(db, await as(U.teacherA), { recordingId, add: [U.studentY] }, When(66))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("after media finalization the list is frozen", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    const storage = new FakeStorage();
    await registerRecordingMedia(db, storage, recordingId);
    const r = await db.recording.findUniqueOrThrow({ where: { id: recordingId } });
    storage.put(r.storageBucket as string, r.storageObjectKey as string, 1000);
    await finalizeRecordingMedia(db, storage, recordingId, { durationMs: 1000 }, at(120));
    await expect(correctRecordingParticipants(db, await as(U.teacherA), { recordingId, remove: [L.s1] }, When(121))).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("an excluded participant never qualifies as a viewer of the approved recording", async () => {
    const { sessionId } = await recordedSession();
    const recordingId = await startSessionRecording(db, await as(U.teacherA), { sessionId, ...START }, When(65));
    await correctRecordingParticipants(db, await as(U.teacherA), { recordingId, remove: [U.studentX] }, When(66));
    // Owner-path approval (approval itself is covered by the recordings suite).
    await pg.query(
      `UPDATE recordings SET status = 'APPROVED', submitted_at = now(), submitted_by_id = $2, approved_at = now(), approved_by_id = $3, approval_scope = 'WHOLE' WHERE id = $1`,
      [recordingId, U.teacherA, U.adminA],
    );
    expect(await listStudentVisibleRecordings(db, await as(U.studentX))).toEqual([]);
  });
});
