import { Suspense } from "react";
import { ParentHome } from "./_home/parent-home";
import { TeacherHome } from "./_home/teacher-home";
import { Icon } from "@/components/icons";
import { MediaPlayButton } from "@/components/media-play-button";
import { format, type Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";
import { getDictionary, getLocale } from "@/i18n/server";
import {
  attendanceTone,
  dayKey,
  enrollmentTone,
  monthGrid,
  pickNextSession,
  type AttendanceTone,
} from "@/lib/student-dashboard";
import { getCurrentActor } from "@/server/auth";
import { AuthorizationError, type Actor } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { listMyTenants } from "@/server/data/tenants";
import { buildNav } from "@/server/navigation";
import { getClassOverview, listClasses } from "@/server/services/classes";
import { listStudentCorrections } from "@/server/services/corrections";
import { SEAT_HOLDING_STATES } from "@/server/services/live-rules";
import { listMyAttendance } from "@/server/services/live-sessions";

// Home (ui-plan §4). Signed out: the public introduction. Signed in: a dashboard — the full
// student view (F3) for a student, quick links to their areas for everyone else until their
// own phases (F4–F6). Every figure comes from a service that has already authorized it.

export default async function HomePage() {
  const dict = await getDictionary();
  return (
    <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
      <HomeBody />
    </Suspense>
  );
}

async function HomeBody() {
  const locale = await getLocale();
  const dict = await getDictionary();
  const current = await getCurrentActor();
  if (current.state !== "signed-in") return <PublicHome locale={locale} dict={dict} />;
  return <Dashboard locale={locale} dict={dict} actor={current.actor} />;
}

function PublicHome({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <>
      <p className="badge badge-accent">{dict.home.badge}</p>
      <h1>{dict.home.title}</h1>
      <p className="muted">{dict.home.intro}</p>
      <section className="card">
        <h2>{dict.home.invitedTitle}</h2>
        <p>{dict.home.invitedBody}</p>
        <a className="button button-primary" href={`/${locale}/sign-in`}>
          {dict.nav.signIn}
        </a>
      </section>
    </>
  );
}

async function loadStudentData(actor: Actor, now: Date) {
  const db = getDb();
  const tenants = (await listMyTenants(db, actor)).filter((t) => t.roles.includes("STUDENT"));
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

  // Only classes the person is actually enrolled in as a student (an admin of the same Markaz
  // would otherwise see every class here).
  const myClasses = overviews
    .map((o) => ({ overview: o, enrollment: o.enrollments.find((e) => e.studentProfileId === actor.profileId && e.effectiveStatus !== "ENDED") }))
    .filter((x): x is typeof x & { enrollment: NonNullable<typeof x.enrollment> } => x.enrollment !== undefined);

  const [attendance, corrections] = await Promise.all([
    listMyAttendance(db, actor),
    listStudentCorrections(db, actor, actor.profileId).catch(() => []),
  ]);
  return { myClasses, attendance, corrections };
}

async function Dashboard({ locale, dict, actor }: { locale: Locale; dict: Dictionary; actor: Actor }) {
  const d = dict.dashboard;
  const db = getDb();
  const profile = await db.profile.findUnique({
    where: { id: actor.profileId },
    select: { displayName: true, studentAccount: { select: { profileId: true } }, parentAccount: { select: { profileId: true } } },
  });
  const isStudent = profile?.studentAccount != null && actor.memberships.some((m) => m.status === "ACTIVE" && m.role === "STUDENT");
  const isTeacher = actor.memberships.some((m) => m.status === "ACTIVE" && m.role === "TEACHER");
  const isParent = profile?.parentAccount != null;
  const greeting = profile?.displayName ? format(d.greeting, { name: profile.displayName }) : d.greetingNoName;
  const links = buildNav(actor, locale).filter((i) => i.key !== "home");
  // Quick links for roles without a section of their own (admin, finance, Super Admin) —
  // not for a parent whose only other destination is the account page.
  const showQuickLinks = !isTeacher && !isStudent && (!isParent || links.length > 1);

  // Order: teaching, own learning, children. Each later block gets a divider.
  return (
    <>
      <h1>{greeting}</h1>
      {showQuickLinks ? (
        <>
          <p className="muted">{d.quickLinksNote}</p>
          <h2 className="section-title">{d.quickLinksHeading}</h2>
          <div className="card-grid">
            {links.map((item) => (
              <a key={item.key} href={item.href} className="card card-interactive quick-link">
                <Icon name={item.key} size={28} />
                <span>{dict.nav.items[item.key]}</span>
              </a>
            ))}
          </div>
        </>
      ) : null}
      {isTeacher ? <TeacherHome locale={locale} dict={dict} actor={actor} /> : null}
      {isTeacher && isStudent ? <h2 className="section-title section-divider">{dict.teacherDashboard.studentSectionHeading}</h2> : null}
      {isStudent ? <StudentHome locale={locale} dict={dict} actor={actor} /> : null}
      {isParent ? (
        <div className={isTeacher || isStudent || showQuickLinks ? "section-divider" : undefined}>
          <ParentHome locale={locale} dict={dict} actor={actor} />
        </div>
      ) : null}
    </>
  );
}

async function StudentHome({ locale, dict, actor }: { locale: Locale; dict: Dictionary; actor: Actor }) {
  const d = dict.dashboard;
  const now = new Date();
  const { myClasses, attendance, corrections } = await loadStudentData(actor, now);
  const l = dict.live;
  const tzByClass = new Map(myClasses.map((c) => [c.overview.class.id, c.overview.class.timezone]));
  const homeTz = myClasses[0]?.overview.class.timezone ?? null;

  // Next class: only from classes that currently hold a seat (ACTIVE / GRACE); a pending payment
  // or waitlist shows on the class card instead.
  const candidates = myClasses
    .filter((c) => SEAT_HOLDING_STATES.includes(c.enrollment.effectiveStatus))
    .flatMap((c) => c.overview.sessions.map((s) => ({ ...s, cls: c.overview.class })));
  const next = pickNextSession(candidates, now);
  const dateTime = (date: Date, tz: string | null) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", timeZone: tz ?? "UTC" }).format(date);

  // Attendance calendar for the current month, in the Markaz time zone (UTC when unset, A131).
  const todayKey = dayKey(now, homeTz);
  const [year, month] = todayKey.split("-").map(Number);
  const records = attendance.map((r) => ({ key: dayKey(r.sessionDate, tzByClass.get(r.classId) ?? homeTz), tone: attendanceTone(r.status, r.punctuality) }));
  const weeks = monthGrid(year, month - 1, records, todayKey);
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 1 + i))),
  );
  const present = attendance.filter((r) => r.status !== "ABSENT").length;
  const toneLabel: Record<AttendanceTone, string> = {
    present: l.attendanceStatuses.PRESENT,
    late: l.punctualityStatuses.LATE,
    absent: l.attendanceStatuses.ABSENT,
  };
  const dateOnly = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <>
      <p className="muted">{d.intro}</p>

      <div className="dashboard">
        <div className="dashboard-main">
          <section aria-labelledby="next-class">
            <h2 id="next-class" className="section-title">
              <Icon name="classes" /> {d.nextClassHeading}
            </h2>
            {next ? (
              <div className="card next-class">
                <div className="row">
                  {next.status === "LIVE" ? <span className="badge badge-danger">● {d.liveNow}</span> : null}
                  {next.cls.subject ? <span className="badge">{next.cls.subject}</span> : null}
                </div>
                <h3 className="card-title">{next.title ?? next.cls.name}</h3>
                {next.title ? <p className="muted">{next.cls.name}</p> : null}
                <p className="card-meta">{dateTime(next.scheduledStartAt, next.cls.timezone)}</p>
                <div className="card-actions">
                  {next.status === "LIVE" ? (
                    <a className="button button-primary" href={`/${locale}/live/${next.id}`}>
                      {d.enterClass}
                    </a>
                  ) : (
                    <a className="button button-secondary" href={`/${locale}/markaz/${next.cls.tenantId}/classes/${next.cls.id}`}>
                      {d.viewClass}
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="empty-state">{d.noUpcoming}</p>
            )}
          </section>

          <section aria-labelledby="my-classes">
            <h2 id="my-classes" className="section-title">
              <Icon name="markaz" /> {d.myClassesHeading}
            </h2>
            {myClasses.length === 0 ? (
              <p className="empty-state">{d.noClasses}</p>
            ) : (
              <ul className="card-grid list-reset">
                {myClasses.map(({ overview: o, enrollment }) => {
                  const primary = o.teachers.find((t) => t.role === "PRIMARY" && !t.endedAt);
                  return (
                    <li key={o.class.id} className="card class-card">
                      <div className="row">
                        <span className="badge">{o.class.subject ?? l.classesTitle}</span>
                        <span className={`badge badge-${enrollmentTone(enrollment.effectiveStatus)}`}>
                          {l.enrollmentStates[enrollment.effectiveStatus]}
                        </span>
                      </div>
                      <h3 className="card-title">
                        <a href={`/${locale}/markaz/${o.class.tenantId}/classes/${o.class.id}`}>{o.class.name}</a>
                      </h3>
                      {o.class.description ? <p className="muted clamp-2">{o.class.description}</p> : null}
                      <p className="card-meta">
                        {primary?.teacher.displayName ? <span>{format(d.teacherLine, { name: primary.teacher.displayName })}</span> : null}
                        {o.class.paymentRequired ? <span>{l.paymentRequiredBadge}</span> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="latest-corrections">
            <h2 id="latest-corrections" className="section-title">
              <Icon name="account" /> {d.correctionsHeading}
            </h2>
            {corrections.length === 0 ? (
              <p className="empty-state">{d.noCorrections}</p>
            ) : (
              <>
                <ul className="list">
                  {corrections.slice(0, 3).map((c) => {
                    const clip = c.audioClips.find((x) => x.isPrimary && x.status === "FINALIZED" && !x.deletedAt);
                    return (
                      <li key={c.id} className="card correction-card">
                        <p className="card-meta">
                          {format(d.correctionFrom, { teacher: c.teacher.displayName ?? dict.markaz.unnamed, date: dateOnly.format(c.capturedAt) })}
                          <span>{c.tenant.name}</span>
                        </p>
                        {c.note ? <p>{c.note}</p> : null}
                        {clip ? (
                          <MediaPlayButton kind="clip" id={clip.id} label={dict.media.play} loading={dict.common.loading} results={dict.results} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <p>
                  <a href={`/${locale}/account#my-corrections`}>{d.allCorrections}</a>
                </p>
              </>
            )}
          </section>
        </div>

        <aside className="dashboard-side" aria-labelledby="my-attendance">
          <h2 id="my-attendance" className="section-title">
            <Icon name="home" /> {d.attendanceHeading}
          </h2>
          <div className="card">
            <p className="calendar-title">{monthTitle}</p>
            <table className="calendar">
              <thead>
                <tr>
                  {weekdayNames.map((w, i) => (
                    <th key={i} scope="col">
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((cell, ci) => (
                      <td key={ci}>
                        {cell ? (
                          <span
                            className={`calendar-day${cell.tone ? ` tone-${cell.tone}` : ""}${cell.today ? " is-today" : ""}`}
                            aria-current={cell.today ? "date" : undefined}
                          >
                            {cell.day}
                            {cell.tone ? <span className="visually-hidden"> — {toneLabel[cell.tone]}</span> : null}
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="calendar-legend" aria-label={d.legendLabel}>
              {(["present", "late", "absent"] as const).map((t) => (
                <li key={t}>
                  <span className={`legend-dot tone-${t}`} aria-hidden="true" /> {toneLabel[t]}
                </li>
              ))}
            </ul>
            <p className="muted">
              {attendance.length === 0 ? d.noAttendance : format(d.attendanceSummary, { present, total: attendance.length })}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
