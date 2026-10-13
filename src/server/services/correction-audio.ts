import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, canReadCorrection, hasActiveRole, type Actor } from "@/server/authz/policy";
import {
  CORRECTION_CLIP_BUCKET,
  newCorrectionClipObjectKey,
  SIGNED_DOWNLOAD_TTL_SECONDS,
  type ObjectStorage,
} from "@/server/storage/object-storage";
import { DomainError } from "./errors";

// Standalone correction clips (A53, hybrid source A43). Vendor-neutral: no RTC provider,
// no media processing. Every clip gets its OWN object key at registration, and playback
// only ever reads that object — never a byte range of a parent recording.
//
// Deferred (not decided / not in scope): the actual capture UI, the extraction worker
// that copies a segment out of a recording, codecs, maximum duration, retention.

const idSchema = z.uuid();

async function loadCorrection(db: PrismaClient, correctionId: unknown) {
  if (!idSchema.safeParse(correctionId).success) throw new AuthorizationError();
  const correction = await db.correction.findUnique({
    where: { id: correctionId as string },
    select: { id: true, tenantId: true, studentProfileId: true, teacherProfileId: true },
  });
  if (!correction) throw new AuthorizationError();
  return correction;
}

/** Only the correction's own teacher, while an ACTIVE teacher of that Markaz, adds audio. */
function requireAuthoringTeacher(actor: Actor, correction: { tenantId: string; teacherProfileId: string }) {
  if (actor.profileId !== correction.teacherProfileId || !hasActiveRole(actor, correction.tenantId, "TEACHER")) {
    throw new AuthorizationError();
  }
}

const directSchema = z.object({ correctionId: z.uuid(), mimeType: z.string().max(100).optional() });

/** Path 1 — no full recording: the client uploads a short clip straight to its own object. */
export async function registerDirectCaptureClip(db: PrismaClient, storage: ObjectStorage, actor: Actor, input: unknown) {
  const parsed = directSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const correction = await loadCorrection(db, parsed.data.correctionId);
  requireAuthoringTeacher(actor, correction);

  const clip = await db.correctionAudioClip.create({
    data: {
      correctionId: correction.id,
      tenantId: correction.tenantId,
      sourceType: "DIRECT_CAPTURE",
      status: "AWAITING_UPLOAD",
      storageBucket: CORRECTION_CLIP_BUCKET,
      storageObjectKey: newCorrectionClipObjectKey(),
      mimeType: parsed.data.mimeType ?? null,
      createdById: actor.profileId,
    },
    select: { id: true, storageBucket: true, storageObjectKey: true },
  });
  const { url } = await storage.createSignedUploadUrl(clip.storageBucket, clip.storageObjectKey);
  return { clipId: clip.id, uploadUrl: url };
}

const extractedSchema = z
  .object({
    correctionId: z.uuid(),
    sourceRecordingId: z.uuid(),
    sourceStartMs: z.int().min(0),
    sourceEndMs: z.int().min(1),
  })
  .refine((v) => v.sourceEndMs > v.sourceStartMs);

/**
 * Path 2 — a full-session recording exists: register a clip whose bytes will be COPIED
 * out of the recording into this clip's own object by a (future) extraction worker.
 * The recording id and offsets are provenance only.
 */
export async function registerExtractedClip(db: PrismaClient, actor: Actor, input: unknown) {
  const parsed = extractedSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const correction = await loadCorrection(db, parsed.data.correctionId);
  requireAuthoringTeacher(actor, correction);

  return db.correctionAudioClip.create({
    data: {
      correctionId: correction.id,
      tenantId: correction.tenantId,
      sourceType: "EXTRACTED_FROM_RECORDING",
      sourceRecordingId: parsed.data.sourceRecordingId,
      sourceStartMs: parsed.data.sourceStartMs,
      sourceEndMs: parsed.data.sourceEndMs,
      status: "AWAITING_EXTRACTION",
      storageBucket: CORRECTION_CLIP_BUCKET,
      storageObjectKey: newCorrectionClipObjectKey(),
      createdById: actor.profileId,
    },
    select: { id: true, status: true },
  });
}

const finalizeSchema = z.object({ clipId: z.uuid(), durationMs: z.int().min(0).optional() });

/**
 * Finalizes a directly-captured clip after upload. The stored object is checked on the
 * server; the client's claims about size are not trusted.
 */
export async function finalizeDirectCaptureClip(db: PrismaClient, storage: ObjectStorage, actor: Actor, input: unknown, now = new Date()) {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const clip = await db.correctionAudioClip.findUnique({
    where: { id: parsed.data.clipId },
    select: {
      id: true,
      storageBucket: true,
      storageObjectKey: true,
      createdById: true,
      correction: { select: { tenantId: true, teacherProfileId: true } },
    },
  });
  if (!clip || clip.createdById !== actor.profileId) throw new AuthorizationError();
  requireAuthoringTeacher(actor, clip.correction);
  return finalize(db, storage, clip, "AWAITING_UPLOAD", parsed.data.durationMs, now);
}

/**
 * Finalizes an extracted clip once the worker has COPIED the segment into the clip's own
 * object. Trusted server-internal entry point for that worker — not exposed to clients.
 */
export async function finalizeExtractedClip(db: PrismaClient, storage: ObjectStorage, clipId: string, durationMs?: number, now = new Date()) {
  const clip = await db.correctionAudioClip.findUnique({
    where: { id: clipId },
    select: { id: true, storageBucket: true, storageObjectKey: true },
  });
  if (!clip) throw new DomainError("not_found");
  return finalize(db, storage, clip, "AWAITING_EXTRACTION", durationMs, now);
}

async function finalize(
  db: PrismaClient,
  storage: ObjectStorage,
  clip: { id: string; storageBucket: string; storageObjectKey: string },
  from: "AWAITING_UPLOAD" | "AWAITING_EXTRACTION",
  durationMs: number | undefined,
  now: Date,
) {
  const stat = await storage.statObject(clip.storageBucket, clip.storageObjectKey);
  if (!stat.exists) throw new DomainError("invalid_state");
  const { count } = await db.correctionAudioClip.updateMany({
    where: { id: clip.id, status: from },
    data: { status: "FINALIZED", byteSize: stat.byteSize, durationMs: durationMs ?? null, finalizedAt: now },
  });
  if (count !== 1) throw new DomainError("invalid_state");
}

/**
 * A short-lived URL for a FINALIZED clip, for anyone who may read the correction
 * (student, ACTIVE-linked parent, authoring teacher). Reads only the clip's own object.
 */
export async function getClipPlaybackUrl(db: PrismaClient, storage: ObjectStorage, actor: Actor, clipId: unknown) {
  if (!idSchema.safeParse(clipId).success) throw new AuthorizationError();
  const clip = await db.correctionAudioClip.findUnique({
    where: { id: clipId as string },
    select: {
      status: true,
      storageBucket: true,
      storageObjectKey: true,
      correction: { select: { tenantId: true, studentProfileId: true, teacherProfileId: true } },
    },
  });
  if (!clip || !canReadCorrection(actor, clip.correction)) throw new AuthorizationError();
  if (clip.status !== "FINALIZED") throw new DomainError("invalid_state");
  return storage.createSignedDownloadUrl(clip.storageBucket, clip.storageObjectKey, SIGNED_DOWNLOAD_TTL_SECONDS);
}

/**
 * What must happen when a full-session recording is deleted (recordings are not built yet):
 * clips keep their own objects and status; only the provenance pointer is cleared. The
 * future recordings FK must be ON DELETE SET NULL to the same effect.
 */
export async function detachSourceRecording(db: PrismaClient, recordingId: string) {
  return db.correctionAudioClip.updateMany({
    where: { sourceRecordingId: recordingId },
    data: { sourceRecordingId: null },
  });
}
