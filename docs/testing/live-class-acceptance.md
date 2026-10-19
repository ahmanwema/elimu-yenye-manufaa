# Live Class Acceptance Testing

Status: **PROPOSED** — test cases to be executed once a Live Class implementation exists.

> **2026-10-19:** the business-state foundation (A101–A130) exists and its rules are covered by automated tests ([security-tests.md](security-tests.md) "Live Class foundation tests"). Scenario 1's lobby/start/admission logic, permission grant/revoke state, chat, attendance and recording-participant rules are therefore testable now in the provider-neutral shell (`/[locale]/live/[sessionId]`). Every scenario that needs real audio, whiteboard drawing, screen share, latency or hardware (2, 3, …) still waits for the RTC vendor decision (A35) and the XPPen test.

## Scope

End-to-end acceptance testing for [../features/live-class.md](../features/live-class.md) and its dependencies ([../features/whiteboard.md](../features/whiteboard.md), [../features/pdf-annotations.md](../features/pdf-annotations.md), [../features/student-corrections.md](../features/student-corrections.md), [../features/audio-recording.md](../features/audio-recording.md), [../features/lesson-player.md](../features/lesson-player.md)).

## Core scenarios

1. Teacher starts a class; a student joins before start, sees a lobby state, then sees live content once started.
2. Teacher speaks; student hears audio with acceptable latency (target to be set after real network testing — no number invented here).
3. Teacher writes on the whiteboard using the XPPen Deco 640; a student on a mid-range Android phone (per [device-compatibility.md](device-compatibility.md)) sees the strokes live.
4. A late-joining student (after 50+ operations) sees correct current whiteboard state immediately.
5. Teacher grants a raised-hand student mic + whiteboard write access; that student speaks/writes; teacher revokes; further attempts from that student are rejected server-side.
6. Teacher switches to correction mode and marks a private correction on a specific student's page; verify no other connected student's client ever receives that operation.
7. Teacher shares their screen; verify private-correction layers are not part of the shared stream.
8. Class ends; recording becomes available; replay reconstructs whiteboard/PDF state in sync with audio at an arbitrary seek point.
9. Attendance record accurately reflects join/leave times for all participants across the session.
10. Simulated network drop and reconnect for a student mid-class: whiteboard recovers to correct current state.
11. Class at capacity: an additional join attempt fails gracefully with a clear message.

## Non-functional checks

- Latency budget for whiteboard sync and audio (targets to be defined once real network testing establishes a baseline — see [device-compatibility.md](device-compatibility.md) Phase 4).
- Session stability over a realistic full lesson duration.

## Exit criteria

All core scenarios pass on: (a) the confirmed teacher hardware/browser combination, and (b) at least one mid-range Android phone and one iOS device as student clients, before Live Class is considered ready for real users.
