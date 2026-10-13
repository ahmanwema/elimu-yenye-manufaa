// Agora adapter for the pilot. Same interface as providers/livekit.js.
// "live" mode: teacher = host; students = audience (low-latency level 1) until granted.
import AgoraRTC from "agora-rtc-sdk-ng";
import { log } from "../telemetry.js";

export async function connectAgora(join, { onRemoteAudio }) {
  const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
  const tJoin = performance.now();
  let firstAudio = false;
  let reconnectStart = null;
  let mic = null;
  const names = new Map(); // uid → identity is not known to Agora; the pilot shows uids

  client.on("connection-state-change", (cur, prev, reason) => {
    log("connection_state", { state: cur, prev, reason });
    if (cur === "RECONNECTING") reconnectStart = performance.now();
    if (cur === "CONNECTED" && prev === "RECONNECTING") {
      log("reconnected", { ms: reconnectStart ? Math.round(performance.now() - reconnectStart) : null });
      reconnectStart = null;
    }
  });
  client.on("user-joined", (u) => log("participant_joined", { uid: u.uid }));
  client.on("user-left", (u, reason) => log("participant_left", { uid: u.uid, reason }));
  client.on("network-quality", (q) => log("connection_quality", { up: q.uplinkNetworkQuality, down: q.downlinkNetworkQuality }));
  client.on("exception", (e) => log("sdk_exception", { code: e.code, msg: e.msg }));
  client.on("token-privilege-will-expire", () => log("token_will_expire"));
  client.on("user-published", async (user, mediaType) => {
    if (mediaType !== "audio") return;
    await client.subscribe(user, "audio");
    user.audioTrack?.play();
    onRemoteAudio(String(user.uid), null);
    if (!firstAudio) {
      firstAudio = true;
      log("first_remote_audio", { ms: Math.round(performance.now() - tJoin), from: user.uid });
    }
  });
  client.on("user-unpublished", (user, mediaType) => {
    if (mediaType === "audio") log("remote_audio_ended", { from: user.uid });
  });

  await client.setClientRole(join.role === "teacher" ? "host" : "audience", join.role === "teacher" ? undefined : { level: 1 });
  try {
    await client.join(join.appId, join.room, join.token, join.uid);
  } catch (e) {
    log("join_failed", { error: String(e?.message ?? e), code: e?.code });
    throw e;
  }
  log("joined", { ms: Math.round(performance.now() - tJoin), uid: join.uid });

  return {
    provider: "agora",
    /**
     * Granting on Agora is CLIENT-COOPERATIVE: the client switches to host with a publisher
     * token. Revoking relies on the client unpublishing. `ignoreRevoke` simulates a modified
     * client to test whether the platform enforces anything server-side.
     */
    async setMic(on, publisherToken) {
      try {
        if (on) {
          if (publisherToken) await client.renewToken(publisherToken);
          await client.setClientRole("host");
          mic = mic ?? (await AgoraRTC.createMicrophoneAudioTrack());
          await client.publish([mic]);
        } else if (mic) {
          await client.unpublish([mic]);
          mic.close();
          mic = null;
          await client.setClientRole("audience", { level: 1 });
        }
        log("mic_set", { on });
      } catch (e) {
        log("mic_error", { on, error: String(e?.message ?? e), code: e?.code });
      }
    },
    /** Agora Web SDK 4.x documents no send API for data streams → not available here. */
    sendData: null,
    participants: () => client.remoteUsers.map((u) => String(names.get(u.uid) ?? u.uid)),
    connected: () => client.connectionState === "CONNECTED",
    async stats() {
      const rtc = client.getRTCStats();
      const remote = client.getRemoteAudioStats();
      return {
        rttMs: rtc.RTT ?? null,
        sendKbps: rtc.SendBitrate != null ? Math.round(rtc.SendBitrate / 1000) : null,
        recvKbps: rtc.RecvBitrate != null ? Math.round(rtc.RecvBitrate / 1000) : null,
        inbound: Object.entries(remote).map(([uid, s]) => ({
          from: uid,
          end2EndDelayMs: s.end2EndDelay ?? null,
          transportDelayMs: s.transportDelay ?? null,
          packetLossRate: s.packetLossRate ?? null,
          freezeRate: s.freezeRate ?? null,
          receiveKbps: s.receiveBitrate != null ? Math.round(s.receiveBitrate / 1000) : null,
        })),
      };
    },
    async leave() {
      mic?.close();
      await client.leave();
    },
  };
}
