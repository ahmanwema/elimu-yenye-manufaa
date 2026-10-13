"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult, ResultCode } from "@/lib/action-result";

type Props = {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  /** Hidden and visible fields. Identifiers here are hints only — the server re-authorizes. */
  children?: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  messages: Record<ResultCode, string>;
  variant?: "primary" | "secondary";
  inline?: boolean;
};

/** A form bound to a server action, with pending state and a translated outcome message. */
export function ActionForm({ action, children, submitLabel, pendingLabel, messages, variant = "primary", inline }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } as ActionResult);
  const message =
    state.status === "ok" ? messages.done : state.status === "error" ? messages[state.code] : null;

  return (
    <form action={formAction} className={inline ? "form form-inline" : "form"}>
      {children}
      <button type="submit" className={`button button-${variant}`} disabled={pending} aria-busy={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
      <p role="status" aria-live="polite" className={state.status === "error" ? "message message-error" : "message"}>
        {message}
      </p>
    </form>
  );
}
