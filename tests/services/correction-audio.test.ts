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
import { buildM4a, mp3Entry } from "../support/m4a";
import { insertCorrection, insertGuardianConsent, M, MINOR_DOB, seedMedia, setDob, TEST_POLICY, uploadM4a } from "../support/media";

let pg: PGlite;
let db: PrismaClient;
let storage: FakeStorage;
let correctionId: string;
const O = { policy: TEST_POLICY };

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
  storage = new FakeStorage();
  await setDob(pg, U.studentX, MINOR_DOB);
  await insertGuardianConsent(pg, U.studentX);
  correctionId = await insertCorrection(pg, T.A, U.studentX, U.teacherA);
});

async function register(id = correctionId, teacher: string = U.teacherA) {
  return registerDirectCaptureClip(db, storage, await actor(db, teacher), { correctionId: id, mimeType: "audio/mp4" }, O);
}

async function finalizedDirectClip(id = correctionId, teacher: string = U.teacherA, durationMs = 2500) {
  const { clipId } = await register(id, teacher);
  await uploadM4a(db, storage, clipId, durationMs);
  await finalizeDirectCaptureClip(db, storage, await actor(db, teacher), { clipId }, O);
  return clipId;
}

/** A recording of Markaz A with finished media in which studentX's audio was included. */
async function recordingWithStudentAudio(tenantId: string = T.A, teacher: string = U.teacherA) {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO recordings (tenant_id, teacher_profile_id, notice_shown_at, started_at, storage_bucket, storage_object_key, byte_size, duration_ms, media_finalized_at)
     VALUES ($1, $2, now(), now(), 'recordings', 'recordings/' || gen_random_uuid(), 1000, 600000, now()) RETURNING id`,
    [tenantId, teacher],
  );
  const consent = await pg.query<{ id: string }>("SELECT id FROM recording_consents WHERE student_profile_id = $1", [U.studentX]);
  await pg.query(
    `INSERT INTO recording_participants (recording_id, tenant_id, student_profile_id, audio_included, eligibility, consent_id)
     VALUES ($1, $2, $3, true, 'CONSENTED', $4)`,
    [rows[0].id, tenantId, U.studentX, consent.rows[0].id],
  );
  return rows[0].id;
}

describe("direct capture (Option B never needs a full recording)", () => {
  it("a registered clip has its own private, non-guessable object identity from the start", async () => {
    const { clipId, uploadUrl } = await register();
    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    expect(clip).toMatchObject({ status: "AWAITING_UPLOAD", storageBucket: CORRECTION_CLIP_BUCKET, sourceRecordingId: null, isPrimary: false });
    expect(clip.storageObjectKey).not.toContain(U.studentX);
    expect(clip.storageObjectKey).not.toContain(T.A);
    expect(uploadUrl).toContain(clip.storageObjectKey);
  });

  it("the server measures the STORED file: AAC in M4A, duration from the container", async () => {
    const { clipId } = await register();
    await expect(finalizeDirectCaptureClip(db, storage, await actor(db, U.teacherA), { clipId }, O)).rejects.toMatchObject({ code: "invalid_state" });
    await uploadM4a(db, storage, clipId, 2500);
    await finalizeDirectCaptureClip(db, storage, await actor(db, U.teacherA), { clipId }, O);
    expect(await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).toMatchObject({
      status: "FINALIZED",
      mimeType: "audio/mp4",
      durationMs: 2500,
      isPrimary: true,
    });
  });

  it("exactly 60 s is accepted; more than 60 s is rejected, marked FAILED and its object removed", async () => {
    await finalizedDirectClip(correctionId, U.teacherA, 60_000);
    const { clipId } = await register();
    const clip = await uploadM4a(db, storage, clipId, 60_001);
    await expect(finalizeDirectCaptureClip(db, storage, await actor(db, U.teacherA), { clipId }, O)).rejects.toMatchObject({ code: "invalid_media" });
    expect(await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).toMatchObject({ status: "FAILED", isPrimary: false });
    expect(storage.has(clip.storageBucket, clip.storageObjectKey)).toBe(false);
  });

  it("a non-AAC file (MP3 in MP4) is rejected even when declared as M4A", async () => {
    const { clipId } = await register();
    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    storage.put(clip.storageBucket, clip.storageObjectKey, buildM4a({ durationMs: 1000, tracks: [{ handler: "soun", entry: mp3Entry() }] }));
    await expect(finalizeDirectCaptureClip(db, storage, await actor(db, U.teacherA), { clipId }, O)).rejects.toMatchObject({ code: "invalid_media" });
  });

  it("only M4A may be declared at registration", async () => {
    await expect(
      registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId, mimeType: "audio/webm" }, O),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it.each([
    ["another teacher of the same Markaz", U.teacherAB],
    ["the student", U.studentX],
    ["an ACTIVE-linked parent", U.parentActive],
    ["the Markaz Admin", U.adminA],
    ["a Super Admin", U.superAdmin],
  ])("cannot be added by %s", async (_l, who) => {
    await expect(register(correctionId, who)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a departed teacher can no longer add audio to their own corrections", async () => {
    const id = await insertCorrection(pg, T.A, U.studentX, M.departedTeacher);
    await expect(register(id, M.departedTeacher)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("consent gate (A70–A72) — one policy for clips and recordings", () => {
  it("a minor without valid consent cannot have a clip captured", async () => {
    await pg.query("UPDATE recording_consents SET withdrawn_at = now(), withdrawn_by_id = $1", [U.parentActive]);
    await expect(register()).rejects.toMatchObject({ code: "consent_required" });
  });

  it("without the owner's age threshold (the shipped default), nobody is eligible", async () => {
    await expect(
      registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId, mimeType: "audio/mp4" }),
    ).rejects.toMatchObject({ code: "consent_required" });
  });

  it("consent withdrawn after registration: the upload never becomes media (FAILED, object removed)", async () => {
    const { clipId } = await register();
    const clip = await uploadM4a(db, storage, clipId);
    await pg.query("UPDATE recording_consents SET withdrawn_at = now(), withdrawn_by_id = $1", [U.parentActive]);
    await expect(finalizeDirectCaptureClip(db, storage, await actor(db, U.teacherA), { clipId }, O)).rejects.toMatchObject({ code: "consent_required" });
    expect((await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).status).toBe("FAILED");
    expect(storage.has(clip.storageBucket, clip.storageObjectKey)).toBe(false);
  });
});

describe("multiple clips: exactly one primary, history kept (A68)", () => {
  it("a new finalized clip becomes primary; the previous one stays as playable history", async () => {
    const first = await finalizedDirectClip();
    const second = await finalizedDirectClip();
    const clips = await db.correctionAudioClip.findMany({ where: { correctionId }, orderBy: { createdAt: "asc" } });
    expect(clips.map((c) => [c.id, c.status, c.isPrimary])).toEqual([
      [first, "FINALIZED", false],
      [second, "FINALIZED", true],
    ]);
    // The old object was not overwritten or removed, and still plays.
    expect(storage.deleted).toEqual([]);
    await getClipPlaybackUrl(db, storage, await actor(db, U.studentX), first);
    const audit = await db.auditEvent.findMany({ where: { action: "CORRECTION_CLIP_REPLACED" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ targetId: second, actorId: U.teacherA, tenantId: T.A });
  });

  it("the database refuses a second primary and a primary that is not a live finalized clip", async () => {
    const first = await finalizedDirectClip();
    const { clipId } = await register();
    await expect(pg.query("UPDATE correction_audio_clips SET is_primary = true WHERE id = $1", [clipId])).rejects.toThrow(/clip_primary_is_live_finalized/);
    const second = await finalizedDirectClip();
    await expect(pg.query("UPDATE correction_audio_clips SET is_primary = true WHERE id = $1", [first])).rejects.toThrow(/one_primary/);
    expect((await db.correctionAudioClip.findMany({ where: { correctionId, isPrimary: true } })).map((c) => c.id)).toEqual([second]);
  });
});

describe("extracted from a full-session recording (hybrid source, A43/A53)", () => {
  it("is validated against a real recording and survives the recording row being removed", async () => {
    const recordingId = await recordingWithStudentAudio();
    const teacher = await actor(db, U.teacherA);
    const reg = await registerExtractedClip(db, teacher, { correctionId, sourceRecordingId: recordingId, sourceStartMs: 61_000, sourceEndMs: 64_500 }, O);
    expect(reg.status).toBe("AWAITING_EXTRACTION");
    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: reg.id } });
    storage.put(clip.storageBucket, clip.storageObjectKey, buildM4a({ durationMs: 3500 }));
    await finalizeExtractedClip(db, storage, reg.id, O);

    // Even a hard removal of the recording row (FK ON DELETE SET NULL) leaves the clip intact.
    await pg.query("DELETE FROM recording_participants WHERE recording_id = $1", [recordingId]);
    await pg.query("DELETE FROM recordings WHERE id = $1", [recordingId]);
    const after = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: reg.id } });
    expect(after).toMatchObject({ status: "FINALIZED", sourceRecordingId: null, sourceStartMs: 61_000, durationMs: 3500, storageObjectKey: clip.storageObjectKey });
    const { url } = await getClipPlaybackUrl(db, storage, await actor(db, U.studentX), reg.id);
    expect(url).toContain(clip.storageObjectKey);
    expect(await detachSourceRecording(db, recordingId)).toMatchObject({ count: 0 });
  });

  it("refuses an unknown or other-Markaz recording, a segment over 60 s, and excluded student audio", async () => {
    const teacher = await actor(db, U.teacherA);
    const extract = (input: object) => registerExtractedClip(db, teacher, { correctionId, sourceStartMs: 0, sourceEndMs: 5000, ...input }, O);
    await expect(extract({ sourceRecordingId: "99999999-0000-4000-8000-0000000000aa" })).rejects.toMatchObject({ code: "not_found" });
    const otherMarkaz = await recordingWithStudentAudio(T.B, U.teacherAB);
    await expect(extract({ sourceRecordingId: otherMarkaz })).rejects.toMatchObject({ code: "not_found" });
    const recordingId = await recordingWithStudentAudio();
    await expect(extract({ sourceRecordingId: recordingId, sourceEndMs: 60_001 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(extract({ sourceRecordingId: recordingId, sourceStartMs: 5000, sourceEndMs: 5000 })).rejects.toMatchObject({ code: "invalid_input" });
    await pg.query("UPDATE recording_participants SET audio_included = false, eligibility = 'NO_CONSENT', consent_id = NULL WHERE recording_id = $1", [recordingId]);
    await expect(extract({ sourceRecordingId: recordingId })).rejects.toMatchObject({ code: "consent_required" });
  });
});

describe("playback authorization (A66)", () => {
  it.each([
    ["the student", U.studentX, true],
    ["the authoring teacher", U.teacherA, true],
    ["the Markaz Admin of that Markaz", U.adminA, true],
    ["an ACTIVE-linked parent", U.parentActive, true],
    ["a VERIFIED-linked parent", U.parentVerified, false],
    ["a PENDING-linked parent", U.parentPendingA, false],
    ["a REVOKED-linked parent", U.parentRevoked, false],
    ["an unlinked parent", U.parentUnlinked, false],
    ["another student", U.studentY, false],
    ["another teacher in the same Markaz", U.teacherAB, false],
    ["another Markaz's admin", U.adminB, false],
  ])("%s → allowed: %s", async (_l, who, allowed) => {
    const clipId = await finalizedDirectClip();
    const a = await actor(db, who);
    if (allowed) {
      expect((await getClipPlaybackUrl(db, storage, a, clipId)).url).toContain("download");
    } else {
      await expect(getClipPlaybackUrl(db, storage, a, clipId)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("a Super Admin may play, and an audit event is written for every access — before the URL", async () => {
    const clipId = await finalizedDirectClip();
    const sa = await actor(db, U.superAdmin);
    await getClipPlaybackUrl(db, storage, sa, clipId);
    await getClipPlaybackUrl(db, storage, sa, clipId);
    const events = await db.auditEvent.findMany({ where: { action: "SUPER_ADMIN_MEDIA_READ" } });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actorId: U.superAdmin, tenantId: T.A, targetType: "CORRECTION_AUDIO_CLIP", targetId: clipId });
    expect(JSON.stringify(events)).not.toContain("download"); // no signed URL in the audit trail
  });

  it("if the audit cannot be written, the Super Admin gets no URL", async () => {
    const clipId = await finalizedDirectClip();
    const before = storage.signedDownloads.length;
    const broken = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "auditEvent") return { create: async () => { throw new Error("audit down"); } };
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(getClipPlaybackUrl(broken, storage, await actor(db, U.superAdmin), clipId)).rejects.toThrow("audit down");
    expect(storage.signedDownloads.length).toBe(before);
  });

  it("an ACTIVE parent hears the child's clips from EVERY Markaz", async () => {
    const inB = await insertCorrection(pg, T.B, U.studentX, U.teacherAB);
    const clipId = await finalizedDirectClip(inB, U.teacherAB);
    await getClipPlaybackUrl(db, storage, await actor(db, U.parentActive), clipId);
    await expect(getClipPlaybackUrl(db, storage, await actor(db, U.adminA), clipId)).rejects.toBeInstanceOf(AuthorizationError);
    await getClipPlaybackUrl(db, storage, await actor(db, U.adminB), clipId);
  });

  it("a departed teacher loses access; the student and the Markaz keep it", async () => {
    const id = await insertCorrection(pg, T.A, U.studentX, M.departedTeacher);
    // The clip was made while the teacher was active (owner-path insert of a finalized clip).
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO correction_audio_clips (correction_id, tenant_id, source_type, status, storage_bucket, storage_object_key, mime_type, byte_size, duration_ms, created_by_id, finalized_at, is_primary)
       VALUES ($1, $2, 'DIRECT_CAPTURE', 'FINALIZED', 'correction-clips', 'clips/departed', 'audio/mp4', 10, 1000, $3, now(), true) RETURNING id`,
      [id, T.A, M.departedTeacher],
    );
    await expect(getClipPlaybackUrl(db, storage, await actor(db, M.departedTeacher), rows[0].id)).rejects.toBeInstanceOf(AuthorizationError);
    await getClipPlaybackUrl(db, storage, await actor(db, U.studentX), rows[0].id);
    await getClipPlaybackUrl(db, storage, await actor(db, U.adminA), rows[0].id);
  });

  it("a denied caller never gets a signed URL minted", async () => {
    const clipId = await finalizedDirectClip();
    await expect(getClipPlaybackUrl(db, storage, await actor(db, U.adminB), clipId)).rejects.toBeInstanceOf(AuthorizationError);
    expect(storage.signedDownloads).toEqual([]);
  });

  it("a clip that is not finalized cannot be played", async () => {
    const { clipId } = await register();
    await expect(getClipPlaybackUrl(db, storage, await actor(db, U.studentX), clipId)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("a departed student keeps access to their own correction audio (A32)", async () => {
    await setDob(pg, U.studentLeft, MINOR_DOB);
    await insertGuardianConsent(pg, U.studentLeft, U.parentActive).catch(() => undefined);
    const id = await insertCorrection(pg, T.A, U.studentLeft, U.teacherA);
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO correction_audio_clips (correction_id, tenant_id, source_type, status, storage_bucket, storage_object_key, mime_type, byte_size, duration_ms, created_by_id, finalized_at, is_primary)
       VALUES ($1, $2, 'DIRECT_CAPTURE', 'FINALIZED', 'correction-clips', 'clips/left', 'audio/mp4', 10, 1000, $3, now(), true) RETURNING id`,
      [id, T.A, U.teacherA],
    );
    await getClipPlaybackUrl(db, storage, await actor(db, U.studentLeft), rows[0].id);
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
    ["FINALIZED without M4A type and duration", "DIRECT_CAPTURE", "FINALIZED", "NULL", "10", "now()", "NULL", "NULL"],
    ["FINALIZED longer than 60 s", "DIRECT_CAPTURE", "FINALIZED", "NULL", "10", "now()", "'audio/mp4'", "60001"],
    ["direct capture carrying a source recording", "DIRECT_CAPTURE", "AWAITING_UPLOAD", "gen_random_uuid()", "NULL", "NULL", "NULL", "NULL"],
    ["an extracted clip without a segment", "EXTRACTED_FROM_RECORDING", "AWAITING_EXTRACTION", "NULL", "NULL", "NULL", "NULL", "NULL"],
  ])("rejects %s", async (_l, source, status, recording, size, finalizedAt, mime, duration) => {
    await expect(
      pg.query(
        `INSERT INTO correction_audio_clips (correction_id, tenant_id, source_type, status, source_recording_id, byte_size, finalized_at, mime_type, duration_ms, storage_bucket, storage_object_key, created_by_id)
         VALUES ($1, $2, '${source}', '${status}', ${recording}, ${size}, ${finalizedAt}, ${mime}, ${duration}, 'correction-clips', 'k2', $3)`,
        [correctionId, T.A, U.teacherA],
      ),
    ).rejects.toThrow(/clip_|foreign key/);
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
  const visible = (who: string, table: string) => asUser(pg, who, async (tx) => (await tx.query(`SELECT id FROM ${table}`)).rows.length);

  it("matches the server rule: student, author, same-Markaz admin, ACTIVE parent — nobody else", async () => {
    await finalizedDirectClip();
    for (const table of ["corrections", "correction_audio_clips"]) {
      for (const who of [U.studentX, U.teacherA, U.adminA, U.parentActive]) expect(await visible(who, table), `${who} ${table}`).toBe(1);
      // Super Admin: no Data API path at all — their reads must go through the audited server path.
      for (const who of [U.parentVerified, U.parentPendingA, U.parentRevoked, U.studentY, U.teacherAB, U.adminB, U.superAdmin, M.departedTeacher]) {
        expect(await visible(who, table), `${who} ${table}`).toBe(0);
      }
    }
  });

  it("a departed teacher no longer sees even the corrections they wrote", async () => {
    await insertCorrection(pg, T.A, U.studentX, M.departedTeacher);
    expect(await visible(M.departedTeacher, "corrections")).toBe(0);
    expect(await visible(U.adminA, "corrections")).toBe(2);
  });
});
