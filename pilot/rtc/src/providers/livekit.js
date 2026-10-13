// LiveKit adapter for the pilot. Same interface as providers/agora.js.
import { ConnectionState, Room, RoomEvent, Track } from "livekit-client";
import { log } from "../telemetry.js";

export async function connectLiveKit(join, { onRemoteAudio, onData }) {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const tJoin = performance.now();
  let firstAudio = false;
  let reconnectStart = null;
  let wantMic = false; // desired state; publishing follows the SERVER permission event

  room
    .on(RoomEvent.ConnectionStateChanged, (s) => log("connection_state", { state: s }))
    .on(RoomEvent.Reconnecting, () => {
      reconnectStart = performance.now();
      log("reconnecting");
    })
    .on(RoomEvent.Reconnected, () => {
      log("reconnected", { ms: reconnectStart ? Math.round(performance.now() - reconnectStart) : null });
      reconnectStart = null;
    })
    .on(RoomEvent.Disconnected, (reason) => log("disconnected", { reason }))
    .on(RoomEvent.ParticipantConnected, (p) => log("participant_joined", { identity: p.identity }))
    .on(RoomEvent.ParticipantDisconnected, (p) => log("participant_left", { identity: p.identity }))
    .on(RoomEvent.ConnectionQualityChanged, (q, p) => log("connection_quality", { identity: p.identity, quality: q }))
    .on(RoomEvent.ParticipantPermissionsChanged, async (_prev, p) => {
      if (!p.isLocal) return;
      log("permissions_changed", { canPublish: p.permissions?.canPublish });
      // Integration lesson from the pilot: the app-level "granted" signal can arrive before
      // LiveKit's permission update, so publish when the permission event arrives.
      if (p.permissions?.canPublish && wantMic && !room.localParticipant.isMicrophoneEnabled) {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          log("mic_set", { on: true, via: "permission_event" });
        } catch (e) {
          log("mic_error", { on: true, error: String(e?.message ?? e) });
        }
      }
    })
    .on(RoomEvent.LocalTrackUnpublished, (pub) => log("local_track_unpublished", { source: pub.source }))
    .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      onRemoteAudio(participant.identity, el);
      if (!firstAudio) {
        firstAudio = true;
        log("first_remote_audio", { ms: Math.round(performance.now() - tJoin), from: participant.identity });
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      track.detach().forEach((el) => el.remove());
      log("remote_audio_ended", { from: participant.identity });
    })
    .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic === "wb") onData(payload, participant?.identity);
    });

  try {
    await room.connect(join.url, join.token);
  } catch (e) {
    log("join_failed", { error: String(e?.message ?? e) });
    throw e;
  }
  log("joined", { ms: Math.round(performance.now() - tJoin) });

  return {
    provider: "livekit",
    async setMic(on) {
      wantMic = on;
      try {
        await room.localParticipant.setMicrophoneEnabled(on);
        log("mic_set", { on });
      } catch (e) {
        log("mic_error", { on, error: String(e?.message ?? e) });
      }
    },
    /** Reliable, ordered (best effort) data packet on topic "wb". */
    sendData(bytes) {
      return room.localParticipant.publishData(bytes, { reliable: true, topic: "wb" });
    },
    participants: () => [...room.remoteParticipants.values()].map((p) => p.identity),
    connected: () => room.state === ConnectionState.Connected,
    async stats() {
      const out = { rttMs: null, inbound: [], outbound: null };
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.audioTrackPublications.values()) {
          const report = await pub.track?.getRTCStatsReport?.();
          report?.forEach((s) => {
            if (s.type === "inbound-rtp" && s.kind === "audio") {
              out.inbound.push({
                from: p.identity,
                packetsLost: s.packetsLost,
                packetsReceived: s.packetsReceived,
                jitterMs: s.jitter != null ? Math.round(s.jitter * 1000) : null,
                bytesReceived: s.bytesReceived,
                concealedSamples: s.concealedSamples ?? null,
                totalSamplesReceived: s.totalSamplesReceived ?? null,
              });
            }
            if (s.type === "candidate-pair" && s.nominated && s.currentRoundTripTime != null) {
              out.rttMs = Math.round(s.currentRoundTripTime * 1000);
            }
          });
        }
      }
      const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      const sendReport = await mic?.getRTCStatsReport?.();
      sendReport?.forEach((s) => {
        if (s.type === "outbound-rtp") out.outbound = { bytesSent: s.bytesSent, packetsSent: s.packetsSent };
        if (s.type === "candidate-pair" && s.nominated && s.currentRoundTripTime != null) {
          out.rttMs = Math.round(s.currentRoundTripTime * 1000);
        }
      });
      return out;
    },
    async leave() {
      await room.disconnect();
    },
  };
}
