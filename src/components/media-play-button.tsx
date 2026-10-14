"use client";

import { useState } from "react";
import type { ResultCode } from "@/lib/action-result";
import { clipPlaybackAction, recordingPlaybackAction } from "@/server/actions/media";

type Props =
  | { kind: "clip"; id: string; label: string; loading: string; results: Record<ResultCode, string> }
  | { kind: "recording"; id: string; segmentId?: string; label: string; loading: string; results: Record<ResultCode, string> };

/**
 * Asks the server for a fresh, short-lived signed URL (the server authorizes — and audits a
 * Super Admin — first), then plays it. The URL is never stored or logged.
 */
export function MediaPlayButton(props: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function play() {
    setPending(true);
    setError(null);
    const form = new FormData();
    if (props.kind === "clip") form.set("clipId", props.id);
    else {
      form.set("recordingId", props.id);
      if (props.segmentId) form.set("segmentId", props.segmentId);
    }
    const result = props.kind === "clip" ? await clipPlaybackAction({ status: "idle" }, form) : await recordingPlaybackAction({ status: "idle" }, form);
    setPending(false);
    if (result.status === "ok" && result.data) setSrc(result.data.url);
    else setError(result.status === "error" ? props.results[result.code] : props.results.error);
  }

  return (
    <span className="row">
      {src ? (
        <audio controls autoPlay src={src} />
      ) : (
        <button type="button" className="button button-secondary" onClick={play} disabled={pending} aria-busy={pending}>
          {pending ? props.loading : props.label}
        </button>
      )}
      {error ? (
        <span role="alert" className="message message-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
