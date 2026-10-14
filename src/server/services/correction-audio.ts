import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, correctionReadAccess, isActiveAuthoringTeacher, type Actor } from "@/server/authz/policy";
import type { ConsentPolicy } from "@/server/authz/recording-consent";
import { inspectM4a } from "@/server/media/m4a";
import {
  ACCEPTED_CLIP_UPLOAD_TYPES,
  CORRECTION_CLIP_BUCKET,
  CORRECTION_CLIP_MIME_TYPE,
  MAX_CORRECTION_CLIP_MS,
  newCorrectionClipObjectKey,
  SIGNED_DOWNLOAD_TTL_SECONDS,
  type ObjectStorage,
} from "@/server/storage/object-storage";
import { auditSuperAdminRead, recordAudit, type Tx } from "./audit";
import { requireRecordingEligibility } from "./consent";
import { DomainError } from "./errors";

// Standalone correction clips (A53, hybrid source A43) under the 2026-10-14 decisions:
// - consent gate (A70–A72): no clip of a student whose audio may not be captured;
// - AAC in M4A, at most 60 s, verified by the server on the STORED bytes (A69);
// - several clips per correction, exactly one live primary; a new finalized clip becomes
//   primary and the previous one stays as history — nothing is overwritten (A68);
// - soft-deleted clips are never played (A73–A75).
// Vendor-neutral: no RTC provider, no transcoding. Every clip has its OWN object key, and
// playback only ever reads that object — never a byte range of a recording.

export type ClipOptions = { now?: Date; policy?: ConsentPolicy };

const idSchema = z.uuid();

async function loadCorrection(db: Tx | PrismaClient, correctionId: unknown) {
  if (!idSchema.safeParse(correctionId).success) throw new AuthorizationError();
  const correction = await db.correction.findUnique({
    where: { id: correctionId as string },
    select: { id: true, tenantId: true, studentProfileId: true, teacherProfileId: true },
  });
  if (!correction) throw new AuthorizationError();
  return correction;
}

function requireAuthoringTeacher(actor: Actor, correction: { tenantId: string; teacherProfileId: string }) {
  if (!isActiveAuthoringTeacher(actor, correction)) throw new AuthorizationError();
}

const directSchema = z.object({ correctionId: z.uuid(), mimeType: z.enum(ACCEPTED_CLIP_UPLOAD_TYPES) });

/** Path 1 — no full recording: the client uploads a short M4A clip straight to its own object. */
export async function registerDirectCaptureClip(
  db: PrismaClient,
  storage: ObjectStorage,
  actor: Actor,
  input: unknown,
  options: ClipOptions = {},
) {
  const parsed = directSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const correction = await loadCorrection(db, parsed.data.correctionId);
  requireAuthoringTeacher(actor, correction);
  await requireRecordingEligibility(db, correction.studentProfileId, correction.tenantId, options);

  const clip = await db.correctionAudioClip.create({
    data: {
      correctionId: correction.id,
      tenantId: correction.tenantId,
      sourceType: "DIRECT_CAPTURE",
      status: "AWAITING_UPLOAD",
      storageBucket: CORRECTION_CLIP_BUCKET,
      storageObjectKey: newCorrectionClipObjectKey(),
      createdById: actor.profileId,
      createdAt: options.now ?? new Date(),
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
  .refine((v) => v.sourceEndMs > v.sourceStartMs && v.sourceEndMs - v.sourceStartMs <= MAX_CORRECTION_CLIP_MS);

/**
 * Path 2 — a full-session recording exists: register a clip whose bytes will be COPIED out of
 * the recording into this clip's own object by a (future) extraction worker. The recording
 * must belong to the same Markaz, still hold media, and include this student's audio.
 */
export async function registerExtractedClip(db: PrismaClient, actor: Actor, input: unknown, options: ClipOptions = {}) {
  const parsed = extractedSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const correction = await loadCorrection(db, parsed.data.correctionId);
  requireAuthoringTeacher(actor, correction);

  const recording = await db.recording.findUnique({
    where: { id: parsed.data.sourceRecordingId },
    select: {
      tenantId: true,
      deletedAt: true,
      mediaFinalizedAt: true,
      durationMs: true,
      participants: { where: { studentProfileId: correction.studentProfileId }, select: { audioIncluded: true } },
    },
  });
  if (!recording || recording.tenantId !== correction.tenantId) throw new DomainError("not_found");
  if (recording.deletedAt || !recording.mediaFinalizedAt) throw new DomainError("invalid_state");
  if (recording.durationMs !== null && parsed.data.sourceEndMs > recording.durationMs) throw new DomainError("invalid_input");
  if (!recording.participants[0]?.audioIncluded) throw new DomainError("consent_required");
  await requireRecordingEligibility(db, correction.studentProfileId, correction.tenantId, options);

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
      createdAt: options.now ?? new Date(),
    },
    select: { id: true, status: true },
  });
}

const finalizeSchema = z.object({ clipId: z.uuid() });

/** Finalizes a directly-captured clip after upload. The stored bytes decide, not the client. */
export async function finalizeDirectCaptureClip(
  db: PrismaClient,
  storage: ObjectStorage,
  actor: Actor,
  input: unknown,
  options: ClipOptions = {},
) {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const clip = await loadClipForFinalize(db, parsed.data.clipId);
  if (!clip || clip.createdById !== actor.profileId) throw new AuthorizationError();
  requireAuthoringTeacher(actor, clip.correction);
  return finalize(db, storage, clip, "AWAITING_UPLOAD", actor.profileId, options);
}

/**
 * Finalizes an extracted clip once the worker has COPIED the segment into the clip's own
 * object. Trusted server-internal entry point for that worker — not exposed to clients.
 */
export async function finalizeExtractedClip(db: PrismaClient, storage: ObjectStorage, clipId: string, options: ClipOptions = {}) {
  const clip = await loadClipForFinalize(db, clipId);
  if (!clip) throw new DomainError("not_found");
  return finalize(db, storage, clip, "AWAITING_EXTRACTION", null, options);
}

function loadClipForFinalize(db: PrismaClient, clipId: string) {
  return db.correctionAudioClip.findUnique({
    where: { id: clipId },
    select: {
      id: true,
      correctionId: true,
      tenantId: true,
      storageBucket: true,
      storageObjectKey: true,
      createdById: true,
      correction: { select: { tenantId: true, teacherProfileId: true, studentProfileId: true } },
    },
  });
}

type FinalizableClip = NonNullable<Awaited<ReturnType<typeof loadClipForFinalize>>>;

/** Marks a clip FAILED and removes its never-finalized object (not approved media). */
async function failClip(db: PrismaClient, storage: ObjectStorage, clip: FinalizableClip, from: string, now: Date) {
  await db.correctionAudioClip.updateMany({
    where: { id: clip.id, status: from as "AWAITING_UPLOAD" | "AWAITING_EXTRACTION" },
    data: { status: "FAILED", failedAt: now },
  });
  await storage.deleteObject(clip.storageBucket, clip.storageObjectKey);
}

async function finalize(
  db: PrismaClient,
  storage: ObjectStorage,
  clip: FinalizableClip,
  from: "AWAITING_UPLOAD" | "AWAITING_EXTRACTION",
  actorId: string | null,
  options: ClipOptions,
) {
  const now = options.now ?? new Date();
  const stat = await storage.statObject(clip.storageBucket, clip.storageObjectKey);
  if (!stat.exists) throw new DomainError("invalid_state");

  // Consent may have been withdrawn since registration: then this clip must never become media.
  try {
    await requireRecordingEligibility(db, clip.correction.studentProfileId, clip.correction.tenantId, options);
  } catch (error) {
    if (error instanceof DomainError) await failClip(db, storage, clip, from, now);
    throw error;
  }

  const inspection = await inspectM4a((offset, length) => storage.readRange(clip.storageBucket, clip.storageObjectKey, offset, length), stat.byteSize);
  const tooLong = inspection.ok && inspection.durationUnits * BigInt(1000) > BigInt(MAX_CORRECTION_CLIP_MS) * BigInt(inspection.timescale);
  if (!inspection.ok || tooLong) {
    await failClip(db, storage, clip, from, now);
    throw new DomainError("invalid_media");
  }

  await db.$transaction(async (tx) => {
    const previous = await tx.correctionAudioClip.findFirst({
      where: { correctionId: clip.correctionId, isPrimary: true },
      select: { id: true },
    });
    if (previous) await tx.correctionAudioClip.update({ where: { id: previous.id }, data: { isPrimary: false } });
    const { count } = await tx.correctionAudioClip.updateMany({
      where: { id: clip.id, status: from },
      data: {
        status: "FINALIZED",
        isPrimary: true,
        mimeType: CORRECTION_CLIP_MIME_TYPE,
        byteSize: stat.byteSize,
        durationMs: inspection.durationMs,
        finalizedAt: now,
      },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    if (previous) {
      await recordAudit(tx, {
        actorId,
        tenantId: clip.tenantId,
        action: "CORRECTION_CLIP_REPLACED",
        targetType: "CORRECTION_AUDIO_CLIP",
        targetId: clip.id,
        metadata: { previousClipId: previous.id },
        now,
      });
    }
  });
}

/**
 * A short-lived URL for a live FINALIZED clip (primary or historical), for anyone who may
 * read the correction. Soft-deleted clips are never played. A Super Admin gets a URL only
 * after the mandatory audit event has been written.
 */
export async function getClipPlaybackUrl(
  db: PrismaClient,
  storage: ObjectStorage,
  actor: Actor,
  clipId: unknown,
  options: { now?: Date } = {},
) {
  if (!idSchema.safeParse(clipId).success) throw new AuthorizationError();
  const clip = await db.correctionAudioClip.findUnique({
    where: { id: clipId as string },
    select: {
      id: true,
      status: true,
      deletedAt: true,
      storageBucket: true,
      storageObjectKey: true,
      correction: { select: { tenantId: true, studentProfileId: true, teacherProfileId: true } },
    },
  });
  if (!clip) throw new AuthorizationError();
  const access = correctionReadAccess(actor, clip.correction);
  if (access === "DENY") throw new AuthorizationError();
  if (clip.status !== "FINALIZED" || clip.deletedAt) throw new DomainError("invalid_state");
  if (access === "ALLOW_AUDITED") {
    await auditSuperAdminRead(db, actor, { tenantId: clip.correction.tenantId, targetType: "CORRECTION_AUDIO_CLIP", targetId: clip.id }, options.now ?? new Date());
  }
  return storage.createSignedDownloadUrl(clip.storageBucket, clip.storageObjectKey, SIGNED_DOWNLOAD_TTL_SECONDS);
}

/**
 * Called when a full-session recording row is removed: clips keep their own objects and
 * status; only the provenance pointer is cleared (the FK is ON DELETE SET NULL to the same
 * effect). Recordings are normally soft-deleted, so this is a safety net.
 */
export async function detachSourceRecording(db: PrismaClient, recordingId: string) {
  return db.correctionAudioClip.updateMany({
    where: { sourceRecordingId: recordingId },
    data: { sourceRecordingId: null },
  });
}
