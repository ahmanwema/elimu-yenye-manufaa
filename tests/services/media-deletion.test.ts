import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import { finalizeDirectCaptureClip, getClipPlaybackUrl, registerDirectCaptureClip } from "@/server/services/correction-audio";
import { createCorrection, getCorrection, markAnchorSourceRemoved } from "@/server/services/corrections";
import {
  approveMediaDeletion,
  cleanupAbandonedUploads,
  listPendingDeletionRequests,
  MEDIA_PURGE_GRACE_DAYS,
  purgeExpiredMedia,
  requestMediaDeletion,
} from "@/server/services/media-deletion";
import { actor, createTestPrisma, FakeStorage } from "../db/prisma";
import { T, U } from "../support/fixture";
import { insertGuardianConsent, M, MINOR_DOB, seedMedia, setDob, TEST_POLICY, uploadM4a } from "../support/media";

let pg: PGlite;
let db: PrismaClient;
let storage: FakeStorage;
let correctionId: string;
const O = { policy: TEST_POLICY };
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-10-14T10:00:00Z");

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
  storage = new FakeStorage();
  await setDob(pg, U.studentX, MINOR_DOB);
  await insertGuardianConsent(pg, U.studentX);
  correctionId = await createCorrection(db, await actor(db, U.teacherA), {
    tenantId: T.A,
    studentProfileId: U.studentX,
    note: "Ghunna",
    anchors: [{ kind: "PAGE", refId: "p-1", snapshot: { label: "Page 1" } }],
  });
});

async function clip() {
  const teacher = await actor(db, U.teacherA);
  const { clipId } = await registerDirectCaptureClip(db, storage, teacher, { correctionId, mimeType: "audio/mp4" }, O);
  await uploadM4a(db, storage, clipId);
  await finalizeDirectCaptureClip(db, storage, teacher, { clipId }, O);
  return clipId;
}

describe("requesting deletion (A73)", () => {
  it("the authoring teacher or a same-Markaz admin may request; nothing changes until approval", async () => {
    const clipId = await clip();
    const requestId = await requestMediaDeletion(db, await actor(db, U.teacherA), { clipId, note: "wrong student" }, { now: T0 });
    await expect(requestMediaDeletion(db, await actor(db, U.adminA), { clipId }, { now: T0 })).rejects.toMatchObject({ code: "conflict" });
    for (const who of [U.teacherAB, U.adminB, U.studentX, U.parentActive, U.superAdmin, M.departedTeacher]) {
      await expect(requestMediaDeletion(db, await actor(db, who), { clipId }, { now: T0 })).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect((await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).deletedAt).toBeNull();
    await getClipPlaybackUrl(db, storage, await actor(db, U.studentX), clipId);
    expect((await listPendingDeletionRequests(db, await actor(db, U.adminA), T.A)).map((r) => r.id)).toEqual([requestId]);
    expect(await db.auditEvent.count({ where: { action: "MEDIA_DELETION_REQUESTED", targetId: requestId } })).toBe(1);
  });

  it("exactly one target per request", async () => {
    const clipId = await clip();
    await expect(requestMediaDeletion(db, await actor(db, U.adminA), {}, { now: T0 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      requestMediaDeletion(db, await actor(db, U.adminA), { clipId, recordingId: "99999999-0000-4000-8000-0000000000aa" }, { now: T0 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("approval → soft delete + archive → 30-day grace → purge (A73–A75)", () => {
  it("only a same-Markaz admin approves — never a teacher — and playback stops immediately", async () => {
    const first = await clip();
    const clipId = await clip(); // primary
    const requestId = await requestMediaDeletion(db, await actor(db, U.teacherA), { clipId }, { now: T0 });
    for (const who of [U.teacherA, U.adminB, U.superAdmin]) {
      await expect(approveMediaDeletion(db, await actor(db, who), { requestId }, { now: T0 })).rejects.toBeInstanceOf(AuthorizationError);
    }
    await approveMediaDeletion(db, await actor(db, U.adminA), { requestId }, { now: T0 });

    const after = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    expect(after).toMatchObject({ deletedAt: T0, archivedAt: T0, isPrimary: false, purgedAt: null });
    expect(after.purgeEligibleAt?.getTime()).toBe(T0.getTime() + MEDIA_PURGE_GRACE_DAYS * DAY);
    for (const who of [U.studentX, U.teacherA, U.adminA, U.parentActive, U.superAdmin]) {
      await expect(getClipPlaybackUrl(db, storage, await actor(db, who), clipId)).rejects.toMatchObject({ code: "invalid_state" });
    }
    // History: the older clip is untouched and is NOT silently promoted.
    expect(await db.correctionAudioClip.findUniqueOrThrow({ where: { id: first } })).toMatchObject({ isPrimary: false, deletedAt: null });
    expect(storage.deleted).toEqual([]); // bytes still exist during the grace period
    await expect(approveMediaDeletion(db, await actor(db, U.adminA), { requestId }, { now: T0 })).rejects.toMatchObject({ code: "invalid_state" });
    expect(await db.auditEvent.count({ where: { action: "MEDIA_DELETION_APPROVED", targetId: requestId, actorId: U.adminA } })).toBe(1);
  });

  it("INTERIM: an admin cannot approve their own request; another admin of the Markaz can", async () => {
    const clipId = await clip();
    const requestId = await requestMediaDeletion(db, await actor(db, U.adminA), { clipId }, { now: T0 });
    await expect(approveMediaDeletion(db, await actor(db, U.adminA), { requestId }, { now: T0 })).rejects.toBeInstanceOf(AuthorizationError);
    await approveMediaDeletion(db, await actor(db, M.adminA2), { requestId }, { now: T0 });
  });

  it("bytes are purged only after the 30-day grace period; metadata, correction, anchors and history stay", async () => {
    const clipId = await clip();
    const requestId = await requestMediaDeletion(db, await actor(db, U.teacherA), { clipId }, { now: T0 });
    await approveMediaDeletion(db, await actor(db, U.adminA), { requestId }, { now: T0 });
    const row = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });

    expect(await purgeExpiredMedia(db, storage, { now: new Date(T0.getTime() + 29 * DAY) })).toBe(0);
    expect(storage.has(row.storageBucket, row.storageObjectKey)).toBe(true);

    expect(await purgeExpiredMedia(db, storage, { now: new Date(T0.getTime() + 30 * DAY) })).toBe(1);
    expect(storage.has(row.storageBucket, row.storageObjectKey)).toBe(false);
    const purged = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    expect(purged).toMatchObject({ purgedAt: new Date(T0.getTime() + 30 * DAY), durationMs: 2500, byteSize: row.byteSize, status: "FINALIZED" });

    // The academic record survives the purge, including after its anchor content is removed.
    await markAnchorSourceRemoved(db, { kind: "PAGE", refId: "p-1" });
    const c = await getCorrection(db, await actor(db, U.studentX), correctionId);
    expect(c).toMatchObject({ note: "Ghunna" });
    expect(c.anchors[0]).toMatchObject({ snapshot: { label: "Page 1" } });
    expect(c.anchors[0].sourceRemovedAt).not.toBeNull();
    expect(c.audioClips.find((x) => x.id === clipId)).toMatchObject({ purgedAt: expect.any(Date) });
    expect(await db.mediaDeletionRequest.count()).toBe(1);
    const trail = (await db.auditEvent.findMany({ orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(trail).toEqual(expect.arrayContaining(["MEDIA_DELETION_REQUESTED", "MEDIA_DELETION_APPROVED", "MEDIA_PURGED"]));
    expect(await purgeExpiredMedia(db, storage, { now: new Date(T0.getTime() + 60 * DAY) })).toBe(0);
  });

  it("the database itself refuses a purge before the grace period or without a deletion", async () => {
    const clipId = await clip();
    await expect(pg.query("UPDATE correction_audio_clips SET purged_at = now() WHERE id = $1", [clipId])).rejects.toThrow(/clip_deletion_lifecycle/);
    await expect(
      pg.query("UPDATE correction_audio_clips SET deleted_at = now(), archived_at = now(), purge_eligible_at = now() + interval '30 days', purged_at = now(), is_primary = false WHERE id = $1", [clipId]),
    ).rejects.toThrow(/clip_deletion_lifecycle/);
  });

  it("the audit trail is append-only, even for the database owner", async () => {
    const clipId = await clip();
    await requestMediaDeletion(db, await actor(db, U.teacherA), { clipId }, { now: T0 });
    await expect(pg.query("UPDATE audit_events SET action = 'MEDIA_PURGED'")).rejects.toThrow(/append-only/);
    await expect(pg.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/);
    await expect(pg.query("TRUNCATE audit_events")).rejects.toThrow(/append-only/);
  });
});

describe("abandoned uploads", () => {
  it("cleanup needs an explicit age (none is approved) and only touches never-finalized uploads", async () => {
    const live = await clip();
    const teacher = await actor(db, U.teacherA);
    const { clipId: abandoned } = await registerDirectCaptureClip(db, storage, teacher, { correctionId, mimeType: "audio/mp4" }, { ...O, now: T0 });
    await uploadM4a(db, storage, abandoned); // partial/forgotten upload
    // @ts-expect-error — the age is required: there is deliberately no default duration.
    await expect(cleanupAbandonedUploads(db, storage, {})).rejects.toMatchObject({ code: "invalid_input" });
    await expect(cleanupAbandonedUploads(db, storage, { olderThanMs: 0 })).rejects.toMatchObject({ code: "invalid_input" });

    expect(await cleanupAbandonedUploads(db, storage, { olderThanMs: DAY, now: new Date(T0.getTime() + DAY / 2) })).toBe(0);
    expect(await cleanupAbandonedUploads(db, storage, { olderThanMs: DAY, now: new Date(T0.getTime() + 2 * DAY) })).toBe(1);
    expect(await db.correctionAudioClip.findUniqueOrThrow({ where: { id: abandoned } })).toMatchObject({ status: "FAILED" });
    expect(await db.correctionAudioClip.findUniqueOrThrow({ where: { id: live } })).toMatchObject({ status: "FINALIZED", deletedAt: null });
  });
});
