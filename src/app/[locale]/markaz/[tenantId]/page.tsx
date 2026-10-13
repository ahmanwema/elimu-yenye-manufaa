import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { InviteCreateForm } from "@/components/invite-create-form";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { revokeInvite } from "@/server/actions/invitations";
import {
  activateLinkAction,
  createLinkAction,
  grantPermissionAction,
  requestAppointmentAction,
  revokeLinkAction,
  revokePermissionAction,
  verifyLinkAction,
} from "@/server/actions/workspace";
import { getCurrentActor } from "@/server/auth";
import {
  AuthorizationError,
  GRANTABLE_PERMISSIONS,
  hasActiveRole,
  hasGrantedPermission,
  hasTenantPermission,
  invitableTargets,
} from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { getTenant } from "@/server/data/tenants";
import { listAppointmentCandidates, listTenantAppointmentRequests } from "@/server/services/appointments";
import { listPendingInvitations } from "@/server/services/invitations";
import { listTenantParentLinks } from "@/server/services/parent-links";
import { listTeacherDelegation } from "@/server/services/permissions";
import { listStudentRoster } from "@/server/services/roster";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).markaz.title, robots: { index: false } };
}

export default async function MarkazPage({ params }: PageProps<"/[locale]/markaz/[tenantId]">) {
  const dict = await getDictionary();
  return (
    <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
      <MarkazBody params={params} />
    </Suspense>
  );
}

// Each section is shown only when the server-side permission check passes, and each
// data function and action re-checks it. Hiding a section is presentation, not security.
async function MarkazBody({ params }: { params: PageProps<"/[locale]/markaz/[tenantId]">["params"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const { tenantId } = await params;
  const current = await getCurrentActor();
  if (current.state === "not-configured") return <p>{dict.common.notConfigured}</p>;
  if (current.state !== "signed-in") redirect(`/${locale}/sign-in?next=/${locale}/markaz/${tenantId}`);

  const db = getDb();
  const { actor } = current;
  let tenant;
  try {
    tenant = await getTenant(db, actor, tenantId);
  } catch (error) {
    if (error instanceof AuthorizationError) return <p role="alert">{dict.markaz.notAllowed}</p>;
    throw error;
  }
  if (!tenant) return <p role="alert">{dict.markaz.notAllowed}</p>;

  const can = {
    roster: hasTenantPermission(actor, tenantId, "tenant.roster.read"),
    create: hasGrantedPermission(actor, tenantId, "parent_link.create"),
    verify: hasGrantedPermission(actor, tenantId, "parent_link.verify"),
    activate: hasGrantedPermission(actor, tenantId, "parent_link.activate"),
    revoke: hasGrantedPermission(actor, tenantId, "parent_link.revoke"),
    appoint: hasTenantPermission(actor, tenantId, "tenant.admin_appointment.request"),
    delegate: actor.isPlatformAdmin || hasActiveRole(actor, tenantId, "MARKAZ_ADMIN"),
  };
  const targets = invitableTargets(actor, tenantId);
  const canLinks =
    hasTenantPermission(actor, tenantId, "tenant.parent_links.read") || can.create || can.verify || can.activate || can.revoke;

  const [roster, invitations, links, candidates, requests, verifiers] = await Promise.all([
    can.roster || can.create ? listStudentRoster(db, actor, tenantId).catch(() => null) : null,
    targets.length > 0 ? listPendingInvitations(db, actor, tenantId) : null,
    canLinks ? listTenantParentLinks(db, actor, tenantId) : null,
    can.appoint ? listAppointmentCandidates(db, actor, tenantId) : null,
    can.appoint ? listTenantAppointmentRequests(db, actor, tenantId) : null,
    can.delegate ? listTeacherDelegation(db, actor, tenantId) : null,
  ]);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const name = (n: string | null | undefined) => n ?? dict.markaz.unnamed;
  const targetLabel = (t: keyof typeof dict.roles) => dict.roles[t];
  const studentOptions = roster?.map((s) => ({ profileId: s.profileId, label: name(s.displayName) })) ?? [];

  return (
    <>
      <h1>{tenant.name}</h1>
      <p className="muted">{format(dict.markaz.codeLabel, { code: tenant.slug })}</p>

      {roster && can.roster ? (
        <section className="card" aria-labelledby="roster">
          <h2 id="roster">{dict.markaz.rosterHeading}</h2>
          <p className="muted">{dict.markaz.rosterNote}</p>
          {roster.length === 0 ? (
            <p className="muted">{dict.markaz.noStudents}</p>
          ) : (
            <ul className="list">
              {roster.map((s) => (
                <li key={s.profileId}>{name(s.displayName)}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {invitations ? (
        <section className="card" aria-labelledby="invites">
          <h2 id="invites">{dict.markaz.invitesHeading}</h2>
          <InviteCreateForm
            locale={locale}
            tenantId={tenant.id}
            targets={targets.map((t) => ({ value: t, label: targetLabel(t) }))}
            students={targets.includes("PARENT") && can.create && hasGrantedPermission(actor, tenantId, "invitation.create") ? studentOptions : null}
            strings={{
              email: dict.markaz.inviteEmail,
              role: dict.markaz.inviteRole,
              create: dict.markaz.inviteCreate,
              created: dict.markaz.inviteCreated,
              loading: dict.common.loading,
              child: dict.markaz.inviteChild,
              noChild: dict.markaz.noChildOption,
              results: dict.results,
            }}
          />
          {invitations.length === 0 ? (
            <p className="muted">{dict.markaz.noInvites}</p>
          ) : (
            <ul className="list">
              {invitations.map((inv) => (
                <li key={inv.id} className="row">
                  <span dir="ltr">{inv.email}</span> — {targetLabel(inv.target)} —{" "}
                  <span className="muted">{format(dict.markaz.inviteExpires, { date: dateFmt.format(inv.expiresAt) })}</span>
                  <ActionForm action={revokeInvite} submitLabel={dict.markaz.inviteRevoke} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                    <input type="hidden" name="invitationId" value={inv.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {links ? (
        <section className="card" aria-labelledby="links">
          <h2 id="links">{dict.markaz.linksHeading}</h2>
          <p className="muted">{dict.markaz.linksNote}</p>
          {can.create && studentOptions.length > 0 ? (
            <>
              <h3>{dict.markaz.createLinkHeading}</h3>
              <ActionForm action={createLinkAction} submitLabel={dict.markaz.createLinkSubmit} pendingLabel={dict.common.loading} messages={dict.results}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <label htmlFor="parentEmail">{dict.markaz.createLinkParentEmail}</label>
                <input id="parentEmail" name="parentEmail" type="email" required dir="ltr" />
                <label htmlFor="linkStudent">{dict.markaz.linkStudent}</label>
                <select id="linkStudent" name="studentProfileId" required>
                  {studentOptions.map((s) => (
                    <option key={s.profileId} value={s.profileId}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </ActionForm>
            </>
          ) : null}
          {links.length === 0 ? (
            <p className="muted">{dict.markaz.noLinks}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{dict.markaz.linkParent}</th>
                  <th scope="col">{dict.markaz.linkStudent}</th>
                  <th scope="col">{dict.markaz.linkStatus}</th>
                  <th scope="col">
                    <span className="visually-hidden">{dict.markaz.verify}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const party = actor.profileId === l.parentProfileId || actor.profileId === l.studentProfileId;
                  return (
                    <tr key={l.id}>
                      <td>{name(l.parent.profile.displayName)}</td>
                      <td>{name(l.student.profile.displayName)}</td>
                      <td>{dict.statuses[l.status]}</td>
                      <td className="row">
                        {can.verify && !party && l.status === "PENDING" ? (
                          <ActionForm action={verifyLinkAction} submitLabel={dict.markaz.verify} pendingLabel={dict.common.loading} messages={dict.results} inline>
                            <input type="hidden" name="linkId" value={l.id} />
                          </ActionForm>
                        ) : null}
                        {can.activate && !party && l.status === "VERIFIED" ? (
                          <ActionForm action={activateLinkAction} submitLabel={dict.markaz.activate} pendingLabel={dict.common.loading} messages={dict.results} inline>
                            <input type="hidden" name="linkId" value={l.id} />
                          </ActionForm>
                        ) : null}
                        {can.revoke && l.status !== "REVOKED" ? (
                          <ActionForm action={revokeLinkAction} submitLabel={dict.markaz.revokeLink} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                            <input type="hidden" name="linkId" value={l.id} />
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {verifiers ? (
        <section className="card" aria-labelledby="verifiers">
          <h2 id="verifiers">{dict.markaz.verifiersHeading}</h2>
          <p className="muted">{dict.markaz.verifiersNote}</p>
          {verifiers.length === 0 ? (
            <p className="muted">{dict.markaz.noTeachers}</p>
          ) : (
            <ul className="list">
              {verifiers.map((v) => (
                <li key={v.profileId}>
                  <span>{name(v.displayName)}</span>
                  <ul className="list">
                    {GRANTABLE_PERMISSIONS.map((p) => {
                      const grantId = v.grants[p];
                      return (
                        <li key={p} className="row">
                          <span>{dict.permissions[p]}</span>
                          {grantId ? (
                            <ActionForm action={revokePermissionAction} submitLabel={dict.platform.revoke} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                              <input type="hidden" name="grantId" value={grantId} />
                            </ActionForm>
                          ) : (
                            <ActionForm action={grantPermissionAction} submitLabel={dict.platform.grant} pendingLabel={dict.common.loading} messages={dict.results} inline>
                              <input type="hidden" name="tenantId" value={tenant.id} />
                              <input type="hidden" name="profileId" value={v.profileId} />
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
        </section>
      ) : null}

      {candidates && requests ? (
        <section className="card" aria-labelledby="appoint">
          <h2 id="appoint">{dict.markaz.appointmentHeading}</h2>
          <p className="muted">{dict.markaz.appointmentNote}</p>
          {candidates.length === 0 ? (
            <p className="muted">{dict.markaz.noCandidates}</p>
          ) : (
            <ActionForm action={requestAppointmentAction} submitLabel={dict.markaz.appointmentSubmit} pendingLabel={dict.common.loading} messages={{ ...dict.results, done: dict.markaz.appointmentSent }}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <label htmlFor="candidate">{dict.markaz.appointmentCandidate}</label>
              <select id="candidate" name="candidateProfileId" required>
                {candidates.map((c) => (
                  <option key={c.profileId} value={c.profileId}>
                    {name(c.displayName)}
                  </option>
                ))}
              </select>
            </ActionForm>
          )}
          {requests.length > 0 ? (
            <>
              <h3>{dict.markaz.appointmentList}</h3>
              <ul className="list">
                {requests.map((r) => (
                  <li key={r.id}>
                    {name(r.candidate.displayName)} — {dict.statuses[r.status]}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
