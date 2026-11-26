import { Icon } from "@/components/icons";
import { format, type Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";
import { attendanceTone } from "@/lib/student-dashboard";
import type { Actor } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { listStudentCorrections } from "@/server/services/corrections";
import { listChildAttendance } from "@/server/services/live-sessions";
import { listMyParentLinks } from "@/server/services/parent-links";

// Parent section of the home dashboard (ui-plan §4, F6). Only ACTIVE links reveal a child
// (listMyParentLinks), and each child's data comes from services that re-check the link
// (A41, A127): attendance STATUS and the session date only — never times or durations.

const TONE_BADGE = { present: "success", late: "warning", absent: "danger" } as const;
const RECENT = 5;

export async function ParentHome({ locale, dict, actor }: { locale: Locale; dict: Dictionary; actor: Actor }) {
  const p = dict.parentDashboard;
  const l = dict.live;
  const db = getDb();
  const links = await listMyParentLinks(db, actor);
  const children = links.filter((x): x is typeof x & { studentProfileId: string } => x.studentProfileId !== null);
  const pending = links.filter((x) => x.status === "PENDING" || x.status === "VERIFIED").length;

  const data = await Promise.all(
    children.map(async (c) => {
      const [attendance, corrections] = await Promise.all([
        listChildAttendance(db, actor, c.studentProfileId).catch(() => []),
        listStudentCorrections(db, actor, c.studentProfileId).catch(() => []),
      ]);
      return { child: c, attendance, corrections };
    }),
  );

  return (
    <section aria-labelledby="my-children">
      <h2 id="my-children" className="section-title">
        <Icon name="account" /> {p.heading}
      </h2>
      <p className="muted">{p.intro}</p>
      {pending > 0 ? <p className="callout">{format(p.pendingLinks, { count: pending })}</p> : null}
      {data.length === 0 ? (
        <div className="empty-state">
          <p>{p.noChildren}</p>
          <a className="button button-secondary button-sm" href={`/${locale}/account`}>
            {p.requestLink}
          </a>
        </div>
      ) : (
        <ul className="card-grid list-reset">
          {data.map(({ child, attendance, corrections }) => {
            const present = attendance.filter((r) => r.status !== "ABSENT").length;
            return (
              <li key={child.id} className="card child-card">
                <div className="row">
                  <span className="badge">{child.markazName}</span>
                </div>
                <h3 className="card-title">{child.studentName ?? dict.markaz.unnamed}</h3>
                <p className="card-meta">
                  <span>{attendance.length > 0 ? format(p.attendedSummary, { present, total: attendance.length }) : l.noAttendance}</span>
                  <span>{format(p.corrections, { count: corrections.length })}</span>
                </p>
                {attendance.length > 0 ? (
                  <>
                    <h4 className="mini-heading">{p.recentAttendance}</h4>
                    <ul className="list-reset attendance-mini">
                      {attendance.slice(0, RECENT).map((r) => {
                        const tone = attendanceTone(r.status, r.punctuality);
                        return (
                          <li key={r.id}>
                            <span className="muted">
                              {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: r.timezone ?? "UTC" }).format(r.sessionDate)}
                            </span>
                            <span>{r.className}</span>
                            <span className={`badge badge-${TONE_BADGE[tone]}`}>
                              {l.attendanceStatuses[r.status]}
                              {r.punctuality ? ` · ${l.punctualityStatuses[r.punctuality]}` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}
                <div className="card-actions">
                  <a className="button button-secondary button-sm" href={`/${locale}/account#child-${child.id}`}>
                    {p.viewDetails}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
