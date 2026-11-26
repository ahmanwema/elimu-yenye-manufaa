import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { MarkazSwitcher } from "@/components/markaz-switcher";
import { enrollmentTone } from "@/lib/student-dashboard";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import { rejectPaymentAction, submitPaymentAction, verifyPaymentAction } from "@/server/actions/live-class";
import { getCurrentActor } from "@/server/auth";
import { canVerifyPayment } from "@/server/authz/live-class";
import { AuthorizationError } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { getTenant, listMyTenants } from "@/server/data/tenants";
import { listFinanceEnrollments, listPaymentSubmissions } from "@/server/services/enrollments";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).live.financeTitle, robots: { index: false } };
}

type FinanceProps = PageProps<"/[locale]/markaz/[tenantId]/finance">;

export default async function FinancePage({ params, searchParams }: FinanceProps) {
  const dict = await getDictionary();
  return (
    <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
      <FinanceBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

// F5 tabs. The filter only narrows a list the service already authorized; an unknown value
// falls back to the pending queue.
const PAYMENT_TABS = ["SUBMITTED", "VERIFIED", "REJECTED", "all"] as const;
type PaymentTab = (typeof PAYMENT_TABS)[number];
function paymentTab(value: unknown): PaymentTab {
  return typeof value === "string" && (PAYMENT_TABS as readonly string[]).includes(value) ? (value as PaymentTab) : "SUBMITTED";
}

// A140: the finance desk of one Markaz — Markaz Admins and Finance Officers only. It shows only
// what payment work needs (student, class, access state and period, evidence reference) and no
// class configuration, live-session, teaching or academic data.
async function FinanceBody({ params, searchParams }: { params: FinanceProps["params"]; searchParams: FinanceProps["searchParams"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const l = dict.live;
  const a = dict.adminDashboard;
  const { tenantId } = await params;
  const tab = paymentTab((await searchParams).status);
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
  const count = (s: PaymentTab) => (s === "all" ? payments.length : payments.filter((p) => p.status === s).length);
  const shown = tab === "all" ? payments : payments.filter((p) => p.status === tab);
  const awaiting = enrollments.filter((e) => e.effectiveStatus === "PENDING_PAYMENT").length;
  const tabLabel = (s: PaymentTab) => (s === "all" ? a.financeAll : l.paymentStatuses[s]);
  const statusTone = { SUBMITTED: "accent", VERIFIED: "success", REJECTED: "danger" } as const;
  const myTenants = (await listMyTenants(db, actor)).filter((t) => canVerifyPayment(actor, t.id));

  return (
    <>
      <MarkazSwitcher tenants={myTenants} currentId={tenant.id} locale={locale} path="/finance" label={a.switchLabel} currentLabel={a.currentMarkaz} />
      <p>
        <a href={`/${locale}/markaz/${tenant.id}`}>{tenant.name}</a>
      </p>
      <h1>{l.financeTitle}</h1>
      <p className="muted">{l.paymentNote}</p>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-value">{count("SUBMITTED")}</span>
          <span className="stat-label">{a.kpiPayments}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{awaiting}</span>
          <span className="stat-label">{a.kpiAwaiting}</span>
        </div>
      </div>

      <section aria-labelledby="payments">
        <h2 id="payments" className="section-title">
          {l.paymentsHeading}
        </h2>
        <nav aria-label={l.paymentsHeading}>
          <ul className="tabs">
            {PAYMENT_TABS.map((s) => (
              <li key={s}>
                <a href={`?status=${s}`} aria-current={tab === s ? "page" : undefined}>
                  {tabLabel(s)} <span className="tab-count">{count(s)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {payments.length === 0 ? (
          <p className="empty-state">{l.noPayments}</p>
        ) : shown.length === 0 ? (
          <p className="empty-state">{a.noPaymentsInTab}</p>
        ) : (
          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{a.colStudent}</th>
                  <th scope="col">{a.colClasses}</th>
                  <th scope="col">{a.colPeriod}</th>
                  <th scope="col">{a.colReference}</th>
                  <th scope="col">{a.colStatus}</th>
                  <th scope="col">{a.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{name(p.student.profile.displayName)}</strong>
                      <div className="muted">{p.coverageNote}</div>
                    </td>
                    <td>{p.enrollments.map((e) => e.enrollment.class.name).join(", ")}</td>
                    <td className="nowrap">
                      {dateFmt.format(p.periodStart)} – {dateFmt.format(p.periodEnd)}
                    </td>
                    <td>
                      <code dir="ltr">{p.evidenceReference}</code>
                    </td>
                    <td>
                      <span className={`badge badge-${statusTone[p.status]}`}>{l.paymentStatuses[p.status]}</span>
                    </td>
                    <td>
                      {p.status === "SUBMITTED" ? (
                        <div className="row">
                          <ActionForm action={verifyPaymentAction} submitLabel={l.verify} pendingLabel={loading} messages={results} inline>
                            <input type="hidden" name="submissionId" value={p.id} />
                          </ActionForm>
                          <ActionForm action={rejectPaymentAction} submitLabel={l.reject} pendingLabel={loading} messages={results} variant="secondary" inline>
                            <input type="hidden" name="submissionId" value={p.id} />
                            <label htmlFor={`rej-${p.id}`} className="visually-hidden">{l.rejectReason}</label>
                            <input id={`rej-${p.id}`} name="reason" maxLength={500} placeholder={l.rejectReason} />
                          </ActionForm>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <span className={`badge badge-${enrollmentTone(e.effectiveStatus)}`}>{l.enrollmentStates[e.effectiveStatus]}</span>
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
