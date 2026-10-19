import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { format } from "@/i18n/dictionaries";
import { getDictionary, getLocale } from "@/i18n/server";
import {
  correctRecordingParticipantsAction,
  endSessionAction,
  grantMicAction,
  grantWhiteboardAction,
  joinSessionAction,
  leaveSessionAction,
  lowerHandAction,
  postChatAction,
  raiseHandAction,
  removeParticipantAction,
  revokeMicAction,
  revokeWhiteboardAction,
  startSessionAction,
  startSessionRecordingAction,
  stopSessionRecordingAction,
} from "@/server/actions/live-class";
import { getCurrentActor } from "@/server/auth";
import { AuthorizationError } from "@/server/authz/policy";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/services/errors";
import { getLiveSessionView } from "@/server/services/live-sessions";
import { activeSessionRecording, listSessionRecordings } from "@/server/services/session-recording";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getDictionary()).live.shellTitle, robots: { index: false } };
}

export default async function LivePage({ params }: PageProps<"/[locale]/live/[sessionId]">) {
  const dict = await getDictionary();
  return (
    <Suspense fallback={<p aria-busy="true">{dict.common.loading}</p>}>
      <LiveBody params={params} />
    </Suspense>
  );
}

// PROVIDER-NEUTRAL SHELL (A35: no RTC vendor). It renders the business state only — status,
// teachers, waiting room, admission, raise hand, mic / whiteboard PERMISSIONS, chat, recording
// state. There is no audio, video, drawing or screen-share transport, and the page says so.
// Every control is a server action that re-authorizes; reload to see others' changes.
async function LiveBody({ params }: { params: PageProps<"/[locale]/live/[sessionId]">["params"] }) {
  const locale = await getLocale();
  const dict = await getDictionary();
  const l = dict.live;
  const { sessionId } = await params;
  const current = await getCurrentActor();
  if (current.state === "not-configured") return <p>{dict.common.notConfigured}</p>;
  if (current.state !== "signed-in") redirect(`/${locale}/sign-in?next=/${locale}/live/${sessionId}`);
  const db = getDb();
  const { actor } = current;

  let view;
  try {
    view = await getLiveSessionView(db, actor, sessionId);
  } catch (error) {
    if (error instanceof DomainError) return <p role="alert">{dict.results[error.code]}</p>;
    if (error instanceof AuthorizationError) return <p role="alert">{dict.markaz.notAllowed}</p>;
    throw error;
  }
  const { session, me, can } = view;
  const recording = can.startOrEnd ? await activeSessionRecording(db, session.id) : null;
  // A124: Primary, Co-Teacher and Markaz Admin may correct the participant list before finalization.
  const canCorrect = view.relation.primary || view.relation.coTeacher || view.relation.admin;
  const sessionRecordings = canCorrect ? await listSessionRecordings(db, actor, session.id) : [];
  const name = (n: string | null | undefined) => n ?? dict.markaz.unnamed;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: session.timezone ?? "UTC" }); // display only (A131)
  const results = dict.results;
  const loading = dict.common.loading;
  const joined = (me?.connections.length ?? 0) > 0;
  const canJoin = (session.status === "LIVE" || session.waitingRoomOpen) && !me?.removedAt && (me?.connections.length ?? 0) < 2;
  const isStudent = view.role === "STUDENT";
  const primaryDevice = me?.connections.some((c) => c.mode === "PRIMARY") ?? false;

  return (
    <>
      <p>
        <a href={`/${locale}/markaz/${session.tenantId}/classes/${session.classId}`}>{l.backToClass}</a>
      </p>
      <h1>
        {l.shellTitle}: {session.className}
      </h1>
      <p role="note" className="callout">
        {l.shellNoMedia}
      </p>
      <p>
        <strong>{format(l.shellStatus, { status: l.sessionStatuses[session.status] })}</strong> — {dateTime.format(session.scheduledStartAt)}
        {session.title ? ` — ${session.title}` : null}
      </p>
      {session.status === "SCHEDULED" ? <p className="muted">{session.waitingRoomOpen ? l.waitingRoom : l.notOpenYet}</p> : null}

      <section className="card" aria-labelledby="teachers">
        <h2 id="teachers">{l.teachersHeading}</h2>
        <ul className="list">
          {view.teachers.map((t, i) => (
            <li key={i}>
              {name(t.name)} — {l.teacherRoles[t.role]}
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="me">
        <h2 id="me">{l.yourPermissions}</h2>
        <p>{l.participantRoles[view.role]}</p>
        {view.role === "MARKAZ_ADMIN" ? <p className="muted">{l.permOperational}</p> : null}
        {can.screenShare ? <p className="muted">{l.permScreenShare}</p> : null}
        {can.authorWhiteboard ? <p className="muted">{l.permWhiteboard}</p> : null}
        {isStudent && me?.admission ? <p>{l.admissions[me.admission]}</p> : null}
        {isStudent && me?.micGrantedAt ? <p className="badge">{l.micGranted}</p> : null}
        {isStudent && me?.whiteboardGrantedAt ? <p className="badge">{l.wbGranted}</p> : null}
        {me?.removedAt ? <p role="alert">{l.removed}</p> : null}

        <ul className="list">
          {me?.connections.map((c) => (
            <li key={c.id} className="row">
              <span>{l.deviceModes[c.mode]}</span>
              <ActionForm action={leaveSessionAction} submitLabel={l.leave} pendingLabel={loading} messages={results} variant="secondary" inline>
                <input type="hidden" name="connectionId" value={c.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
        {canJoin ? (
          <ActionForm action={joinSessionAction} submitLabel={l.join} pendingLabel={loading} messages={results} inline>
            <input type="hidden" name="sessionId" value={session.id} />
          </ActionForm>
        ) : null}
        {isStudent && joined && primaryDevice && session.status === "LIVE" && me?.admission === "ADMITTED" ? (
          me.handRaisedAt ? (
            <ActionForm action={lowerHandAction} submitLabel={l.lowerHand} pendingLabel={loading} messages={results} variant="secondary" inline>
              <input type="hidden" name="participantId" value={me.id} />
            </ActionForm>
          ) : (
            <ActionForm action={raiseHandAction} submitLabel={l.raiseHand} pendingLabel={loading} messages={results} inline>
              <input type="hidden" name="sessionId" value={session.id} />
            </ActionForm>
          )
        ) : null}
      </section>

      {can.startOrEnd && (session.startOpen || session.status === "LIVE") ? (
        <section className="card" aria-labelledby="control">
          <h2 id="control">{l.sessionsHeading}</h2>
          {session.status === "SCHEDULED" ? (
            <ActionForm action={startSessionAction} submitLabel={l.start} pendingLabel={loading} messages={results} inline>
              <input type="hidden" name="sessionId" value={session.id} />
            </ActionForm>
          ) : (
            <ActionForm action={endSessionAction} submitLabel={l.end} pendingLabel={loading} messages={results} inline>
              <input type="hidden" name="sessionId" value={session.id} />
            </ActionForm>
          )}
        </section>
      ) : null}

      <section className="card" aria-labelledby="recording">
        <h2 id="recording">{dict.media.recordingsHeading}</h2>
        <p>{view.recording.inProgress ? l.recordingOn : l.recordingOff}</p>
        {isStudent && view.recording.inProgress && view.recording.myAudioIncluded !== null ? (
          <p className="muted">{view.recording.myAudioIncluded ? l.myAudioIncluded : l.myAudioExcluded}</p>
        ) : null}
        {session.status === "LIVE" && session.recordingEnabled && can.screenShare && !view.recording.inProgress ? (
          <ActionForm action={startSessionRecordingAction} submitLabel={l.startRecording} pendingLabel={loading} messages={results}>
            <input type="hidden" name="sessionId" value={session.id} />
            <label>
              <input type="checkbox" name="noticeConfirmed" required /> {l.recordingNotice}
            </label>
          </ActionForm>
        ) : null}
        {recording ? (
          <ActionForm action={stopSessionRecordingAction} submitLabel={l.stopRecording} pendingLabel={loading} messages={results} variant="secondary" inline>
            <input type="hidden" name="recordingId" value={recording.id} />
          </ActionForm>
        ) : null}
        {sessionRecordings.map((r) => (
          <div key={r.id}>
            <h3>{l.recordingParticipantsHeading}</h3>
            <ul className="list">
              {r.participants.map((p) => (
                <li key={p.studentProfileId} className="row">
                  <span>{name(p.student.profile.displayName)}</span>
                  <span className="muted">{p.excludedAt ? l.excludedLabel : p.audioIncluded ? l.audioIn : l.audioOut}</span>
                  {!p.excludedAt && !r.mediaFinalizedAt && r.status === "DRAFT" ? (
                    <ActionForm action={correctRecordingParticipantsAction} submitLabel={l.removeFromRecording} pendingLabel={loading} messages={results} variant="secondary" inline>
                      <input type="hidden" name="recordingId" value={r.id} />
                      <input type="hidden" name="remove" value={p.studentProfileId} />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {view.participants ? (
        <section className="card" aria-labelledby="participants">
          <h2 id="participants">{l.participantsHeading}</h2>
          <p className="muted">
            {session.liveCapacity !== null
              ? format(l.slots, { occupied: view.occupiedSlots ?? 0, capacity: session.liveCapacity })
              : format(l.slotsUnlimited, { occupied: view.occupiedSlots ?? 0 })}
          </p>
          {view.participants.length === 0 ? (
            <p className="muted">{l.noParticipants}</p>
          ) : (
            <ul className="list">
              {view.participants.map((p) => (
                <li key={p.id} className="row">
                  <strong>{name(p.profile.displayName)}</strong>
                  <span className="muted">{l.participantRoles[p.role]}</span>
                  <span className="muted">{format(l.connectedDevices, { count: p._count.connections })}</span>
                  {p.admission ? <span>{l.admissions[p.admission]}</span> : null}
                  {p.handRaisedAt ? <span className="badge">{l.handRaised}</span> : null}
                  {p.micGrantedAt ? <span className="badge">{l.micGranted}</span> : null}
                  {p.whiteboardGrantedAt ? <span className="badge">{l.wbGranted}</span> : null}
                  {p.removedAt ? <span className="muted">{l.removed}</span> : null}
                  {p.role === "STUDENT" && !p.removedAt && session.status === "LIVE" ? (
                    <>
                      {can.controlMic ? (
                        <ActionForm action={p.micGrantedAt ? revokeMicAction : grantMicAction} submitLabel={p.micGrantedAt ? l.revokeMic : l.grantMic} pendingLabel={loading} messages={results} inline>
                          <input type="hidden" name="participantId" value={p.id} />
                        </ActionForm>
                      ) : null}
                      {can.controlWhiteboard ? (
                        <ActionForm
                          action={p.whiteboardGrantedAt ? revokeWhiteboardAction : grantWhiteboardAction}
                          submitLabel={p.whiteboardGrantedAt ? l.revokeWb : l.grantWb}
                          pendingLabel={loading}
                          messages={results}
                          variant="secondary"
                          inline
                        >
                          <input type="hidden" name="participantId" value={p.id} />
                        </ActionForm>
                      ) : null}
                      {p.handRaisedAt && can.controlMic ? (
                        <ActionForm action={lowerHandAction} submitLabel={l.lowerHand} pendingLabel={loading} messages={results} variant="secondary" inline>
                          <input type="hidden" name="participantId" value={p.id} />
                        </ActionForm>
                      ) : null}
                      {can.operate ? (
                        <ActionForm action={removeParticipantAction} submitLabel={l.remove} pendingLabel={loading} messages={results} variant="secondary" inline>
                          <input type="hidden" name="participantId" value={p.id} />
                        </ActionForm>
                      ) : null}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="card" aria-labelledby="chat">
        <h2 id="chat">{l.chatHeading}</h2>
        {view.chat.length === 0 ? (
          <p className="muted">{l.noChat}</p>
        ) : (
          <ul className="list">
            {view.chat.map((m) => (
              <li key={m.id}>
                <span className="muted">
                  {name(m.author.displayName)} ({l.participantRoles[m.authorRole]}):
                </span>{" "}
                {m.body}
              </li>
            ))}
          </ul>
        )}
        {session.status === "LIVE" && joined && (!isStudent || me?.admission === "ADMITTED") ? (
          <ActionForm action={postChatAction} submitLabel={l.send} pendingLabel={loading} messages={results}>
            <input type="hidden" name="sessionId" value={session.id} />
            <label htmlFor="chatBody">{l.chatLabel}</label>
            <textarea id="chatBody" name="body" maxLength={2000} rows={2} required />
          </ActionForm>
        ) : null}
      </section>
    </>
  );
}
