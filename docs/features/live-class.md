# Feature: Live Class

Status: **This is the first implementation priority** (A11, APPROVED at the feature-selection level). The detailed design below is **PROPOSED** and requires review before implementation begins.

> **2026-10-19 — Class structure, capacity and session foundation APPROVED (A101–A130) and implemented LOCALLY.** See "Implemented foundation (2026-10-19)" at the end of this file. It is **provider-neutral business state only**: no audio, whiteboard drawing or screen-share transport exists, and no RTC vendor is chosen (A35). Where the PROPOSED text below conflicts with A101–A130 (notably "Permissions"), A101–A130 win — see DECISIONS §1.9.

## Purpose

Let a teacher run a real-time lesson — voice, whiteboard, PDF/Qur'an-page annotation, screen share — with a class of students on phones and desktops, including individual corrections that stay private, attendance tracking, and recording for later replay.

## User roles

Teacher, Student. (Super Admin has support-level access. The Markaz Admin role is approved (A26, broad operational authority inside own Markaz only), but its concrete Live Class permissions are not derived yet — see [../system/roles-permissions.md](../system/roles-permissions.md) and open question 13. Teachers may teach in several Markaz (A28); each class belongs to exactly one tenant scope.)

## User journey

1. Teacher schedules/starts a class session tied to a course/lesson.
2. Students join via the class link/dashboard entry at the scheduled time (or a bit early, per plan-tier rules).
3. Teacher speaks (mic audio); students hear it live.
4. Teacher writes on the whiteboard and/or displays a PDF/Qur'an page and annotates it; all students see it live.
5. A student raises their hand; teacher can grant them mic access and/or whiteboard-write access for their turn, then revoke it.
6. While a student reads aloud, teacher marks corrections directly on that student's page; only that student (+teacher) can see those marks.
7. Students ask questions via text chat.
8. Teacher tracks attendance (automatic presence + optional manual adjustment).
9. Session ends; recording (if enabled) becomes available on the lesson page for replay, alongside materials and the student's private corrections.

## Functional requirements

- Teacher mic audio, broadcast live to the class (A13).
- Digital whiteboard: write, erase (A13); write access is teacher-only by default (A16).
- PDF display + annotation, including Qur'an-page annotation (A13) — see [pdf-annotations.md](pdf-annotations.md).
- Screen sharing (A13).
- Raise-hand (A13), teacher grants/revokes student mic access (A13) and whiteboard write access (A16) explicitly and per-student.
- Text chat for questions (A13).
- Lesson recording (A13) — see [audio-recording.md](audio-recording.md) and [../system/architecture.md](../system/architecture.md) §3.4 on why the recording is not a single flat video. Since 2026-10-05: full-session recording is the optional, separately-enabled Option C add-on; private corrections default to Option B (annotation + timestamp + short audio segment) and must not depend on a full recording (A29). How A13/A24 replay relates to the add-on is open (open question 18).
- Attendance tracking (A13): join/leave timestamps per student, contributing to a per-lesson attendance record.
- No live teacher video (A14 — explicitly out of scope).
- Class capacity varies by plan (A15) — see [payments.md](payments.md); the RTC layer must support configurable per-room participant limits, not a single hardcoded cap. A33 (2026-10-05) confirms that no final participant numbers may be hardcoded; concrete limits wait for pilot/network/cost testing.

## Data requirements

See entity groups in [../system/database.md](../system/database.md) §2 ("Live Class" and "Corrections/annotations" groups): class sessions, attendance records, whiteboard documents/pages, operation logs + snapshots, recording metadata, permission-grant events, chat messages, private annotation records.

## Permissions

> **SUPERSEDED 2026-10-19** by A113, A115–A120 and A122 (role/action matrix in [../system/roles-permissions.md](../system/roles-permissions.md) §2.9). The original 2026-09-30 proposal is kept below for history.

- Only the class's teacher can start/end the session, grant/revoke mic and whiteboard-write access, and see all students' corrections in that class.
- A student sees: the shared whiteboard/PDF state, their own private corrections, their own attendance, class-wide chat.
- A student never sees another student's private corrections, even during screen share/recording playback (A17) — enforced server-side (A16 principle extended to all permission checks).
- Enforcement is server-side for every permission above; UI controls that appear hidden/disabled are a courtesy, not the boundary (brief 4.3, [../system/security.md](../system/security.md)).

## UI states

- **Pre-join**: lobby/waiting state before teacher starts, or before the student's device permissions (mic, if granted) are set up.
- **Live — viewing only** (default student state): audio playing, whiteboard/PDF read-only, chat available, raise-hand available.
- **Live — granted mic/write** (a specific student, teacher-granted): additional controls appear for that student only.
- **Reconnecting**: network drop mid-class — see [../features/whiteboard.md](whiteboard.md) §reconnection.
- **Ended / replay**: same lesson page switches to a player over the recorded audio + whiteboard operation log — see [lesson-player.md](lesson-player.md).
- **Teacher — correcting a student**: a mode where the teacher's marks on the current page are tagged private-to-that-student rather than broadcast to the whole class.

## Error handling & edge cases

- Teacher's mic/network fails mid-class: students should get a clear "teacher audio interrupted" state rather than silence with no explanation.
- A student's device can't establish the RTC connection (blocked network, incompatible browser): fallback should be a clear error, not a silent blank screen — device/browser compatibility testing plan in [../testing/device-compatibility.md](../testing/device-compatibility.md).
- Two students both attempt to use a granted permission (e.g. mic) simultaneously: only one can be actively granted at a time per resource unless explicitly designed otherwise — needs explicit product decision if simultaneous multi-student mic is ever desired (not currently requested).
- Class reaches its plan's capacity: joining should fail gracefully with a clear message, not silently drop an existing participant.
- Late joiner: must receive current whiteboard/PDF state without waiting for the entire session history — see [whiteboard.md](whiteboard.md) §snapshotting.

## Security considerations

- Whiteboard write-permission and mic-permission checks happen at the moment of the action server-side, not just at grant-time (so revocation is immediate) — [../system/security.md](../system/security.md) §5.
- Private correction data must not leak into the class-wide broadcast, screen share, or shared recording — [student-corrections.md](student-corrections.md).
- Recording requires a consent/notice mechanism — **APPROVED 2026-10-05 (A30)**: general consent at enrollment/account setup **and** a clear in-class notice when recording begins. The "Recording-in-progress indicator" in [audio-recording.md](audio-recording.md) is the natural home for that notice; its exact UX is not designed yet. Consent for minors is still open (open question 17).
- Attendance and chat logs are only visible to the class's teacher and Super Admin (support), not other tenants.

## Dependencies

[whiteboard.md](whiteboard.md), [pdf-annotations.md](pdf-annotations.md), [student-corrections.md](student-corrections.md), [audio-recording.md](audio-recording.md), [lesson-player.md](lesson-player.md), [../system/security.md](../system/security.md), [../system/technology-evaluation.md](../system/technology-evaluation.md) (RTC provider choice), [../testing/device-compatibility.md](../testing/device-compatibility.md) (XPPen Deco 640 plan).

## Acceptance criteria (PROPOSED, for review before implementation)

- A teacher on the confirmed hardware (XPPen Deco 640 + Windows Chrome) can write on the whiteboard with visible pressure-sensitive strokes, and a student on a mid-range Android phone sees those strokes appear within an acceptable latency budget (target to be set after network testing — see [../testing/live-class-acceptance.md](../testing/live-class-acceptance.md)).
- A student who joins after the teacher has already written several strokes sees the current whiteboard state, not a blank canvas.
- Revoking a student's whiteboard-write permission mid-class immediately prevents further writes from that student's client, verified at the server, not just hidden in their UI.
- A private correction made on Student A's page during class is never visible to Student B, including in the post-class recording/replay.
- Attendance record reflects actual join/leave times for every participant in a test session.

## Testing requirements

See [../testing/live-class-acceptance.md](../testing/live-class-acceptance.md), [../testing/device-compatibility.md](../testing/device-compatibility.md), [../testing/security-tests.md](../testing/security-tests.md).

## Open questions

- ~~Consent/notice mechanism and retention period for recordings (roadmap item 7)~~ — resolved at business level 2026-10-05 (A30, A31); deletion mechanics (item 16) and minors' consent (item 17) remain open.
- Exact per-plan class-capacity numbers (roadmap item 5) — no numbers are invented here; still open per A33.
- RTC provider — Agora vs LiveKit pilot (A35); no vendor selected.
- Relationship of class replay to the Option C add-on (item 18).
- Whether simultaneous multi-student mic grant is ever needed (not currently requested; flagged for completeness).

## Implemented foundation (2026-10-19, A101–A130)

Local only (not applied to the DEV Supabase project — see [../testing/dev-supabase-verification.md](../testing/dev-supabase-verification.md)). Code: `src/server/authz/live-class.ts` (pure rules), `src/server/services/{classes,enrollments,live-sessions,session-recording,live-rules}.ts`, pages under `/[locale]/markaz/[tenantId]/classes`, `/[locale]/live/[sessionId]`, account and platform sections.

**Tenancy.** Markaz-only (A101). Every row carries `tenant_id` and is pinned to its parent by composite `(id, tenant_id)` foreign keys; a DB trigger refuses a teacher/student/substitute who lacks the right ACTIVE membership in the same Markaz.

**Class.** One Markaz; exactly one active PRIMARY (partial unique index), any number of CO_TEACHERs; ended assignments are kept. A Primary is only *replaced* (explicitly, audited), never removed or silently reassigned; a departed teacher's row grants nothing (authority always requires an ACTIVE Teacher membership). Archive keeps everything.

**Enrollment / access.**

```
(enroll) ──seat free──▶ ACTIVE ──access period ends──▶ GRACE (7 days, extendable) ──▶ SUSPENDED
   └──class full──▶ WAITLISTED ──admit (seat or admin override)──▶ ACTIVE
GRACE / SUSPENDED ──verified payment──▶ ACTIVE        any open state ──end──▶ ENDED (kept)
```

Access decisions use the *effective* state computed from the dates, so a lifecycle job that has not run never grants access. Joining needs an ACTIVE student membership AND an ACTIVE/GRACE enrollment.

**Capacity.** Enrollment and live capacities count students only. A Class value must be ≤ the Markaz plan ceiling (set by a Super Admin; NULL = none). No numbers exist in code (A33). Full → WAITLISTED; a Markaz Admin override records actor/time/reason and is audited. Live full → WAITING_FOR_SLOT; slots are given first-come-first-served.

**Sessions.**

```
SCHEDULED ──start (from −15 min; not after end + 30)──▶ LIVE ──end (manual)──────────────▶ ENDED (MANUAL)
    │                                                    └──still LIVE at end + 30 min──▶ ENDED (SAFETY_CLOSE)
    └──cancel (Primary / Markaz Admin)──▶ CANCELLED
(ad hoc: default 60 min, changeable) ──create──▶ LIVE
```

"Waiting room open" (from −15 min) is derived, not stored. One LIVE session per class. Timestamps are UTC; schedules (weekly, Markaz-local wall time) are converted with the Markaz IANA zone. `closeStaleSessions(now)` and `advanceEnrollmentStates(now)` are safe, re-runnable entry points — **not scheduled anywhere**.

**Participation (business state only).** One row per person per session (role, admission, hand, mic grant, whiteboard grant, removal) and one row per device connection (PRIMARY / VIEW_ONLY, raw presence). One student mic at a time (partial unique index; a second grant is refused until the first is revoked). Capabilities a future provider adapter must enforce: `getMyDeviceCapabilities()` — a VIEW_ONLY device never publishes mic or writes the whiteboard; a Markaz Admin has no teaching capabilities by role.

**Attendance.** Computed at session end from the UNION of admitted connection intervals (reconnects and a second device never double-count): ≥ 50 % → PRESENT; else first arrival after start + 15 → LATE; else ABSENT (precedence: OQ53). Manual correction by Primary/Co/Admin is audited (from/to). Parents receive status + class + session date only.

**Chat.** Public to the class, persistent, tenant + class + session scoped, authorship kept. Readers per A120; posting needs a LIVE session, a joined (and, for students, admitted) participant.

**Recording (Option C).** A recording-enabled session needs Option C to start; recording start checks it again and creates a recording linked to the session (`recordings.live_session_id`). Participants come from presence: admitted+connected at start (`SESSION_PRESENCE`), or when admitted later (`SESSION_LATE_JOIN`); consent is evaluated at that moment and audio may be captured only from `audio_included_from`. A Primary/Co/Admin may correct the list before media finalization (excluded rows are kept and audited). The free-form list is refused for session recordings.

**NOT implemented (by decision):** media transport of any kind, RTC vendor SDKs or tokens, whiteboard sync, screen sharing, a production scheduler, payment amounts/providers.
