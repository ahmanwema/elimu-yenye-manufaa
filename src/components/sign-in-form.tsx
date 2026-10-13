"use client";

import { useActionState } from "react";
import { requestSignInCode, verifySignInCode, type SignInState } from "@/server/actions/auth";
import type { Dictionary } from "@/i18n/dictionaries";
import { format } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";

type Strings = Dictionary["auth"] & { loading: string };

/** Two steps: request a code (and magic link) by email, then enter the code. */
export function SignInForm({ locale, next, strings }: { locale: Locale; next: string; strings: Strings }) {
  const [requestState, requestAction, requesting] = useActionState(requestSignInCode, { step: "email" } as SignInState);
  const [verifyState, verifyAction, verifying] = useActionState(verifySignInCode, { step: "email" } as SignInState);

  const codeStep = verifyState.step === "code" ? verifyState : requestState.step === "code" ? requestState : null;

  if (!codeStep) {
    const error = requestState.step === "email" ? requestState.error : undefined;
    return (
      <form action={requestAction} className="form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={next} />
        <label htmlFor="email">{strings.emailLabel}</label>
        <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required dir="ltr" />
        <button type="submit" className="button button-primary" disabled={requesting} aria-busy={requesting}>
          {requesting ? strings.loading : strings.sendCode}
        </button>
        <p role="alert" className="message message-error">
          {error ? strings.errors[error] : null}
        </p>
        <p className="muted">{strings.noAccountHint}</p>
      </form>
    );
  }

  const error = verifyState.step === "code" ? verifyState.error : requestState.step === "code" ? requestState.error : undefined;
  return (
    <div>
      <h2>{strings.sentTitle}</h2>
      <p>{format(strings.sentBody, { email: codeStep.email })}</p>
      <form action={verifyAction} className="form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="email" value={codeStep.email} />
        <label htmlFor="code">{strings.codeLabel}</label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6,10}"
          required
          dir="ltr"
        />
        <p className="muted">{strings.codeHint}</p>
        <button type="submit" className="button button-primary" disabled={verifying} aria-busy={verifying}>
          {verifying ? strings.loading : strings.verify}
        </button>
        <p role="alert" className="message message-error">
          {error ? strings.errors[error] : null}
        </p>
      </form>
      <a href={`/${locale}/sign-in`}>{strings.useDifferentEmail}</a>
    </div>
  );
}
