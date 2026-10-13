"use client";

import { useActionState } from "react";
import { sendInviteCode, verifyInviteCode, type InviteSignInState } from "@/server/actions/invitations";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/dictionaries";

type Strings = {
  sendCode: string;
  sentBody: string;
  codeLabel: string;
  codeHint: string;
  verify: string;
  loading: string;
  errors: Record<"invalid" | "expired" | "rate_limited" | "unavailable" | "invalid_code", string>;
};

/** Sends the sign-in code to the INVITED address (chosen by the server from the token). */
export function InviteSignIn({
  locale,
  token,
  maskedEmail,
  strings,
}: {
  locale: Locale;
  token: string;
  maskedEmail: string;
  strings: Strings;
}) {
  const [sendState, sendAction, sending] = useActionState(sendInviteCode, { step: "send" } as InviteSignInState);
  const [verifyState, verifyAction, verifying] = useActionState(verifyInviteCode, { step: "send" } as InviteSignInState);
  const onCodeStep = sendState.step === "code" || verifyState.step === "code";

  if (!onCodeStep) {
    return (
      <form action={sendAction} className="form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="button button-primary" disabled={sending} aria-busy={sending}>
          {sending ? strings.loading : strings.sendCode}
        </button>
        <p role="alert" className="message message-error">
          {sendState.error ? strings.errors[sendState.error] : null}
        </p>
      </form>
    );
  }

  const error = verifyState.step === "code" ? verifyState.error : sendState.step === "code" ? sendState.error : undefined;
  return (
    <form action={verifyAction} className="form">
      <p>{format(strings.sentBody, { email: maskedEmail })}</p>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <label htmlFor="code">{strings.codeLabel}</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required dir="ltr" />
      <p className="muted">{strings.codeHint}</p>
      <button type="submit" className="button button-primary" disabled={verifying} aria-busy={verifying}>
        {verifying ? strings.loading : strings.verify}
      </button>
      <p role="alert" className="message message-error">
        {error ? strings.errors[error] : null}
      </p>
    </form>
  );
}
