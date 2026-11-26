"use client";

import { useActionState } from "react";
import { PasswordInput } from "@/components/password-input";
import type { Locale } from "@/i18n/config";
import { joinAsSignedInAction, registerWithJoinLinkAction, type JoinState } from "@/server/actions/join-links";

export type JoinStrings = {
  nameLabel: string;
  phoneLabel: string;
  genderLabel: string;
  genderMale: string;
  genderFemale: string;
  dobLabel: string;
  dobHint: string;
  emailLabel: string;
  emailHint: string;
  passwordLabel: string;
  passwordHint: string;
  passwordConfirmLabel: string;
  showPassword: string;
  hidePassword: string;
  submit: string;
  submitSignedIn: string;
  signedInAs: string;
  haveAccount: string;
  loading: string;
  errors: Record<NonNullable<JoinState["error"]>, string>;
};

/**
 * Registering through a shared link. One step: details, email and a password of their own.
 *
 * There is no emailed code, because nothing is emailed — the link is what authorizes this
 * (owner decision 2026-11-22). The password matters more than it looks: it is the only way the
 * person gets back in afterwards, since no mail can reach them.
 *
 * Someone already signed in sees a confirm form instead: their account is never touched and no
 * password is set, only the membership is added.
 */
export function JoinForm({
  locale,
  token,
  isStudent,
  signedInEmail,
  strings,
}: {
  locale: Locale;
  token: string;
  isStudent: boolean;
  signedInEmail: string | null;
  strings: JoinStrings;
}) {
  const action = signedInEmail ? joinAsSignedInAction : registerWithJoinLinkAction;
  const [state, formAction, pending] = useActionState(action, {} as JoinState);
  const error = state.error ? strings.errors[state.error] : null;

  const studentFields = isStudent ? (
    <>
      <fieldset>
        <legend>{strings.genderLabel}</legend>
        <label>
          <input type="radio" name="gender" value="MALE" required />
          {strings.genderMale}
        </label>
        <label>
          <input type="radio" name="gender" value="FEMALE" required />
          {strings.genderFemale}
        </label>
      </fieldset>
      <label htmlFor="dateOfBirth">{strings.dobLabel}</label>
      <input id="dateOfBirth" name="dateOfBirth" type="date" required dir="ltr" />
      <p className="muted">{strings.dobHint}</p>
    </>
  ) : null;

  if (signedInEmail) {
    return (
      <form action={formAction} className="form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <p>
          {strings.signedInAs} <strong dir="ltr">{signedInEmail}</strong>
        </p>
        <label htmlFor="displayName">{strings.nameLabel}</label>
        <input id="displayName" name="displayName" required minLength={2} maxLength={120} />
        <label htmlFor="phone">{strings.phoneLabel}</label>
        <input id="phone" name="phone" type="tel" required minLength={7} maxLength={32} dir="ltr" />
        {studentFields}
        <button type="submit" className="button button-primary" disabled={pending} aria-busy={pending}>
          {pending ? strings.loading : strings.submitSignedIn}
        </button>
        <p role="alert" className="message message-error">
          {error}
        </p>
      </form>
    );
  }

  return (
    <form action={formAction} className="form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />

      <label htmlFor="displayName">{strings.nameLabel}</label>
      <input id="displayName" name="displayName" required minLength={2} maxLength={120} autoComplete="name" />

      <label htmlFor="phone">{strings.phoneLabel}</label>
      <input id="phone" name="phone" type="tel" required minLength={7} maxLength={32} dir="ltr" autoComplete="tel" />

      {studentFields}

      <label htmlFor="email">{strings.emailLabel}</label>
      <input id="email" name="email" type="email" required maxLength={320} dir="ltr" autoComplete="email" />
      <p className="muted">{strings.emailHint}</p>

      <label htmlFor="password">{strings.passwordLabel}</label>
      <PasswordInput id="password" name="password" required minLength={8} maxLength={200} autoComplete="new-password" showLabel={strings.showPassword} hideLabel={strings.hidePassword} />
      <p className="muted">{strings.passwordHint}</p>

      <label htmlFor="passwordConfirm">{strings.passwordConfirmLabel}</label>
      <PasswordInput id="passwordConfirm" name="passwordConfirm" required minLength={8} maxLength={200} autoComplete="new-password" showLabel={strings.showPassword} hideLabel={strings.hidePassword} />

      <button type="submit" className="button button-primary" disabled={pending} aria-busy={pending}>
        {pending ? strings.loading : strings.submit}
      </button>
      <p role="alert" className="message message-error">
        {error}
      </p>
      <p className="muted">{strings.haveAccount}</p>
    </form>
  );
}
