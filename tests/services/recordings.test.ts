import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { RecordingStatus } from "@/generated/prisma/enums";
import { AuthorizationError } from "@/server/authz/policy";
import { withdrawConsent } from "@/server/services/consent";
import {
  approveRecording,
  createRecording,
  finalizeRecordingMedia,
  finalizeSegmentMedia,
  getRecordingPlaybackUrl,
  listParentVisibleRecordings,
  registerRecordingMedia,
  registerRecordingParticipants,
  registerSegmentMedia,
  revokeRecordingApproval,
  startRecording,
  submitRecordingForApproval,
} from "@/server/services/recordings";
import { RECORDING_BUCKET } from "@/server/storage/object-storage";
import { actor, createTestPrisma, FakeStorage } from "../db/prisma";
import { T, U } from "../support/fixture";
import { insertGuardianConsent, M, MINOR_DOB, seedMedia, setDob, TEST_POLICY } from "../support/media";

let pg: PGlite;
let db: PrismaClient;
let storage: FakeStorage;
let consentId: string;
const O = { policy: TEST_POLICY };

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
  storage = new FakeStorage();
  await setDob(pg, U.studentX, MINOR_DOB);
  consentId = await insertGuardianConsent(pg, U.studentX);
});

/** A finished recording of Markaz A (by teacherA) in which studentX took part. */
async function finishedRecording(teacher: string = U.teacherA, tenantId: string = T.A) {
  const a = await actor(db, teacher);
  const recordingId = await createRecording(db, a, { tenantId, title: "An-Naba" }, O);
  await startRecording(db, a, { recordingId, noticeShown: true }, O);
  await registerRecordingParticipants(db, a, { recordingId, studentProfileIds: [U.studentX] }, O);
  // The future provider-neutral worker writes the media:
  await registerRecordingMedia(db, storage, recordingId);
  const r = await db.recording.findUniqueOrThrow({ where: { id: recordingId } });
  storage.put(r.storageBucket as string, r.storageObjectKey as string, 5000);
  await finalizeRecordingMedia(db, storage, recordingId, { durationMs: 600_000 });
  return recordingId;
}

async function approvedWhole() {
  const id = await finishedRecording();
  await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
  await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
  return id;
}

const play = async (who: string, recordingId: string, segmentId?: string) =>
  getRecordingPlaybackUrl(db, storage, await actor(db, who), { recordingId, segmentId }, O);

describe("provider-neutral foundation (A77)", () => {
  it("the only states are DRAFT → PENDING_APPROVAL → APPROVED → REVOKED (no rejection workflow)", () => {
    expect(Object.keys(RecordingStatus).sort()).toEqual(["APPROVED", "DRAFT", "PENDING_APPROVAL", "REVOKED"]);
  });

  it("capture can only start once the recording notice was shown (A30)", async () => {
    const a = await actor(db, U.teacherA);
    const recordingId = await createRecording(db, a, { tenantId: T.A }, O);
    await expect(startRecording(db, a, { recordingId, noticeShown: false }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(startRecording(db, a, { recordingId }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(pg.query("UPDATE recordings SET started_at = now() WHERE id = $1", [recordingId])).rejects.toThrow(/recording_started_with_notice/);
    await startRecording(db, a, { recordingId, noticeShown: true }, O);
    expect((await db.recording.findUniqueOrThrow({ where: { id: recordingId } })).noticeShownAt).not.toBeNull();
  });

  it("media lives in the private recordings bucket under a non-guessable key", async () => {
    const id = await finishedRecording();
    const r = await db.recording.findUniqueOrThrow({ where: { id } });
    expect(r.storageBucket).toBe(RECORDING_BUCKET);
    expect(r.storageObjectKey).not.toContain(T.A);
    expect(r.storageObjectKey).not.toContain(U.teacherA);
  });
});

describe("approval workflow (A78)", () => {
  it("the teacher submits; only a same-Markaz Markaz Admin approves; the teacher never does", async () => {
    const id = await finishedRecording();
    await expect(submitRecordingForApproval(db, await actor(db, U.teacherAB), { recordingId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    for (const who of [U.teacherA, U.adminB, U.superAdmin, U.parentActive]) {
      await expect(approveRecording(db, await actor(db, who), { recordingId: id, scope: "WHOLE" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
    expect(await db.recording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "APPROVED", approvalScope: "WHOLE", approvedById: U.adminA });
    const actions = (await db.auditEvent.findMany({ where: { targetId: id }, orderBy: { createdAt: "asc" } })).map((e) => [e.action, e.actorId]);
    expect(actions).toEqual([
      ["RECORDING_SUBMITTED", U.teacherA],
      ["RECORDING_APPROVED", U.adminA],
    ]);
  });

  it("a recording without finished media cannot be submitted; a draft cannot be approved", async () => {
    const a = await actor(db, U.teacherA);
    const id = await createRecording(db, a, { tenantId: T.A }, O);
    await expect(submitRecordingForApproval(db, a, { recordingId: id }, O)).rejects.toMatchObject({ code: "invalid_state" });
    const done = await finishedRecording();
    await expect(approveRecording(db, await actor(db, U.adminA), { recordingId: done, scope: "WHOLE" }, O)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("a departed teacher can no longer submit", async () => {
    const id = await finishedRecording();
    await pg.query("UPDATE memberships SET status = 'ENDED', ended_at = now() WHERE profile_id = $1 AND tenant_id = $2", [U.teacherA, T.A]);
    await expect(submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("INTERIM: an admin who is also the recording's author may not approve it", async () => {
    await pg.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'TEACHER')", [T.A, M.adminA2]);
    const id = await finishedRecording(M.adminA2);
    await submitRecordingForApproval(db, await actor(db, M.adminA2), { recordingId: id }, O);
    await expect(approveRecording(db, await actor(db, M.adminA2), { recordingId: id, scope: "WHOLE" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
  });

  it("revocation is not deletion: hidden from parents, kept for staff, bytes untouched (A79)", async () => {
    const id = await approvedWhole();
    await play(U.parentActive, id);
    await expect(revokeRecordingApproval(db, await actor(db, U.teacherA), { recordingId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await revokeRecordingApproval(db, await actor(db, U.adminA), { recordingId: id }, O);
    const r = await db.recording.findUniqueOrThrow({ where: { id } });
    expect(r).toMatchObject({ status: "REVOKED", deletedAt: null, approvalRevokedById: U.adminA });
    expect(storage.has(r.storageBucket as string, r.storageObjectKey as string)).toBe(true);
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
    await play(U.adminA, id);
    await play(U.teacherA, id);
    expect(await db.auditEvent.count({ where: { action: "RECORDING_APPROVAL_REVOKED", targetId: id } })).toBe(1);
  });
});

describe("parent visibility needs ALL gates (A78)", () => {
  it("not before approval, and only with an ACTIVE link", async () => {
    const id = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
    expect((await play(U.parentActive, id)).url).toContain("download");
    for (const who of [U.parentVerified, U.parentPendingA, U.parentRevoked, U.parentUnlinked]) {
      await expect(play(who, id)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("not when the child's audio was excluded (no consent at capture time)", async () => {
    await pg.query("UPDATE recording_consents SET withdrawn_at = now(), withdrawn_by_id = $1", [U.parentActive]);
    const id = await finishedRecording();
    expect((await db.recordingParticipant.findFirstOrThrow({ where: { recordingId: id } })).audioIncluded).toBe(false);
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("not after consent is withdrawn (the recording also enters deletion review)", async () => {
    const id = await approvedWhole();
    await withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O);
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await db.mediaDeletionRequest.findMany({ where: { recordingId: id } })).toEqual([
      expect.objectContaining({ reason: "CONSENT_WITHDRAWN", status: "PENDING" }),
    ]);
  });

  it("the parent list shows only recordings passing every gate", async () => {
    const approved = await approvedWhole();
    await finishedRecording(); // draft, not visible
    expect((await listParentVisibleRecordings(db, await actor(db, U.parentActive), O)).map((r) => r.id)).toEqual([approved]);
    expect(await listParentVisibleRecordings(db, await actor(db, U.parentVerified), O)).toEqual([]);
  });

  it("students do not get full-recording access (not decided)", async () => {
    const id = await approvedWhole();
    await expect(play(U.studentX, id)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("segment approval is a special case (A78)", () => {
  async function approvedSegments() {
    const id = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "SEGMENTS", segments: [{ startMs: 60_000, endMs: 90_000 }] }, O);
    return id;
  }

  it("parents never get the whole file; a segment plays only from its own finalized object", async () => {
    const id = await approvedSegments();
    const [segment] = await db.recordingSegment.findMany({ where: { recordingId: id } });
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(play(U.parentActive, id, segment.id)).rejects.toMatchObject({ code: "invalid_state" });
    await registerSegmentMedia(db, storage, segment.id);
    const s = await db.recordingSegment.findUniqueOrThrow({ where: { id: segment.id } });
    storage.put(s.storageBucket as string, s.storageObjectKey as string, 100);
    await finalizeSegmentMedia(db, storage, segment.id);
    const { url } = await play(U.parentActive, id, segment.id);
    expect(url).toContain(s.storageObjectKey as string);
    await play(U.adminA, id); // staff may still review the whole recording
  });

  it("segments outside the recording or empty are rejected", async () => {
    const id = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    const admin = await actor(db, U.adminA);
    await expect(approveRecording(db, admin, { recordingId: id, scope: "SEGMENTS", segments: [] }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(approveRecording(db, admin, { recordingId: id, scope: "SEGMENTS", segments: [{ startMs: 0, endMs: 700_000 }] }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(approveRecording(db, admin, { recordingId: id, scope: "SEGMENTS", segments: [{ startMs: 5, endMs: 5 }] }, O)).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("staff and Super Admin access (A66/A77)", () => {
  it("author and same-Markaz admin play; other staff do not; a Super Admin plays only with an audit event", async () => {
    const id = await finishedRecording();
    await play(U.teacherA, id);
    await play(U.adminA, id);
    for (const who of [U.teacherAB, U.adminB, M.departedTeacher]) await expect(play(who, id)).rejects.toBeInstanceOf(AuthorizationError);
    await play(U.superAdmin, id);
    expect(await db.auditEvent.findMany({ where: { action: "SUPER_ADMIN_MEDIA_READ" } })).toEqual([
      expect.objectContaining({ actorId: U.superAdmin, tenantId: T.A, targetType: "RECORDING", targetId: id }),
    ]);
  });
});
