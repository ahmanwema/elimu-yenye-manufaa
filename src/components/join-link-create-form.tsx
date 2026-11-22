"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/config";
import type { ActionResult, ResultCode } from "@/lib/action-result";
import { createJoinLinkAction } from "@/server/actions/join-links";

type Strings = {
  label: string;
  roleLabel: string;
  classLabel: string;
  noClass: string;
  days: string;
  maxUses: string;
  create: string;
  created: string;
  loading: string;
  results: Record<ResultCode, string>;
};

/**
 * Creates a shareable join link and shows it once. Only the hash is stored, so the link cannot
 * be shown again: if it is lost, the admin cancels it and makes another.
 */
export function JoinLinkCreateForm({
  locale,
  tenantId,
  roles,
  classes,
  strings,
}: {
  locale: Locale;
  tenantId: string;
  /** Exactly the roles the server says this actor may hand out; it re-checks on submit. */
  roles: { value: string; label: string }[];
  classes: { id: string; name: string }[];
  strings: Strings;
}) {
  const [state, action, pending] = useActionState(createJoinLinkAction, { status: "idle" } as ActionResult<{ link: string }>);
  return (
    <div>
      <form action={action} className="form">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="tenantId" value={tenantId} />

        <label htmlFor={`join-label-${tenantId}`}>{strings.label}</label>
        <input id={`join-label-${tenantId}`} name="label" required maxLength={120} autoComplete="off" />

        <label htmlFor={`join-role-${tenantId}`}>{strings.roleLabel}</label>
        <select id={`join-role-${tenantId}`} name="role" required>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        {classes.length > 0 ? (
          <>
            <label htmlFor={`join-class-${tenantId}`}>{strings.classLabel}</label>
            <select id={`join-class-${tenantId}`} name="classId" defaultValue="">
              <option value="">{strings.noClass}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <label htmlFor={`join-days-${tenantId}`}>{strings.days}</label>
        <input id={`join-days-${tenantId}`} name="expiresInDays" type="number" min={1} max={90} defaultValue={30} required dir="ltr" />

        <label htmlFor={`join-max-${tenantId}`}>{strings.maxUses}</label>
        <input id={`join-max-${tenantId}`} name="maxUses" type="number" min={1} max={10000} dir="ltr" />

        <button type="submit" className="button button-primary" disabled={pending} aria-busy={pending}>
          {pending ? strings.loading : strings.create}
        </button>
        <p role="status" aria-live="polite" className={state.status === "error" ? "message message-error" : "message"}>
          {state.status === "error" ? strings.results[state.code] : null}
        </p>
      </form>
      {state.status === "ok" && state.data ? (
        <div className="callout">
          <p>{strings.created}</p>
          <input readOnly value={state.data.link} dir="ltr" aria-label={strings.created} onFocus={(e) => e.target.select()} />
        </div>
      ) : null}
    </div>
  );
}
