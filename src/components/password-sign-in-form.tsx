"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/config";
import { signInWithPassword, type PasswordSignInState } from "@/server/actions/auth";

type Strings = {
  emailLabel: string;
  passwordLabel: string;
  submit: string;
  loading: string;
  errors: Record<NonNullable<PasswordSignInState["error"]>, string>;
};

/**
 * Email + password. The primary way in (owner decision 2026-11-22): it is the only route that
 * works without an SMTP provider, because nothing has to reach the person's inbox.
 *
 * A failure always reads the same whether the address is unknown or the password is wrong — the
 * server decides that, and this form only displays it.
 */
export function PasswordSignInForm({ locale, next, strings }: { locale: Locale; next: string; strings: Strings }) {
  const [state, action, pending] = useActionState(signInWithPassword, {} as PasswordSignInState);
  return (
    <form action={action} className="form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password-email">{strings.emailLabel}</label>
      <input id="password-email" name="email" type="email" autoComplete="email" inputMode="email" required dir="ltr" />
      <label htmlFor="password-password">{strings.passwordLabel}</label>
      <input id="password-password" name="password" type="password" autoComplete="current-password" required dir="ltr" />
      <button type="submit" className="button button-primary" disabled={pending} aria-busy={pending}>
        {pending ? strings.loading : strings.submit}
      </button>
      <p role="alert" className="message message-error">
        {state.error ? strings.errors[state.error] : null}
      </p>
    </form>
  );
}
