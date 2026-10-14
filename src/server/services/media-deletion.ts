import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  canApproveMediaDeletion,
  canRequestMediaDeletion,
  hasActiveRole,
  isValidId,
  type Actor,
} from "@/server/authz/policy";
import type { ObjectStorage } from "@/server/storage/object-storage";
import { recordAudit } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";

// Media retention & deletion (owner decisions 2026-10-14, A73–A76):
//
//   REQUEST (authoring teacher or Markaz Admin)
//     → MARKAZ ADMIN APPROVAL (never a teacher; INTERIM: never the requester)
//     → SOFT DELETE + ARCHIVE (playback stops immediately)
//     → 30-DAY GRACE PERIOD
//     → PHYSICAL PURGE of the bytes only.
//
// Metadata, the correction, its anchors and every audit/history row are kept forever:
// purging media never destroys academic history. Nothing here deletes a database row.
// No rejection/cancellation of a request exists — it was not decided (owner decision).

export const MEDIA_PURGE_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type Options = { now?: Date };

const requestSchema = z
  .object({ clipId: z.uuid().optional(), recordingId: z.uuid().optional(), note: z.string().trim().max(500).optional() })
  .refine((v) => Number(Boolean(v.clipId)) + Number(Boolean(v.recordingId)) === 1);

async function resolveTarget(db: PrismaClient, target: { clipId?: string | null; recordingId?: string | null }) {
  if (target.clipId) {
    const clip = await db.correctionAudioClip.findUnique({
      where: { id: target.clipId },
      select: { id: true, tenantId: true, deletedAt: true, correction: { select: { teacherProfileId: true } } },
    });
    return clip && { kind: "clip" as const, id: clip.id, tenantId: clip.tenantId, teacherProfileId: clip.correction.teacherProfileId, deletedAt: clip.deletedAt };
  }
  const recording = await db.recording.findUnique({
    where: { id: target.recordingId as string },
    select: { id: true, tenantId: true, teacherProfileId: true, deletedAt: true },
  });
  return recording && { kind: "recording" as const, ...recording };
}

/** Starts a deletion request (A73). Nothing is hidden or removed until a Markaz Admin approves. */
export async function requestMediaDeletion(db: PrismaClient, actor: Actor, input: unknown, options: Options = {}) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const target = await resolveTarget(db, parsed.data);
  if (!target || !canRequestMediaDeletion(actor, target)) throw new AuthorizationError();
  if (target.deletedAt) throw new DomainError("invalid_state");
  const now = options.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const request = await tx.mediaDeletionRequest.create({
        data: {
          tenantId: target.tenantId,
          clipId: target.kind === "clip" ? target.id : null,
          recordingId: target.kind === "recording" ? target.id : null,
          reason: "REQUESTED",
          requestedById: actor.profileId,
          requestedAt: now,
          note: parsed.data.note || null,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorId: actor.profileId,
        tenantId: target.tenantId,
        action: "MEDIA_DELETION_REQUESTED",
        targetType: "MEDIA_DELETION_REQUEST",
        targetId: request.id,
        metadata: { reason: "REQUESTED", target: target.kind },
        now,
      });
      return request.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

const approveSchema = z.object({ requestId: z.uuid() });

/**
 * A Markaz Admin approves: the media is soft-deleted and archived at once (playback stops),
 * and becomes eligible for physical purge after the 30-day grace period. A primary clip
 * loses its primary flag; older clips stay history and are NOT promoted automatically.
 */
export async function approveMediaDeletion(db: PrismaClient, actor: Actor, input: unknown, options: Options = {}) {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const request = await db.mediaDeletionRequest.findUnique({
    where: { id: parsed.data.requestId },
    select: { id: true, tenantId: true, requestedById: true, status: true, clipId: true, recordingId: true },
  });
  if (!request || !canApproveMediaDeletion(actor, request)) throw new AuthorizationError();
  if (request.status !== "PENDING") throw new DomainError("invalid_state");
  const now = options.now ?? new Date();
  const lifecycle = { deletedAt: now, archivedAt: now, purgeEligibleAt: new Date(now.getTime() + MEDIA_PURGE_GRACE_DAYS * DAY_MS) };

  await db.$transaction(async (tx) => {
    const { count } = await tx.mediaDeletionRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "APPROVED", approvedById: actor.profileId, approvedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    if (request.clipId) {
      await tx.correctionAudioClip.updateMany({ where: { id: request.clipId, deletedAt: null }, data: { ...lifecycle, isPrimary: false } });
    } else if (request.recordingId) {
      await tx.recording.updateMany({ where: { id: request.recordingId, deletedAt: null }, data: lifecycle });
    }
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: request.tenantId,
      action: "MEDIA_DELETION_APPROVED",
      targetType: "MEDIA_DELETION_REQUEST",
      targetId: request.id,
      metadata: { target: request.clipId ? "clip" : "recording" },
      now,
    });
  });
}

/** Pending requests of a Markaz, for its Markaz Admins. */
export async function listPendingDeletionRequests(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!isValidId(tenantId) || !hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) throw new AuthorizationError();
  return db.mediaDeletionRequest.findMany({
    where: { tenantId, status: "PENDING" },
    select: {
      id: true,
      reason: true,
      requestedById: true,
      requestedAt: true,
      note: true,
      clip: { select: { id: true, correction: { select: { student: { select: { profile: { select: { displayName: true } } } } } } } },
      recording: { select: { id: true, title: true } },
    },
    orderBy: { requestedAt: "asc" },
  });
}

/**
 * Physical purge (server-internal job; not scheduled yet). Removes the BYTES of media whose
 * grace period has ended and records purged_at + an audit event per object. Rows stay.
 */
export async function purgeExpiredMedia(db: PrismaClient, storage: ObjectStorage, options: Options = {}) {
  const now = options.now ?? new Date();
  let purged = 0;

  const clips = await db.correctionAudioClip.findMany({
    where: { purgedAt: null, purgeEligibleAt: { lte: now } },
    select: { id: true, tenantId: true, storageBucket: true, storageObjectKey: true },
  });
  for (const clip of clips) {
    await storage.deleteObject(clip.storageBucket, clip.storageObjectKey);
    await db.$transaction(async (tx) => {
      await tx.correctionAudioClip.update({ where: { id: clip.id }, data: { purgedAt: now } });
      await recordAudit(tx, { actorId: null, tenantId: clip.tenantId, action: "MEDIA_PURGED", targetType: "CORRECTION_AUDIO_CLIP", targetId: clip.id, now });
    });
    purged++;
  }

  const recordings = await db.recording.findMany({
    where: { purgedAt: null, purgeEligibleAt: { lte: now } },
    select: {
      id: true,
      tenantId: true,
      storageBucket: true,
      storageObjectKey: true,
      segments: { where: { purgedAt: null }, select: { id: true, storageBucket: true, storageObjectKey: true } },
    },
  });
  for (const r of recordings) {
    if (r.storageBucket && r.storageObjectKey) await storage.deleteObject(r.storageBucket, r.storageObjectKey);
    for (const s of r.segments) if (s.storageBucket && s.storageObjectKey) await storage.deleteObject(s.storageBucket, s.storageObjectKey);
    await db.$transaction(async (tx) => {
      await tx.recordingSegment.updateMany({ where: { recordingId: r.id, purgedAt: null }, data: { purgedAt: now } });
      await tx.recording.update({ where: { id: r.id }, data: { purgedAt: now } });
      await recordAudit(tx, { actorId: null, tenantId: r.tenantId, action: "MEDIA_PURGED", targetType: "RECORDING", targetId: r.id, now });
    });
    purged++;
  }
  return purged;
}

/**
 * Abandoned direct uploads: clips still AWAITING_UPLOAD after `olderThanMs` are marked
 * FAILED and any partial object is removed (never-finalized uploads are not media history).
 * There is deliberately NO default age and no schedule: the duration is an open owner
 * decision. Server-internal only.
 */
export async function cleanupAbandonedUploads(
  db: PrismaClient,
  storage: ObjectStorage,
  input: { olderThanMs: number; now?: Date },
) {
  if (!Number.isInteger(input.olderThanMs) || input.olderThanMs <= 0) throw new DomainError("invalid_input");
  const now = input.now ?? new Date();
  const stale = await db.correctionAudioClip.findMany({
    where: { status: "AWAITING_UPLOAD", createdAt: { lt: new Date(now.getTime() - input.olderThanMs) } },
    select: { id: true, storageBucket: true, storageObjectKey: true },
  });
  for (const clip of stale) {
    await storage.deleteObject(clip.storageBucket, clip.storageObjectKey);
    await db.correctionAudioClip.updateMany({ where: { id: clip.id, status: "AWAITING_UPLOAD" }, data: { status: "FAILED", failedAt: now } });
  }
  return stale.length;
}
