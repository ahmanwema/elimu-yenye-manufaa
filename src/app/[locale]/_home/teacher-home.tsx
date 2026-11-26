import { Icon } from "@/components/icons";
import { format, type Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";
import { upcomingSessions, sessionTone } from "@/lib/teacher-dashboard";
import { AuthorizationError, hasActiveRole, type Actor } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { listMyTenants } from "@/server/data/tenants";
import { getClassOverview, listClasses } from "@/server/services/classes";
import { listTenantCorrections } from "@/server/services/corrections";

// Teacher section of the home dashboard (ui-plan §4, F4). Built only from services that already
// authorize the teacher (listClasses, getClassOverview, listTenantCorrections); starting or
// ending a session stays on the class page, where its own permission check runs.

async function loadTeacherData(actor: Actor, now: Date) {
  const db = getDb();
  const tenants = (await listMyTenants(db, actor)).filter((t) => hasActiveRole(actor, t.id, "TEACHER"));
  const classLists = await Promise.all(tenants.map((t) => listClasses(db, actor, t.id).catch(() => [])));
  const overviews = (
    await Promise.all(
      classLists.flat().map((c) =>
        getClassOverview(db, actor, c.id, { now }).catch((error: unknown) => {
          if (error instanceof AuthorizationError) return null;
          throw error;
        }),
      ),
    )
  ).filter((o): o is NonNullable<typeof o> => o !== null);

  // Only classes this person currently teaches (a Markaz Admin of the same Markaz would
  // otherwise get every class).
  const taught = overviews
    .map((o) => ({ overview: o, mine: o.teachers.find((t) => t.teacherProfileId === actor.profileId && !t.endedAt) }))
    .filter((x): x is typeof x & { mine: NonNullable<typeof x.mine> } => x.mine !== undefined)
    .filter((x) => x.overview.class.status !== "ARCHIVED");

  const corrections = (
    await Promise.all(tenants.map((t) => listTenantCorrections(db, actor, t.id).catch(() => [])))
  ).flat().filter((c) => c.teacherProfileId === actor.profileId);

  return { taught, correctionCount: corrections.length };
}

export async function TeacherHome({ locale, dict, actor }: { locale: Locale; dict: Dictionary; actor: Actor }) {
  const t = dict.teacherDashboard;
  const l = dict.live;
  const now = new Date();
  const { taught, correctionCount } = await loadTeacherData(actor, now);

  const sessions = upcomingSessions(
    taught.flatMap((c) => c.overview.sessions.map((s) => ({ ...s, cls: c.overview.class }))),
    now,
  );
  const students = taught.reduce((sum, c) => sum + (c.overview.seatsTaken ?? 0), 0);
  const dateTime = (date: Date, tz: string | null) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz ?? "UTC" }).format(date);
  const classHref = (c: { tenantId: string; id: string }) => `/${locale}/markaz/${c.tenantId}/classes/${c.id}`;

  return (
    <>
      <p className="muted">{t.intro}</p>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-value">{taught.length}</span>
          <span className="stat-label">{t.kpiClasses}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{students}</span>
          <span className="stat-label">{t.kpiStudents}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{sessions.length}</span>
          <span className="stat-label">{t.kpiSessions}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{correctionCount}</span>
          <span className="stat-label">{t.kpiCorrections}</span>
        </div>
      </div>

      <section aria-labelledby="teacher-sessions">
        <h2 id="teacher-sessions" className="section-title">
          <Icon name="classes" /> {t.sessionsHeading}
        </h2>
        {sessions.length === 0 ? (
          <p className="empty-state">{t.noSessions}</p>
        ) : (
          <ul className="list-reset session-list">
            {sessions.map((s) => (
              <li key={s.id} className={`card session-row${s.status === "LIVE" ? " is-live" : ""}`}>
                <div className="session-when">{dateTime(s.scheduledStartAt, s.cls.timezone)}</div>
                <div className="session-what">
                  <strong>{s.title ?? s.cls.name}</strong>
                  {s.title ? <span className="muted"> · {s.cls.name}</span> : null}
                </div>
                <span className={`badge badge-${sessionTone(s.status)}`}>{l.sessionStatuses[s.status]}</span>
                {s.status === "LIVE" ? (
                  <a className="button button-primary button-sm" href={`/${locale}/live/${s.id}`}>
                    {t.enterLive}
                  </a>
                ) : (
                  <a className="button button-secondary button-sm" href={`${classHref(s.cls)}#sessions`}>
                    {t.openClass}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="teacher-classes">
        <h2 id="teacher-classes" className="section-title">
          <Icon name="markaz" /> {t.classesHeading}
        </h2>
        {taught.length === 0 ? (
          <p className="empty-state">{t.noClasses}</p>
        ) : (
          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t.colClass}</th>
                  <th scope="col">{t.colSubject}</th>
                  <th scope="col">{t.colRole}</th>
                  <th scope="col">{t.colStudents}</th>
                  <th scope="col">{t.colNext}</th>
                </tr>
              </thead>
              <tbody>
                {taught.map(({ overview: o, mine }) => {
                  const nextSession = upcomingSessions(o.sessions, now, 365).find((s) => s.status === "SCHEDULED");
                  return (
                    <tr key={o.class.id}>
                      <td>
                        <a href={classHref(o.class)}>{o.class.name}</a>
                      </td>
                      <td>{o.class.subject ? <span className="badge">{o.class.subject}</span> : null}</td>
                      <td>{l.teacherRoles[mine.role]}</td>
                      <td>
                        {o.class.effectiveEnrollmentCapacity
                          ? format(l.seats, { taken: o.seatsTaken ?? 0, capacity: o.class.effectiveEnrollmentCapacity })
                          : format(l.seatsUnlimited, { taken: o.seatsTaken ?? 0 })}
                      </td>
                      <td className="muted">{nextSession ? dateTime(nextSession.scheduledStartAt, o.class.timezone) : t.notScheduled}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
