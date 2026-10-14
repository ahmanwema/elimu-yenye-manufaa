import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  canApproveMediaDeletion,
  canCancelMediaDeletion,
  canDeclineMediaDeletion,
  canRequestMediaDeletion,
  hasActiveRole,
  isValidId,
  type Actor,
} from "@/server/authz/policy";
import type { ObjectStorage } from "@/server/storage/object-storage";
import { recordAudit } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";

// Media retention & deletion (A73–A76, completed 2026-10-15 by A84–A86):
//
//   PENDING ──approve (a SECOND Markaz Admin — never the requester)──▶ APPROVED
//      │                                                          → soft delete + archive
//      ├──decline (Markaz Admin)──▶ DECLINED   (media untouched)   → 30-day grace → purge bytes
//      └──cancel (requester)──────▶ CANCELLED  (media untouched)
//
// Metadata, the correction, its anchors and every audit/history row are kept forever:
// purging media never destroys academic history. Nothing here deletes a database row.

export const MEDIA_PURGE_GRACE_DAYS = 30;
/** A86: unfinalized correction-clip uploads are abandoned after 7 days. */
export const ABANDONED_UPLOAD_DAYS = 7;
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

const requestIdSchema = z.object({ requestId: z.uuid() });

async function loadRequest(db: PrismaClient, input: unknown) {
  const parsed = requestIdSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const request = await db.mediaDeletionRequest.findUnique({
    where: { id: parsed.data.requestId },
    select: { id: true, tenantId: true, requestedById: true, status: true, clipId: true, recordingId: true },
  });
  if (!request) throw new AuthorizationError();
  return request;
}

/**
 * A SECOND Markaz Admin approves (A84): the media is soft-deleted and archived at once
 * (playback stops), and becomes eligible for physical purge after the 30-day grace period.
 * The requester gets DomainError("second_admin_required") and the request stays PENDING —
 * never silently self-approved. A primary clip loses its primary flag; no other clip is
 * promoted automatically (A88).
 */
export async function approveMediaDeletion(db: PrismaClient, actor: Actor, input: unknown, options: Options = {}) {
  const request = await loadRequest(db, input);
  if (!hasActiveRole(actor, request.tenantId, "MARKAZ_ADMIN")) throw new AuthorizationError();
  if (!canApproveMediaDeletion(actor, request)) throw new DomainError("second_admin_required");
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

const declineSchema = z.object({ requestId: z.uuid(), reason: z.string().trim().max(500).optional() });

/** A Markaz Admin declines a pending request (A85). The media is not touched. */
export async function declineMediaDeletion(db: PrismaClient, actor: Actor, input: unknown, options: Options = {}) {
  const parsed = declineSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const request = await loadRequest(db, { requestId: parsed.data.requestId });
  if (!canDeclineMediaDeletion(actor, request)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.mediaDeletionRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "DECLINED", declinedById: actor.profileId, declinedAt: now, declineReason: parsed.data.reason || null },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: request.tenantId,
      action: "MEDIA_DELETION_DECLINED",
      targetType: "MEDIA_DELETION_REQUEST",
      targetId: request.id,
      now,
    });
  });
}

/** The requester cancels their own pending request (A85). The media is not touched. */
export async function cancelMediaDeletion(db: PrismaClient, actor: Actor, input: unknown, options: Options = {}) {
  const request = await loadRequest(db, input);
  if (!canCancelMediaDeletion(actor, request)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.mediaDeletionRequest.updateMany({
      where: { id: request.id, status: "PENDING", requestedById: actor.profileId },
      data: { status: "CANCELLED", cancelledById: actor.profileId, cancelledAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: request.tenantId,
      action: "MEDIA_DELETION_CANCELLED",
      targetType: "MEDIA_DELETION_REQUEST",
      targetId: request.id,
      now,
    });
  });
}

/**
 * Pending requests of a Markaz, for its Markaz Admins. `awaitingSecondAdmin` is true when
 * the request was made by an admin and NO other ACTIVE admin of the Markaz exists, so it
 * cannot be approved yet (A84) — shown to users instead of failing silently.
 */
export async function listPendingDeletionRequests(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!isValidId(tenantId) || !hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) throw new AuthorizationError();
  const [requests, admins] = await Promise.all([
    db.mediaDeletionRequest.findMany({
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
    }),
    db.membership.findMany({ where: { tenantId, role: "MARKAZ_ADMIN", status: "ACTIVE" }, select: { profileId: true } }),
  ]);
  return requests.map((r) => ({
    ...r,
    awaitingSecondAdmin: !admins.some((a) => a.profileId !== r.requestedById),
  }));
}

/**
 * Physical purge (server-internal job; not scheduled). Removes the BYTES of media whose
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
 * Abandoned direct uploads (A86): a correction clip still AWAITING_UPLOAD 7 days (or more)
 * after registration never became media. Its storage object (if any) is removed FIRST, then
 * the row is marked FAILED (kept as a tombstone) and the cleanup is audited. Finalized clips —
 * current or historical — are never touched, however old. Safe to re-run: a failed object
 * removal leaves the row AWAITING_UPLOAD for the next run, and FAILED rows are not selected
 * again. Server-internal and NOT scheduled.
 */
export async function cleanupAbandonedUploads(db: PrismaClient, storage: ObjectStorage, options: Options = {}) {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ABANDONED_UPLOAD_DAYS * DAY_MS);
  const stale = await db.correctionAudioClip.findMany({
    where: { status: "AWAITING_UPLOAD", createdAt: { lte: cutoff } },
    select: { id: true, tenantId: true, storageBucket: true, storageObjectKey: true },
  });
  let cleaned = 0;
  for (const clip of stale) {
    await storage.deleteObject(clip.storageBucket, clip.storageObjectKey);
    await db.$transaction(async (tx) => {
      const { count } = await tx.correctionAudioClip.updateMany({
        where: { id: clip.id, status: "AWAITING_UPLOAD" },
        data: { status: "FAILED", failedAt: now },
      });
      if (count === 1) {
        await recordAudit(tx, {
          actorId: null,
          tenantId: clip.tenantId,
          action: "ABANDONED_UPLOAD_CLEANED",
          targetType: "CORRECTION_AUDIO_CLIP",
          targetId: clip.id,
          now,
        });
        cleaned++;
      }
    });
  }
  return cleaned;
}
