import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import { createScheduledSession, endSession, grantMic, joinSession, leaveSession, removeParticipant, revokeMic, startSession } from "@/server/services/live-sessions";
import { AudioSyncError, issueAudioToken, storedAudioGrant, syncSessionAudio } from "@/server/services/live-audio";
import { createFakeRtcProvider } from "@/server/rtc/fake";
import { roomNameForSession, type RtcProvider } from "@/server/rtc/rtc";
import { actor, createTestPrisma } from "../db/prisma";
import { U } from "../support/fixture";
import { at, classWithStudents, L, NOW, seedLive } from "../support/live";

// Live Class media M1 (docs/features/live-class-media-plan.md §2.1): the audio room follows the
// database. The fake provider stands in for LiveKit; the real adapter is covered in tests/unit/rtc.

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedLive(pg);
});

const as = (id: string) => actor(db, id);
const When = (m: number) => ({ now: at(m) });

async function liveRoom() {
  const classId = await classWithStudents(db, { students: [U.studentX, L.s1] });
  const local = new Date(at(60).getTime() + 3 * 3_600_000).toISOString(); // Africa/Nairobi wall time
  const sessionId = await createScheduledSession(db, await as(U.teacherA), { classId, date: local.slice(0, 10), startTime: local.slice(11, 16), durationMinutes: 60 }, { now: NOW });
  await startSession(db, await as(U.teacherA), { sessionId }, When(60));
  const teacher = await joinSession(db, await as(U.teacherA), { sessionId }, When(60));
  const x = await joinSession(db, await as(U.studentX), { sessionId }, When(61));
  const s1 = await joinSession(db, await as(L.s1), { sessionId }, When(61));
  const rtc = createFakeRtcProvider();
  const room = roomNameForSession(sessionId);
  for (const c of [teacher, x, s1]) rtc.connect(room, c.connectionId);
  return { sessionId, room, rtc, teacher, x, s1 };
}

/** Last grant pushed to each identity. */
function lastGrants(rtc: ReturnType<typeof createFakeRtcProvider>) {
  const out: Record<string, boolean> = {};
  for (const c of rtc.calls) if (c.op === "setPublish") out[c.identity] = c.grant.canPublishMicrophone;
  return out;
}

describe("audio token (fail closed)", () => {
  it("a teacher may speak; a student listens until granted the mic", async () => {
    const { rtc, teacher, x, sessionId } = await liveRoom();
    expect((await issueAudioToken(db, await as(U.teacherA), rtc, { connectionId: teacher.connectionId }, When(62))).canPublishMicrophone).toBe(true);
    expect((await issueAudioToken(db, await as(U.studentX), rtc, { connectionId: x.connectionId }, When(62))).canPublishMicrophone).toBe(false);
    await grantMic(db, await as(U.teacherA), { participantId: x.participantId }, When(63));
    expect((await issueAudioToken(db, await as(U.studentX), rtc, { connectionId: x.connectionId }, When(63))).canPublishMicrophone).toBe(true);
    expect(rtc.calls.at(-1)).toMatchObject({ op: "token", room: roomNameForSession(sessionId), identity: x.connectionId });
  });

  it("a second (view-only) device never gets the mic (A121)", async () => {
    const { rtc, x, sessionId } = await liveRoom();
    await grantMic(db, await as(U.teacherA), { participantId: x.participantId }, When(63));
    const second = await joinSession(db, await as(U.studentX), { sessionId }, When(64));
    expect(second.mode).toBe("VIEW_ONLY");
    expect((await issueAudioToken(db, await as(U.studentX), rtc, { connectionId: second.connectionId }, When(64))).canPublishMicrophone).toBe(false);
  });

  it("nobody gets a token for someone else's device, or for an ended session", async () => {
    const { rtc, x, teacher, sessionId } = await liveRoom();
    await expect(issueAudioToken(db, await as(L.s1), rtc, { connectionId: x.connectionId }, When(62))).rejects.toBeInstanceOf(AuthorizationError);
    await expect(issueAudioToken(db, await as(U.teacherA), rtc, { connectionId: "not-a-uuid" }, When(62))).rejects.toMatchObject({ code: "invalid_input" });
    await endSession(db, await as(U.teacherA), { sessionId }, When(70));
    await expect(issueAudioToken(db, await as(U.teacherA), rtc, { connectionId: teacher.connectionId }, When(71))).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("a student waiting for a live slot gets no token", async () => {
    const classId = await classWithStudents(db, { liveCapacity: 1, students: [U.studentX, L.s1] });
    const sessionId = await (async () => {
      const local = new Date(at(60).getTime() + 3 * 3_600_000).toISOString();
      return createScheduledSession(db, await as(U.teacherA), { classId, date: local.slice(0, 10), startTime: local.slice(11, 16), durationMinutes: 60 }, { now: NOW });
    })();
    await startSession(db, await as(U.teacherA), { sessionId }, When(60));
    await joinSession(db, await as(U.studentX), { sessionId }, When(61));
    const waiting = await joinSession(db, await as(L.s1), { sessionId }, When(61));
    expect(waiting.admission).toBe("WAITING_FOR_SLOT");
    await expect(issueAudioToken(db, await as(L.s1), createFakeRtcProvider(), { connectionId: waiting.connectionId }, When(62))).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("room sync follows the database", () => {
  it("mic grant, handoff and revoke reach the media server (A117, A138)", async () => {
    const { rtc, sessionId, x, s1, teacher } = await liveRoom();
    await grantMic(db, await as(U.teacherA), { participantId: x.participantId }, When(62));
    await syncSessionAudio(db, rtc, sessionId);
    expect(lastGrants(rtc)).toEqual({ [teacher.connectionId]: true, [x.connectionId]: true, [s1.connectionId]: false });

    await grantMic(db, await as(U.teacherA), { participantId: s1.participantId }, When(63)); // handoff
    await syncSessionAudio(db, rtc, sessionId);
    expect(lastGrants(rtc)).toMatchObject({ [x.connectionId]: false, [s1.connectionId]: true });

    await revokeMic(db, await as(U.teacherA), { participantId: s1.participantId }, When(64));
    await syncSessionAudio(db, rtc, sessionId);
    expect(lastGrants(rtc)).toMatchObject({ [x.connectionId]: false, [s1.connectionId]: false, [teacher.connectionId]: true });
  });

  it("a removed student is disconnected from the room", async () => {
    const { rtc, sessionId, room, x } = await liveRoom();
    await removeParticipant(db, await as(U.adminA), { participantId: x.participantId }, When(62));
    await syncSessionAudio(db, rtc, sessionId);
    expect(rtc.calls).toContainEqual({ op: "remove", room, identity: x.connectionId });
    expect(rtc.inRoom(room)).not.toContain(x.connectionId);
  });

  it("leaving drops that device; a remaining view-only device takes over the mic", async () => {
    const { rtc, sessionId, room, x } = await liveRoom();
    await grantMic(db, await as(U.teacherA), { participantId: x.participantId }, When(62));
    const second = await joinSession(db, await as(U.studentX), { sessionId }, When(63));
    rtc.connect(room, second.connectionId);
    await leaveSession(db, await as(U.studentX), { connectionId: x.connectionId }, When(64));
    await syncSessionAudio(db, rtc, sessionId, [x.connectionId]);
    expect(rtc.calls).toContainEqual({ op: "remove", room, identity: x.connectionId });
    expect(lastGrants(rtc)[second.connectionId]).toBe(true); // promoted to PRIMARY, still holds the mic
  });

  it("ending the session closes the room", async () => {
    const { rtc, sessionId, room } = await liveRoom();
    await endSession(db, await as(U.teacherA), { sessionId }, When(70));
    await syncSessionAudio(db, rtc, sessionId);
    expect(rtc.calls.at(-1)).toEqual({ op: "close", room });
    expect(rtc.inRoom(room)).toEqual([]);
  });

  it("if a revoke cannot be applied, the device is disconnected instead (fail closed)", async () => {
    const { rtc, sessionId, room, x } = await liveRoom();
    const failing: RtcProvider = {
      ...rtc,
      async setPublish(r, identity, grant) {
        if (identity === x.connectionId) throw new Error("vendor down");
        return rtc.setPublish(r, identity, grant);
      },
    };
    await syncSessionAudio(db, failing, sessionId);
    expect(rtc.calls).toContainEqual({ op: "remove", room, identity: x.connectionId });
  });

  it("a grant that cannot be applied is reported, not hidden", async () => {
    const { rtc, sessionId, x } = await liveRoom();
    await grantMic(db, await as(U.teacherA), { participantId: x.participantId }, When(62));
    const failing: RtcProvider = { ...rtc, setPublish: async () => Promise.reject(new Error("vendor down")) };
    await expect(syncSessionAudio(db, failing, sessionId)).rejects.toBeInstanceOf(AudioSyncError);
  });
});

describe("stored audio grant (pure)", () => {
  const base = { sessionLive: true, mode: "PRIMARY" as const, removed: false, admission: null, micGranted: false };
  it("teaching roles speak from their primary device; a Markaz Admin does not by role (A115)", () => {
    for (const role of ["PRIMARY_TEACHER", "CO_TEACHER", "SUBSTITUTE_TEACHER"]) expect(storedAudioGrant({ ...base, role }).canPublishMicrophone).toBe(true);
    expect(storedAudioGrant({ ...base, role: "MARKAZ_ADMIN" }).canPublishMicrophone).toBe(false);
    expect(storedAudioGrant({ ...base, role: "PRIMARY_TEACHER", mode: "VIEW_ONLY" }).canPublishMicrophone).toBe(false);
  });

  it("a student needs admission and the mic grant", () => {
    expect(storedAudioGrant({ ...base, role: "STUDENT", admission: "ADMITTED", micGranted: true }).canPublishMicrophone).toBe(true);
    expect(storedAudioGrant({ ...base, role: "STUDENT", admission: "WAITING_FOR_SLOT", micGranted: true }).canPublishMicrophone).toBe(false);
    expect(storedAudioGrant({ ...base, role: "STUDENT", admission: "ADMITTED", micGranted: true, removed: true }).canPublishMicrophone).toBe(false);
    expect(storedAudioGrant({ ...base, role: "STUDENT", admission: "ADMITTED", micGranted: true, sessionLive: false }).canPublishMicrophone).toBe(false);
  });
});
