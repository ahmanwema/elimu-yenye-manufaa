import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import {
  addScheduleAction,
  adjustAttendanceAction,
  admitFromWaitlistAction,
  archiveClassAction,
  assignSubstituteAction,
  assignTeacherAction,
  cancelSessionAction,
  createSessionAction,
  endEnrollmentAction,
  endScheduleAction,
  endSessionAction,
  enrollStudentAction,
  extendGraceAction,
  generateSessionsAction,
  removeCoTeacherAction,
  startAdHocSessionAction,
  startSessionAction,
  submitPaymentAction,
  updateClassAction,
} from "@/server/actions/live-class";
import { getCurrentActor } from "@/server/auth";
import {
  canAdjustAttendance,
  canAssignSubstitute,
  canCancelSession,
  canCreateSession,
  canExtendGrace,
  canManageClass,
  canManageEnrollment,
  canOverrideCapacity,
  canReadSessionAttendance,
  canStartOrEndSession,
  canSubmitPayment,
  type SessionContext,
} from "@/server/authz/live-class";
import { AuthorizationError } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { getClassOverview, listActiveTeachers } from "@/server/services/classes";
import { listClassChatHistory, listMyAttendance, listSessionAttendance } from "@/server/services/live-sessions";
import { listStudentRoster } from "@/server/services/roster";
import { DomainError } from "@/server/services/errors";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).live.classesTitle, robots: { index: false } };
}

export default async function ClassPage({ params }: PageProps<"/[locale]/markaz/[tenantId]/classes/[classId]">) {
  const dict = await getDictionary();
  return (
    <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
      <ClassBody params={params} />
    </Suspense>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

// What each viewer sees is decided by getClassOverview() and the same pure rules the actions
// re-check. Hidden controls are presentation only.
async function ClassBody({ params }: { params: PageProps<"/[locale]/markaz/[tenantId]/classes/[classId]">["params"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const l = dict.live;
  const { tenantId, classId } = await params;
  const current = await getCurrentActor();
  if (current.state === "not-configured") return <p>{dict.common.notConfigured}</p>;
  if (current.state !== "signed-in") redirect(`/${locale}/sign-in?next=/${locale}/markaz/${tenantId}/classes/${classId}`);
  const db = getDb();
  const { actor } = current;

  let view;
  try {
    view = await getClassOverview(db, actor, classId);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof DomainError) return <p role="alert">{dict.markaz.notAllowed}</p>;
    throw error;
  }
  if (view.class.tenantId !== tenantId) return <p role="alert">{dict.markaz.notAllowed}</p>;

  const cls = view.class;
  const ctx = { tenantId: cls.tenantId, teachers: view.teachers.filter((t) => !t.endedAt).map((t) => ({ teacherProfileId: t.teacherProfileId, role: t.role })) };
  const sessionCtx = (substituteProfileId: string | null): SessionContext => ({ ...ctx, substituteProfileId });
  const admin = canManageClass(actor, ctx);
  const active = cls.status === "ACTIVE";
  const studentAccess = view.myAccess === "ACTIVE" || view.myAccess === "GRACE";

  const now = new Date();
  const ended = view.sessions.filter((s) => s.status === "ENDED").slice(0, 5);
  const [activeTeachers, roster, attendanceBySession, chat, myAttendance] = await Promise.all([
    view.staff ? listActiveTeachers(db, actor, cls.tenantId) : null,
    view.staff && canManageEnrollment(actor, ctx) ? listStudentRoster(db, actor, cls.tenantId).catch(() => null) : null,
    Promise.all(ended.map(async (s) => (canReadSessionAttendance(actor, sessionCtx(s.substituteProfileId)) ? { session: s, rows: await listSessionAttendance(db, actor, s.id) } : null))),
    view.staff || studentAccess ? listClassChatHistory(db, actor, cls.id) : null,
    view.staff ? null : listMyAttendance(db, actor),
  ]);
  const activeTeacherIds = new Set((activeTeachers ?? []).map((t) => t.profileId));
  const name = (n: string | null | undefined) => n ?? dict.markaz.unnamed;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: cls.timezone });
  const dateOnly = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: cls.timezone });
  const results = dict.results;
  const loading = dict.common.loading;
  const enrolledIds = new Set(view.enrollments.filter((e) => e.status !== "ENDED").map((e) => e.studentProfileId));
  const open = view.enrollments.filter((e) => e.status !== "ENDED" && e.effectiveStatus !== "WAITLISTED");
  const waitlist = view.enrollments.filter((e) => e.effectiveStatus === "WAITLISTED");
  const upcoming = view.sessions.filter((s) => s.status === "SCHEDULED" || s.status === "LIVE").reverse();
  const past = view.sessions.filter((s) => s.status === "ENDED" || s.status === "CANCELLED");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: cls.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

  return (
    <>
      <p>
        <a href={`/${locale}/markaz/${cls.tenantId}/classes`}>{l.classesTitle}</a>
      </p>
      <h1>{cls.name}</h1>
      {cls.subject ? <p className="muted">{cls.subject}</p> : null}
      {cls.description ? <p>{cls.description}</p> : null}
      {!active ? <p className="badge">{l.archivedLabel}</p> : null}
      {view.myAccess ? <p className="callout">{format(l.myAccess, { state: l.enrollmentStates[view.myAccess] })}</p> : null}
      {view.staff ? (
        <p className="muted">
          {cls.effectiveEnrollmentCapacity
            ? format(l.seats, { taken: view.seatsTaken ?? 0, capacity: cls.effectiveEnrollmentCapacity })
            : format(l.seatsUnlimited, { taken: view.seatsTaken ?? 0 })}
          {" · "}
          {format(l.ceilingLine, { enrollment: cls.ceilings.enrollment ?? l.noCeiling, live: cls.ceilings.live ?? l.noCeiling })}
        </p>
      ) : null}

      <section className="card" aria-labelledby="teachers">
        <h2 id="teachers">{l.teachersHeading}</h2>
        <ul className="list">
          {view.teachers
            .filter((t) => view.staff || !t.endedAt)
            .map((t) => (
              <li key={t.id} className="row">
                <span>
                  {name(t.teacher.displayName)} — {l.teacherRoles[t.role]} {t.endedAt ? <span className="muted">{l.teacherEnded}</span> : null}
                </span>
                {view.staff && !t.endedAt && activeTeachers && !activeTeacherIds.has(t.teacherProfileId) ? (
                  <span className="message message-error">{l.teacherInactive}</span>
                ) : null}
                {admin && active && !t.endedAt && t.role === "CO_TEACHER" ? (
                  <ActionForm action={removeCoTeacherAction} submitLabel={l.removeTeacher} pendingLabel={loading} messages={results} variant="secondary" inline>
                    <input type="hidden" name="assignmentId" value={t.id} />
                  </ActionForm>
                ) : null}
              </li>
            ))}
        </ul>
        {admin && active && activeTeachers ? (
          <ActionForm action={assignTeacherAction} submitLabel={l.assignTeacher} pendingLabel={loading} messages={results} inline>
            <input type="hidden" name="classId" value={cls.id} />
            <label htmlFor="assignTeacher" className="visually-hidden">{l.teacherLabel}</label>
            <select id="assignTeacher" name="teacherProfileId" required>
              {activeTeachers.map((t) => (
                <option key={t.profileId} value={t.profileId}>
                  {name(t.displayName)}
                </option>
              ))}
            </select>
            <label htmlFor="assignRole" className="visually-hidden">{l.assignRole}</label>
            <select id="assignRole" name="role" defaultValue="CO_TEACHER">
              <option value="CO_TEACHER">{l.teacherRoles.CO_TEACHER}</option>
              <option value="PRIMARY">{l.teacherRoles.PRIMARY}</option>
            </select>
          </ActionForm>
        ) : null}
      </section>

      {admin && active ? (
        <section className="card" aria-labelledby="details">
          <h2 id="details">{l.editHeading}</h2>
          <ActionForm action={updateClassAction} submitLabel={l.save} pendingLabel={loading} messages={results}>
            <input type="hidden" name="classId" value={cls.id} />
            <label htmlFor="edName">{l.className}</label>
            <input id="edName" name="name" defaultValue={cls.name} maxLength={200} required />
            <label htmlFor="edSubject">{l.subject}</label>
            <input id="edSubject" name="subject" defaultValue={cls.subject ?? ""} maxLength={200} />
            <label htmlFor="edDescription">{l.description}</label>
            <textarea id="edDescription" name="description" defaultValue={cls.description ?? ""} maxLength={2000} rows={2} />
            <label htmlFor="edEnroll">{l.enrollmentCapacity}</label>
            <input id="edEnroll" name="enrollmentCapacity" type="number" min={1} max={cls.ceilings.enrollment ?? undefined} defaultValue={cls.enrollmentCapacity ?? ""} />
            <label htmlFor="edLive">{l.liveCapacity}</label>
            <input id="edLive" name="liveCapacity" type="number" min={1} max={cls.ceilings.live ?? undefined} defaultValue={cls.liveCapacity ?? ""} />
            <p className="muted">{l.capacityHint}</p>
          </ActionForm>
          <ActionForm action={archiveClassAction} submitLabel={l.archive} pendingLabel={loading} messages={results} variant="secondary">
            <input type="hidden" name="classId" value={cls.id} />
          </ActionForm>
        </section>
      ) : null}

      {view.staff ? (
        <section className="card" aria-labelledby="students">
          <h2 id="students">{l.studentsHeading}</h2>
          {active && roster && canManageEnrollment(actor, ctx) ? (
            <ActionForm action={enrollStudentAction} submitLabel={l.enroll} pendingLabel={loading} messages={results}>
              <input type="hidden" name="classId" value={cls.id} />
              <label htmlFor="enrollStudent">{l.studentLabel}</label>
              <select id="enrollStudent" name="studentProfileId" required>
                {roster
                  .filter((s) => !enrolledIds.has(s.profileId))
                  .map((s) => (
                    <option key={s.profileId} value={s.profileId}>
                      {name(s.displayName)}
                    </option>
                  ))}
              </select>
              {canOverrideCapacity(actor, ctx) ? (
                <>
                  <label htmlFor="override">{l.overrideReason}</label>
                  <input id="override" name="overrideReason" maxLength={500} />
                </>
              ) : null}
            </ActionForm>
          ) : null}
          {open.length === 0 ? (
            <p className="muted">{l.noEnrollments}</p>
          ) : (
            <ul className="list">
              {open.map((e) => (
                <li key={e.id}>
                  <p className="row">
                    <strong>{name(e.student.profile.displayName)}</strong>
                    <span>{l.enrollmentStates[e.effectiveStatus]}</span>
                    {e.accessUntil ? <span className="muted">{format(l.accessUntil, { date: dateOnly.format(e.accessUntil) })}</span> : null}
                    {e.effectiveStatus === "GRACE" && e.graceUntil ? <span className="muted">{format(l.graceUntil, { date: dateOnly.format(e.graceUntil) })}</span> : null}
                    {e.capacityOverrideReason ? <span className="muted">{format(l.overridden, { reason: e.capacityOverrideReason })}</span> : null}
                    {canManageEnrollment(actor, ctx) ? (
                      <ActionForm action={endEnrollmentAction} submitLabel={l.endEnrollment} pendingLabel={loading} messages={results} variant="secondary" inline>
                        <input type="hidden" name="enrollmentId" value={e.id} />
                      </ActionForm>
                    ) : null}
                  </p>
                  {(e.effectiveStatus === "GRACE" || e.effectiveStatus === "SUSPENDED") && canExtendGrace(actor, ctx) ? (
                    <details>
                      <summary>{l.extendGrace}</summary>
                      <ActionForm action={extendGraceAction} submitLabel={l.extendGrace} pendingLabel={loading} messages={results}>
                        <input type="hidden" name="enrollmentId" value={e.id} />
                        <label htmlFor={`gd-${e.id}`}>{l.graceDate}</label>
                        <input id={`gd-${e.id}`} name="graceUntil" type="date" min={today} required />
                        <label htmlFor={`gr-${e.id}`}>{l.graceReason}</label>
                        <input id={`gr-${e.id}`} name="reason" maxLength={500} required />
                      </ActionForm>
                    </details>
                  ) : null}
                  {canSubmitPayment(actor, ctx) ? (
                    <details>
                      <summary>{l.paymentHeading}</summary>
                      <p className="muted">{l.paymentNote}</p>
                      <ActionForm action={submitPaymentAction} submitLabel={l.submitPayment} pendingLabel={loading} messages={results}>
                        <input type="hidden" name="tenantId" value={cls.tenantId} />
                        <input type="hidden" name="studentProfileId" value={e.studentProfileId} />
                        <input type="hidden" name="enrollmentIds" value={e.id} />
                        <label htmlFor={`pc-${e.id}`}>{l.paymentCoverage}</label>
                        <input id={`pc-${e.id}`} name="coverageNote" maxLength={500} defaultValue={cls.name} required />
                        <label htmlFor={`pr-${e.id}`}>{l.paymentReference}</label>
                        <input id={`pr-${e.id}`} name="evidenceReference" maxLength={200} required dir="ltr" />
                        <label htmlFor={`ps-${e.id}`}>{l.periodStart}</label>
                        <input id={`ps-${e.id}`} name="periodStart" type="date" required />
                        <label htmlFor={`pe-${e.id}`}>{l.periodEnd}</label>
                        <input id={`pe-${e.id}`} name="periodEnd" type="date" required />
                      </ActionForm>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <h3>{l.waitlistHeading}</h3>
          {waitlist.length === 0 ? (
            <p className="muted">{l.noWaitlist}</p>
          ) : (
            <ol className="list">
              {waitlist.map((e) => (
                <li key={e.id} className="row">
                  <span>{name(e.student.profile.displayName)}</span>
                  {active && canManageEnrollment(actor, ctx) ? (
                    <ActionForm action={admitFromWaitlistAction} submitLabel={l.admit} pendingLabel={loading} messages={results} inline>
                      <input type="hidden" name="enrollmentId" value={e.id} />
                      {canOverrideCapacity(actor, ctx) ? (
                        <>
                          <label htmlFor={`ov-${e.id}`} className="visually-hidden">{l.overrideReason}</label>
                          <input id={`ov-${e.id}`} name="overrideReason" maxLength={500} placeholder={l.overrideReason} />
                        </>
                      ) : null}
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      <section className="card" aria-labelledby="schedule">
        <h2 id="schedule">{l.schedulesHeading}</h2>
        <p className="muted">{format(l.timezoneCurrent, { timezone: cls.timezone })}</p>
        {view.schedules.length === 0 ? (
          <p className="muted">{l.noSchedules}</p>
        ) : (
          <ul className="list">
            {view.schedules.map((s) => (
              <li key={s.id} className="row">
                <span>
                  {format(l.scheduleLine, {
                    day: l.weekdays[`d${s.weekday}` as keyof typeof l.weekdays],
                    time: `${pad(Math.floor(s.startMinute / 60))}:${pad(s.startMinute % 60)}`,
                    minutes: s.durationMinutes,
                  })}
                </span>
                {admin && active ? (
                  <ActionForm action={endScheduleAction} submitLabel={l.endSchedule} pendingLabel={loading} messages={results} variant="secondary" inline>
                    <input type="hidden" name="scheduleId" value={s.id} />
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {admin && active ? (
          <ActionForm action={addScheduleAction} submitLabel={l.addSchedule} pendingLabel={loading} messages={results} inline>
            <input type="hidden" name="classId" value={cls.id} />
            <label htmlFor="weekday" className="visually-hidden">{l.weekday}</label>
            <select id="weekday" name="weekday">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {l.weekdays[`d${d}` as keyof typeof l.weekdays]}
                </option>
              ))}
            </select>
            <label htmlFor="schedStart" className="visually-hidden">{l.startTime}</label>
            <input id="schedStart" name="startTime" type="time" required />
            <label htmlFor="schedDuration" className="visually-hidden">{l.duration}</label>
            <input id="schedDuration" name="durationMinutes" type="number" min={1} max={1440} defaultValue={60} required placeholder={l.duration} />
          </ActionForm>
        ) : null}
        {active && canCreateSession(actor, ctx) && view.schedules.length > 0 ? (
          <>
            <h3>{l.generateHeading}</h3>
            <ActionForm action={generateSessionsAction} submitLabel={l.generate} pendingLabel={loading} messages={results} inline>
              <input type="hidden" name="classId" value={cls.id} />
              <label htmlFor="genFrom" className="visually-hidden">{l.fromDate}</label>
              <input id="genFrom" name="fromDate" type="date" defaultValue={today} required />
              <label htmlFor="genDays" className="visually-hidden">{l.days}</label>
              <input id="genDays" name="days" type="number" min={1} max={62} defaultValue={14} required placeholder={l.days} />
            </ActionForm>
          </>
        ) : null}
      </section>

      <section className="card" aria-labelledby="sessions">
        <h2 id="sessions">{view.staff ? l.sessionsHeading : l.upcomingHeading}</h2>
        {active && canCreateSession(actor, ctx) ? (
          <>
            <details>
              <summary>{l.newSession}</summary>
              <ActionForm action={createSessionAction} submitLabel={l.createSession} pendingLabel={loading} messages={results}>
                <input type="hidden" name="classId" value={cls.id} />
                <label htmlFor="sDate">{l.date}</label>
                <input id="sDate" name="date" type="date" min={today} required />
                <label htmlFor="sTime">{l.startTime}</label>
                <input id="sTime" name="startTime" type="time" required />
                <label htmlFor="sDur">{l.duration}</label>
                <input id="sDur" name="durationMinutes" type="number" min={1} max={1440} defaultValue={60} required />
                <label htmlFor="sTitle">{l.sessionTitle}</label>
                <input id="sTitle" name="title" maxLength={200} />
                <label>
                  <input type="checkbox" name="recordingEnabled" /> {l.recordingMode}
                </label>
              </ActionForm>
            </details>
            <details>
              <summary>{l.adHocHeading}</summary>
              <p className="muted">{l.adHocNote}</p>
              <ActionForm action={startAdHocSessionAction} submitLabel={l.startNow} pendingLabel={loading} messages={results}>
                <input type="hidden" name="classId" value={cls.id} />
                <label htmlFor="aDur">{l.duration}</label>
                <input id="aDur" name="durationMinutes" type="number" min={1} max={1440} defaultValue={60} />
                <label htmlFor="aTitle">{l.sessionTitle}</label>
                <input id="aTitle" name="title" maxLength={200} />
                <label>
                  <input type="checkbox" name="recordingEnabled" /> {l.recordingMode}
                </label>
              </ActionForm>
            </details>
          </>
        ) : null}
        {upcoming.length === 0 && (view.staff ? past.length === 0 : true) ? <p className="muted">{l.noSessions}</p> : null}
        <ul className="list">
          {[...upcoming, ...(view.staff ? past : [])].map((s) => {
            const sctx = sessionCtx(s.substituteProfileId);
            return (
              <li key={s.id}>
                <p className="row">
                  <strong>{s.title ?? l.sessionKinds[s.kind]}</strong>
                  <span>{dateTime.format(s.scheduledStartAt)}</span>
                  <span className="badge">{l.sessionStatuses[s.status]}</span>
                  {s.endReason === "SAFETY_CLOSE" ? <span className="muted">({l.safetyClosed})</span> : null}
                  {s.substitute ? (
                    <span className="muted">
                      {l.substitute}: {name(s.substitute.displayName)}
                    </span>
                  ) : null}
                  {s.status === "SCHEDULED" || s.status === "LIVE" ? <a href={`/${locale}/live/${s.id}`}>{l.enter}</a> : null}
                </p>
                <div className="row">
                  {s.status === "SCHEDULED" && canStartOrEndSession(actor, sctx) ? (
                    <ActionForm action={startSessionAction} submitLabel={l.start} pendingLabel={loading} messages={results} inline>
                      <input type="hidden" name="sessionId" value={s.id} />
                    </ActionForm>
                  ) : null}
                  {s.status === "LIVE" && canStartOrEndSession(actor, sctx) ? (
                    <ActionForm action={endSessionAction} submitLabel={l.end} pendingLabel={loading} messages={results} inline>
                      <input type="hidden" name="sessionId" value={s.id} />
                    </ActionForm>
                  ) : null}
                  {s.status === "SCHEDULED" && s.kind === "SCHEDULED" && canCancelSession(actor, sctx) ? (
                    <ActionForm action={cancelSessionAction} submitLabel={l.cancel} pendingLabel={loading} messages={results} variant="secondary" inline>
                      <input type="hidden" name="sessionId" value={s.id} />
                      <label htmlFor={`cr-${s.id}`} className="visually-hidden">{l.cancelReason}</label>
                      <input id={`cr-${s.id}`} name="reason" maxLength={500} placeholder={l.cancelReason} />
                    </ActionForm>
                  ) : null}
                  {(s.status === "SCHEDULED" || s.status === "LIVE") && canAssignSubstitute(actor, sctx) && activeTeachers ? (
                    <ActionForm action={assignSubstituteAction} submitLabel={l.setSubstitute} pendingLabel={loading} messages={results} variant="secondary" inline>
                      <input type="hidden" name="sessionId" value={s.id} />
                      <label htmlFor={`sub-${s.id}`} className="visually-hidden">{l.substitute}</label>
                      <select id={`sub-${s.id}`} name="substituteProfileId" defaultValue={s.substituteProfileId ?? ""}>
                        <option value="">{l.noSubstitute}</option>
                        {activeTeachers
                          .filter((t) => !ctx.teachers.some((ct) => ct.teacherProfileId === t.profileId))
                          .map((t) => (
                            <option key={t.profileId} value={t.profileId}>
                              {name(t.displayName)}
                            </option>
                          ))}
                      </select>
                    </ActionForm>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {attendanceBySession.some(Boolean) ? (
        <section className="card" aria-labelledby="attendance">
          <h2 id="attendance">{l.attendanceHeading}</h2>
          {attendanceBySession.map((a) =>
            a ? (
              <div key={a.session.id}>
                <h3>
                  {a.session.title ?? l.sessionKinds[a.session.kind]} — {dateTime.format(a.session.scheduledStartAt)}
                </h3>
                {a.rows.length === 0 ? (
                  <p className="muted">{l.noAttendance}</p>
                ) : (
                  <ul className="list">
                    {a.rows.map((r) => (
                      <li key={r.id} className="row">
                        <span>
                          {format(l.attendanceLine, {
                            name: name(r.student.profile.displayName),
                            status: l.attendanceStatuses[r.status],
                            minutes: Math.round(r.presentSeconds / 60),
                            total: Math.round(r.sessionSeconds / 60),
                          })}
                        </span>
                        {r.adjustedAt ? <span className="muted">{format(l.adjusted, { reason: r.adjustmentReason ?? "" })}</span> : null}
                        {canAdjustAttendance(actor, ctx) ? (
                          <ActionForm action={adjustAttendanceAction} submitLabel={l.adjust} pendingLabel={loading} messages={results} variant="secondary" inline>
                            <input type="hidden" name="recordId" value={r.id} />
                            <label htmlFor={`as-${r.id}`} className="visually-hidden">{l.attendanceHeading}</label>
                            <select id={`as-${r.id}`} name="status" defaultValue={r.status}>
                              {(["PRESENT", "LATE", "ABSENT"] as const).map((st) => (
                                <option key={st} value={st}>
                                  {l.attendanceStatuses[st]}
                                </option>
                              ))}
                            </select>
                            <label htmlFor={`ar-${r.id}`} className="visually-hidden">{l.adjustReason}</label>
                            <input id={`ar-${r.id}`} name="reason" maxLength={500} required placeholder={l.adjustReason} />
                          </ActionForm>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null,
          )}
        </section>
      ) : null}

      {myAttendance ? (
        <section className="card" aria-labelledby="my-attendance">
          <h2 id="my-attendance">{l.myAttendanceHeading}</h2>
          {myAttendance.filter((r) => r.classId === cls.id).length === 0 ? (
            <p className="muted">{l.noAttendance}</p>
          ) : (
            <ul className="list">
              {myAttendance
                .filter((r) => r.classId === cls.id)
                .map((r) => (
                  <li key={r.id}>{format(l.attendanceRecordLine, { date: dateOnly.format(r.sessionDate), className: r.className, status: l.attendanceStatuses[r.status] })}</li>
                ))}
            </ul>
          )}
        </section>
      ) : null}

      {chat ? (
        <section className="card" aria-labelledby="chat">
          <h2 id="chat">{l.chatHeading}</h2>
          {chat.length === 0 ? (
            <p className="muted">{l.noChat}</p>
          ) : (
            <ul className="list">
              {chat.map((m) => (
                <li key={m.id}>
                  <span className="muted">
                    {dateTime.format(m.createdAt)} · {name(m.author.displayName)} ({l.participantRoles[m.authorRole]}):
                  </span>{" "}
                  <span>{m.body}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
