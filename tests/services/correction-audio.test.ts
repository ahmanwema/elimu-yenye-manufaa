import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import {
  detachSourceRecording,
  finalizeDirectCaptureClip,
  finalizeExtractedClip,
  getClipPlaybackUrl,
  registerDirectCaptureClip,
  registerExtractedClip,
} from "@/server/services/correction-audio";
import { CORRECTION_CLIP_BUCKET } from "@/server/storage/object-storage";
import { asUser } from "../db/harness";
import { actor, createTestPrisma, FakeStorage, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;
let storage: FakeStorage;
let correctionId: string;
const RECORDING = "99999999-0000-4000-8000-0000000000aa";

async function insertCorrection(tenantId: string, student: string, teacher: string) {
  const { rows } = await pg.query<{ id: string }>(
    "INSERT INTO corrections (tenant_id, student_profile_id, teacher_profile_id, captured_at) VALUES ($1, $2, $3, now()) RETURNING id",
    [tenantId, student, teacher],
  );
  return rows[0].id;
}

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  storage = new FakeStorage();
  correctionId = await insertCorrection(T.A, U.studentX, U.teacherA);
});

async function finalizedDirectClip() {
  const teacher = await actor(db, U.teacherA);
  const { clipId } = await registerDirectCaptureClip(db, storage, teacher, { correctionId, mimeType: "audio/webm" });
  const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
  storage.put(clip.storageBucket, clip.storageObjectKey, 4321);
  await finalizeDirectCaptureClip(db, storage, teacher, { clipId, durationMs: 2500 });
  return clipId;
}

describe("direct capture (no full recording needed)", () => {
  it("a registered clip has its own private, non-guessable object identity from the start", async () => {
    const { clipId, uploadUrl } = await registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId });
    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    expect(clip).toMatchObject({ status: "AWAITING_UPLOAD", sourceType: "DIRECT_CAPTURE", storageBucket: CORRECTION_CLIP_BUCKET });
    expect(clip.storageObjectKey).toMatch(/^clips\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{22}$/);
    for (const id of [T.A, U.studentX, U.teacherA, correctionId]) expect(clip.storageObjectKey).not.toContain(id);
    expect(uploadUrl).toContain(clip.storageObjectKey);
  });

  it("finalizing requires the object to really exist, and records the server-side size", async () => {
    const teacher = await actor(db, U.teacherA);
    const { clipId } = await registerDirectCaptureClip(db, storage, teacher, { correctionId });
    await expect(finalizeDirectCaptureClip(db, storage, teacher, { clipId })).rejects.toMatchObject({ code: "invalid_state" });
    const id = await finalizedDirectClip();
    expect(await db.correctionAudioClip.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "FINALIZED",
      byteSize: 4321,
      durationMs: 2500,
    });
  });

  it.each([
    ["another teacher of the same Markaz", U.teacherAB],
    ["the student", U.studentX],
    ["an ACTIVE-linked parent", U.parentActive],
    ["the Markaz Admin", U.adminA],
    ["a Super Admin", U.superAdmin],
  ])("cannot be added by %s", async (_l, who) => {
    await expect(registerDirectCaptureClip(db, storage, await actor(db, who), { correctionId })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe("extracted from a full-session recording", () => {
  it("becomes a standalone clip that survives the recording being deleted", async () => {
    const teacher = await actor(db, U.teacherA);
    const reg = await registerExtractedClip(db, teacher, {
      correctionId,
      sourceRecordingId: RECORDING,
      sourceStartMs: 61_000,
      sourceEndMs: 64_500,
    });
    expect(reg.status).toBe("AWAITING_EXTRACTION");
    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: reg.id } });

    // The (future) worker copies the segment into the clip's OWN object, then finalizes.
    storage.put(clip.storageBucket, clip.storageObjectKey, 9000);
    await finalizeExtractedClip(db, storage, reg.id, 3500);

    // The full recording is deleted → provenance is detached, the clip is untouched.
    await detachSourceRecording(db, RECORDING);
    const after = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: reg.id } });
    expect(after).toMatchObject({
      status: "FINALIZED",
      sourceRecordingId: null,
      sourceStartMs: 61_000,
      sourceEndMs: 64_500,
      storageObjectKey: clip.storageObjectKey,
    });
    const { url } = await getClipPlaybackUrl(db, storage, await actor(db, U.studentX), reg.id);
    expect(url).toContain(clip.storageObjectKey);
    expect(url).not.toContain(RECORDING);
  });

  it("rejects an invalid segment", async () => {
    await expect(
      registerExtractedClip(db, await actor(db, U.teacherA), {
        correctionId,
        sourceRecordingId: RECORDING,
        sourceStartMs: 5000,
        sourceEndMs: 5000,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("playback authorization", () => {
  it.each([
    ["the student", U.studentX, true],
    ["the authoring teacher", U.teacherA, true],
    ["an ACTIVE-linked parent", U.parentActive, true],
    ["a VERIFIED-linked parent", U.parentVerified, false],
    ["a PENDING-linked parent", U.parentPendingA, false],
    ["a REVOKED-linked parent", U.parentRevoked, false],
    ["an unlinked parent", U.parentUnlinked, false],
    ["another student", U.studentY, false],
    ["another teacher in the same Markaz", U.teacherAB, false],
    ["the Markaz Admin (private correction, A17)", U.adminA, false],
    ["another Markaz's admin", U.adminB, false],
    ["a Super Admin (support access not designed)", U.superAdmin, false],
  ])("%s → allowed: %s", async (_l, who, allowed) => {
    const clipId = await finalizedDirectClip();
    const a = await actor(db, who);
    if (allowed) {
      expect((await getClipPlaybackUrl(db, storage, a, clipId)).url).toContain("download");
    } else {
      await expect(getClipPlaybackUrl(db, storage, a, clipId)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("a denied caller never gets a signed URL minted", async () => {
    const clipId = await finalizedDirectClip();
    await expect(getClipPlaybackUrl(db, storage, await actor(db, U.adminB), clipId)).rejects.toBeInstanceOf(AuthorizationError);
    expect(storage.signedDownloads).toEqual([]);
  });

  it("a clip that is not finalized cannot be played", async () => {
    const { clipId } = await registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId });
    await expect(getClipPlaybackUrl(db, storage, await actor(db, U.studentX), clipId)).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("a departed student keeps access to their own correction audio (A32)", async () => {
    const id = await insertCorrection(T.A, U.studentLeft, U.teacherA);
    const { clipId } = await registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId: id });
    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    storage.put(clip.storageBucket, clip.storageObjectKey, 10);
    await finalizeDirectCaptureClip(db, storage, await actor(db, U.teacherA), { clipId });
    await getClipPlaybackUrl(db, storage, await actor(db, U.studentLeft), clipId);
  });

  it("a malformed clip id is denied before any query", async () => {
    const a = await actor(db, U.studentX);
    const spy = spyDb(db);
    await expect(getClipPlaybackUrl(spy.db, storage, a, "../../other")).rejects.toBeInstanceOf(AuthorizationError);
    expect(spy.calls).toEqual([]);
  });
});

describe("database guarantees", () => {
  it("a clip cannot claim a different Markaz than its correction", async () => {
    await expect(
      pg.query(
        `INSERT INTO correction_audio_clips (correction_id, tenant_id, source_type, status, storage_bucket, storage_object_key, created_by_id)
         VALUES ($1, $2, 'DIRECT_CAPTURE', 'AWAITING_UPLOAD', 'correction-clips', 'k1', $3)`,
        [correctionId, T.B, U.teacherA],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it.each([
    ["FINALIZED without its own stored size", "DIRECT_CAPTURE", "FINALIZED", null, null, "now()"],
    ["direct capture carrying a source recording", "DIRECT_CAPTURE", "AWAITING_UPLOAD", "'" + RECORDING + "'", null, "NULL"],
    ["an extracted clip without a segment", "EXTRACTED_FROM_RECORDING", "AWAITING_EXTRACTION", "'" + RECORDING + "'", null, "NULL"],
  ])("rejects %s", async (_l, source, status, recording, size, finalizedAt) => {
    await expect(
      pg.query(
        `INSERT INTO correction_audio_clips (correction_id, tenant_id, source_type, status, source_recording_id, byte_size, finalized_at, storage_bucket, storage_object_key, created_by_id)
         VALUES ($1, $2, '${source}', '${status}', ${recording}, ${size}, ${finalizedAt}, 'correction-clips', 'k2', $3)`,
        [correctionId, T.A, U.teacherA],
      ),
    ).rejects.toThrow(/clip_/);
  });

  it("two clips can never share a storage object", async () => {
    const insert = (key: string) =>
      pg.query(
        `INSERT INTO correction_audio_clips (correction_id, tenant_id, source_type, status, storage_bucket, storage_object_key, created_by_id)
         VALUES ($1, $2, 'DIRECT_CAPTURE', 'AWAITING_UPLOAD', 'correction-clips', $3, $4)`,
        [correctionId, T.A, key, U.teacherA],
      );
    await insert("same-key");
    await expect(insert("same-key")).rejects.toThrow(/unique/);
  });
});

describe("RLS (Supabase Data API) on corrections and clips", () => {
  const visibleClips = (who: string) =>
    asUser(pg, who, async (tx) => (await tx.query("SELECT id FROM correction_audio_clips")).rows.length);

  it("matches the server rule: student, author, ACTIVE parent — nobody else", async () => {
    await finalizedDirectClip();
    expect(await visibleClips(U.studentX)).toBe(1);
    expect(await visibleClips(U.teacherA)).toBe(1);
    expect(await visibleClips(U.parentActive)).toBe(1);
    for (const who of [U.parentVerified, U.parentPendingA, U.parentRevoked, U.studentY, U.teacherAB, U.adminA, U.adminB, U.superAdmin]) {
      expect(await visibleClips(who)).toBe(0);
    }
  });
});
