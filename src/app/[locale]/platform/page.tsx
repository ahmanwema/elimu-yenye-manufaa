import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { declineOptionCAction, disableOptionCAction, enableOptionCAction } from "@/server/actions/media";
import { grantPermissionAction, reviewAppointmentAction, revokePermissionAction } from "@/server/actions/workspace";
import { GRANTABLE_PERMISSIONS } from "@/server/authz/policy";
import { getCurrentActor } from "@/server/auth";
import { getDb } from "@/server/db";
import { listPendingAppointmentRequests } from "@/server/services/appointments";
import { listOptionCForPlatform } from "@/server/services/option-c";
import { listPermissionOverview } from "@/server/services/platform";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).platform.title, robots: { index: false } };
}

export default async function PlatformPage() {
  const dict = await getDictionary();
  return (
    <>
      <h1>{dict.platform.title}</h1>
      <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
        <PlatformBody />
      </Suspense>
    </>
  );
}

async function PlatformBody() {
  const locale = await getLocale();
  const dict = await getDictionary();
  const current = await getCurrentActor();
  if (current.state === "not-configured") return <p>{dict.common.notConfigured}</p>;
  if (current.state !== "signed-in") redirect(`/${locale}/sign-in?next=/${locale}/platform`);
  if (!current.actor.isPlatformAdmin) return <p role="alert">{dict.platform.notAllowed}</p>;

  const db = getDb();
  const [requests, overview, optionC] = await Promise.all([
    listPendingAppointmentRequests(db, current.actor),
    listPermissionOverview(db, current.actor),
    listOptionCForPlatform(db, current.actor),
  ]);
  const name = (n: string | null) => n ?? dict.markaz.unnamed;

  return (
    <>
      <section className="card" aria-labelledby="option-c">
        <h2 id="option-c">{dict.platform.optionCHeading}</h2>
        <p className="muted">{dict.media.optionCNote}</p>
        {optionC.filter((o) => o.status === "PENDING").length === 0 ? (
          <p className="muted">{dict.platform.noOptionC}</p>
        ) : (
          <ul className="list">
            {optionC
              .filter((o) => o.status === "PENDING")
              .map((o) => (
                <li key={o.tenantId} className="row">
                  <span>{o.tenant.name}</span>
                  <ActionForm action={enableOptionCAction} submitLabel={dict.platform.optionCEnable} pendingLabel={dict.common.loading} messages={dict.results} inline>
                    <input type="hidden" name="tenantId" value={o.tenantId} />
                  </ActionForm>
                  <ActionForm action={declineOptionCAction} submitLabel={dict.platform.optionCDecline} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                    <input type="hidden" name="tenantId" value={o.tenantId} />
                  </ActionForm>
                </li>
              ))}
          </ul>
        )}
        {optionC.some((o) => o.status === "ENABLED") ? (
          <>
            <h3>{dict.platform.optionCEnabledList}</h3>
            <ul className="list">
              {optionC
                .filter((o) => o.status === "ENABLED")
                .map((o) => (
                  <li key={o.tenantId} className="row">
                    <span>{o.tenant.name}</span>
                    <ActionForm action={disableOptionCAction} submitLabel={dict.platform.optionCDisable} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="tenantId" value={o.tenantId} />
                    </ActionForm>
                  </li>
                ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="card" aria-labelledby="requests">
        <h2 id="requests">{dict.platform.requestsHeading}</h2>
        {requests.length === 0 ? (
          <p className="muted">{dict.platform.noRequests}</p>
        ) : (
          <ul className="list">
            {requests.map((r) => (
              <li key={r.id} className="row">
                <span>{format(dict.platform.requestLine, { candidate: name(r.candidate.displayName), markaz: r.tenant.name })}</span>
                {r.requestedById === current.actor.profileId ? null : (
                  <>
                    <ActionForm action={reviewAppointmentAction} submitLabel={dict.platform.approve} pendingLabel={dict.common.loading} messages={dict.results} inline>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="APPROVE" />
                    </ActionForm>
                    <ActionForm action={reviewAppointmentAction} submitLabel={dict.platform.reject} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="REJECT" />
                    </ActionForm>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="grants">
        <h2 id="grants">{dict.platform.grantsHeading}</h2>
        <p className="muted">{dict.platform.grantsNote}</p>
        {overview.map((t) => (
          <div key={t.id}>
            <h3>{t.name}</h3>
            {t.members.length === 0 ? (
              <p className="muted">{dict.platform.noEligible}</p>
            ) : (
              <ul className="list">
                {t.members.map((m) => (
                  <li key={m.profileId}>
                    <span>
                      {name(m.displayName)}{" "}
                      <span className="muted">— {m.roles.map((r) => dict.roles[r as keyof typeof dict.roles]).join(", ")}</span>
                    </span>
                    <ul className="list">
                      {GRANTABLE_PERMISSIONS.map((p) => {
                        const grantId = m.grants[p];
                        return (
                          <li key={p} className="row">
                            <span>{dict.permissions[p]}</span>
                            {grantId ? (
                              <ActionForm action={revokePermissionAction} submitLabel={dict.platform.revoke} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                                <input type="hidden" name="grantId" value={grantId} />
                              </ActionForm>
                            ) : (
                              <ActionForm action={grantPermissionAction} submitLabel={dict.platform.grant} pendingLabel={dict.common.loading} messages={dict.results} inline>
                                <input type="hidden" name="tenantId" value={t.id} />
                                <input type="hidden" name="profileId" value={m.profileId} />
                                <input type="hidden" name="permission" value={p} />
                              </ActionForm>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
