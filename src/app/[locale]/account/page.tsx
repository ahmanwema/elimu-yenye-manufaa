import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { getDictionary, getLocale } from "@/i18n/server";
import { format } from "@/i18n/dictionaries";
import { signOut } from "@/server/actions/auth";
import { requestLinkAction, updateMyNameAction, withdrawMyLinkAction } from "@/server/actions/workspace";
import { getCurrentActor } from "@/server/auth";
import { getDb } from "@/server/db";
import { listMyTenants } from "@/server/data/tenants";
import { listMyParentLinks } from "@/server/services/parent-links";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).account.title };
}

export default async function AccountPage() {
  const dict = await getDictionary();
  return (
    <>
      <h1>{dict.account.title}</h1>
      <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
        <AccountBody />
      </Suspense>
    </>
  );
}

async function AccountBody() {
  const locale = await getLocale();
  const dict = await getDictionary();
  const current = await getCurrentActor();

  if (current.state === "not-configured") return <p>{dict.common.notConfigured}</p>;
  if (current.state === "signed-out") redirect(`/${locale}/sign-in?next=/${locale}/account`);
  if (current.state === "no-profile") return <p>{dict.account.noProfile}</p>;

  const db = getDb();
  const { actor, identity } = current;
  const [profile, tenants, links, registrations] = await Promise.all([
    db.profile.findUnique({
      where: { id: actor.profileId },
      select: { displayName: true, parentAccount: { select: { profileId: true } } },
    }),
    listMyTenants(db, actor),
    listMyParentLinks(db, actor),
    // The student's own registration numbers (self-data only).
    db.membership.findMany({
      where: { profileId: actor.profileId, role: "STUDENT", status: "ACTIVE" },
      select: { registrationNumber: true, tenant: { select: { name: true, slug: true } } },
    }),
  ]);
  const linkStatus = {
    PENDING: dict.account.linkPending,
    VERIFIED: dict.account.linkVerified,
    ACTIVE: dict.statuses.ACTIVE,
    REVOKED: dict.account.linkRevoked,
  };

  return (
    <>
      {identity.email ? <p className="muted">{format(dict.auth.signedInAs, { email: identity.email })}</p> : null}

      <section className="card">
        <ActionForm action={updateMyNameAction} submitLabel={dict.account.nameSave} pendingLabel={dict.common.loading} messages={dict.results}>
          <label htmlFor="displayName">{dict.account.nameLabel}</label>
          <input id="displayName" name="displayName" defaultValue={profile?.displayName ?? ""} maxLength={80} required />
        </ActionForm>
      </section>

      <section className="card">
        <h2>{dict.account.markazHeading}</h2>
        {tenants.length === 0 ? (
          <p className="muted">{dict.account.noMarkaz}</p>
        ) : (
          <ul className="list">
            {tenants.map((t) => (
              <li key={t.id}>
                <a href={`/${locale}/markaz/${t.id}`}>{t.name}</a>{" "}
                <span className="muted">— {t.roles.map((r) => dict.roles[r]).join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {registrations.length > 0 ? (
        <section className="card">
          <h2>{dict.account.myRegistrationHeading}</h2>
          <p className="muted">{dict.account.myRegistrationNote}</p>
          <ul className="list">
            {registrations.map((r) => (
              <li key={r.tenant.slug}>
                {r.tenant.name} — <span dir="ltr">{format(dict.markaz.codeLabel, { code: r.tenant.slug })}</span> —{" "}
                <strong dir="ltr">{r.registrationNumber}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile?.parentAccount ? (
        <section className="card">
          <h2>{dict.account.childrenHeading}</h2>
          {links.length > 0 ? (
            <ul className="list">
              {links.map((l) => (
                <li key={l.id} className="row">
                  <span>
                    {l.studentName ?? dict.markaz.unnamed} <span className="muted">({l.markazName})</span> — {linkStatus[l.status]}
                  </span>
                  {l.status !== "REVOKED" ? (
                    <ActionForm action={withdrawMyLinkAction} submitLabel={dict.account.withdraw} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="linkId" value={l.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <h3>{dict.account.requestLinkHeading}</h3>
          <p className="muted">{dict.account.requestLinkNote}</p>
          <ActionForm action={requestLinkAction} submitLabel={dict.account.requestLinkSubmit} pendingLabel={dict.common.loading} messages={{ ...dict.results, done: dict.account.requestLinkSent }}>
            <label htmlFor="tenantSlug">{dict.account.markazCode}</label>
            <input id="tenantSlug" name="tenantSlug" required dir="ltr" autoComplete="off" />
            <label htmlFor="studentEmail">{dict.account.childEmail}</label>
            <input id="studentEmail" name="studentEmail" type="email" dir="ltr" />
            <p className="muted">{dict.account.orLabel}</p>
            <label htmlFor="studentRegistrationNumber">{dict.account.childRegistrationNumber}</label>
            <input id="studentRegistrationNumber" name="studentRegistrationNumber" dir="ltr" autoComplete="off" maxLength={12} />
          </ActionForm>
        </section>
      ) : null}

      {actor.isPlatformAdmin ? (
        <p>
          <a href={`/${locale}/platform`}>{dict.nav.platform}</a>
        </p>
      ) : null}

      <form action={signOut}>
        <input type="hidden" name="locale" value={locale} />
        <button type="submit" className="button button-secondary">
          {dict.nav.signOut}
        </button>
      </form>
    </>
  );
}
