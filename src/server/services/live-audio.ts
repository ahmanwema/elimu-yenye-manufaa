import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Actor } from "@/server/authz/policy";
import { AuthorizationError } from "@/server/authz/policy";
import { audioGrantFor, identityForConnection, roomNameForSession, type AudioGrant, type RtcProvider } from "@/server/rtc/rtc";
import { DomainError } from "./errors";
import { getMyDeviceCapabilities, type SessionOptions } from "./live-sessions";

/**
 * Live Class audio (media plan M1, A154). The live-session services decide; this module makes the
 * media server agree. It never grants anything the database has not already granted.
 *
 * - `issueAudioToken`: a join token for the caller's OWN device connection, with the microphone
 *   open only if that device may publish right now (getMyDeviceCapabilities, fail closed).
 * - `syncSessionAudio`: after a mic grant / revoke / handoff, a removal, a leave or an end, pushes
 *   the current state to the room. Withdrawing the mic is enforced by the media server
 *   (canPublish → false unpublishes the track); if that call fails, the device is disconnected
 *   instead, so a revoked student can never keep talking because of a vendor error.
 */

const TEACHING_ROLES = new Set(["PRIMARY_TEACHER", "CO_TEACHER", "SUBSTITUTE_TEACHER"]);

export async function issueAudioToken(db: PrismaClient, actor: Actor, rtc: RtcProvider, input: unknown, options: SessionOptions = {}) {
  const parsed = z.object({ connectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { connectionId } = parsed.data;
  // Authorizes: the connection must be the caller's own, and the caller must still belong here.
  const caps = await getMyDeviceCapabilities(db, actor, { connectionId }, options);
  const grant = audioGrantFor(caps);
  if (!grant) throw new DomainError("invalid_state");
  const conn = await db.liveSessionConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { sessionId: true, participant: { select: { profile: { select: { displayName: true } } } } },
  });
  const issued = await rtc.issueAudioToken({
    sessionId: conn.sessionId,
    connectionId,
    displayName: conn.participant.profile.displayName ?? "",
    grant,
  });
  return { ...issued, canPublishMicrophone: grant.canPublishMicrophone };
}

/** Pure: what one open connection may publish, from the stored participant state. */
export function storedAudioGrant(p: {
  sessionLive: boolean;
  role: string;
  mode: "PRIMARY" | "VIEW_ONLY";
  removed: boolean;
  admission: "ADMITTED" | "WAITING_FOR_SLOT" | null;
  micGranted: boolean;
}): AudioGrant {
  const primary = p.sessionLive && !p.removed && p.mode === "PRIMARY";
  if (p.role === "STUDENT") return { canPublishMicrophone: primary && p.admission === "ADMITTED" && p.micGranted };
  return { canPublishMicrophone: primary && TEACHING_ROLES.has(p.role) };
}

export class AudioSyncError extends Error {}

/**
 * Brings the audio room in line with the database for one session. Safe to call repeatedly.
 * `leftConnectionIds`: connections that just closed (leave), to be dropped from the room.
 */
export async function syncSessionAudio(db: PrismaClient, rtc: RtcProvider, sessionId: string, leftConnectionIds: string[] = []) {
  const room = roomNameForSession(sessionId);
  const session = await db.liveSession.findUnique({ where: { id: sessionId }, select: { status: true } });
  if (!session) return;
  if (session.status !== "LIVE") {
    await rtc.closeRoom(room);
    return;
  }
  const participants = await db.liveSessionParticipant.findMany({
    where: { sessionId },
    select: {
      role: true,
      admission: true,
      removedAt: true,
      micGrantedAt: true,
      connections: { select: { id: true, mode: true, disconnectedAt: true } },
    },
  });

  const failures: unknown[] = [];
  const drop = async (connectionId: string) => {
    try {
      await rtc.removeFromRoom(room, identityForConnection(connectionId));
    } catch (error) {
      failures.push(error);
    }
  };
  const tasks: Promise<void>[] = leftConnectionIds.map(drop);

  for (const p of participants) {
    for (const c of p.connections) {
      if (p.removedAt) {
        // Removal closed these connections; make sure none of them is still in the room.
        if (c.disconnectedAt === null || c.disconnectedAt >= p.removedAt) tasks.push(drop(c.id));
        continue;
      }
      if (c.disconnectedAt !== null) continue;
      const grant = storedAudioGrant({
        sessionLive: true,
        role: p.role,
        mode: c.mode,
        removed: false,
        admission: p.admission,
        micGranted: p.micGrantedAt !== null,
      });
      tasks.push(
        (async () => {
          try {
            await rtc.setPublish(room, identityForConnection(c.id), grant);
          } catch (error) {
            // Fail closed: a device whose permission could not be updated is disconnected; it
            // reconnects with a fresh token that carries the current grant.
            if (!grant.canPublishMicrophone) await drop(c.id);
            else failures.push(error);
          }
        })(),
      );
    }
  }
  await Promise.all(tasks);
  if (failures.length) {
    console.error("[live-audio] sync failed", failures);
    throw new AudioSyncError("audio sync failed");
  }
}

/** Session of a participant row, for actions that only receive the participant id. */
export async function sessionIdOfParticipant(db: PrismaClient, participantId: unknown): Promise<string | null> {
  const parsed = z.uuid().safeParse(participantId);
  if (!parsed.success) return null;
  const p = await db.liveSessionParticipant.findUnique({ where: { id: parsed.data }, select: { sessionId: true } });
  return p?.sessionId ?? null;
}

/** Session of a connection that belongs to the actor (leave), or null. */
export async function sessionIdOfOwnConnection(db: PrismaClient, actor: Actor, connectionId: unknown): Promise<string | null> {
  const parsed = z.uuid().safeParse(connectionId);
  if (!parsed.success) return null;
  const c = await db.liveSessionConnection.findUnique({
    where: { id: parsed.data },
    select: { sessionId: true, participant: { select: { profileId: true } } },
  });
  if (!c) return null;
  if (c.participant.profileId !== actor.profileId) throw new AuthorizationError();
  return c.sessionId;
}
