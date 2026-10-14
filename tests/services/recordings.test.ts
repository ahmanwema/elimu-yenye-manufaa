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
  listStudentVisibleRecordings,
  rejectRecording,
  updateRecordingTitle,
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
import { enableOptionCFor, insertGuardianConsent, M, MINOR_DOB, seedMedia, setDob, TEST_POLICY } from "../support/media";
// (offline-consent tenant scope for recordings is covered at the end of this file)

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
  await enableOptionCFor(pg, T.A);
});

/** A finished recording of Markaz A (by teacherA) in which studentX took part. */
async function finishedRecording(teacher: string = U.teacherA, tenantId: string = T.A) {
  const a = await actor(db, teacher);
  const recordingId = await createRecording(db, a, { tenantId, title: "An-Naba" }, O);
  await startRecording(db, a, { recordingId, noticeShown: true, teacherNoticeAcknowledged: true }, O);
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
  it("states: DRAFT, PENDING_APPROVAL, APPROVED, REVOKED and REJECTED (A87)", () => {
    expect(Object.keys(RecordingStatus).sort()).toEqual(["APPROVED", "DRAFT", "PENDING_APPROVAL", "REJECTED", "REVOKED"]);
  });

  it("capture starts only with the participants' notice (A30) AND the teacher's own notice acknowledgement (A89)", async () => {
    const a = await actor(db, U.teacherA);
    const recordingId = await createRecording(db, a, { tenantId: T.A }, O);
    await expect(startRecording(db, a, { recordingId, noticeShown: false, teacherNoticeAcknowledged: true }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(startRecording(db, a, { recordingId, noticeShown: true }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(startRecording(db, a, { recordingId, noticeShown: true, teacherNoticeAcknowledged: false }, O)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(pg.query("UPDATE recordings SET started_at = now(), notice_shown_at = now() WHERE id = $1", [recordingId])).rejects.toThrow(/recording_started_with_notices/);
    await startRecording(db, a, { recordingId, noticeShown: true, teacherNoticeAcknowledged: true }, O);
    const r = await db.recording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(r).toMatchObject({ teacherNoticeAcknowledgedById: U.teacherA });
    expect(r.noticeShownAt).not.toBeNull();
    expect(await db.auditEvent.count({ where: { action: "RECORDING_TEACHER_NOTICE_ACKNOWLEDGED", actorId: U.teacherA } })).toBe(1);
  });

  it("the teacher notice is not consent: no consent row is created for the teacher, and student consent stays independent", async () => {
    const id = await finishedRecording();
    expect(await db.recordingConsent.count({ where: { recordedById: U.teacherA } })).toBe(0);
    expect((await db.recordingParticipant.findFirstOrThrow({ where: { recordingId: id } })).audioIncluded).toBe(true);
    await pg.query("UPDATE recording_consents SET withdrawn_at = now(), withdrawn_by_id = $1", [U.parentActive]);
    const second = await finishedRecording();
    expect((await db.recordingParticipant.findFirstOrThrow({ where: { recordingId: second } })).audioIncluded).toBe(false);
  });

  it("no full recording without Option C ENABLED for the Markaz (A90)", async () => {
    await expect(createRecording(db, await actor(db, U.teacherAB), { tenantId: T.B }, O)).rejects.toMatchObject({ code: "feature_not_enabled" });
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
      ["RECORDING_TEACHER_NOTICE_ACKNOWLEDGED", U.teacherA],
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

  it("A92: a Markaz Admin who authored the recording MAY approve and reject it themselves", async () => {
    await pg.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'TEACHER')", [T.A, M.adminA2]);
    const author = await actor(db, M.adminA2);
    const approved = await finishedRecording(M.adminA2);
    await submitRecordingForApproval(db, author, { recordingId: approved }, O);
    await approveRecording(db, author, { recordingId: approved, scope: "WHOLE" }, O);
    expect(await db.recording.findUniqueOrThrow({ where: { id: approved } })).toMatchObject({ status: "APPROVED", approvedById: M.adminA2, teacherProfileId: M.adminA2 });

    const rejected = await finishedRecording(M.adminA2);
    await submitRecordingForApproval(db, author, { recordingId: rejected }, O);
    await rejectRecording(db, author, { recordingId: rejected, reason: "redo" }, O);
    expect((await db.recording.findUniqueOrThrow({ where: { id: rejected } })).status).toBe("REJECTED");
    expect(await db.auditEvent.count({ where: { actorId: M.adminA2, action: { in: ["RECORDING_APPROVED", "RECORDING_REJECTED"] } } })).toBe(2);
  });

  it("an ordinary teacher still never approves, and another Markaz's admin cannot either", async () => {
    const id = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    for (const who of [U.teacherA, U.teacherAB, U.adminB]) {
      await expect(approveRecording(db, await actor(db, who), { recordingId: id, scope: "WHOLE" }, O)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(rejectRecording(db, await actor(db, who), { recordingId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
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

describe("review workflow: reject and resubmit (A87)", () => {
  it("admin rejects with a reason; the teacher fixes and resubmits; it waits for approval again", async () => {
    const id = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    for (const who of [U.teacherA, U.adminB, U.superAdmin]) {
      await expect(rejectRecording(db, await actor(db, who), { recordingId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await rejectRecording(db, await actor(db, U.adminA), { recordingId: id, reason: "Wrong lesson title" }, O);
    expect(await db.recording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "REJECTED", rejectionReason: "Wrong lesson title", rejectedById: U.adminA });
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O)).rejects.toMatchObject({ code: "invalid_state" });

    await updateRecordingTitle(db, await actor(db, U.teacherA), { recordingId: id, title: "An-Naba (fixed)" });
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    expect(await db.recording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PENDING_APPROVAL", title: "An-Naba (fixed)", rejectedAt: null, rejectionReason: null });
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError); // not auto-approved
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
    await play(U.parentActive, id);

    const trail = (await db.auditEvent.findMany({ where: { targetId: id }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(trail).toEqual(["RECORDING_TEACHER_NOTICE_ACKNOWLEDGED", "RECORDING_SUBMITTED", "RECORDING_REJECTED", "RECORDING_RESUBMITTED", "RECORDING_APPROVED"]);
  });

  it("a revoked recording may be resubmitted; it is NOT re-approved automatically and old segments never return", async () => {
    const id = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "SEGMENTS", segments: [{ startMs: 0, endMs: 10_000 }] }, O);
    const [segment] = await db.recordingSegment.findMany({ where: { recordingId: id } });
    await registerSegmentMedia(db, storage, segment.id);
    const s = await db.recordingSegment.findUniqueOrThrow({ where: { id: segment.id } });
    storage.put(s.storageBucket as string, s.storageObjectKey as string, 10);
    await finalizeSegmentMedia(db, storage, segment.id);
    await play(U.parentActive, id, segment.id);

    await revokeRecordingApproval(db, await actor(db, U.adminA), { recordingId: id }, O);
    expect((await db.recordingSegment.findUniqueOrThrow({ where: { id: segment.id } })).withdrawnAt).not.toBeNull();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    expect(await db.recording.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PENDING_APPROVAL", approvedAt: null, approvalScope: null, approvalRevokedAt: null });
    await expect(play(U.parentActive, id, segment.id)).rejects.toBeInstanceOf(AuthorizationError);
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
    await expect(play(U.parentActive, id, segment.id)).rejects.toBeInstanceOf(AuthorizationError); // the old segment stays withdrawn
    await play(U.parentActive, id);
    expect(await db.auditEvent.count({ where: { targetId: id, action: "RECORDING_RESUBMITTED" } })).toBe(1);
  });

  it("only the author resubmits; approved or pending recordings cannot be resubmitted; titles are fixed only when allowed", async () => {
    const id = await approvedWhole();
    await expect(submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(updateRecordingTitle(db, await actor(db, U.teacherA), { recordingId: id, title: "x" })).rejects.toMatchObject({ code: "invalid_state" });
    await revokeRecordingApproval(db, await actor(db, U.adminA), { recordingId: id }, O);
    await expect(submitRecordingForApproval(db, await actor(db, U.teacherAB), { recordingId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
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

  it("A95: consent valid AT CAPTURE + later withdrawal → still visible, sent to review (not auto-hidden)", async () => {
    const id = await approvedWhole();
    await withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O);
    // The guardian who withdrew still holds an ACTIVE link; the historical recording stays visible…
    await play(U.parentActive, id);
    await play(U.studentX, id);
    // …and is in the review/deletion workflow; future capture is blocked.
    expect(await db.mediaDeletionRequest.findMany({ where: { recordingId: id } })).toEqual([
      expect.objectContaining({ reason: "CONSENT_WITHDRAWN", status: "PENDING" }),
    ]);
    const next = await createRecording(db, await actor(db, U.teacherA), { tenantId: T.A }, O);
    await registerRecordingParticipants(db, await actor(db, U.teacherA), { recordingId: next, studentProfileIds: [U.studentX] }, O);
    expect((await db.recordingParticipant.findFirstOrThrow({ where: { recordingId: next } })).audioIncluded).toBe(false);
  });

  it("consent invalid at capture → never visible, even after consent is given later", async () => {
    await pg.query("UPDATE recording_consents SET withdrawn_at = now(), withdrawn_by_id = $1", [U.parentActive]);
    const id = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: id }, O);
    await approveRecording(db, await actor(db, U.adminA), { recordingId: id, scope: "WHOLE" }, O);
    await insertGuardianConsent(pg, U.studentX); // consent given only afterwards
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(play(U.studentX, id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("the parent list shows only recordings passing every gate", async () => {
    const approved = await approvedWhole();
    await finishedRecording(); // draft, not visible
    expect((await listParentVisibleRecordings(db, await actor(db, U.parentActive))).map((r) => r.id)).toEqual([approved]);
    expect(await listParentVisibleRecordings(db, await actor(db, U.parentVerified))).toEqual([]);
  });

  it("A94: the student who took part (consent valid at capture) sees their own approved recording, without a parent link", async () => {
    const id = await approvedWhole();
    expect((await play(U.studentX, id)).url).toContain("download");
    expect((await listStudentVisibleRecordings(db, await actor(db, U.studentX))).map((r) => r.id)).toEqual([id]);
  });

  it("student gates: other student, not approved, deleted, not a participant → denied", async () => {
    const id = await approvedWhole();
    await expect(play(U.studentY, id)).rejects.toBeInstanceOf(AuthorizationError); // not a participant / other student

    const pending = await finishedRecording();
    await submitRecordingForApproval(db, await actor(db, U.teacherA), { recordingId: pending }, O);
    await expect(play(U.studentX, pending)).rejects.toBeInstanceOf(AuthorizationError);

    await pg.query(
      "UPDATE recordings SET deleted_at = now(), archived_at = now(), purge_eligible_at = now() + interval '30 days' WHERE id = $1",
      [id],
    );
    await expect(play(U.studentX, id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(play(U.parentActive, id)).rejects.toBeInstanceOf(AuthorizationError);
    expect(await listStudentVisibleRecordings(db, await actor(db, U.studentX))).toEqual([]);
  });

  it("A99: a student who has left the recording's Markaz is refused full recordings (restricted Markaz content)", async () => {
    const id = await approvedWhole();
    await pg.query("UPDATE memberships SET status = 'ENDED', ended_at = now() WHERE profile_id = $1 AND tenant_id = $2", [U.studentX, T.A]);
    await expect(play(U.studentX, id)).rejects.toBeInstanceOf(AuthorizationError);
    await play(U.parentActive, id); // the ACTIVE parent's own gates are unchanged
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

describe("verified offline consent is Markaz-specific (A97)", () => {
  it("offline consent from Markaz A includes the student's audio in A only; B needs its own consent", async () => {
    await pg.query("UPDATE recording_consents SET withdrawn_at = now(), withdrawn_by_id = $1", [U.parentActive]);
    await pg.query(
      `INSERT INTO recording_consents (student_profile_id, method, tenant_id, offline_consenter_description, evidence_reference, recorded_by_id, granted_at)
       VALUES ($1, 'OFFLINE_VERIFIED', $2, 'Mother', 'Form 1', $3, now())`,
      [U.studentX, T.A, U.adminA],
    );
    await enableOptionCFor(pg, T.B);
    const inA = await finishedRecording(U.teacherA, T.A);
    const inB = await finishedRecording(U.teacherAB, T.B);
    expect((await db.recordingParticipant.findFirstOrThrow({ where: { recordingId: inA } })).audioIncluded).toBe(true);
    expect(await db.recordingParticipant.findFirstOrThrow({ where: { recordingId: inB } })).toMatchObject({ audioIncluded: false, eligibility: "NO_CONSENT" });
  });
});
