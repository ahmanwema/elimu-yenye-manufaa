import type { DeviceCapabilities } from "@/server/services/live-sessions";

/**
 * Vendor-neutral real-time audio contract (A154, docs/features/live-class-media-plan.md §1–§2.1).
 *
 * The database and the services in src/server/services/live-sessions.ts decide every permission;
 * an RtcProvider only turns that decision into what the media server enforces. Application code
 * depends on this interface, never on a vendor SDK, so the provider can be swapped or self-hosted
 * by changing one module (./livekit.ts).
 *
 * Rules:
 * - One room per live session; the name is derived from the session id only (no tenant, class or
 *   person identifiers leak into the vendor).
 * - One identity per DEVICE CONNECTION (A121): a VIEW_ONLY device has its own identity and never
 *   holds publish rights, and the media server's view of presence lines up with our connections.
 * - Audio only in this phase: the microphone is the only source that can ever be published, and
 *   data publishing is off (the whiteboard uses Supabase Realtime, §2.2).
 * - Calls are made only AFTER the authorizing database transaction has committed.
 */
export interface RtcProvider {
  /** Short-lived join token for one device connection. */
  issueAudioToken(input: AudioTokenRequest): Promise<{ url: string; token: string; expiresInSeconds: number }>;
  /**
   * Changes what an identity already in the room may publish. Returns false when the identity is not
   * in the room (nothing to change: it gets the right grant from its next token).
   */
  setPublish(room: string, identity: string, grant: AudioGrant): Promise<boolean>;
  /** Disconnects one identity. Missing identity or room is not an error. */
  removeFromRoom(room: string, identity: string): Promise<void>;
  /** Closes the room for everyone. A missing room is not an error. */
  closeRoom(room: string): Promise<void>;
}

export type AudioTokenRequest = {
  sessionId: string;
  connectionId: string;
  /** Shown to other participants; never an email or phone number. */
  displayName: string;
  grant: AudioGrant;
};

/** What one device may do in the audio room. Subscribing is the only thing every device can do. */
export type AudioGrant = { canPublishMicrophone: boolean };

/** Engineering default (not a business rule): the media server refreshes it while connected. */
export const AUDIO_TOKEN_TTL_SECONDS = 600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Room for a live session. Derived only from the session id. */
export function roomNameForSession(sessionId: string): string {
  if (!UUID.test(sessionId)) throw new Error("rtc: invalid session id");
  return `lc_${sessionId.toLowerCase()}`;
}

/** Reverse of roomNameForSession, for webhooks: null for any room this app did not create. */
export function sessionIdFromRoomName(room: string): string | null {
  const m = /^lc_([0-9a-f-]{36})$/.exec(room);
  return m && UUID.test(m[1]) ? m[1] : null;
}

/** The identity of one device connection. */
export function identityForConnection(connectionId: string): string {
  if (!UUID.test(connectionId)) throw new Error("rtc: invalid connection id");
  return connectionId.toLowerCase();
}

/**
 * The audio grant for a device, from the capabilities the server computed for it. Fails closed:
 * a device that is not live gets no token at all, and only `publishMic` opens the microphone.
 */
export function audioGrantFor(caps: DeviceCapabilities): AudioGrant | null {
  if (!caps.live || !caps.admitted) return null;
  return { canPublishMicrophone: caps.publishMic && !caps.viewOnly };
}
