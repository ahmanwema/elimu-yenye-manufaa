"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, type LocalParticipant, type Participant, type RemoteParticipant } from "livekit-client";
import type { Dictionary } from "@/i18n/dictionaries";
import { format } from "@/i18n/dictionaries";
import { audioTokenAction } from "@/server/actions/live-class";

type Labels = Dictionary["live"]["audio"];
type Status = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

/**
 * Class audio for THIS device's connection (media plan M1). The server decides everything: the
 * token says whether the microphone may be published, and the media server enforces later
 * changes (a revoked student is unpublished by LiveKit itself). This component only shows the
 * state and lets a permitted speaker mute or unmute.
 *
 * "Join audio" is a deliberate click: browsers only play sound after a user gesture.
 */
export function LiveAudio({ connectionId, viewOnly, labels, resultMessages }: { connectionId: string; viewOnly: boolean; labels: Labels; resultMessages: Record<string, string> }) {
  const router = useRouter();
  const roomRef = useRef<Room | null>(null);
  const sinkRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [soundBlocked, setSoundBlocked] = useState(false);

  const disconnect = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
  }, []);

  useEffect(() => disconnect, [disconnect]);

  async function join() {
    setStatus("connecting");
    setMessage(null);
    const result = await audioTokenAction(connectionId);
    if (result.status !== "ok" || !result.data) {
      setStatus("idle");
      setMessage(result.status === "error" ? (resultMessages[result.code] ?? labels.failed) : labels.failed);
      return;
    }
    const room = new Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    roomRef.current = room;

    room
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        sinkRef.current?.appendChild(track.attach());
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
      .on(RoomEvent.ActiveSpeakersChanged, (active: Participant[]) => setSpeakers(active.map((p) => p.name || "—")))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setSoundBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Connected) setStatus("connected");
        else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) setStatus("reconnecting");
      })
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant: RemoteParticipant | LocalParticipant) => {
        if (participant !== room.localParticipant) return;
        const allowed = participant.permissions?.canPublish ?? false;
        setCanPublish(allowed);
        if (!allowed) setMicOn(false);
        router.refresh(); // the page shows the matching business state (mic badge, hand)
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        roomRef.current = null;
        setStatus("closed");
        setMicOn(false);
        setSpeakers([]);
        if (reason === DisconnectReason.PARTICIPANT_REMOVED) setMessage(labels.removed);
        else if (reason === DisconnectReason.ROOM_DELETED) setMessage(labels.ended);
        else if (reason === DisconnectReason.DUPLICATE_IDENTITY) setMessage(labels.otherDevice);
        else if (reason !== DisconnectReason.CLIENT_INITIATED) setMessage(labels.failed);
        router.refresh();
      });

    try {
      await room.connect(result.data.url, result.data.token);
      await room.startAudio();
      setSoundBlocked(!room.canPlaybackAudio);
      setCanPublish(room.localParticipant.permissions?.canPublish ?? result.data.canPublishMicrophone);
      setStatus("connected");
    } catch {
      roomRef.current = null;
      setStatus("idle");
      setMessage(labels.failed);
    }
  }

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!micOn);
      setMicOn(!micOn);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === "NotAllowedError" ? labels.micDenied : labels.failed);
    }
  }

  const live = status === "connected" || status === "reconnecting";

  return (
    <div className="live-audio">
      <div ref={sinkRef} hidden />
      {live ? (
        <>
          <p className={status === "reconnecting" ? "chip chip-warning" : "chip chip-success"} role="status">
            {status === "reconnecting" ? labels.reconnecting : labels.connected}
          </p>
          <p className="muted" aria-live="polite">
            {speakers.length ? format(labels.speaking, { names: speakers.join(", ") }) : labels.nobodySpeaking}
          </p>
          <p className="muted">{viewOnly ? labels.viewOnly : canPublish ? labels.canSpeak : labels.listenOnly}</p>
          <div className="row">
            {canPublish ? (
              <button type="button" className={micOn ? "button button-primary" : "button button-secondary"} aria-pressed={micOn} onClick={toggleMic}>
                {micOn ? labels.micOn : labels.micOff}
              </button>
            ) : null}
            {soundBlocked ? (
              <button type="button" className="button button-primary" onClick={() => roomRef.current?.startAudio().then(() => setSoundBlocked(false))}>
                {labels.enableSound}
              </button>
            ) : null}
            <button type="button" className="button button-secondary" onClick={disconnect}>
              {labels.leave}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="button button-primary" onClick={join} disabled={status === "connecting"}>
          {status === "connecting" ? labels.joining : labels.join}
        </button>
      )}
      {message ? (
        <p role="alert" className="muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}
