import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { CorrectionList } from "@/components/correction-list";
import { InviteCreateForm } from "@/components/invite-create-form";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { revokeInvite } from "@/server/actions/invitations";
import {
  approveMediaDeletionAction,
  approveRecordingAction,
  cancelMediaDeletionAction,
  cancelOptionCAction,
  createCorrectionAction,
  createRecordingAction,
  declineMediaDeletionAction,
  recordOfflineConsentAction,
  rejectRecordingAction,
  requestMediaDeletionAction,
  requestOptionCAction,
  revokeRecordingApprovalAction,
  submitRecordingAction,
  verifyDateOfBirthAction,
} from "@/server/actions/media";
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
  canApproveMediaDeletion,
  canApproveRecording,
  canRequestMediaDeletion,
  GRANTABLE_PERMISSIONS,
  hasActiveRole,
  hasGrantedPermission,
  hasTenantPermission,
  invitableTargets,
} from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { getTenant } from "@/server/data/tenants";
import { listAppointmentCandidates, listTenantAppointmentRequests } from "@/server/services/appointments";
import { listTenantConsentOverview } from "@/server/services/consent";
import { ANCHOR_KINDS, listTenantCorrections } from "@/server/services/corrections";
import { listPendingInvitations } from "@/server/services/invitations";
import { listPendingDeletionRequests } from "@/server/services/media-deletion";
import { getOptionCForMarkaz } from "@/server/services/option-c";
import { listTenantRecordings } from "@/server/services/recordings";
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
    teach: hasActiveRole(actor, tenantId, "TEACHER"),
    administer: hasActiveRole(actor, tenantId, "MARKAZ_ADMIN"),
  };
  const targets = invitableTargets(actor, tenantId);
  const canLinks =
    hasTenantPermission(actor, tenantId, "tenant.parent_links.read") || can.create || can.verify || can.activate || can.revoke;

  const [corrections, recordings, consentOverview, deletionRequests, optionC] = await Promise.all([
    can.teach || can.administer ? listTenantCorrections(db, actor, tenantId) : null,
    can.teach || can.administer ? listTenantRecordings(db, actor, tenantId) : null,
    can.administer ? listTenantConsentOverview(db, actor, tenantId) : null,
    can.administer ? listPendingDeletionRequests(db, actor, tenantId) : null,
    can.teach || can.administer ? getOptionCForMarkaz(db, actor, tenantId) : null,
  ]);
  const m = dict.media;
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

      {corrections ? (
        <section className="card" aria-labelledby="corrections">
          <h2 id="corrections">{m.correctionsHeading}</h2>
          <p className="muted">{m.correctionsNote}</p>
          {can.teach && studentOptions.length > 0 ? (
            <>
              <h3>{m.newCorrection}</h3>
              <ActionForm action={createCorrectionAction} submitLabel={m.create} pendingLabel={dict.common.loading} messages={dict.results}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <label htmlFor="correctionStudent">{m.student}</label>
                <select id="correctionStudent" name="studentProfileId" required>
                  {studentOptions.map((s) => (
                    <option key={s.profileId} value={s.profileId}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="correctionNote">{m.note}</label>
                <textarea id="correctionNote" name="note" maxLength={4000} rows={3} />
                <label htmlFor="anchorKind">{m.anchorKind}</label>
                <select id="anchorKind" name="anchorKind" defaultValue="">
                  <option value="">{m.noAnchor}</option>
                  {ANCHOR_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {m.anchorKinds[k]}
                    </option>
                  ))}
                </select>
                <label htmlFor="anchorLabel">{m.anchorLabel}</label>
                <input id="anchorLabel" name="anchorLabel" maxLength={500} />
                <label htmlFor="anchorRefId">{m.anchorRef}</label>
                <input id="anchorRefId" name="anchorRefId" maxLength={200} dir="ltr" />
              </ActionForm>
            </>
          ) : null}
          <CorrectionList corrections={corrections} actor={actor} dict={dict} locale={locale} />
        </section>
      ) : null}

      {consentOverview ? (
        <section className="card" aria-labelledby="consent">
          <h2 id="consent">{m.consentHeading}</h2>
          <p className="muted">{m.consentNote}</p>
          {consentOverview.length === 0 ? (
            <p className="muted">{dict.markaz.noStudents}</p>
          ) : (
            <ul className="list">
              {consentOverview.map((s) => (
                <li key={s.studentProfileId}>
                  <p>
                    <strong>{name(roster?.find((r) => r.profileId === s.studentProfileId)?.displayName)}</strong> —{" "}
                    {m.dobStates[s.dateOfBirthState]}
                    {s.dateOfBirthState === "VERIFIED" ? ` — ${m.minorStatus[s.minorStatus]}` : null}
                  </p>
                  {s.dateOfBirthToVerify && s.enteredByMe ? <p className="muted">{m.enteredByYou}</p> : null}
                  {s.noOtherVerifier ? <p className="muted">{m.noOtherVerifier}</p> : null}
                  {s.dateOfBirthToVerify && !s.enteredByMe ? (
                    <ActionForm action={verifyDateOfBirthAction} submitLabel={m.verifyDob} pendingLabel={dict.common.loading} messages={dict.results} inline>
                      <span dir="ltr">{format(m.verifyDobLabel, { date: s.dateOfBirthToVerify })}</span>
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <input type="hidden" name="studentProfileId" value={s.studentProfileId} />
                      <input type="hidden" name="dateOfBirth" value={s.dateOfBirthToVerify} />
                    </ActionForm>
                  ) : null}
                  {s.consents.length === 0 ? <p className="muted">{m.consentNone}</p> : null}
                  <ul className="list">
                    {s.consents.map((c) => (
                      <li key={c.id} className="row">
                        <span>{m.methods[c.method]}</span>
                      </li>
                    ))}
                  </ul>
                  {!s.consents.some((c) => c.method === "OFFLINE_VERIFIED") ? (
                    <details>
                      <summary>{m.offlineHeading}</summary>
                      <ActionForm action={recordOfflineConsentAction} submitLabel={m.offlineSubmit} pendingLabel={dict.common.loading} messages={dict.results}>
                        <input type="hidden" name="tenantId" value={tenant.id} />
                        <input type="hidden" name="studentProfileId" value={s.studentProfileId} />
                        <label htmlFor={`who-${s.studentProfileId}`}>{m.offlineWho}</label>
                        <input id={`who-${s.studentProfileId}`} name="consenterDescription" maxLength={200} required />
                        <label htmlFor={`ev-${s.studentProfileId}`}>{m.offlineEvidence}</label>
                        <input id={`ev-${s.studentProfileId}`} name="evidenceReference" maxLength={200} required />
                      </ActionForm>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {can.administer ? (
        <section className="card" aria-labelledby="option-c">
          <h2 id="option-c">{m.optionCHeading}</h2>
          <p>
            <strong>{m.optionCStatus[optionC?.status ?? "NOT_ENABLED"]}</strong>
          </p>
          <p className="muted">{m.optionCNote}</p>
          {optionC && optionC.status !== "PENDING" && optionC.status !== "ENABLED" ? (
            <ActionForm action={requestOptionCAction} submitLabel={m.optionCRequest} pendingLabel={dict.common.loading} messages={dict.results}>
              <input type="hidden" name="tenantId" value={tenant.id} />
            </ActionForm>
          ) : null}
          {optionC?.status === "PENDING" && optionC.requestedByMe ? (
            <ActionForm action={cancelOptionCAction} submitLabel={m.optionCCancel} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary">
              <input type="hidden" name="tenantId" value={tenant.id} />
            </ActionForm>
          ) : null}
        </section>
      ) : null}

      {deletionRequests ? (
        <section className="card" aria-labelledby="deletions">
          <h2 id="deletions">{m.deletionHeading}</h2>
          <p className="muted">{m.deletionNote}</p>
          {deletionRequests.length === 0 ? (
            <p className="muted">{m.noDeletion}</p>
          ) : (
            <ul className="list">
              {deletionRequests.map((d) => (
                <li key={d.id} className="row">
                  <span>
                    {d.clip
                      ? `${m.clips} — ${name(d.clip.correction.student.profile.displayName)}`
                      : `${m.recordingsHeading} — ${d.recording?.title ?? m.untitled}`}{" "}
                    <span className="muted">({m.reasons[d.reason]})</span>
                  </span>
                  {canApproveMediaDeletion(actor, { tenantId: tenant.id, requestedById: d.requestedById }) ? (
                    <ActionForm action={approveMediaDeletionAction} submitLabel={m.approveDeletion} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="requestId" value={d.id} />
                    </ActionForm>
                  ) : null}
                  {d.awaitingSecondAdmin ? <span className="muted">{m.awaitingSecondAdmin}</span> : null}
                  {d.requestedById === actor.profileId ? (
                    <ActionForm action={cancelMediaDeletionAction} submitLabel={m.cancelDeletion} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="requestId" value={d.id} />
                    </ActionForm>
                  ) : (
                    <ActionForm action={declineMediaDeletionAction} submitLabel={m.declineDeletion} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="requestId" value={d.id} />
                      <label htmlFor={`decline-${d.id}`} className="visually-hidden">{m.declineReason}</label>
                      <input id={`decline-${d.id}`} name="reason" maxLength={500} placeholder={m.declineReason} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {recordings ? (
        <section className="card" aria-labelledby="recordings">
          <h2 id="recordings">{m.recordingsHeading}</h2>
          <p className="muted">{m.recordingsNote}</p>
          <p>
            {m.optionCHeading}: <strong>{m.optionCStatus[optionC?.status ?? "NOT_ENABLED"]}</strong>
          </p>
          {can.teach && optionC?.status === "ENABLED" ? (
            <ActionForm action={createRecordingAction} submitLabel={m.createRecording} pendingLabel={dict.common.loading} messages={dict.results}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <label htmlFor="recordingTitle">{m.recordingTitle}</label>
              <input id="recordingTitle" name="title" maxLength={200} />
            </ActionForm>
          ) : null}
          {recordings.length === 0 ? (
            <p className="muted">{m.noRecordings}</p>
          ) : (
            <ul className="list">
              {recordings.map((r) => (
                <li key={r.id} className="row">
                  <span>
                    {r.title ?? m.untitled} — {r.deletedAt ? m.clipRemoved : m.recordingStatus[r.status]}{" "}
                    <span className="muted">({name(r.teacher.displayName)})</span>
                  </span>
                  {r.status === "REJECTED" && r.rejectionReason ? <span className="muted">{format(m.rejectedBecause, { reason: r.rejectionReason })}</span> : null}
                  {["DRAFT", "REJECTED", "REVOKED"].includes(r.status) && r.teacherProfileId === actor.profileId && !r.deletedAt ? (
                    <ActionForm action={submitRecordingAction} submitLabel={r.status === "DRAFT" ? m.submit : m.resubmit} pendingLabel={dict.common.loading} messages={dict.results} inline>
                      <input type="hidden" name="recordingId" value={r.id} />
                    </ActionForm>
                  ) : null}
                  {r.status === "PENDING_APPROVAL" && !r.deletedAt && canApproveRecording(actor, r) ? (
                    <>
                      <ActionForm action={approveRecordingAction} submitLabel={m.approve} pendingLabel={dict.common.loading} messages={dict.results} inline>
                        <input type="hidden" name="recordingId" value={r.id} />
                      </ActionForm>
                      <ActionForm action={rejectRecordingAction} submitLabel={m.reject} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                        <input type="hidden" name="recordingId" value={r.id} />
                        <label htmlFor={`reject-${r.id}`} className="visually-hidden">{m.rejectReason}</label>
                        <input id={`reject-${r.id}`} name="reason" maxLength={500} placeholder={m.rejectReason} />
                      </ActionForm>
                    </>
                  ) : null}
                  {r.status === "APPROVED" && can.administer ? (
                    <ActionForm action={revokeRecordingApprovalAction} submitLabel={m.revoke} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="recordingId" value={r.id} />
                    </ActionForm>
                  ) : null}
                  {!r.deletedAt && r.deletionRequests.length === 0 && canRequestMediaDeletion(actor, r) && r.mediaFinalizedAt ? (
                    <ActionForm action={requestMediaDeletionAction} submitLabel={m.requestDeletion} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                      <input type="hidden" name="recordingId" value={r.id} />
                    </ActionForm>
                  ) : null}
                  {r.deletionRequests.length > 0 && !r.deletedAt ? <span className="muted">{m.deletionPending}</span> : null}
                </li>
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
