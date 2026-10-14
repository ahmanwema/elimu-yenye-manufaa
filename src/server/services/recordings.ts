import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  canApproveRecording,
  canRevokeRecordingApproval,
  hasActiveParentLink,
  hasActiveRole,
  isActiveAuthoringTeacher,
  isValidId,
  recordingStaffAccess,
  type Actor,
} from "@/server/authz/policy";
import type { ConsentPolicy } from "@/server/authz/recording-consent";
import {
  newRecordingObjectKey,
  newRecordingSegmentObjectKey,
  RECORDING_BUCKET,
  SIGNED_DOWNLOAD_TTL_SECONDS,
  type ObjectStorage,
} from "@/server/storage/object-storage";
import { auditSuperAdminRead, recordAudit } from "./audit";
import { getRecordingEligibility } from "./consent";
import { DomainError } from "./errors";
import { requireOptionCEnabled } from "./option-c";

// Full-session recordings (Option C) — PROVIDER-NEUTRAL foundation only (A77–A80; A35:
// no RTC vendor chosen). There is NO capture, egress, extraction or transcoding here: a
// future vendor adapter/worker writes the media through the internal register/finalize
// functions below and must honour the capture plan.
//
// Review workflow (A78–A79, completed 2026-10-15 by A87):
//
//   DRAFT ──submit (teacher)──▶ PENDING_APPROVAL ──approve (Markaz Admin)──▶ APPROVED
//                                 │      ▲                                     │
//          reject (Markaz Admin)  ▼      │ resubmit (teacher)                  │ revoke (Markaz Admin)
//                              REJECTED ─┘◀────────────── REVOKED ◀─────────────┘
//
// Resubmission never re-approves anything: it always returns to PENDING_APPROVAL for a
// Markaz Admin. Revocation is not deletion; deletion is ./media-deletion.ts.
// Option C must be ENABLED for the Markaz (A90) to create or start a recording.

export type RecordingOptions = { now?: Date; policy?: ConsentPolicy };

const createSchema = z.object({ tenantId: z.uuid(), title: z.string().trim().max(200).optional() });

/** An ACTIVE teacher creates recording metadata — only where Option C is ENABLED (A90). */
export async function createRecording(db: PrismaClient, actor: Actor, input: unknown, options: RecordingOptions = {}) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  if (!hasActiveRole(actor, parsed.data.tenantId, "TEACHER")) throw new AuthorizationError();
  await requireOptionCEnabled(db, parsed.data.tenantId);
  const recording = await db.recording.create({
    data: {
      tenantId: parsed.data.tenantId,
      teacherProfileId: actor.profileId,
      title: parsed.data.title || null,
      createdAt: options.now ?? new Date(),
    },
    select: { id: true },
  });
  return recording.id;
}

const idInput = z.object({ recordingId: z.uuid() });

async function loadForAuthor(db: PrismaClient, actor: Actor, input: unknown) {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const recording = await db.recording.findUnique({
    where: { id: parsed.data.recordingId },
    select: { id: true, tenantId: true, teacherProfileId: true, status: true, startedAt: true, deletedAt: true, mediaFinalizedAt: true },
  });
  if (!recording || !isActiveAuthoringTeacher(actor, recording)) throw new AuthorizationError();
  return recording;
}

const startSchema = z.object({
  recordingId: z.uuid(),
  /** A30: the recording-start notice was shown to everyone in the session. */
  noticeShown: z.literal(true),
  /** A89: the teacher acknowledges their OWN recording notice (not consent). */
  teacherNoticeAcknowledged: z.literal(true),
});

/**
 * Marks capture as started. General consent never replaces the recording-start notice (A30),
 * and the teacher must acknowledge the teacher recording notice (A89) — a notice, not a
 * consent: it is never treated as student or guardian consent and gates nothing else.
 */
export async function startRecording(db: PrismaClient, actor: Actor, input: unknown, options: RecordingOptions = {}) {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const recording = await loadForAuthor(db, actor, { recordingId: parsed.data.recordingId });
  if (recording.status !== "DRAFT" || recording.startedAt || recording.deletedAt) throw new DomainError("invalid_state");
  await requireOptionCEnabled(db, recording.tenantId);
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.recording.update({
      where: { id: recording.id },
      data: { noticeShownAt: now, startedAt: now, teacherNoticeAcknowledgedAt: now, teacherNoticeAcknowledgedById: actor.profileId },
    });
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: recording.tenantId,
      action: "RECORDING_TEACHER_NOTICE_ACKNOWLEDGED",
      targetType: "RECORDING",
      targetId: recording.id,
      now,
    });
  });
}

const titleSchema = z.object({ recordingId: z.uuid(), title: z.string().trim().max(200) });

/** The teacher fixes a recording's details while it is DRAFT, REJECTED or REVOKED (A87). */
export async function updateRecordingTitle(db: PrismaClient, actor: Actor, input: unknown) {
  const parsed = titleSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const recording = await loadForAuthor(db, actor, { recordingId: parsed.data.recordingId });
  const { count } = await db.recording.updateMany({
    where: { id: recording.id, status: { in: ["DRAFT", "REJECTED", "REVOKED"] }, deletedAt: null },
    data: { title: parsed.data.title || null },
  });
  if (count !== 1) throw new DomainError("invalid_state");
}

const participantsSchema = z.object({ recordingId: z.uuid(), studentProfileIds: z.array(z.uuid()).min(1).max(500) });

/**
 * Registers the students present in the session. Each one is a participant regardless of
 * consent (live participation is unaffected, A72); `audioIncluded` records whether their
 * audio may go into the recorded media, decided by the consent policy at this moment.
 */
export async function registerRecordingParticipants(db: PrismaClient, actor: Actor, input: unknown, options: RecordingOptions = {}) {
  const parsed = participantsSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const recording = await loadForAuthor(db, actor, { recordingId: parsed.data.recordingId });
  if (recording.deletedAt) throw new DomainError("invalid_state");
  const now = options.now ?? new Date();
  const ids = [...new Set(parsed.data.studentProfileIds)];
  const members = await db.membership.findMany({
    where: { tenantId: recording.tenantId, role: "STUDENT", status: "ACTIVE", profileId: { in: ids } },
    select: { profileId: true },
  });
  if (members.length !== ids.length) throw new AuthorizationError();

  for (const studentProfileId of ids) {
    const result = await getRecordingEligibility(db, studentProfileId, recording.tenantId, { ...options, now });
    await db.recordingParticipant.upsert({
      where: { recordingId_studentProfileId: { recordingId: recording.id, studentProfileId } },
      create: {
        recordingId: recording.id,
        tenantId: recording.tenantId,
        studentProfileId,
        audioIncluded: result.eligible,
        eligibility: result.eligibility,
        consentId: result.eligible ? result.consentId : null,
        registeredAt: now,
      },
      update: {}, // first registration stands; consent changes later go through review
    });
  }
}

/**
 * The provider-neutral capture boundary: who is in the session and whose audio may be
 * recorded. A future vendor adapter MUST exclude every `includeAudio: false` participant
 * from recorded media (it must not touch their live mic permission).
 */
export async function getCapturePlan(db: PrismaClient, actor: Actor, input: unknown) {
  const recording = await loadForAuthor(db, actor, input);
  const participants = await db.recordingParticipant.findMany({
    where: { recordingId: recording.id },
    select: { studentProfileId: true, audioIncluded: true, eligibility: true },
  });
  return participants.map((p) => ({ studentProfileId: p.studentProfileId, includeAudio: p.audioIncluded, eligibility: p.eligibility }));
}

// --- Internal media entry points for a FUTURE capture/extraction worker (no client access) ---

export async function registerRecordingMedia(db: PrismaClient, storage: ObjectStorage, recordingId: string) {
  const key = newRecordingObjectKey();
  const { count } = await db.recording.updateMany({
    where: { id: recordingId, storageObjectKey: null, deletedAt: null },
    data: { storageBucket: RECORDING_BUCKET, storageObjectKey: key },
  });
  if (count !== 1) throw new DomainError("invalid_state");
  return storage.createSignedUploadUrl(RECORDING_BUCKET, key);
}

export async function finalizeRecordingMedia(
  db: PrismaClient,
  storage: ObjectStorage,
  recordingId: string,
  meta: { durationMs?: number; mimeType?: string } = {},
  now: Date = new Date(),
) {
  const recording = await db.recording.findUnique({
    where: { id: recordingId },
    select: { storageBucket: true, storageObjectKey: true, mediaFinalizedAt: true, endedAt: true },
  });
  if (!recording?.storageBucket || !recording.storageObjectKey || recording.mediaFinalizedAt) throw new DomainError("invalid_state");
  const stat = await storage.statObject(recording.storageBucket, recording.storageObjectKey);
  if (!stat.exists) throw new DomainError("invalid_state");
  // No recording format/duration rules are approved, so none are enforced.
  await db.recording.update({
    where: { id: recordingId },
    data: {
      byteSize: stat.byteSize,
      durationMs: meta.durationMs ?? null,
      mimeType: meta.mimeType ?? null,
      mediaFinalizedAt: now,
      endedAt: recording.endedAt ?? now,
    },
  });
}

export async function registerSegmentMedia(db: PrismaClient, storage: ObjectStorage, segmentId: string) {
  const key = newRecordingSegmentObjectKey();
  const { count } = await db.recordingSegment.updateMany({
    where: { id: segmentId, storageObjectKey: null, purgedAt: null },
    data: { storageBucket: RECORDING_BUCKET, storageObjectKey: key },
  });
  if (count !== 1) throw new DomainError("invalid_state");
  return storage.createSignedUploadUrl(RECORDING_BUCKET, key);
}

export async function finalizeSegmentMedia(db: PrismaClient, storage: ObjectStorage, segmentId: string, now: Date = new Date()) {
  const segment = await db.recordingSegment.findUnique({
    where: { id: segmentId },
    select: { storageBucket: true, storageObjectKey: true, mediaFinalizedAt: true },
  });
  if (!segment?.storageBucket || !segment.storageObjectKey || segment.mediaFinalizedAt) throw new DomainError("invalid_state");
  const stat = await storage.statObject(segment.storageBucket, segment.storageObjectKey);
  if (!stat.exists) throw new DomainError("invalid_state");
  await db.recordingSegment.update({ where: { id: segmentId }, data: { byteSize: stat.byteSize, mediaFinalizedAt: now } });
}

// --- Approval workflow (A78–A79) ---------------------------------------------------------

/**
 * The authoring teacher submits a finished recording (DRAFT), or RESUBMITS one that was
 * REJECTED or whose approval was REVOKED (A87). Either way it goes to PENDING_APPROVAL — it is
 * never re-approved automatically. The previous decision fields are cleared on the row (the
 * full history stays in the audit trail).
 */
export async function submitRecordingForApproval(db: PrismaClient, actor: Actor, input: unknown, options: RecordingOptions = {}) {
  const recording = await loadForAuthor(db, actor, input);
  if (recording.deletedAt || !recording.mediaFinalizedAt) throw new DomainError("invalid_state");
  const resubmission = recording.status === "REJECTED" || recording.status === "REVOKED";
  if (!resubmission && recording.status !== "DRAFT") throw new DomainError("invalid_state");
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.recording.updateMany({
      where: { id: recording.id, status: recording.status, deletedAt: null },
      data: {
        status: "PENDING_APPROVAL",
        submittedAt: now,
        submittedById: actor.profileId,
        approvalScope: null,
        approvedAt: null,
        approvedById: null,
        approvalRevokedAt: null,
        approvalRevokedById: null,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await tx.recordingSegment.updateMany({ where: { recordingId: recording.id, withdrawnAt: null }, data: { withdrawnAt: now } });
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: recording.tenantId,
      action: resubmission ? "RECORDING_RESUBMITTED" : "RECORDING_SUBMITTED",
      targetType: "RECORDING",
      targetId: recording.id,
      metadata: resubmission ? { from: recording.status } : undefined,
      now,
    });
  });
}

const rejectSchema = z.object({ recordingId: z.uuid(), reason: z.string().trim().max(500).optional() });

/** A Markaz Admin rejects a submitted recording, optionally with a reason (A87). */
export async function rejectRecording(db: PrismaClient, actor: Actor, input: unknown, options: RecordingOptions = {}) {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const recording = await db.recording.findUnique({
    where: { id: parsed.data.recordingId },
    select: { id: true, tenantId: true, teacherProfileId: true },
  });
  if (!recording || !canApproveRecording(actor, recording)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.recording.updateMany({
      where: { id: recording.id, status: "PENDING_APPROVAL" },
      data: { status: "REJECTED", rejectedAt: now, rejectedById: actor.profileId, rejectionReason: parsed.data.reason || null },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: recording.tenantId,
      action: "RECORDING_REJECTED",
      targetType: "RECORDING",
      targetId: recording.id,
      now,
    });
  });
}

const approveSchema = z.discriminatedUnion("scope", [
  z.object({ recordingId: z.uuid(), scope: z.literal("WHOLE") }),
  z.object({
    recordingId: z.uuid(),
    scope: z.literal("SEGMENTS"),
    segments: z
      .array(z.object({ startMs: z.int().min(0), endMs: z.int().min(1) }).refine((s) => s.endMs > s.startMs))
      .min(1)
      .max(100),
  }),
]);

/**
 * A Markaz Admin approves a submitted recording. Default: the WHOLE recording. Special
 * case: only listed SEGMENTS (each later needs its own media object to be playable).
 */
export async function approveRecording(db: PrismaClient, actor: Actor, input: unknown, options: RecordingOptions = {}) {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const recording = await db.recording.findUnique({
    where: { id: parsed.data.recordingId },
    select: { id: true, tenantId: true, teacherProfileId: true, durationMs: true, deletedAt: true },
  });
  if (!recording || !canApproveRecording(actor, recording)) throw new AuthorizationError();
  if (recording.deletedAt) throw new DomainError("invalid_state");
  if (parsed.data.scope === "SEGMENTS" && recording.durationMs !== null) {
    if (parsed.data.segments.some((s) => s.endMs > (recording.durationMs as number))) throw new DomainError("invalid_input");
  }
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.recording.updateMany({
      where: { id: recording.id, status: "PENDING_APPROVAL", deletedAt: null },
      data: { status: "APPROVED", approvalScope: parsed.data.scope, approvedAt: now, approvedById: actor.profileId },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    if (parsed.data.scope === "SEGMENTS") {
      for (const s of parsed.data.segments) {
        await tx.recordingSegment.create({
          data: {
            recordingId: recording.id,
            tenantId: recording.tenantId,
            startMs: s.startMs,
            endMs: s.endMs,
            approvedAt: now,
            approvedById: actor.profileId,
            createdAt: now,
          },
        });
      }
    }
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: recording.tenantId,
      action: "RECORDING_APPROVED",
      targetType: "RECORDING",
      targetId: recording.id,
      metadata: { scope: parsed.data.scope },
      now,
    });
  });
}

/** A Markaz Admin revokes approval. NOT deletion: media and history stay (A79). */
export async function revokeRecordingApproval(db: PrismaClient, actor: Actor, input: unknown, options: RecordingOptions = {}) {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const recording = await db.recording.findUnique({ where: { id: parsed.data.recordingId }, select: { id: true, tenantId: true } });
  if (!recording || !canRevokeRecordingApproval(actor, recording)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.recording.updateMany({
      where: { id: recording.id, status: "APPROVED" },
      data: { status: "REVOKED", approvalRevokedAt: now, approvalRevokedById: actor.profileId },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    // Segments belonged to that approval: never shown to parents again.
    await tx.recordingSegment.updateMany({ where: { recordingId: recording.id, withdrawnAt: null }, data: { withdrawnAt: now } });
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: recording.tenantId,
      action: "RECORDING_APPROVAL_REVOKED",
      targetType: "RECORDING",
      targetId: recording.id,
      now,
    });
  });
}

// --- Visibility & playback ------------------------------------------------------------------

const playbackSchema = z.object({ recordingId: z.uuid(), segmentId: z.uuid().optional() });

type VisibleRecording = {
  tenantId: string;
  status: string;
  deletedAt: Date | null;
  participants: { studentProfileId: string; audioIncluded: boolean }[];
};

/**
 * Viewer gates for a full recording outside staff (A78, A94, A95). Both require an APPROVED,
 * non-deleted recording and a participant whose consent was VALID AT CAPTURE TIME.
 *
 * Consent at capture = `recording_participants.audio_included`: the consent policy's verdict
 * snapshotted when the student was registered for the session (eligibility CONSENTED with the
 * consent id; DB CHECK). A LATER withdrawal does not change it — the recording then goes to the
 * deletion/review workflow (A72) and future capture is blocked; it is not hidden automatically.
 *
 * - STUDENT (A94): the student themself took part with audio included. INTERIM (open question):
 *   a student who has since left the recording's Markaz is refused — A32 keeps a departed
 *   student's own submissions/corrections, but is silent on full lesson recordings.
 * - PARENT (A95): an ACTIVE link to such a participant (cross-Markaz, like corrections).
 */
function viewerQualifies(actor: Actor, recording: VisibleRecording): "STUDENT" | "PARENT" | null {
  if (recording.status !== "APPROVED" || recording.deletedAt) return null;
  const included = recording.participants.filter((p) => p.audioIncluded);
  if (included.some((p) => p.studentProfileId === actor.profileId) && hasActiveRole(actor, recording.tenantId, "STUDENT")) return "STUDENT";
  if (included.some((p) => hasActiveParentLink(actor, p.studentProfileId))) return "PARENT";
  return null;
}

/**
 * Short-lived URL for a recording (or an approved segment's own object). Staff (author,
 * Markaz Admin; Super Admin audited) may play any live recording of their scope. A student or
 * parent passes only the viewer gates above; with SEGMENTS approval, only an approved segment
 * that has its own finalized object — never the whole file. Deleted recordings never play.
 */
export async function getRecordingPlaybackUrl(
  db: PrismaClient,
  storage: ObjectStorage,
  actor: Actor,
  input: unknown,
  options: RecordingOptions = {},
) {
  const parsed = playbackSchema.safeParse(input);
  if (!parsed.success) throw new AuthorizationError();
  const recording = await db.recording.findUnique({
    where: { id: parsed.data.recordingId },
    select: {
      id: true,
      tenantId: true,
      teacherProfileId: true,
      status: true,
      approvalScope: true,
      deletedAt: true,
      storageBucket: true,
      storageObjectKey: true,
      mediaFinalizedAt: true,
      participants: { select: { studentProfileId: true, audioIncluded: true } },
      segments: { select: { id: true, storageBucket: true, storageObjectKey: true, mediaFinalizedAt: true, purgedAt: true, withdrawnAt: true } },
    },
  });
  if (!recording) throw new AuthorizationError();

  const staff = recordingStaffAccess(actor, recording);
  if (staff === "DENY" && !viewerQualifies(actor, recording)) throw new AuthorizationError();
  if (recording.deletedAt) throw new DomainError("invalid_state");

  let object: { bucket: string; key: string } | null = null;
  let segmentId: string | null = null;
  if (parsed.data.segmentId) {
    const segment = recording.segments.find((s) => s.id === parsed.data.segmentId);
    if (!segment) throw new DomainError("not_found");
    if (staff === "DENY" && segment.withdrawnAt) throw new AuthorizationError();
    if (!segment.mediaFinalizedAt || segment.purgedAt || !segment.storageBucket || !segment.storageObjectKey) throw new DomainError("invalid_state");
    object = { bucket: segment.storageBucket, key: segment.storageObjectKey };
    segmentId = segment.id;
  } else {
    if (staff === "DENY" && recording.approvalScope !== "WHOLE") throw new AuthorizationError();
    if (!recording.mediaFinalizedAt || !recording.storageBucket || !recording.storageObjectKey) throw new DomainError("invalid_state");
    object = { bucket: recording.storageBucket, key: recording.storageObjectKey };
  }

  if (staff === "ALLOW_AUDITED") {
    await auditSuperAdminRead(
      db,
      actor,
      { tenantId: recording.tenantId, targetType: segmentId ? "RECORDING_SEGMENT" : "RECORDING", targetId: segmentId ?? recording.id },
      options.now ?? new Date(),
    );
  }
  return storage.createSignedDownloadUrl(object.bucket, object.key, SIGNED_DOWNLOAD_TTL_SECONDS);
}

const listSelect = {
  id: true,
  tenantId: true,
  teacherProfileId: true,
  title: true,
  status: true,
  approvalScope: true,
  rejectionReason: true,
  startedAt: true,
  mediaFinalizedAt: true,
  deletedAt: true,
  createdAt: true,
  teacher: { select: { displayName: true } },
  deletionRequests: { where: { status: "PENDING" as const }, select: { id: true } },
};

/** Recordings of a Markaz: Markaz Admins see all; an active teacher sees their own. */
export async function listTenantRecordings(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!isValidId(tenantId)) throw new AuthorizationError();
  const where = hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")
    ? { tenantId }
    : hasActiveRole(actor, tenantId, "TEACHER")
      ? { tenantId, teacherProfileId: actor.profileId }
      : null;
  if (!where) throw new AuthorizationError();
  return db.recording.findMany({ where, select: listSelect, orderBy: { createdAt: "desc" } });
}

const viewerSelect = {
  ...listSelect,
  tenant: { select: { name: true } },
  participants: { select: { studentProfileId: true, audioIncluded: true } },
  segments: { where: { mediaFinalizedAt: { not: null }, purgedAt: null, withdrawnAt: null }, select: { id: true, startMs: true, endMs: true } },
};

/** Approved recordings a parent may open (all gates), across the children's Markaz. */
export async function listParentVisibleRecordings(db: PrismaClient, actor: Actor) {
  const children = actor.parentLinks.filter((l) => l.status === "ACTIVE").map((l) => l.studentProfileId);
  if (children.length === 0) return [];
  const candidates = await db.recording.findMany({
    where: { status: "APPROVED", deletedAt: null, participants: { some: { studentProfileId: { in: children }, audioIncluded: true } } },
    select: viewerSelect,
    orderBy: { createdAt: "desc" },
  });
  return candidates.filter((r) => viewerQualifies(actor, r) === "PARENT");
}

/** A94: the student's own approved recordings (participated, consent valid at capture). */
export async function listStudentVisibleRecordings(db: PrismaClient, actor: Actor) {
  const candidates = await db.recording.findMany({
    where: { status: "APPROVED", deletedAt: null, participants: { some: { studentProfileId: actor.profileId, audioIncluded: true } } },
    select: viewerSelect,
    orderBy: { createdAt: "desc" },
  });
  return candidates.filter((r) => viewerQualifies(actor, r) === "STUDENT");
}
