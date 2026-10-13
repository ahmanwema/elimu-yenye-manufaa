# Component: StudentClassroom

Status: **PROPOSED**.

## Purpose
The student's live-class working view: read-only (by default) whiteboard/PDF view, audio playback, raise-hand control, chat, and — when granted — temporary write/mic controls.

## Associated features
[../features/live-class.md](../features/live-class.md), [../features/whiteboard.md](../features/whiteboard.md), [../features/student-corrections.md](../features/student-corrections.md).

## Inputs and outputs
- **Inputs**: session state, own current permission grants (write/mic), own private corrections for the current lesson.
- **Outputs**: raise-hand toggle, chat messages, (when granted) whiteboard operations/mic audio.

## User interactions
Raise hand, send chat question, (when granted) write on the board or speak, view own private corrections panel.

## UI states
Viewing-only (default), granted-write, granted-mic, hand-raised-pending, reconnecting.

*2026-10-13:* plus a **recording-in-progress notice** state, shown when full-session recording starts (A30). Not implemented.

## Responsive behavior
Mobile-primary component per [../system/design-system.md](../system/design-system.md) §4.3 — most students are expected on phones; must support a fullscreen whiteboard-viewing mode, bottom-reachable controls, not a shrunk desktop teacher view.

## Accessibility
Clear, non-color-only indication of "you currently have write/mic access" — this is a state a student must not misunderstand given the classroom-etiquette stakes (accidentally speaking/writing when not intended, or not realizing they've been granted access).

## Error states
Denied mic permission at the OS/browser level when granted in-app: must surface a clear remediation message, not a silent failure.

## Testing considerations
Cross-device responsive testing ([../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md)); permission-state clarity testing.
