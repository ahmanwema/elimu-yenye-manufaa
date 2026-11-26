# Live Class media phase — plan (LiveKit audio + Supabase Realtime whiteboard)

Status: **PROPOSED (2026-11-26)** — written for owner review. Nothing here is implemented, installed or
migrated. It builds on A154 (vendor choice) and lifts A130 ("no media transport, no SDK") only once the
owner authorizes it, phase by phase.

What exists already (docs/features/live-class.md, "Implemented foundation"): sessions, join/leave per
device (PRIMARY / VIEW_ONLY), admission and live capacity, raise hand, one-student-mic with handoff,
whiteboard write grants, removal, attendance from connection intervals, chat, recording participants.
All of that is **business state only**. This phase connects it to real audio and a real board without
changing any of those rules: the database stays the authority, the vendors only carry media.

## 1. Principles

1. **The server decides, the vendor enforces.** Every permission comes from the existing services
   (`getMyDeviceCapabilities`, `grantMic`, `revokeMic`, `grantWhiteboard`, …). The new code turns that
   decision into a LiveKit token grant or a Supabase Realtime policy — never the reverse.
2. **Privacy by construction (CLAUDE.md rule 5).** A student without mic permission cannot publish audio
   because LiveKit refuses it, not because the button is hidden. A person outside the session cannot
   join the board channel because Realtime authorization refuses it.
3. **One identity per device.** The LiveKit identity is the `connectionId` (not the profile), so a
   VIEW_ONLY device never holds publish rights (A121) and attendance stays per connection.
4. **Vendor code behind an adapter.** `src/server/rtc/` exposes `issueAudioToken`, `setPublish`,
   `removeFromRoom`, `closeRoom`; tests use a fake. Swapping or self-hosting LiveKit later touches one file.
5. **Pilot caveats are designed in (A154):** whiteboard strokes carry a sequence number, are drawn in
   sequence order, and a late or reconnecting student re-syncs from a stored snapshot.

## 2. Architecture

```
            server actions (authz first)                       vendors
 browser ──joinSession──▶ live-sessions.ts ──▶ rtc adapter ──▶ LiveKit token (JWT, short TTL)
    │                     grantMic / revokeMic ──▶ rtc adapter ──▶ LiveKit UpdateParticipant(canPublish)
    │                     removeParticipant / endSession ──▶ RemoveParticipant / DeleteRoom
    │
    ├── LiveKit room "lc_<sessionId>"  ◀── audio only (microphone source)
    │        └── webhook participant_left ──▶ /api/livekit/webhook ──▶ leaveSession (presence)
    │
    └── Supabase Realtime private channel "wb:<sessionId>"  ◀── strokes {seq, author, points…}
             ├── realtime.messages RLS: read = admitted participant; send = whiteboard writer
             └── teacher client batches strokes ──▶ appendWhiteboardStrokes ──▶ live_whiteboard_strokes
                                                          ▲
                              late join / gap / reconnect ┘ loadWhiteboard(sessionId, afterSeq)
```

### 2.1 Audio (LiveKit)

- **Token:** a new server action `getAudioTokenAction(connectionId)` re-checks capabilities and mints a
  token for room `lc_<sessionId>`, identity `connectionId`, `canSubscribe: true`, `canPublishData: false`,
  `canPublish` only when `publishMic` is true, `canPublishSources: [MICROPHONE]`. Short TTL; LiveKit
  refreshes it on reconnect through the same action.
- **Mic grant / revoke / handoff (A117, A138):** after the existing transaction commits, the service
  calls `UpdateParticipant` for the student's PRIMARY connection. LiveKit unpublishes automatically when
  `canPublish` is withdrawn (pilot §1, verified in docs). Handoff = revoke A then grant B.
- **Removal / end:** `removeParticipant` → `RemoveParticipant` for each open connection; `endSession`
  and `closeStaleSessions` → `DeleteRoom`.
- **Presence:** a signed LiveKit webhook (`participant_left`, `participant_joined`) closes or confirms the
  connection row, so a closed tab or lost phone no longer stays "present" until someone presses Leave.
  This makes attendance (A122/A132) trustworthy. Signature verified with the API secret; unknown rooms
  and identities are ignored; the handler is idempotent.
- **Browser:** "Join audio" button (needed anyway for autoplay rules), mute/unmute for whoever may
  publish, speaking indicator, connection-quality dot, reconnect banner.

### 2.2 Whiteboard (Supabase Realtime)

- **Channel:** private broadcast channel `wb:<sessionId>` (the pilot's public channel is not reused,
  A118). Authorization is RLS on `realtime.messages` calling a `SECURITY DEFINER` function
  `live_whiteboard_access(topic, write boolean)`: read for an admitted, non-removed participant of a LIVE
  session; send for a teaching role or a student with `whiteboard_granted_at` set.
- **Stroke model:** `{ seq, strokeId, author, tool (pen | eraser | clear), color, width, points[] }`.
  Only the board owner (the teacher's PRIMARY device) assigns `seq`. Points are sent in small chunks
  while drawing so students see the line grow.
- **Ordering and gaps:** receivers buffer by `seq` and draw in order. A gap older than ~1 s triggers
  `loadWhiteboard(sessionId, afterSeq)`; a reconnect or late join loads the whole board first.
- **Persistence:** the teacher's client sends finished strokes in batches (every ~2 s and on stroke end)
  to `appendWhiteboardStrokes`, which checks the connection is PRIMARY and may write, then inserts into
  the new server-only table `live_whiteboard_strokes` (tenant-scoped, composite FK to the session,
  unique `(session_id, seq)`). Board history ends with the session; whether it is kept afterwards
  (e.g. as lesson notes) is an owner question (§6).
- **Input:** Pointer Events (mouse, touch, pen with pressure), so an XPPen tablet should work without
  special code — to be confirmed when the hardware arrives.

**Known limits, accepted or to be decided:**
- Realtime checks the policy when a client **joins** the channel (and on token refresh), not on every
  message. A student whose write grant is revoked could keep sending until then. Mitigation: receivers
  ignore strokes from authors not in the current writer list (pushed with each grant change), and the
  server refuses to persist them — so the stored board is always correct.
- RLS cannot tell two devices of the same person apart. The VIEW_ONLY rule for the board is therefore
  enforced by the client and by `appendWhiteboardStrokes` (which checks the connection), not by Realtime.
- The pilot measured Supabase Realtime at p50 ≈ 550–670 ms on a phone. Fine for writing; not for audio.

## 3. Phases

| Phase | Scope | Needs |
|---|---|---|
| **M0 — Setup** | LiveKit Cloud project (Build plan, free). Env vars `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env.local` and Vercel (never committed). Install `livekit-client` and `livekit-server-sdk` (pinned, the pilot used 2.22.4 / 2.19.1). `src/server/rtc/` adapter + fake. | Owner: create the LiveKit project and add the keys; authorize the install. |
| **M1 — Audio** | Token action, teacher speaks, students hear; mic grant / revoke / handoff enforced in LiveKit; removal and end close the room; audio controls on the live page. | — |
| **M2 — Presence** | `/api/livekit/webhook` (proxy matcher excludes `api/`), signature check, closes connections; reconnect handling. | Owner: add the webhook URL in LiveKit Cloud. |
| **M3 — Whiteboard** | Migration 26 (ADDITIVE): `live_whiteboard_strokes` + `live_whiteboard_access()` + `realtime.messages` policies. Canvas component, stroke protocol, ordering, persistence, re-sync, clear/undo by the teacher, student write grant. | Owner: authorize the migration and its DEV apply. |
| **M4 — Classroom layout** | Teacher view: board takes the screen, compact toolbar, participant drawer. Student view: board + hand / mic button. Phone: fullscreen board, bottom controls. i18n sw/en/ar, RTL (the board itself is never mirrored). | — |
| **M5 — Verification** | Unit tests (token grants per role/device, stroke ordering, gap detection, webhook idempotency); real-DEV tests for the Realtime policies; manual two-device test (PC teacher + phone student) on Wi-Fi **and 4G**. | Owner: one phone for the manual test. |

Each phase ends with `npm run check`, build, a PROGRESS.md entry, and a commit/push only when authorized.

## 4. Acceptance criteria

1. A teacher starts a session and speaks; an admitted student on a phone hears them within ~1 s.
2. A student without mic permission cannot publish audio even with a modified client (LiveKit refuses).
3. Granting B's mic while A holds it: A goes silent and B can speak, without either reloading.
4. A VIEW_ONLY device hears and sees the board but can never publish or draw.
5. A removed participant is disconnected from audio and board at once; ending the session closes both.
6. Closing a tab without pressing Leave ends that connection within ~30 s (webhook), and attendance
   reflects it.
7. Every stroke the teacher draws appears on each student's board in the right order; a student who
   joins late or loses connection for 10 s ends up with exactly the teacher's board.
8. A person who is not an admitted participant of the session cannot subscribe to `wb:<sessionId>`
   (real-DEV test).
9. Strokes from a student whose write grant was revoked are neither shown by others nor stored.
10. Swahili, English and Arabic UI; Arabic layout mirrors, the board does not.

## 5. Cost (LiveKit Cloud list prices, pilot §3)

Build plan: $0/month, 5,000 participant-minutes, 100 concurrent connections. One 60-minute class with a
teacher and 25 students uses ~1,560 participant-minutes, so the free plan covers about three such
classes a month; beyond that $0.0005 per participant-minute (~$0.78 for that class) or the Ship plan
($50/month, 150,000 minutes). Supabase Realtime is included in the current Supabase plan within its
message quotas. Recording egress is not part of this phase.

## 6. Out of scope here / owner questions

- **Out of scope:** recording (LiveKit egress for Option C), screen share (A119), correction clips from
  live audio (A53 rolling buffer), video, a production scheduler for `closeStaleSessions`.
- **Q1.** Keep the board after the session (as notes students can revisit) or discard it?
- **Q2.** Should a student with whiteboard permission write on the same board as the teacher, or on a
  separate layer the teacher can clear on its own? (Proposal: same board, own colour, teacher can undo.)
- **Q3.** LiveKit region: LiveKit Cloud picks the nearest edge automatically; confirm no data-residency
  requirement for audio (it is not stored in this phase).
