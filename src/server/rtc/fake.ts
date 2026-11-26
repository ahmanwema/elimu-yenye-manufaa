import { AUDIO_TOKEN_TTL_SECONDS, identityForConnection, roomNameForSession, type AudioGrant, type RtcProvider } from "./rtc";

export type FakeRtcCall =
  | { op: "token"; room: string; identity: string; grant: AudioGrant }
  | { op: "setPublish"; room: string; identity: string; grant: AudioGrant }
  | { op: "remove"; room: string; identity: string }
  | { op: "close"; room: string };

/**
 * In-memory RtcProvider for tests: records every call and tracks who is "in" each room, so
 * setPublish reports false for an identity that never joined (like the real media server).
 */
export function createFakeRtcProvider() {
  const calls: FakeRtcCall[] = [];
  const present = new Map<string, Set<string>>();

  const provider: RtcProvider & {
    calls: FakeRtcCall[];
    /** Simulates a device actually connecting to the room with its token. */
    connect(room: string, identity: string): void;
    inRoom(room: string): string[];
  } = {
    calls,
    connect(room, identity) {
      if (!present.has(room)) present.set(room, new Set());
      present.get(room)!.add(identity);
    },
    inRoom(room) {
      return [...(present.get(room) ?? [])];
    },
    async issueAudioToken({ sessionId, connectionId, grant }) {
      const room = roomNameForSession(sessionId);
      const identity = identityForConnection(connectionId);
      calls.push({ op: "token", room, identity, grant });
      return { url: "wss://fake.livekit.test", token: `fake.${identity}`, expiresInSeconds: AUDIO_TOKEN_TTL_SECONDS };
    },
    async setPublish(room, identity, grant) {
      calls.push({ op: "setPublish", room, identity, grant });
      return present.get(room)?.has(identity) ?? false;
    },
    async removeFromRoom(room, identity) {
      calls.push({ op: "remove", room, identity });
      present.get(room)?.delete(identity);
    },
    async closeRoom(room) {
      calls.push({ op: "close", room });
      present.delete(room);
    },
  };
  return provider;
}
