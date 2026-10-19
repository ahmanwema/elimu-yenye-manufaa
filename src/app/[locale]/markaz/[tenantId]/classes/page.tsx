import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { createClassAction, rejectPaymentAction, setTimezoneAction, verifyPaymentAction } from "@/server/actions/live-class";
import { getCurrentActor } from "@/server/auth";
import { canCreateClass, canVerifyPayment } from "@/server/authz/live-class";
import { AuthorizationError } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { getTenant } from "@/server/data/tenants";
import { getTenantClassSettings, listActiveTeachers, listClasses } from "@/server/services/classes";
import { listPaymentSubmissions } from "@/server/services/enrollments";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).live.classesTitle, robots: { index: false } };
}

export default async function ClassesPage({ params }: PageProps<"/[locale]/markaz/[tenantId]/classes">) {
  const dict = await getDictionary();
  return (
    <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
      <ClassesBody params={params} />
    </Suspense>
  );
}

// Sections render only when the server-side check passes; every action re-checks.
async function ClassesBody({ params }: { params: PageProps<"/[locale]/markaz/[tenantId]/classes">["params"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const l = dict.live;
  const { tenantId } = await params;
  const current = await getCurrentActor();
  if (current.state === "not-configured") return <p>{dict.common.notConfigured}</p>;
  if (current.state !== "signed-in") redirect(`/${locale}/sign-in?next=/${locale}/markaz/${tenantId}/classes`);
  const db = getDb();
  const { actor } = current;

  let tenant;
  let classes;
  try {
    tenant = await getTenant(db, actor, tenantId);
    classes = await listClasses(db, actor, tenantId);
  } catch (error) {
    if (error instanceof AuthorizationError) return <p role="alert">{dict.markaz.notAllowed}</p>;
    throw error;
  }
  if (!tenant) return <p role="alert">{dict.markaz.notAllowed}</p>;

  const admin = canCreateClass(actor, tenantId);
  const [settings, teachers, payments] = await Promise.all([
    getTenantClassSettings(db, actor, tenantId),
    admin ? listActiveTeachers(db, actor, tenantId) : null,
    canVerifyPayment(actor, tenantId) ? listPaymentSubmissions(db, actor, tenantId) : null,
  ]);
  const name = (n: string | null | undefined) => n ?? dict.markaz.unnamed;
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: settings.timezone ?? "UTC" }); // display only (A131)
  const ceiling = (n: number | null) => (n === null ? l.noCeiling : String(n));

  return (
    <>
      <p>
        <a href={`/${locale}/markaz/${tenant.id}`}>{tenant.name}</a>
      </p>
      <h1>{l.classesTitle}</h1>
      <p className="muted">{l.classesNote}</p>
      {settings.timezone === null ? <p role="alert" className="callout">{l.timezoneRequired}</p> : null}
      <p className="muted">{format(l.ceilingLine, { enrollment: ceiling(settings.classEnrollmentCapacityMax), live: ceiling(settings.classLiveCapacityMax) })}</p>

      <section className="card" aria-labelledby="class-list">
        <h2 id="class-list">{l.classesTitle}</h2>
        {classes.length === 0 ? (
          <p className="muted">{l.noClasses}</p>
        ) : (
          <ul className="list">
            {classes.map((c) => {
              const primary = c.teachers.find((t) => t.role === "PRIMARY");
              return (
                <li key={c.id} className="row">
                  <a href={`/${locale}/markaz/${tenant.id}/classes/${c.id}`}>{c.name}</a>
                  {c.subject ? <span className="muted">({c.subject})</span> : null}
                  {c.status === "ARCHIVED" ? <span className="badge">{l.archivedLabel}</span> : null}
                  <span className="muted">
                    {l.teacherRoles.PRIMARY}: {name(primary?.teacher.displayName)}
                  </span>
                  <span className="muted">
                    {c.enrollmentCapacity
                      ? format(l.seats, { taken: c._count.enrollments, capacity: c.enrollmentCapacity })
                      : format(l.seatsUnlimited, { taken: c._count.enrollments })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {admin && teachers ? (
        <section className="card" aria-labelledby="new-class">
          <h2 id="new-class">{l.createHeading}</h2>
          {teachers.length === 0 ? (
            <p className="muted">{dict.markaz.noTeachers}</p>
          ) : (
            <ActionForm action={createClassAction} submitLabel={l.createClass} pendingLabel={dict.common.loading} messages={dict.results}>
              <input type="hidden" name="tenantId" value={tenant.id} />
              <label htmlFor="className">{l.className}</label>
              <input id="className" name="name" maxLength={200} required />
              <label htmlFor="subject">{l.subject}</label>
              <input id="subject" name="subject" maxLength={200} />
              <label htmlFor="description">{l.description}</label>
              <textarea id="description" name="description" maxLength={2000} rows={2} />
              <label htmlFor="primary">{l.primaryTeacher}</label>
              <select id="primary" name="primaryTeacherProfileId" required>
                {teachers.map((t) => (
                  <option key={t.profileId} value={t.profileId}>
                    {name(t.displayName)}
                  </option>
                ))}
              </select>
              <label htmlFor="enrollmentCapacity">{l.enrollmentCapacity}</label>
              <input id="enrollmentCapacity" name="enrollmentCapacity" type="number" min={1} max={settings.classEnrollmentCapacityMax ?? undefined} />
              <label htmlFor="liveCapacity">{l.liveCapacity}</label>
              <input id="liveCapacity" name="liveCapacity" type="number" min={1} max={settings.classLiveCapacityMax ?? undefined} />
              <p className="muted">{l.capacityHint}</p>
              <label>
                <input type="checkbox" name="paymentRequired" /> {l.paymentRequired}
              </label>
            </ActionForm>
          )}
        </section>
      ) : null}

      {admin ? (
        <section className="card" aria-labelledby="timezone">
          <h2 id="timezone">{l.timezoneHeading}</h2>
          <p className="muted">{l.timezoneNote}</p>
          <p>{format(l.timezoneCurrent, { timezone: settings.timezone ?? l.timezoneNotSet })}</p>
          <ActionForm action={setTimezoneAction} submitLabel={l.timezoneSave} pendingLabel={dict.common.loading} messages={dict.results} inline>
            <input type="hidden" name="tenantId" value={tenant.id} />
            <label htmlFor="tz" className="visually-hidden">{l.timezoneLabel}</label>
            <input id="tz" name="timezone" defaultValue={settings.timezone ?? ""} maxLength={64} required dir="ltr" placeholder={l.timezoneLabel} />
          </ActionForm>
        </section>
      ) : null}

      {payments ? (
        <section className="card" aria-labelledby="payments">
          <h2 id="payments">{l.paymentsHeading}</h2>
          <p className="muted">{l.paymentNote}</p>
          {payments.length === 0 ? (
            <p className="muted">{l.noPayments}</p>
          ) : (
            <ul className="list">
              {payments.map((p) => (
                <li key={p.id} className="row">
                  <span>
                    {format(l.paymentLine, {
                      student: name(p.student.profile.displayName),
                      coverage: p.coverageNote,
                      from: dateFmt.format(p.periodStart),
                      until: dateFmt.format(p.periodEnd),
                    })}{" "}
                    <span className="muted" dir="ltr">
                      [{p.evidenceReference}]
                    </span>{" "}
                    <span className="muted">— {p.enrollments.map((e) => e.enrollment.class.name).join(", ")}</span>
                  </span>
                  <strong>{l.paymentStatuses[p.status]}</strong>
                  {p.status === "SUBMITTED" ? (
                    <>
                      <ActionForm action={verifyPaymentAction} submitLabel={l.verify} pendingLabel={dict.common.loading} messages={dict.results} inline>
                        <input type="hidden" name="submissionId" value={p.id} />
                      </ActionForm>
                      <ActionForm action={rejectPaymentAction} submitLabel={l.reject} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                        <input type="hidden" name="submissionId" value={p.id} />
                        <label htmlFor={`rej-${p.id}`} className="visually-hidden">{l.rejectReason}</label>
                        <input id={`rej-${p.id}`} name="reason" maxLength={500} placeholder={l.rejectReason} />
                      </ActionForm>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
