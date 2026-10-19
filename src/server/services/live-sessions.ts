import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { LiveParticipantRole } from "@/generated/prisma/enums";
import {
  canAdjustAttendance,
  canAssignSubstitute,
  canAuthorWhiteboard,
  canCancelSession,
  canControlMic,
  canControlWhiteboard,
  canCreateSession,
  canOperateParticipants,
  canReadSessionAttendance,
  canReadSessionChat,
  canScreenShare,
  canStartOrEndSession,
  canViewClassAsStaff,
  classRelation,
  liveParticipantRole,
  studentHasClassAccess,
} from "@/server/authz/live-class";
import { AuthorizationError, hasActiveRole, isValidId, parentMaySee, type Actor } from "@/server/authz/policy";
import type { ConsentPolicy } from "@/server/authz/recording-consent";
import { addLocalDays, localWeekday, parseLocalDate, zonedWallTimeToUtc } from "@/lib/timezone";
import { recordAudit, type Tx } from "./audit";
import {
  enrollmentAccess,
  hasActiveMembership,
  loadClassContext,
  loadSessionContext,
  lockSession,
  requireMarkazTimezone,
  type LoadedSession,
} from "./class-context";
import { DomainError, isUniqueViolation } from "./errors";
import {
  computeAttendance,
  DEFAULT_AD_HOC_DURATION_MINUTES,
  effectiveCapacity,
  effectiveEnrollmentState,
  MAX_OPEN_DEVICES_PER_PARTICIPANT,
  MAX_SESSION_DURATION_MINUTES,
  safetyCloseAt,
  startAllowedFrom,
  waitingRoomOpensAt,
} from "./live-rules";
import { requireOptionCEnabled } from "./option-c";
import { activeSessionRecording, registerSessionRecordingParticipant } from "./session-recording";

// Live Sessions — PROVIDER-NEUTRAL business state (owner TO-BE approval 2026-10-19,
// A111–A122). There is NO audio, video, screen-share or whiteboard transport and NO RTC vendor
// SDK, token or room here (A35). What exists is the state a future provider adapter must obey:
// who may join, who is admitted, which device is interactive, who may publish a mic or write
// the whiteboard, and the raw presence that attendance is computed from.
//
// Session lifecycle (the stored states — "waiting room open" is derived from time):
//
//   SCHEDULED ──start (15 min early at most)──▶ LIVE ──end (manual)──────────────▶ ENDED
//       │                                        └──still LIVE at end + 30 min──▶ ENDED (SAFETY_CLOSE)
//       └──cancel (Primary Teacher / Markaz Admin)──▶ CANCELLED
//   (ad hoc) ──create──▶ LIVE
//
// Device rule (A121): per person, one PRIMARY interactive device and at most one VIEW_ONLY
// device. Presence is the UNION of admitted connection intervals, so reconnects and the second
// device never double-count attendance; capacity counts PEOPLE (participants), not devices.

export type SessionOptions = { now?: Date; policy?: ConsentPolicy };

const MINUTE = 60_000;

async function auditSession(tx: Tx, actorId: string | null, tenantId: string, action: Parameters<typeof recordAudit>[1]["action"], sessionId: string, now: Date, metadata?: Record<string, string | number | boolean | null>) {
  await recordAudit(tx, { actorId, tenantId, action, targetType: "LIVE_SESSION", targetId: sessionId, metadata, now });
}

// --- Creating sessions ----------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const durationSchema = z.coerce.number().int().min(1).max(MAX_SESSION_DURATION_MINUTES);

const scheduledSchema = z.object({
  classId: z.uuid(),
  /** Markaz-local date and time — interpreted in the Markaz time zone, stored in UTC. */
  date: z.iso.date(),
  startTime: z.string().regex(TIME),
  durationMinutes: durationSchema,
  title: z.string().trim().max(200).optional(),
  recordingEnabled: z.boolean().optional(),
});

/** A scheduled one-off session (the default kind, A112): an assigned teacher or a Markaz Admin. */
export async function createScheduledSession(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = scheduledSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const d = parsed.data;
  const cls = await loadClassContext(db, d.classId);
  if (!canCreateSession(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  const tz = requireMarkazTimezone(cls.tenant.timezone); // A131: no silent UTC fallback
  const [hh, mm] = d.startTime.split(":").map(Number);
  const start = zonedWallTimeToUtc(d.date, hh * 60 + mm, tz);
  const end = new Date(start.getTime() + d.durationMinutes * MINUTE);
  const now = options.now ?? new Date();
  if (end.getTime() <= now.getTime()) throw new DomainError("invalid_input");
  return db.$transaction(async (tx) => {
    const row = await tx.liveSession.create({
      data: {
        tenantId: cls.tenantId,
        classId: cls.id,
        kind: "SCHEDULED",
        status: "SCHEDULED",
        title: d.title || null,
        scheduledStartAt: start,
        scheduledEndAt: end,
        recordingEnabled: d.recordingEnabled ?? false,
        createdById: actor.profileId,
        createdAt: now,
      },
      select: { id: true },
    });
    await auditSession(tx, actor.profileId, cls.tenantId, "SESSION_CREATED", row.id, now, { kind: "SCHEDULED" });
    return row.id;
  });
}

const generateSchema = z.object({ classId: z.uuid(), fromDate: z.iso.date(), days: z.coerce.number().int().min(1).max(62) });

/**
 * Materializes the class's recurring schedule into SCHEDULED sessions for `days` Markaz-local
 * days from `fromDate`. Idempotent (unique schedule + start); past slots are skipped.
 */
export async function generateSessionsFromSchedule(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success || !parseLocalDate(parsed.data.fromDate)) throw new DomainError("invalid_input");
  const cls = await loadClassContext(db, parsed.data.classId);
  if (!canCreateSession(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  const tz = requireMarkazTimezone(cls.tenant.timezone); // A131: no silent UTC fallback
  const now = options.now ?? new Date();
  const schedules = await db.classSchedule.findMany({ where: { classId: cls.id, endedAt: null } });
  const rows: { scheduleId: string; start: Date; end: Date }[] = [];
  for (let i = 0; i < parsed.data.days; i++) {
    const date = addLocalDays(parsed.data.fromDate, i);
    const weekday = localWeekday(date);
    for (const s of schedules) {
      if (s.weekday !== weekday) continue;
      if (s.validFrom && date < s.validFrom.toISOString().slice(0, 10)) continue;
      if (s.validUntil && date > s.validUntil.toISOString().slice(0, 10)) continue;
      const start = zonedWallTimeToUtc(date, s.startMinute, tz);
      const end = new Date(start.getTime() + s.durationMinutes * MINUTE);
      if (end.getTime() > now.getTime()) rows.push({ scheduleId: s.id, start, end });
    }
  }
  if (rows.length === 0) return 0;
  return db.$transaction(async (tx) => {
    const created = await tx.liveSession.createManyAndReturn({
      data: rows.map((r) => ({
        tenantId: cls.tenantId,
        classId: cls.id,
        kind: "SCHEDULED" as const,
        status: "SCHEDULED" as const,
        scheduleId: r.scheduleId,
        scheduledStartAt: r.start,
        scheduledEndAt: r.end,
        createdById: actor.profileId,
        createdAt: now,
      })),
      skipDuplicates: true,
      select: { id: true },
    });
    for (const s of created) await auditSession(tx, actor.profileId, cls.tenantId, "SESSION_CREATED", s.id, now, { kind: "SCHEDULED", fromSchedule: true });
    return created.length;
  });
}

const adHocSchema = z.object({
  classId: z.uuid(),
  /** A114: default 60 minutes, changeable by the teacher. A default, never a commercial limit. */
  durationMinutes: durationSchema.optional(),
  title: z.string().trim().max(200).optional(),
  recordingEnabled: z.boolean().optional(),
});

/** An ad hoc session is created and started at once (A114). */
export async function startAdHocSession(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = adHocSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const d = parsed.data;
  const cls = await loadClassContext(db, d.classId);
  if (!canCreateSession(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  // A123 (1): a recording-enabled session needs Option C when it begins.
  if (d.recordingEnabled) await requireOptionCEnabled(db, cls.tenantId);
  const now = options.now ?? new Date();
  const end = new Date(now.getTime() + (d.durationMinutes ?? DEFAULT_AD_HOC_DURATION_MINUTES) * MINUTE);
  return db.$transaction(async (tx) => {
    let id: string;
    try {
      const row = await tx.liveSession.create({
        data: {
          tenantId: cls.tenantId,
          classId: cls.id,
          kind: "AD_HOC",
          status: "LIVE",
          title: d.title || null,
          scheduledStartAt: now,
          scheduledEndAt: end,
          recordingEnabled: d.recordingEnabled ?? false,
          createdById: actor.profileId,
          createdAt: now,
          actualStartAt: now,
          startedById: actor.profileId,
        },
        select: { id: true },
      });
      id = row.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError("conflict"); // another session of this class is LIVE
      throw error;
    }
    await auditSession(tx, actor.profileId, cls.tenantId, "SESSION_CREATED", id, now, { kind: "AD_HOC" });
    await auditSession(tx, actor.profileId, cls.tenantId, "SESSION_STARTED", id, now);
    return id;
  });
}

// --- Lifecycle ------------------------------------------------------------------------------------

const sessionIdSchema = z.object({ sessionId: z.uuid() });

/**
 * Start a scheduled session: Primary, Co-Teacher, the Substitute or a Markaz Admin (A113), from
 * 15 minutes before the scheduled start (A112). A session that would already be past its safety
 * close cannot be started. Option C is checked when a recording-enabled session begins (A123).
 */
export async function startSession(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = sessionIdSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { session, ctx } = await loadSessionContext(db, parsed.data.sessionId);
  if (!canStartOrEndSession(actor, ctx)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  if (session.status !== "SCHEDULED" || session.class.status !== "ACTIVE") throw new DomainError("invalid_state");
  if (now < startAllowedFrom(session.scheduledStartAt)) throw new DomainError("too_early");
  if (now >= safetyCloseAt(session.scheduledEndAt)) throw new DomainError("invalid_state");
  if (session.recordingEnabled) await requireOptionCEnabled(db, session.tenantId);
  await db.$transaction(async (tx) => {
    try {
      const { count } = await tx.liveSession.updateMany({
        where: { id: session.id, status: "SCHEDULED" },
        data: { status: "LIVE", actualStartAt: now, startedById: actor.profileId },
      });
      if (count !== 1) throw new DomainError("invalid_state");
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError("conflict");
      throw error;
    }
    await auditSession(tx, actor.profileId, session.tenantId, "SESSION_STARTED", session.id, now);
  });
}

/**
 * Ends a LIVE session (manual end, or the safety close): closes every open connection, clears all
 * live permissions, stops an in-progress recording's capture, and computes attendance.
 */
async function finishSession(
  tx: Tx,
  session: Pick<LoadedSession, "id" | "tenantId" | "classId" | "scheduledStartAt" | "actualStartAt">,
  endAt: Date,
  endedById: string | null,
  reason: "MANUAL" | "SAFETY_CLOSE",
  now: Date,
) {
  const { count } = await tx.liveSession.updateMany({
    where: { id: session.id, status: "LIVE" },
    data: { status: "ENDED", actualEndAt: endAt, endedById, endReason: reason },
  });
  if (count !== 1) throw new DomainError("invalid_state");
  const open = await tx.liveSessionConnection.findMany({ where: { sessionId: session.id, disconnectedAt: null }, select: { id: true, connectedAt: true } });
  for (const c of open) {
    await tx.liveSessionConnection.update({ where: { id: c.id }, data: { disconnectedAt: c.connectedAt > endAt ? c.connectedAt : endAt } });
  }
  await tx.liveSessionParticipant.updateMany({
    where: { sessionId: session.id },
    data: { handRaisedAt: null, micGrantedAt: null, micGrantedById: null, whiteboardGrantedAt: null, whiteboardGrantedById: null },
  });
  await tx.recording.updateMany({ where: { liveSessionId: session.id, startedAt: { not: null }, endedAt: null }, data: { endedAt: endAt } });
  await finalizeAttendance(tx, { ...session, actualEndAt: endAt }, now);
  await auditSession(tx, endedById, session.tenantId, reason === "MANUAL" ? "SESSION_ENDED" : "SESSION_SAFETY_CLOSED", session.id, now);
}

/** Manual end (the primary behaviour, A113): Primary, Co-Teacher, Substitute or Markaz Admin. */
export async function endSession(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = sessionIdSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { session, ctx } = await loadSessionContext(db, parsed.data.sessionId);
  if (!canStartOrEndSession(actor, ctx)) throw new AuthorizationError();
  if (session.status !== "LIVE") throw new DomainError("invalid_state");
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await lockSession(tx, session.id);
    await finishSession(tx, session, now, actor.profileId, "MANUAL", now);
  });
}

/**
 * Safety close (A113, A114): every session still LIVE at scheduled end + 30 minutes is ended,
 * as of that moment. A SAFE, deterministic, re-runnable entry point for a future job — NOT
 * scheduled anywhere (no production scheduler is authorized).
 */
export async function closeStaleSessions(db: PrismaClient, now: Date = new Date()) {
  const stale = await db.liveSession.findMany({
    where: { status: "LIVE", scheduledEndAt: { lte: new Date(now.getTime() - 30 * MINUTE) } },
    select: { id: true, tenantId: true, classId: true, scheduledStartAt: true, scheduledEndAt: true, actualStartAt: true },
  });
  let closed = 0;
  for (const s of stale) {
    const cutoff = safetyCloseAt(s.scheduledEndAt);
    const endAt = s.actualStartAt && s.actualStartAt > cutoff ? s.actualStartAt : cutoff;
    try {
      await db.$transaction(async (tx) => {
        await lockSession(tx, s.id);
        await finishSession(tx, s, endAt, null, "SAFETY_CLOSE", now);
      });
      closed++;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error; // ended concurrently — fine
    }
  }
  return closed;
}

const cancelSchema = z.object({ sessionId: z.uuid(), reason: z.string().trim().max(500).optional() });

/** Cancel a scheduled session: Primary Teacher or Markaz Admin only — not Co-Teacher/Substitute (A113). */
export async function cancelSession(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { session, ctx } = await loadSessionContext(db, parsed.data.sessionId);
  if (!canCancelSession(actor, ctx)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.liveSession.updateMany({
      where: { id: session.id, status: "SCHEDULED", kind: "SCHEDULED" },
      data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.profileId, cancelReason: parsed.data.reason || null },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await tx.liveSessionConnection.updateMany({ where: { sessionId: session.id, disconnectedAt: null }, data: { disconnectedAt: now } });
    await auditSession(tx, actor.profileId, session.tenantId, "SESSION_CANCELLED", session.id, now);
  });
}

const substituteSchema = z.object({ sessionId: z.uuid(), substituteProfileId: z.union([z.uuid(), z.null()]) });

/**
 * Assign (or clear) the per-session Substitute: Primary Teacher or Markaz Admin (A105). Must be
 * an ACTIVE Teacher of the same Markaz (also a DB trigger); temporary for this session only —
 * never a Primary/Co-Teacher assignment.
 */
export async function assignSubstitute(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = substituteSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { session, ctx } = await loadSessionContext(db, parsed.data.sessionId);
  if (!canAssignSubstitute(actor, ctx)) throw new AuthorizationError();
  if (session.status !== "SCHEDULED" && session.status !== "LIVE") throw new DomainError("invalid_state");
  const sub = parsed.data.substituteProfileId;
  if (sub) {
    if (!(await hasActiveMembership(db, session.tenantId, sub, "TEACHER"))) throw new AuthorizationError();
    if (ctx.teachers.some((t) => t.teacherProfileId === sub)) throw new DomainError("invalid_input");
  }
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.liveSession.update({
      where: { id: session.id },
      data: sub ? { substituteProfileId: sub, substituteAssignedById: actor.profileId, substituteAssignedAt: now } : { substituteProfileId: null, substituteAssignedById: null, substituteAssignedAt: null },
    });
    await auditSession(tx, actor.profileId, session.tenantId, "SESSION_SUBSTITUTE_ASSIGNED", session.id, now, { substituteProfileId: sub });
  });
}

// --- Participation (vendor-neutral) -----------------------------------------------------------

function liveCapacityOf(session: LoadedSession) {
  return effectiveCapacity(session.class.liveCapacity, session.class.tenant.classLiveCapacityMax);
}

/** Students currently holding a live slot: ADMITTED, not removed, with an open connection. */
async function occupiedSlots(tx: Tx, sessionId: string, exceptParticipantId?: string) {
  return tx.liveSessionParticipant.count({
    where: {
      sessionId,
      role: "STUDENT",
      admission: "ADMITTED",
      removedAt: null,
      connections: { some: { disconnectedAt: null } },
      ...(exceptParticipantId ? { id: { not: exceptParticipantId } } : {}),
    },
  });
}

async function admitStudent(tx: Tx, session: LoadedSession, participant: { id: string; profileId: string }, now: Date, options: SessionOptions) {
  await tx.liveSessionParticipant.update({ where: { id: participant.id }, data: { admission: "ADMITTED" } });
  await tx.liveSessionConnection.updateMany({ where: { participantId: participant.id, disconnectedAt: null, admittedAt: null }, data: { admittedAt: now } });
  // A125: a student admitted while the session is being recorded is a late joiner; their audio
  // is excluded until their own consent check passes. Live participation is unaffected.
  const recording = await activeSessionRecording(tx, session.id);
  if (recording) await registerSessionRecordingParticipant(tx, recording, participant.profileId, "SESSION_LATE_JOIN", { now, policy: options.policy });
}

/** Gives free live slots to waiting students, first come first served (A110). */
async function promoteWaiting(tx: Tx, session: LoadedSession, now: Date, options: SessionOptions) {
  const capacity = liveCapacityOf(session);
  for (;;) {
    if (capacity !== null && (await occupiedSlots(tx, session.id)) >= capacity) return;
    const next = await tx.liveSessionParticipant.findFirst({
      where: { sessionId: session.id, role: "STUDENT", admission: "WAITING_FOR_SLOT", removedAt: null, connections: { some: { disconnectedAt: null } } },
      orderBy: { firstJoinedAt: "asc" },
      select: { id: true, profileId: true },
    });
    if (!next) return;
    await admitStudent(tx, session, next, now, options);
  }
}

/**
 * Join a session from one device. Returns this device's connection: PRIMARY if the person has no
 * open primary device, else VIEW_ONLY; a third device is refused (A121). Students need an ACTIVE
 * student membership and an ACTIVE/GRACE enrollment (A106), may wait from 15 minutes before
 * the start (A112), and are WAITING_FOR_SLOT while live capacity is full (A110). Consent is
 * never checked here: recording consent does not gate attendance (A125).
 */
export async function joinSession(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = sessionIdSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const now = options.now ?? new Date();
  const { session, ctx } = await loadSessionContext(db, parsed.data.sessionId);
  const access = await enrollmentAccess(db, session.classId, actor.profileId, now);
  const role = liveParticipantRole(actor, ctx, access);
  if (!role) {
    // An enrolled student whose access lapsed learns why; anyone else is simply refused.
    if (hasActiveRole(actor, ctx.tenantId, "STUDENT") && access !== null && access !== "ENDED") throw new DomainError("access_inactive");
    throw new AuthorizationError();
  }
  if (session.status === "ENDED" || session.status === "CANCELLED" || session.class.status !== "ACTIVE") throw new DomainError("invalid_state");
  if (session.status === "SCHEDULED") {
    if (now < waitingRoomOpensAt(session.scheduledStartAt)) throw new DomainError("too_early");
    if (now >= safetyCloseAt(session.scheduledEndAt)) throw new DomainError("invalid_state");
  }

  return db.$transaction(async (tx) => {
    await lockSession(tx, session.id);
    let participant = await tx.liveSessionParticipant.findUnique({
      where: { sessionId_profileId: { sessionId: session.id, profileId: actor.profileId } },
      select: { id: true, profileId: true, role: true, admission: true, removedAt: true },
    });
    if (participant?.removedAt) throw new AuthorizationError(); // removed from this session
    if (!participant) {
      participant = await tx.liveSessionParticipant.create({
        data: { tenantId: session.tenantId, sessionId: session.id, profileId: actor.profileId, role, admission: role === "STUDENT" ? "WAITING_FOR_SLOT" : null, firstJoinedAt: now },
        select: { id: true, profileId: true, role: true, admission: true, removedAt: true },
      });
    } else if (participant.role !== role && (participant.role === "STUDENT") === (role === "STUDENT")) {
      participant = await tx.liveSessionParticipant.update({ where: { id: participant.id }, data: { role }, select: { id: true, profileId: true, role: true, admission: true, removedAt: true } });
    }

    const open = await tx.liveSessionConnection.findMany({ where: { participantId: participant.id, disconnectedAt: null }, select: { mode: true } });
    if (open.length >= MAX_OPEN_DEVICES_PER_PARTICIPANT) throw new DomainError("limit_exceeded");
    const mode = open.some((c) => c.mode === "PRIMARY") ? "VIEW_ONLY" : "PRIMARY";

    let admission = participant.admission;
    if (participant.role === "STUDENT" && open.length === 0) {
      // First come, first served: students already waiting get any free slot before a newcomer
      // (a slot can free up without a leave, e.g. when an admin raises the capacity).
      if (session.status === "LIVE" || session.status === "SCHEDULED") await promoteWaiting(tx, session, now, options);
      const capacity = liveCapacityOf(session);
      admission = capacity === null || (await occupiedSlots(tx, session.id, participant.id)) < capacity ? "ADMITTED" : "WAITING_FOR_SLOT";
      await tx.liveSessionParticipant.update({ where: { id: participant.id }, data: { admission } });
    }
    const admitted = participant.role !== "STUDENT" || admission === "ADMITTED";
    const connection = await tx.liveSessionConnection.create({
      data: { tenantId: session.tenantId, sessionId: session.id, participantId: participant.id, mode, connectedAt: now, admittedAt: admitted ? now : null },
      select: { id: true },
    });
    if (participant.role === "STUDENT" && admission === "ADMITTED" && open.length === 0) {
      const recording = await activeSessionRecording(tx, session.id);
      if (recording) await registerSessionRecordingParticipant(tx, recording, actor.profileId, "SESSION_LATE_JOIN", { now, policy: options.policy });
    }
    return { connectionId: connection.id, participantId: participant.id, mode, role: participant.role, admission };
  });
}

/** After a device disconnects: hand the primary role over, release a slot, clear stale grants. */
async function afterDisconnect(tx: Tx, session: LoadedSession, participantId: string, now: Date, options: SessionOptions) {
  const open = await tx.liveSessionConnection.findMany({
    where: { participantId, disconnectedAt: null },
    select: { id: true, mode: true },
    orderBy: { connectedAt: "asc" },
  });
  if (open.length > 0) {
    // The remaining (view-only) device becomes the interactive one.
    if (!open.some((c) => c.mode === "PRIMARY")) await tx.liveSessionConnection.update({ where: { id: open[0].id }, data: { mode: "PRIMARY" } });
    return;
  }
  const p = await tx.liveSessionParticipant.findUniqueOrThrow({ where: { id: participantId }, select: { id: true, role: true, admission: true, micGrantedAt: true, whiteboardGrantedAt: true } });
  if (p.role !== "STUDENT") return;
  if (p.micGrantedAt || p.whiteboardGrantedAt) {
    await tx.liveSessionParticipant.update({
      where: { id: p.id },
      data: { handRaisedAt: null, micGrantedAt: null, micGrantedById: null, whiteboardGrantedAt: null, whiteboardGrantedById: null },
    });
    if (p.micGrantedAt) await recordAudit(tx, { actorId: null, tenantId: session.tenantId, action: "MIC_REVOKED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: p.id, metadata: { reason: "disconnected" }, now });
    if (p.whiteboardGrantedAt) await recordAudit(tx, { actorId: null, tenantId: session.tenantId, action: "WHITEBOARD_REVOKED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: p.id, metadata: { reason: "disconnected" }, now });
  } else {
    await tx.liveSessionParticipant.update({ where: { id: p.id }, data: { handRaisedAt: null } });
  }
  if (p.admission === "ADMITTED") await promoteWaiting(tx, session, now, options);
}

/** Leave from one device (the person's own connection only). Idempotent. */
export async function leaveSession(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = z.object({ connectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const conn = await db.liveSessionConnection.findUnique({
    where: { id: parsed.data.connectionId },
    select: { id: true, sessionId: true, participantId: true, disconnectedAt: true, participant: { select: { profileId: true } } },
  });
  if (!conn || conn.participant.profileId !== actor.profileId) throw new AuthorizationError();
  if (conn.disconnectedAt) return;
  const now = options.now ?? new Date();
  const { session } = await loadSessionContext(db, conn.sessionId);
  await db.$transaction(async (tx) => {
    await lockSession(tx, session.id);
    const { count } = await tx.liveSessionConnection.updateMany({ where: { id: conn.id, disconnectedAt: null }, data: { disconnectedAt: now } });
    if (count === 1) await afterDisconnect(tx, session, conn.participantId, now, options);
  });
}

async function loadParticipant(db: PrismaClient, participantId: unknown) {
  if (!isValidId(participantId)) throw new AuthorizationError();
  const p = await db.liveSessionParticipant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      sessionId: true,
      profileId: true,
      role: true,
      admission: true,
      removedAt: true,
      micGrantedAt: true,
      whiteboardGrantedAt: true,
      connections: { where: { disconnectedAt: null }, select: { id: true, mode: true } },
    },
  });
  if (!p) throw new AuthorizationError();
  const { session, ctx } = await loadSessionContext(db, p.sessionId);
  return { p, session, ctx };
}

function requireInteractiveStudent(p: Awaited<ReturnType<typeof loadParticipant>>["p"], session: LoadedSession) {
  if (session.status !== "LIVE") throw new DomainError("invalid_state");
  if (p.role !== "STUDENT" || p.removedAt || p.admission !== "ADMITTED") throw new DomainError("invalid_state");
  // A121: permissions are only ever exercised from the PRIMARY device.
  if (!p.connections.some((c) => c.mode === "PRIMARY")) throw new DomainError("invalid_state");
}

const participantSchema = z.object({ participantId: z.uuid() });

/** A student raises their own hand (admitted, on a live session). */
export async function raiseHand(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = sessionIdSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const p = await db.liveSessionParticipant.findUnique({ where: { sessionId_profileId: { sessionId: parsed.data.sessionId, profileId: actor.profileId } }, select: { id: true } });
  if (!p) throw new AuthorizationError();
  const loaded = await loadParticipant(db, p.id);
  requireInteractiveStudent(loaded.p, loaded.session);
  await db.liveSessionParticipant.update({ where: { id: p.id }, data: { handRaisedAt: options.now ?? new Date() } });
}

/** Lower a hand: the student themself, or anyone who controls mics in this session. */
export async function lowerHand(db: PrismaClient, actor: Actor, input: unknown) {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { p, ctx } = await loadParticipant(db, parsed.data.participantId);
  if (p.profileId !== actor.profileId && !canControlMic(actor, ctx)) throw new AuthorizationError();
  await db.liveSessionParticipant.update({ where: { id: p.id }, data: { handRaisedAt: null } });
}

/**
 * Grant a student's mic PERMISSION (business state only — no audio is transported). Only ONE
 * student may hold it per session (A117; also a partial unique index). A138 handoff: granting
 * Student B while Student A holds it revokes A and grants B in ONE transaction, auditing both
 * transitions, so the one-holder invariant is never broken. Teaching roles and the Markaz Admin
 * (operational) may grant.
 */
export async function grantMic(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { p, session, ctx } = await loadParticipant(db, parsed.data.participantId);
  if (!canControlMic(actor, ctx)) throw new AuthorizationError();
  requireInteractiveStudent(p, session);
  if (p.micGrantedAt) throw new DomainError("conflict"); // already holds it
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await lockSession(tx, session.id);
    const holder = await tx.liveSessionParticipant.findFirst({
      where: { sessionId: session.id, micGrantedAt: { not: null }, id: { not: p.id } },
      select: { id: true },
    });
    if (holder) {
      await tx.liveSessionParticipant.update({ where: { id: holder.id }, data: { micGrantedAt: null, micGrantedById: null } });
      await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "MIC_REVOKED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: holder.id, metadata: { reason: "handoff", toParticipantId: p.id }, now });
    }
    try {
      const { count } = await tx.liveSessionParticipant.updateMany({
        where: { id: p.id, micGrantedAt: null, removedAt: null },
        data: { micGrantedAt: now, micGrantedById: actor.profileId, handRaisedAt: null },
      });
      if (count !== 1) throw new DomainError("conflict");
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError("conflict");
      throw error;
    }
    await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "MIC_GRANTED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: p.id, metadata: { handoffFromParticipantId: holder?.id ?? null }, now });
  });
}

export async function revokeMic(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { p, session, ctx } = await loadParticipant(db, parsed.data.participantId);
  if (!canControlMic(actor, ctx)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.liveSessionParticipant.updateMany({ where: { id: p.id, micGrantedAt: { not: null } }, data: { micGrantedAt: null, micGrantedById: null } });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "MIC_REVOKED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: p.id, now });
  });
}

/** Grant a student whiteboard WRITE permission — teaching roles only, never the Markaz Admin (A118). */
export async function grantWhiteboard(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { p, session, ctx } = await loadParticipant(db, parsed.data.participantId);
  if (!canControlWhiteboard(actor, ctx)) throw new AuthorizationError();
  requireInteractiveStudent(p, session);
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.liveSessionParticipant.updateMany({ where: { id: p.id, whiteboardGrantedAt: null }, data: { whiteboardGrantedAt: now, whiteboardGrantedById: actor.profileId } });
    if (count !== 1) throw new DomainError("conflict");
    await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "WHITEBOARD_GRANTED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: p.id, now });
  });
}

export async function revokeWhiteboard(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { p, session, ctx } = await loadParticipant(db, parsed.data.participantId);
  if (!canControlWhiteboard(actor, ctx)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.liveSessionParticipant.updateMany({ where: { id: p.id, whiteboardGrantedAt: { not: null } }, data: { whiteboardGrantedAt: null, whiteboardGrantedById: null } });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "WHITEBOARD_REVOKED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: p.id, now });
  });
}

/** Remove a student from this session (teaching roles, Markaz Admin). They cannot rejoin it. */
export async function removeParticipant(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { p, session, ctx } = await loadParticipant(db, parsed.data.participantId);
  if (!canOperateParticipants(actor, ctx)) throw new AuthorizationError();
  if (p.role !== "STUDENT" || p.removedAt) throw new DomainError("invalid_state");
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await lockSession(tx, session.id);
    await tx.liveSessionParticipant.update({
      where: { id: p.id },
      data: { removedAt: now, removedById: actor.profileId, handRaisedAt: null, micGrantedAt: null, micGrantedById: null, whiteboardGrantedAt: null, whiteboardGrantedById: null },
    });
    await tx.liveSessionConnection.updateMany({ where: { participantId: p.id, disconnectedAt: null }, data: { disconnectedAt: now } });
    await recordAudit(tx, { actorId: actor.profileId, tenantId: session.tenantId, action: "SESSION_PARTICIPANT_REMOVED", targetType: "LIVE_SESSION_PARTICIPANT", targetId: p.id, now });
    if (p.admission === "ADMITTED" && session.status === "LIVE") await promoteWaiting(tx, session, now, options);
  });
}

// --- Device capabilities: the boundary a future provider adapter must enforce (A121) -----------

export type DeviceCapabilities = {
  live: boolean;
  viewOnly: boolean;
  admitted: boolean;
  publishMic: boolean;
  writeWhiteboard: boolean;
  screenShare: boolean;
};

/**
 * Pure: what ONE device of a participant may do. A VIEW_ONLY device never publishes a mic or
 * writes the whiteboard. A student needs admission plus the matching grant. Teaching roles may
 * speak, write and screen share from their primary device. A Markaz Admin is operational, not a
 * teaching role (A115): none of these by role.
 */
export function deviceCapabilities(input: {
  sessionLive: boolean;
  mode: "PRIMARY" | "VIEW_ONLY";
  open: boolean;
  role: LiveParticipantRole;
  teaching: boolean;
  removed: boolean;
  admission: "ADMITTED" | "WAITING_FOR_SLOT" | null;
  micGranted: boolean;
  whiteboardGranted: boolean;
}): DeviceCapabilities {
  const active = input.sessionLive && input.open && !input.removed;
  const primary = active && input.mode === "PRIMARY";
  const admitted = input.role !== "STUDENT" || input.admission === "ADMITTED";
  if (input.role === "STUDENT") {
    return {
      live: active,
      viewOnly: input.mode === "VIEW_ONLY",
      admitted,
      publishMic: primary && admitted && input.micGranted,
      writeWhiteboard: primary && admitted && input.whiteboardGranted,
      screenShare: false,
    };
  }
  return { live: active, viewOnly: input.mode === "VIEW_ONLY", admitted, publishMic: primary && input.teaching, writeWhiteboard: primary && input.teaching, screenShare: primary && input.teaching };
}

/** Capabilities of the caller's OWN connection, decided from current server state. */
export async function getMyDeviceCapabilities(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = z.object({ connectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const conn = await db.liveSessionConnection.findUnique({
    where: { id: parsed.data.connectionId },
    select: {
      mode: true,
      disconnectedAt: true,
      sessionId: true,
      participant: { select: { profileId: true, role: true, admission: true, removedAt: true, micGrantedAt: true, whiteboardGrantedAt: true } },
    },
  });
  if (!conn || conn.participant.profileId !== actor.profileId) throw new AuthorizationError();
  const { session, ctx } = await loadSessionContext(db, conn.sessionId);
  const now = options.now ?? new Date();
  const p = conn.participant;
  // Re-check current authority: a lapsed enrollment or ended membership loses everything at once.
  const stillAllowed = liveParticipantRole(actor, ctx, await enrollmentAccess(db, session.classId, actor.profileId, now)) !== null;
  return deviceCapabilities({
    sessionLive: session.status === "LIVE" && stillAllowed,
    mode: conn.mode,
    open: conn.disconnectedAt === null,
    role: p.role,
    teaching: canAuthorWhiteboard(actor, ctx),
    removed: p.removedAt !== null,
    admission: p.admission,
    micGranted: p.micGrantedAt !== null,
    whiteboardGranted: p.whiteboardGrantedAt !== null,
  });
}

// --- Attendance (A122) -----------------------------------------------------------------------

/** Computes attendance for every eligible student when a session ends. */
async function finalizeAttendance(
  tx: Tx,
  session: Pick<LoadedSession, "id" | "tenantId" | "classId" | "scheduledStartAt" | "actualStartAt"> & { actualEndAt: Date },
  now: Date,
) {
  const actualStartAt = session.actualStartAt ?? session.actualEndAt;
  const enrolled = await tx.classEnrollment.findMany({
    where: { classId: session.classId, status: { notIn: ["ENDED", "WAITLISTED"] } },
    select: { studentProfileId: true, status: true, accessUntil: true, graceUntil: true },
  });
  const eligible = enrolled.filter((e) => ["ACTIVE", "GRACE"].includes(effectiveEnrollmentState(e, actualStartAt))).map((e) => e.studentProfileId);
  const participants = await tx.liveSessionParticipant.findMany({
    where: { sessionId: session.id, role: "STUDENT" },
    select: { profileId: true, connections: { where: { admittedAt: { not: null } }, select: { admittedAt: true, disconnectedAt: true } } },
  });
  const students = new Set([...eligible, ...participants.map((p) => p.profileId)]);
  const data = [...students].map((studentProfileId) => {
    const p = participants.find((x) => x.profileId === studentProfileId);
    const result = computeAttendance({
      actualStartAt,
      actualEndAt: session.actualEndAt,
      scheduledStartAt: session.scheduledStartAt,
      intervals: (p?.connections ?? []).map((c) => ({ start: c.admittedAt as Date, end: c.disconnectedAt })),
    });
    return {
      tenantId: session.tenantId,
      sessionId: session.id,
      studentProfileId,
      computedStatus: result.status,
      status: result.status,
      computedPunctuality: result.punctuality,
      punctuality: result.punctuality,
      presentSeconds: result.presentSeconds,
      sessionSeconds: result.sessionSeconds,
      firstArrivalAt: result.firstArrivalAt,
      computedAt: now,
    };
  });
  if (data.length) await tx.attendanceRecord.createMany({ data, skipDuplicates: true });
}

/** Full attendance of one session (incl. durations) for its teaching roles and the Markaz Admin. */
export async function listSessionAttendance(db: PrismaClient, actor: Actor, sessionId: unknown) {
  const { session, ctx } = await loadSessionContext(db, sessionId);
  if (!canReadSessionAttendance(actor, ctx)) throw new AuthorizationError();
  return db.attendanceRecord.findMany({
    where: { sessionId: session.id },
    select: {
      id: true,
      studentProfileId: true,
      status: true,
      computedStatus: true,
      punctuality: true,
      computedPunctuality: true,
      presentSeconds: true,
      sessionSeconds: true,
      firstArrivalAt: true,
      adjustedAt: true,
      adjustmentReason: true,
      student: { select: { profile: { select: { displayName: true } } } },
    },
    orderBy: { studentProfileId: "asc" },
  });
}

const adjustSchema = z.object({
  recordId: z.uuid(),
  /** A132: attendance only. */
  status: z.enum(["PRESENT", "ABSENT"]),
  /** A132: punctuality is corrected separately; omitted = unchanged; null = no arrival. */
  punctuality: z.union([z.enum(["ON_TIME", "LATE"]), z.null()]).optional(),
  reason: z.string().trim().min(1).max(500),
});

/** Manual correction: Primary, Co-Teacher or Markaz Admin — not the Substitute (A122). Audited. */
export async function adjustAttendance(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const record = await db.attendanceRecord.findUnique({ where: { id: parsed.data.recordId }, select: { id: true, sessionId: true, status: true, punctuality: true } });
  const punctuality = parsed.data.punctuality === undefined ? record?.punctuality ?? null : parsed.data.punctuality;
  if (!record) throw new AuthorizationError();
  const { session } = await loadSessionContext(db, record.sessionId);
  const cls = await loadClassContext(db, session.classId);
  if (!canAdjustAttendance(actor, cls)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.attendanceRecord.update({
      where: { id: record.id },
      data: { status: parsed.data.status, punctuality, adjustedById: actor.profileId, adjustedAt: now, adjustmentReason: parsed.data.reason },
    });
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: session.tenantId,
      action: "ATTENDANCE_ADJUSTED",
      targetType: "ATTENDANCE_RECORD",
      targetId: record.id,
      metadata: { from: record.status, to: parsed.data.status, punctualityFrom: record.punctuality, punctualityTo: punctuality },
      now,
    });
  });
}

/** A student's own attendance history (status and session date). */
export async function listMyAttendance(db: PrismaClient, actor: Actor) {
  const rows = await db.attendanceRecord.findMany({
    where: { studentProfileId: actor.profileId },
    select: { id: true, status: true, punctuality: true, session: { select: { scheduledStartAt: true, title: true, classId: true, class: { select: { name: true } } } } },
    orderBy: { session: { scheduledStartAt: "desc" } },
    take: 200,
  });
  return rows.map((r) => ({ id: r.id, status: r.status, punctuality: r.punctuality, sessionDate: r.session.scheduledStartAt, classId: r.session.classId, className: r.session.class.name, title: r.session.title }));
}

/**
 * A parent's view of a child's attendance (A41, A127): PRESENT / LATE / ABSENT with the class and
 * the session's scheduled date — NEVER raw join/leave timestamps or durations.
 */
export async function listChildAttendance(db: PrismaClient, actor: Actor, studentProfileId: unknown) {
  if (!parentMaySee(actor, studentProfileId, "attendance")) throw new AuthorizationError();
  const rows = await db.attendanceRecord.findMany({
    where: { studentProfileId: studentProfileId as string },
    select: { id: true, status: true, punctuality: true, session: { select: { scheduledStartAt: true, class: { select: { name: true, tenant: { select: { timezone: true } } } } } } },
    orderBy: { session: { scheduledStartAt: "desc" } },
    take: 200,
  });
  // Deliberately NOT selected: present_seconds, first_arrival_at, connection rows.
  return rows.map((r) => ({ id: r.id, status: r.status, punctuality: r.punctuality, sessionDate: r.session.scheduledStartAt, className: r.session.class.name, timezone: r.session.class.tenant.timezone }));
}

// --- Chat (A120) -------------------------------------------------------------------------------

const chatSchema = z.object({ sessionId: z.uuid(), body: z.string().trim().min(1).max(2000) });

/**
 * Post to the class chat of a LIVE session. The author must have joined (not removed); a student
 * must be admitted and still have class access. Public to the class; persistent.
 */
export async function postChatMessage(db: PrismaClient, actor: Actor, input: unknown, options: SessionOptions = {}) {
  const parsed = chatSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const now = options.now ?? new Date();
  const { session, ctx } = await loadSessionContext(db, parsed.data.sessionId);
  const access = await enrollmentAccess(db, session.classId, actor.profileId, now);
  if (!canReadSessionChat(actor, ctx, access)) throw new AuthorizationError();
  if (session.status !== "LIVE") throw new DomainError("invalid_state");
  const p = await db.liveSessionParticipant.findUnique({
    where: { sessionId_profileId: { sessionId: session.id, profileId: actor.profileId } },
    select: { role: true, admission: true, removedAt: true },
  });
  if (!p || p.removedAt) throw new AuthorizationError();
  if (p.role === "STUDENT" && p.admission !== "ADMITTED") throw new DomainError("invalid_state");
  const role = liveParticipantRole(actor, ctx, access) as LiveParticipantRole;
  const row = await db.liveChatMessage.create({
    data: { tenantId: session.tenantId, classId: session.classId, sessionId: session.id, authorProfileId: actor.profileId, authorRole: role, body: parsed.data.body, createdAt: now },
    select: { id: true },
  });
  return row.id;
}

const chatSelect = { id: true, body: true, createdAt: true, authorRole: true, authorProfileId: true, author: { select: { displayName: true } } } as const;

/** Stored chat of one session (A120 visibility). Parents are never allowed. */
export async function listSessionChat(db: PrismaClient, actor: Actor, sessionId: unknown, options: SessionOptions = {}) {
  const { session, ctx } = await loadSessionContext(db, sessionId);
  const access = await enrollmentAccess(db, session.classId, actor.profileId, options.now ?? new Date());
  if (!canReadSessionChat(actor, ctx, access)) throw new AuthorizationError();
  return db.liveChatMessage.findMany({ where: { sessionId: session.id }, select: chatSelect, orderBy: { createdAt: "asc" }, take: 1000 });
}

/**
 * Chat history of a whole class: its Markaz Admin, Primary and Co-Teachers, and enrolled
 * students with current access. A Substitute reads only their own sessions (listSessionChat).
 */
export async function listClassChatHistory(db: PrismaClient, actor: Actor, classId: unknown, options: SessionOptions = {}) {
  const cls = await loadClassContext(db, classId);
  const access = await enrollmentAccess(db, cls.id, actor.profileId, options.now ?? new Date());
  if (!canViewClassAsStaff(actor, cls) && !studentHasClassAccess(actor, cls, access)) throw new AuthorizationError();
  return db.liveChatMessage.findMany({
    where: { classId: cls.id },
    select: { ...chatSelect, sessionId: true, session: { select: { scheduledStartAt: true, title: true } } },
    orderBy: { createdAt: "asc" },
    take: 1000,
  });
}

// --- The provider-neutral Live Class shell view (A130) -----------------------------------------

/**
 * Everything the Live Class shell renders for this viewer. Staff see the participant list and
 * controls; a student sees their own state only. No raw timestamps for anyone but staff.
 */
export async function getLiveSessionView(db: PrismaClient, actor: Actor, sessionId: unknown, options: SessionOptions = {}) {
  const now = options.now ?? new Date();
  const { session, ctx } = await loadSessionContext(db, sessionId);
  const access = await enrollmentAccess(db, session.classId, actor.profileId, now);
  const role = liveParticipantRole(actor, ctx, access);
  if (!role) {
    if (hasActiveRole(actor, ctx.tenantId, "STUDENT") && access !== null && access !== "ENDED") throw new DomainError("access_inactive");
    throw new AuthorizationError();
  }
  const relation = classRelation(actor, ctx);
  const operator = canOperateParticipants(actor, ctx);
  const [me, participants, recording, chat] = await Promise.all([
    db.liveSessionParticipant.findUnique({
      where: { sessionId_profileId: { sessionId: session.id, profileId: actor.profileId } },
      select: {
        id: true,
        role: true,
        admission: true,
        handRaisedAt: true,
        micGrantedAt: true,
        whiteboardGrantedAt: true,
        removedAt: true,
        connections: { where: { disconnectedAt: null }, select: { id: true, mode: true }, orderBy: { connectedAt: "asc" } },
      },
    }),
    operator
      ? db.liveSessionParticipant.findMany({
          where: { sessionId: session.id },
          select: {
            id: true,
            role: true,
            admission: true,
            handRaisedAt: true,
            micGrantedAt: true,
            whiteboardGrantedAt: true,
            removedAt: true,
            profile: { select: { displayName: true } },
            _count: { select: { connections: { where: { disconnectedAt: null } } } },
          },
          orderBy: { firstJoinedAt: "asc" },
        })
      : null,
    activeSessionRecording(db, session.id),
    canReadSessionChat(actor, ctx, access) ? db.liveChatMessage.findMany({ where: { sessionId: session.id }, select: chatSelect, orderBy: { createdAt: "asc" }, take: 500 }) : [],
  ]);
  const myAudio = recording && role === "STUDENT"
    ? await db.recordingParticipant.findUnique({ where: { recordingId_studentProfileId: { recordingId: recording.id, studentProfileId: actor.profileId } }, select: { audioIncluded: true, excludedAt: true } })
    : null;
  const teacherNames = await db.profile.findMany({
    where: { id: { in: [...ctx.teachers.map((t) => t.teacherProfileId), ...(session.substituteProfileId ? [session.substituteProfileId] : [])] } },
    select: { id: true, displayName: true },
  });
  const nameOf = (id: string) => teacherNames.find((t) => t.id === id)?.displayName ?? null;
  const occupied = participants
    ? participants.filter((p) => p.role === "STUDENT" && p.admission === "ADMITTED" && !p.removedAt && p._count.connections > 0).length
    : null;
  return {
    session: {
      id: session.id,
      classId: session.classId,
      tenantId: session.tenantId,
      className: session.class.name,
      title: session.title,
      kind: session.kind,
      status: session.status,
      scheduledStartAt: session.scheduledStartAt,
      scheduledEndAt: session.scheduledEndAt,
      recordingEnabled: session.recordingEnabled,
      timezone: session.class.tenant.timezone,
      waitingRoomOpen: session.status === "SCHEDULED" && now >= waitingRoomOpensAt(session.scheduledStartAt) && now < safetyCloseAt(session.scheduledEndAt),
      startOpen: session.status === "SCHEDULED" && now >= startAllowedFrom(session.scheduledStartAt) && now < safetyCloseAt(session.scheduledEndAt),
      liveCapacity: liveCapacityOf(session),
    },
    role,
    relation,
    can: {
      startOrEnd: canStartOrEndSession(actor, ctx),
      cancel: canCancelSession(actor, ctx) && session.status === "SCHEDULED",
      assignSubstitute: canAssignSubstitute(actor, ctx),
      operate: operator,
      controlMic: canControlMic(actor, ctx),
      controlWhiteboard: canControlWhiteboard(actor, ctx),
      authorWhiteboard: canAuthorWhiteboard(actor, ctx),
      screenShare: canScreenShare(actor, ctx),
      readAttendance: canReadSessionAttendance(actor, ctx),
    },
    teachers: [
      ...ctx.teachers.map((t) => ({ role: t.role, name: nameOf(t.teacherProfileId) })),
      ...(session.substituteProfileId ? [{ role: "SUBSTITUTE" as const, name: nameOf(session.substituteProfileId) }] : []),
    ],
    me,
    participants,
    occupiedSlots: occupied,
    recording: recording ? { inProgress: true, myAudioIncluded: myAudio ? myAudio.audioIncluded && !myAudio.excludedAt : null } : { inProgress: false, myAudioIncluded: null },
    chat,
  };
}
