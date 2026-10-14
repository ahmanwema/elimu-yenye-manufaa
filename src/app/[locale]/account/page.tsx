import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { CorrectionList } from "@/components/correction-list";
import { MediaPlayButton } from "@/components/media-play-button";
import { getDictionary, getLocale } from "@/i18n/server";
import { format } from "@/i18n/dictionaries";
import { signOut } from "@/server/actions/auth";
import { enterDateOfBirthAction, giveGuardianConsentAction, giveOwnConsentAction, withdrawConsentAction } from "@/server/actions/media";
import { requestLinkAction, updateMyNameAction, withdrawMyLinkAction } from "@/server/actions/workspace";
import { getCurrentActor } from "@/server/auth";
import { getDb } from "@/server/db";
import { listMyTenants } from "@/server/data/tenants";
import { getMyConsent, listMyChildrenConsent } from "@/server/services/consent";
import { listStudentCorrections } from "@/server/services/corrections";
import { listMyParentLinks } from "@/server/services/parent-links";
import { listParentVisibleRecordings, listStudentVisibleRecordings } from "@/server/services/recordings";

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
      select: { displayName: true, parentAccount: { select: { profileId: true } }, studentAccount: { select: { profileId: true } } },
    }),
    listMyTenants(db, actor),
    listMyParentLinks(db, actor),
    // The student's own registration numbers (self-data only).
    db.membership.findMany({
      where: { profileId: actor.profileId, role: "STUDENT", status: "ACTIVE" },
      select: { registrationNumber: true, tenant: { select: { name: true, slug: true } } },
    }),
  ]);
  const activeChildren = links.filter((l) => l.studentProfileId !== null);
  const [myCorrections, myConsent, childConsent, childCorrections, childRecordings, myRecordings] = await Promise.all([
    profile?.studentAccount ? listStudentCorrections(db, actor, actor.profileId) : [],
    profile?.studentAccount ? getMyConsent(db, actor) : null,
    activeChildren.length > 0 ? listMyChildrenConsent(db, actor) : [],
    Promise.all(activeChildren.map((l) => listStudentCorrections(db, actor, l.studentProfileId))),
    activeChildren.length > 0 ? listParentVisibleRecordings(db, actor) : [],
    profile?.studentAccount ? listStudentVisibleRecordings(db, actor) : [],
  ]);
  const m = dict.media;
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

      {myConsent ? (
        <section className="card" aria-labelledby="my-consent">
          <h2 id="my-consent">{m.ownConsentHeading}</h2>
          <p className="muted">{m.ownConsentNote}</p>
          <p>{m.dobStates[myConsent.dateOfBirthState]}</p>
          <ActionForm action={enterDateOfBirthAction} submitLabel={m.dobSave} pendingLabel={dict.common.loading} messages={dict.results}>
            <input type="hidden" name="studentProfileId" value={actor.profileId} />
            <label htmlFor="my-dob">{m.dob}</label>
            <input id="my-dob" name="dateOfBirth" type="date" required />
          </ActionForm>
          {myConsent.consents.length > 0 ? (
            <ul className="list">
              {myConsent.consents.map((c) => (
                <li key={c.id} className="row">
                  <span>{m.methods[c.method]}</span>
                  {c.method === "SELF_ONLINE" ? (
                    <ActionForm action={withdrawConsentAction} submitLabel={m.withdrawConsent} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="consentId" value={c.id} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{m.consentNone}</p>
          )}
          {!myConsent.consents.some((c) => c.method === "SELF_ONLINE") &&
          !(myConsent.dateOfBirthState === "VERIFIED" && myConsent.minorStatus === "MINOR") ? (
            <ActionForm action={giveOwnConsentAction} submitLabel={m.giveOwnConsent} pendingLabel={dict.common.loading} messages={dict.results} />
          ) : null}
        </section>
      ) : null}

      {profile?.studentAccount ? (
        <section className="card" aria-labelledby="my-corrections">
          <h2 id="my-corrections">{m.myCorrectionsHeading}</h2>
          <CorrectionList corrections={myCorrections} actor={actor} dict={dict} locale={locale} />
          <h3>{m.myRecordingsHeading}</h3>
          {myRecordings.length === 0 ? (
            <p className="muted">{m.noRecordings}</p>
          ) : (
            <ul className="list">
              {myRecordings.map((r) => (
                <li key={r.id} className="row">
                  <span>
                    {r.title ?? m.untitled} <span className="muted">({r.tenant.name})</span>
                  </span>
                  {r.approvalScope === "WHOLE" ? (
                    <MediaPlayButton kind="recording" id={r.id} label={m.play} loading={dict.common.loading} results={dict.results} />
                  ) : (
                    r.segments.map((seg) => (
                      <MediaPlayButton
                        key={seg.id}
                        kind="recording"
                        id={r.id}
                        segmentId={seg.id}
                        label={`${m.play} ${Math.floor(seg.startMs / 1000)}–${Math.ceil(seg.endMs / 1000)} s`}
                        loading={dict.common.loading}
                        results={dict.results}
                      />
                    ))
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeChildren.map((child, i) => {
        const consent = childConsent.find((c) => c.studentProfileId === child.studentProfileId);
        const recordings = childRecordings.filter((r) => r.participants.some((p) => p.studentProfileId === child.studentProfileId));
        return (
          <section key={child.id} className="card" aria-labelledby={`child-${child.id}`}>
            <h2 id={`child-${child.id}`}>{child.studentName ?? dict.markaz.unnamed}</h2>
            <h3>{m.consentHeading}</h3>
            <p className="muted">{m.consentNote}</p>
            <p>
              {m.dobStates[consent?.dateOfBirthState ?? "MISSING"]}
              {consent?.dateOfBirthState === "VERIFIED" ? ` — ${m.minorStatus[consent.minorStatus]}` : null}
            </p>
            <ActionForm action={enterDateOfBirthAction} submitLabel={m.dobSave} pendingLabel={dict.common.loading} messages={dict.results}>
              <input type="hidden" name="studentProfileId" value={child.studentProfileId ?? ""} />
              <label htmlFor={`dob-${child.id}`}>{m.dob}</label>
              <input id={`dob-${child.id}`} name="dateOfBirth" type="date" required />
            </ActionForm>
            {consent && consent.consents.length > 0 ? (
              <ul className="list">
                {consent.consents.map((c) => (
                  <li key={c.id} className="row">
                    <span>{m.methods[c.method]}</span>
                    {c.method !== "SELF_ONLINE" ? (
                      <ActionForm action={withdrawConsentAction} submitLabel={m.withdrawConsent} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                        <input type="hidden" name="consentId" value={c.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{m.consentNone}</p>
            )}
            {!consent?.consents.some((c) => c.method === "GUARDIAN_ONLINE" && c.mine) ? (
              <ActionForm action={giveGuardianConsentAction} submitLabel={m.giveConsent} pendingLabel={dict.common.loading} messages={dict.results}>
                <input type="hidden" name="studentProfileId" value={child.studentProfileId ?? ""} />
              </ActionForm>
            ) : null}
            <h3>{m.correctionsHeading}</h3>
            <CorrectionList corrections={childCorrections[i]} actor={actor} dict={dict} locale={locale} />
            <h3>{m.childRecordingsHeading}</h3>
            {recordings.length === 0 ? (
              <p className="muted">{m.noRecordings}</p>
            ) : (
              <ul className="list">
                {recordings.map((r) => (
                  <li key={r.id} className="row">
                    <span>
                      {r.title ?? m.untitled} <span className="muted">({r.tenant.name})</span>
                    </span>
                    {r.approvalScope === "WHOLE" ? (
                      <MediaPlayButton kind="recording" id={r.id} label={m.play} loading={dict.common.loading} results={dict.results} />
                    ) : (
                      r.segments.map((s) => (
                        <MediaPlayButton
                          key={s.id}
                          kind="recording"
                          id={r.id}
                          segmentId={s.id}
                          label={`${m.play} ${Math.floor(s.startMs / 1000)}–${Math.ceil(s.endMs / 1000)} s`}
                          loading={dict.common.loading}
                          results={dict.results}
                        />
                      ))
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

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
