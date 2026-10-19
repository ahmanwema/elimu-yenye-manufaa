import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { rejectPaymentAction, submitPaymentAction, verifyPaymentAction } from "@/server/actions/live-class";
import { getCurrentActor } from "@/server/auth";
import { canVerifyPayment } from "@/server/authz/live-class";
import { AuthorizationError } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { getTenant } from "@/server/data/tenants";
import { listFinanceEnrollments, listPaymentSubmissions } from "@/server/services/enrollments";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).live.financeTitle, robots: { index: false } };
}

export default async function FinancePage({ params }: PageProps<"/[locale]/markaz/[tenantId]/finance">) {
  const dict = await getDictionary();
  return (
    <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
      <FinanceBody params={params} />
    </Suspense>
  );
}

// A140: the finance desk of one Markaz — Markaz Admins and Finance Officers only. It shows only
// what payment work needs (student, class, access state and period, evidence reference) and no
// class configuration, live-session, teaching or academic data.
async function FinanceBody({ params }: { params: PageProps<"/[locale]/markaz/[tenantId]/finance">["params"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const l = dict.live;
  const { tenantId } = await params;
  const current = await getCurrentActor();
  if (current.state === "not-configured") return <p>{dict.common.notConfigured}</p>;
  if (current.state !== "signed-in") redirect(`/${locale}/sign-in?next=/${locale}/markaz/${tenantId}/finance`);
  const db = getDb();
  const { actor } = current;
  if (!canVerifyPayment(actor, tenantId)) return <p role="alert">{dict.markaz.notAllowed}</p>;

  let tenant;
  try {
    tenant = await getTenant(db, actor, tenantId);
  } catch (error) {
    if (error instanceof AuthorizationError) return <p role="alert">{dict.markaz.notAllowed}</p>;
    throw error;
  }
  if (!tenant) return <p role="alert">{dict.markaz.notAllowed}</p>;
  const [payments, enrollments] = await Promise.all([listPaymentSubmissions(db, actor, tenantId), listFinanceEnrollments(db, actor, tenantId)]);
  const name = (n: string | null | undefined) => n ?? dict.markaz.unnamed;
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const results = dict.results;
  const loading = dict.common.loading;

  return (
    <>
      <p>
        <a href={`/${locale}/markaz/${tenant.id}`}>{tenant.name}</a>
      </p>
      <h1>{l.financeTitle}</h1>
      <p className="muted">{l.paymentNote}</p>

      <section className="card" aria-labelledby="payments">
        <h2 id="payments">{l.paymentsHeading}</h2>
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
                    <ActionForm action={verifyPaymentAction} submitLabel={l.verify} pendingLabel={loading} messages={results} inline>
                      <input type="hidden" name="submissionId" value={p.id} />
                    </ActionForm>
                    <ActionForm action={rejectPaymentAction} submitLabel={l.reject} pendingLabel={loading} messages={results} variant="secondary" inline>
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

      <section className="card" aria-labelledby="enrollments">
        <h2 id="enrollments">{l.financeEnrollmentsHeading}</h2>
        {enrollments.length === 0 ? (
          <p className="muted">{l.noEnrollments}</p>
        ) : (
          <ul className="list">
            {enrollments.map((e) => (
              <li key={e.id}>
                <p className="row">
                  <strong>{name(e.student.profile.displayName)}</strong>
                  <span>{e.class.name}</span>
                  {e.class.paymentRequired ? <span className="badge">{l.paymentRequiredBadge}</span> : null}
                  <span>{l.enrollmentStates[e.effectiveStatus]}</span>
                  {e.accessUntil ? <span className="muted">{format(l.accessUntil, { date: dateFmt.format(e.accessUntil) })}</span> : null}
                </p>
                <details>
                  <summary>{l.paymentHeading}</summary>
                  <ActionForm action={submitPaymentAction} submitLabel={l.submitPayment} pendingLabel={loading} messages={results}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input type="hidden" name="studentProfileId" value={e.studentProfileId} />
                    <input type="hidden" name="enrollmentIds" value={e.id} />
                    <label htmlFor={`pc-${e.id}`}>{l.paymentCoverage}</label>
                    <input id={`pc-${e.id}`} name="coverageNote" maxLength={500} defaultValue={e.class.name} required />
                    <label htmlFor={`pr-${e.id}`}>{l.paymentReference}</label>
                    <input id={`pr-${e.id}`} name="evidenceReference" maxLength={200} required dir="ltr" />
                    <label htmlFor={`ps-${e.id}`}>{l.periodStart}</label>
                    <input id={`ps-${e.id}`} name="periodStart" type="date" required />
                    <label htmlFor={`pe-${e.id}`}>{l.periodEnd}</label>
                    <input id={`pe-${e.id}`} name="periodEnd" type="date" required />
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
