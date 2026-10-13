"use client";

import { useActionState } from "react";
import { createInvite } from "@/server/actions/invitations";
import type { ActionResult, ResultCode } from "@/lib/action-result";
import { format } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";

type Strings = {
  email: string;
  role: string;
  create: string;
  created: string;
  loading: string;
  child: string;
  noChild: string;
  results: Record<ResultCode, string>;
};

/**
 * Creates an invitation and shows its link once. The target options (and whether a child
 * may be proposed for a PARENT invitation) are what the server says this actor may do;
 * the server re-checks everything on submit.
 */
export function InviteCreateForm({
  locale,
  tenantId,
  targets,
  students,
  strings,
}: {
  locale: Locale;
  tenantId: string;
  targets: { value: string; label: string }[];
  /** Present only when the actor may propose a child (parent_link.create). */
  students: { profileId: string; label: string }[] | null;
  strings: Strings;
}) {
  const [state, action, pending] = useActionState(
    createInvite,
    { status: "idle" } as ActionResult<{ link: string; email: string }>,
  );
  return (
    <div>
      <form action={action} className="form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="tenantId" value={tenantId} />
        <label htmlFor="invite-email">{strings.email}</label>
        <input id="invite-email" name="email" type="email" required dir="ltr" autoComplete="off" />
        <label htmlFor="invite-target">{strings.role}</label>
        <select id="invite-target" name="target" required>
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {students ? (
          <>
            <label htmlFor="invite-child">{strings.child}</label>
            <select id="invite-child" name="proposedStudentId" defaultValue="">
              <option value="">{strings.noChild}</option>
              {students.map((s) => (
                <option key={s.profileId} value={s.profileId}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <button type="submit" className="button button-primary" disabled={pending} aria-busy={pending}>
          {pending ? strings.loading : strings.create}
        </button>
        <p role="status" aria-live="polite" className={state.status === "error" ? "message message-error" : "message"}>
          {state.status === "error" ? strings.results[state.code] : null}
        </p>
      </form>
      {state.status === "ok" && state.data ? (
        <div className="callout">
          <p>{format(strings.created, { email: state.data.email })}</p>
          <input readOnly value={state.data.link} dir="ltr" aria-label={strings.created} onFocus={(e) => e.target.select()} />
        </div>
      ) : null}
    </div>
  );
}
