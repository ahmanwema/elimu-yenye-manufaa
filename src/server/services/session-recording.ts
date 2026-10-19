import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { canCorrectRecordingParticipants, canStartSessionRecording } from "@/server/authz/live-class";
import { AuthorizationError, isValidId, type Actor } from "@/server/authz/policy";
import type { ConsentPolicy } from "@/server/authz/recording-consent";
import { recordAudit, type Tx } from "./audit";
import { loadClassContext, loadSessionContext, lockSession } from "./class-context";
import { getRecordingEligibility } from "./consent";
import { DomainError, isUniqueViolation } from "./errors";
import { requireOptionCEnabled } from "./option-c";

// Live Session ↔ whole-session recording (Option C) integration (A123–A126). Extends the
// existing provider-neutral recording foundation (./recordings.ts) — nothing is rebuilt and no
// capture/egress exists (A35).
//
// - Whole-session replay is Option C only. Option C is checked when a recording-enabled session
//   STARTS (./live-sessions.ts) and AGAIN here when recording starts.
// - Participants come from the session's attendance/presence, not a free-form list: everyone
//   admitted and connected when recording starts (SESSION_PRESENCE), plus anyone admitted later
//   (SESSION_LATE_JOIN).
// - Consent is snapshotted at capture: present students are evaluated at recording start; a late
//   joiner is evaluated when admitted, and their audio is excluded until that check passes. Live
//   participation never depends on it (A72, A125).
// - Before media finalization a Primary/Co-Teacher/Markaz Admin may correct the list (audited).

export type SessionRecordingOptions = { now?: Date; policy?: ConsentPolicy };

/** The session's recording currently capturing (started, not ended, not deleted), if any. */
export async function activeSessionRecording(db: Tx | PrismaClient, sessionId: string) {
  return db.recording.findFirst({
    where: { liveSessionId: sessionId, startedAt: { not: null }, endedAt: null, deletedAt: null },
    select: { id: true, tenantId: true, startedAt: true },
  });
}

/**
 * Registers (or re-checks) one student for the recording in progress. Called when a student is
 * ADMITTED to a session while it is being recorded. Never blocks or alters live participation.
 */
export async function registerSessionRecordingParticipant(
  tx: Tx,
  recording: { id: string; tenantId: string },
  studentProfileId: string,
  source: "SESSION_PRESENCE" | "SESSION_LATE_JOIN",
  options: { now: Date; policy?: ConsentPolicy },
) {
  const result = await getRecordingEligibility(tx, studentProfileId, recording.tenantId, options);
  const existing = await tx.recordingParticipant.findUnique({
    where: { recordingId_studentProfileId: { recordingId: recording.id, studentProfileId } },
    select: { id: true, audioIncluded: true, excludedAt: true },
  });
  if (existing) {
    // Excluded by a correction: a rejoin does not silently undo that decision.
    if (existing.excludedAt || existing.audioIncluded || !result.eligible) return;
    // Consent now passes (e.g. given during the session): audio counts from this moment only.
    await tx.recordingParticipant.update({
      where: { id: existing.id },
      data: { audioIncluded: true, eligibility: "CONSENTED", consentId: result.consentId, audioIncludedFrom: options.now },
    });
    return;
  }
  await tx.recordingParticipant.create({
    data: {
      recordingId: recording.id,
      tenantId: recording.tenantId,
      studentProfileId,
      audioIncluded: result.eligible,
      eligibility: result.eligibility,
      consentId: result.eligible ? result.consentId : null,
      audioIncludedFrom: result.eligible ? options.now : null,
      registeredAt: options.now,
      source,
    },
  });
}

const startSchema = z.object({
  sessionId: z.uuid(),
  title: z.string().trim().max(200).optional(),
  /** A30: the recording-start notice is shown to everyone in the session. */
  noticeShown: z.literal(true),
  /** A89: the teacher's own recording notice acknowledgement (not consent). */
  teacherNoticeAcknowledged: z.literal(true),
});

/**
 * A teaching role (Primary, Co-Teacher or the session's Substitute — the recording's teacher)
 * starts the whole-session recording of a LIVE, recording-enabled session. Option C is checked
 * again here (A123). Consent is snapshotted for every student present now (A125).
 */
export async function startSessionRecording(db: PrismaClient, actor: Actor, input: unknown, options: SessionRecordingOptions = {}) {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { session, ctx } = await loadSessionContext(db, parsed.data.sessionId);
  if (!canStartSessionRecording(actor, ctx)) throw new AuthorizationError();
  if (session.status !== "LIVE" || !session.recordingEnabled) throw new DomainError("invalid_state");
  await requireOptionCEnabled(db, session.tenantId);
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    await lockSession(tx, session.id);
    if (await activeSessionRecording(tx, session.id)) throw new DomainError("conflict");
    const recording = await tx.recording.create({
      data: {
        tenantId: session.tenantId,
        teacherProfileId: actor.profileId,
        liveSessionId: session.id,
        title: parsed.data.title || session.title || session.class.name,
        noticeShownAt: now,
        startedAt: now,
        teacherNoticeAcknowledgedAt: now,
        teacherNoticeAcknowledgedById: actor.profileId,
        createdAt: now,
      },
      select: { id: true, tenantId: true },
    });
    const present = await tx.liveSessionParticipant.findMany({
      where: { sessionId: session.id, role: "STUDENT", admission: "ADMITTED", removedAt: null, connections: { some: { disconnectedAt: null } } },
      select: { profileId: true },
    });
    for (const p of present) {
      await registerSessionRecordingParticipant(tx, recording, p.profileId, "SESSION_PRESENCE", { now, policy: options.policy });
    }
    await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "RECORDING_SESSION_STARTED", targetType: "RECORDING", targetId: recording.id, metadata: { sessionId: session.id, present: present.length }, now });
    await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "RECORDING_TEACHER_NOTICE_ACKNOWLEDGED", targetType: "RECORDING", targetId: recording.id, now });
    return recording.id;
  });
}

async function loadSessionRecording(db: Tx | PrismaClient, recordingId: unknown) {
  if (!isValidId(recordingId)) throw new AuthorizationError();
  const r = await db.recording.findUnique({
    where: { id: recordingId },
    select: { id: true, tenantId: true, liveSessionId: true, status: true, startedAt: true, endedAt: true, mediaFinalizedAt: true, deletedAt: true },
  });
  if (!r || !r.liveSessionId) throw new AuthorizationError();
  return r as typeof r & { liveSessionId: string };
}

/** Stop capturing (the session ending stops it too). Teaching roles of the session or the Markaz Admin. */
export async function stopSessionRecording(db: PrismaClient, actor: Actor, input: unknown, options: SessionRecordingOptions = {}) {
  const parsed = z.object({ recordingId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const r = await loadSessionRecording(db, parsed.data.recordingId);
  const { ctx } = await loadSessionContext(db, r.liveSessionId);
  if (!canStartSessionRecording(actor, ctx) && !canCorrectRecordingParticipants(actor, ctx)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  const { count } = await db.recording.updateMany({ where: { id: r.id, startedAt: { not: null }, endedAt: null }, data: { endedAt: now } });
  if (count !== 1) throw new DomainError("invalid_state");
}

const correctSchema = z.object({
  recordingId: z.uuid(),
  add: z.array(z.uuid()).max(500).default([]),
  remove: z.array(z.uuid()).max(500).default([]),
});

/**
 * Pre-finalization participant correction (A124): Primary, Co-Teacher or Markaz Admin. Added
 * students must be enrolled in the class (any open enrollment) or have joined the session; their
 * consent is evaluated now. Removed students are EXCLUDED (row kept). Audited with counts.
 */
export async function correctRecordingParticipants(db: PrismaClient, actor: Actor, input: unknown, options: SessionRecordingOptions = {}) {
  const parsed = correctSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const add = [...new Set(parsed.data.add)];
  const remove = [...new Set(parsed.data.remove)];
  if (add.length === 0 && remove.length === 0) throw new DomainError("invalid_input");
  if (add.some((id) => remove.includes(id))) throw new DomainError("invalid_input");
  const r = await loadSessionRecording(db, parsed.data.recordingId);
  const { session } = await loadSessionContext(db, r.liveSessionId);
  const cls = await loadClassContext(db, session.classId);
  if (!canCorrectRecordingParticipants(actor, cls)) throw new AuthorizationError();
  if (r.mediaFinalizedAt || r.deletedAt || r.status !== "DRAFT") throw new DomainError("invalid_state");
  const now = options.now ?? new Date();

  if (add.length) {
    const [enrolled, joined] = await Promise.all([
      db.classEnrollment.findMany({ where: { classId: cls.id, studentProfileId: { in: add }, status: { not: "ENDED" } }, select: { studentProfileId: true } }),
      db.liveSessionParticipant.findMany({ where: { sessionId: session.id, role: "STUDENT", profileId: { in: add } }, select: { profileId: true } }),
    ]);
    const known = new Set([...enrolled.map((e) => e.studentProfileId), ...joined.map((p) => p.profileId)]);
    if (add.some((id) => !known.has(id))) throw new AuthorizationError();
  }

  await db.$transaction(async (tx) => {
    for (const studentProfileId of add) {
      const result = await getRecordingEligibility(tx, studentProfileId, r.tenantId, { now, policy: options.policy });
      const existing = await tx.recordingParticipant.findUnique({ where: { recordingId_studentProfileId: { recordingId: r.id, studentProfileId } }, select: { id: true } });
      const data = {
        audioIncluded: result.eligible,
        eligibility: result.eligibility,
        consentId: result.eligible ? result.consentId : null,
        audioIncludedFrom: result.eligible ? now : null,
        excludedAt: null,
        excludedById: null,
      };
      try {
        if (existing) await tx.recordingParticipant.update({ where: { id: existing.id }, data });
        else await tx.recordingParticipant.create({ data: { ...data, recordingId: r.id, tenantId: r.tenantId, studentProfileId, registeredAt: now, source: "MANUAL_CORRECTION" } });
      } catch (error) {
        if (isUniqueViolation(error)) throw new DomainError("conflict");
        throw error;
      }
    }
    if (remove.length) {
      await tx.recordingParticipant.updateMany({
        where: { recordingId: r.id, studentProfileId: { in: remove }, excludedAt: null },
        data: { excludedAt: now, excludedById: actor.profileId },
      });
    }
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: r.tenantId,
      action: "RECORDING_PARTICIPANTS_ADJUSTED",
      targetType: "RECORDING",
      targetId: r.id,
      metadata: { added: add.length, removed: remove.length },
      now,
    });
  });
}

/** Session recordings with their participant snapshot, for the class staff of that session. */
export async function listSessionRecordings(db: PrismaClient, actor: Actor, sessionId: unknown) {
  const { session } = await loadSessionContext(db, sessionId);
  const cls = await loadClassContext(db, session.classId);
  const { ctx } = await loadSessionContext(db, session.id);
  if (!canCorrectRecordingParticipants(actor, cls) && !canStartSessionRecording(actor, ctx)) throw new AuthorizationError();
  return db.recording.findMany({
    where: { liveSessionId: session.id },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      mediaFinalizedAt: true,
      participants: {
        select: { studentProfileId: true, audioIncluded: true, eligibility: true, source: true, excludedAt: true, student: { select: { profile: { select: { displayName: true } } } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
