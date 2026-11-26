import "server-only";
import { AccessToken, RoomServiceClient, ServerError, TrackSource, type VideoGrant } from "livekit-server-sdk";
import { getLiveKitEnv, type LiveKitEnv } from "@/env";
import { AUDIO_TOKEN_TTL_SECONDS, identityForConnection, roomNameForSession, type AudioGrant, type RtcProvider } from "./rtc";

/**
 * LiveKit Cloud implementation of RtcProvider (A154). Server-only: it holds the API secret.
 * Verified against the official SDK types (livekit-server-sdk 2.19.1):
 * - `canPublishSources` supersedes `canPublish`; we set both so a device without the mic can
 *   publish nothing at all.
 * - Withdrawing `canPublish` makes LiveKit unpublish the participant's tracks (pilot §1).
 * - `UpdateParticipant` replaces permissions atomically, so every field is always sent.
 */
export function videoGrantFor(room: string, grant: AudioGrant): VideoGrant {
  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: grant.canPublishMicrophone,
    canPublishSources: grant.canPublishMicrophone ? [TrackSource.MICROPHONE] : [],
    canPublishData: false,
    canUpdateOwnMetadata: false,
  };
}

function permissionFor(grant: AudioGrant) {
  return {
    canSubscribe: true,
    canPublish: grant.canPublishMicrophone,
    canPublishSources: grant.canPublishMicrophone ? [TrackSource.MICROPHONE] : [],
    canPublishData: false,
    canUpdateMetadata: false,
  };
}

/** LiveKit answers "not_found" for an unknown room or identity; that is not an error for us. */
function isNotFound(error: unknown): boolean {
  return error instanceof ServerError && (error.code === "not_found" || error.status === 404);
}

export function createLiveKitProvider(env: LiveKitEnv = getLiveKitEnv()): RtcProvider {
  const httpUrl = env.LIVEKIT_URL.replace(/^ws/, "http");
  const rooms = new RoomServiceClient(httpUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

  return {
    async issueAudioToken({ sessionId, connectionId, displayName, grant }) {
      const room = roomNameForSession(sessionId);
      const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: identityForConnection(connectionId),
        name: displayName.slice(0, 80),
        ttl: AUDIO_TOKEN_TTL_SECONDS,
      });
      token.addGrant(videoGrantFor(room, grant));
      return { url: env.LIVEKIT_URL, token: await token.toJwt(), expiresInSeconds: AUDIO_TOKEN_TTL_SECONDS };
    },

    async setPublish(room, identity, grant) {
      try {
        await rooms.updateParticipant(room, identity, { permission: permissionFor(grant) });
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },

    async removeFromRoom(room, identity) {
      try {
        await rooms.removeParticipant(room, identity);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },

    async closeRoom(room) {
      try {
        await rooms.deleteRoom(room);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}
