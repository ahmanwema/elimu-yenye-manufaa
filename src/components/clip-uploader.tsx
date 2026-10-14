"use client";

import { useState, type FormEvent } from "react";
import type { ResultCode } from "@/lib/action-result";
import { finalizeClipUploadAction, registerClipUploadAction } from "@/server/actions/media";

type Props = {
  correctionId: string;
  strings: { label: string; submit: string; done: string; failed: string; loading: string; results: Record<ResultCode, string> };
};

/**
 * Teacher uploads a short correction clip: the server registers it (consent is checked
 * there), the file goes straight to private storage through a one-time signed URL, then the
 * server inspects the STORED bytes (AAC in M4A, ≤ 60 s) and finalizes it.
 */
export function ClipUploader({ correctionId, strings }: Props) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = (event.currentTarget.elements.namedItem("clip") as HTMLInputElement).files?.[0];
    if (!file) return;
    setPending(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("correctionId", correctionId);
      form.set("mimeType", file.type || "audio/mp4");
      const registered = await registerClipUploadAction({ status: "idle" }, form);
      if (registered.status !== "ok" || !registered.data) {
        setMessage({ text: registered.status === "error" ? strings.results[registered.code] : strings.failed, error: true });
        return;
      }
      const put = await fetch(registered.data.uploadUrl, { method: "PUT", headers: { "content-type": "audio/mp4" }, body: file });
      if (!put.ok) {
        setMessage({ text: strings.failed, error: true });
        return;
      }
      const done = new FormData();
      done.set("clipId", registered.data.clipId);
      const finalized = await finalizeClipUploadAction({ status: "idle" }, done);
      setMessage(
        finalized.status === "ok"
          ? { text: strings.done, error: false }
          : { text: finalized.status === "error" ? strings.results[finalized.code] : strings.failed, error: true },
      );
    } catch {
      setMessage({ text: strings.failed, error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="form form-inline">
      <label htmlFor={`clip-${correctionId}`}>{strings.label}</label>
      <input id={`clip-${correctionId}`} name="clip" type="file" accept="audio/mp4,audio/x-m4a,.m4a" required />
      <button type="submit" className="button button-secondary" disabled={pending} aria-busy={pending}>
        {pending ? strings.loading : strings.submit}
      </button>
      <p role="status" aria-live="polite" className={message?.error ? "message message-error" : "message"}>
        {message?.text}
      </p>
    </form>
  );
}
