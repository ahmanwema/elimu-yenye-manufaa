"use client";

import { useActionState, useState } from "react";
import type { Locale } from "@/i18n/config";
import { format } from "@/i18n/dictionaries";
import { finishJoinAction, startJoinAction, type JoinState } from "@/server/actions/join-links";

type Strings = {
  nameLabel: string;
  phoneLabel: string;
  genderLabel: string;
  genderMale: string;
  genderFemale: string;
  dobLabel: string;
  dobHint: string;
  emailLabel: string;
  emailHint: string;
  send: string;
  sentBody: string;
  codeLabel: string;
  codeHint: string;
  verify: string;
  loading: string;
  errors: Record<"invalid" | "expired" | "rate_limited" | "unavailable" | "invalid_input" | "invalid_code", string>;
};

type Details = { displayName: string; phone: string; gender: string; dateOfBirth: string };

const EMPTY: Details = { displayName: "", phone: "", gender: "", dateOfBirth: "" };

/**
 * Joining a Markaz through a shared link, in two steps: the student's details and email, then
 * the code emailed to that address. The details are kept in the form across both steps so the
 * server can write them only once the address has actually been proved.
 */
export function JoinForm({ locale, token, strings }: { locale: Locale; token: string; strings: Strings }) {
  const [details, setDetails] = useState<Details>(EMPTY);
  const [startState, startFormAction, starting] = useActionState(startJoinAction, { step: "details" } as JoinState);
  const [finishState, finishFormAction, finishing] = useActionState(finishJoinAction, { step: "details" } as JoinState);

  // Step 2 only once a code has actually been sent, and not after the server sent us back
  // (an expired link, say) — in that case the details form is shown again with the error.
  const codeStep = startState.step === "code" && !(finishState.step === "details" && finishState.error);
  const error = finishState.error ?? startState.error;
  const set = (key: keyof Details) => (event: { target: { value: string } }) =>
    setDetails((d) => ({ ...d, [key]: event.target.value }));

  if (!codeStep) {
    return (
        <form action={startFormAction} className="form">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="token" value={token} />
          <label htmlFor="displayName">{strings.nameLabel}</label>
          <input id="displayName" name="displayName" required minLength={2} maxLength={120} value={details.displayName} onChange={set("displayName")} />

          <label htmlFor="phone">{strings.phoneLabel}</label>
          <input id="phone" name="phone" type="tel" required minLength={7} maxLength={32} dir="ltr" value={details.phone} onChange={set("phone")} />

          <fieldset>
            <legend>{strings.genderLabel}</legend>
            <label>
              <input type="radio" name="gender" value="MALE" required checked={details.gender === "MALE"} onChange={set("gender")} />
              {strings.genderMale}
            </label>
            <label>
              <input type="radio" name="gender" value="FEMALE" required checked={details.gender === "FEMALE"} onChange={set("gender")} />
              {strings.genderFemale}
            </label>
          </fieldset>

          <label htmlFor="dateOfBirth">{strings.dobLabel}</label>
          <input id="dateOfBirth" name="dateOfBirth" type="date" required dir="ltr" value={details.dateOfBirth} onChange={set("dateOfBirth")} />
          <p className="muted">{strings.dobHint}</p>

          <label htmlFor="email">{strings.emailLabel}</label>
          <input id="email" name="email" type="email" required maxLength={320} autoComplete="email" dir="ltr" />
          <p className="muted">{strings.emailHint}</p>

          <button type="submit" className="button button-primary" disabled={starting} aria-busy={starting}>
            {starting ? strings.loading : strings.send}
          </button>
          <p role="alert" className="message message-error">
            {error ? strings.errors[error] : null}
          </p>
        </form>
    );
  }

  const email = startState.step === "code" ? startState.email : "";
  return (
    <form action={finishFormAction} className="form">
      <p>{format(strings.sentBody, { email })}</p>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="displayName" value={details.displayName} />
      <input type="hidden" name="phone" value={details.phone} />
      <input type="hidden" name="gender" value={details.gender} />
      <input type="hidden" name="dateOfBirth" value={details.dateOfBirth} />

      <label htmlFor="code">{strings.codeLabel}</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required dir="ltr" />
      <p className="muted">{strings.codeHint}</p>

      <button type="submit" className="button button-primary" disabled={finishing} aria-busy={finishing}>
        {finishing ? strings.loading : strings.verify}
      </button>
      <p role="alert" className="message message-error">
        {error ? strings.errors[error] : null}
      </p>
    </form>
  );
}
