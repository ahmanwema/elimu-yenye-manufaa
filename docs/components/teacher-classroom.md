# Component: TeacherClassroom

Status: **PROPOSED**.

## Purpose
The teacher's full live-class working view: whiteboard/PDF area, classroom controls (mic, raise-hand queue, permission grants), attendance, and chat — the teacher-side counterpart to [live-class-layout.md](live-class-layout.md).

## Associated features
[../features/live-class.md](../features/live-class.md), [../features/whiteboard.md](../features/whiteboard.md), [../features/student-corrections.md](../features/student-corrections.md).

## Inputs and outputs
- **Inputs**: session state (participants, raise-hand queue, current permissions granted), whiteboard/PDF state.
- **Outputs**: permission grant/revoke actions (mic, whiteboard-write), recording start/stop, attendance adjustments.

## User interactions
Grant/revoke a raised-hand student's mic or write access; switch into correction mode for an individual student's reading; start/stop screen share; start/stop recording; navigate materials.

*2026-10-13 alignment with approved decisions:* "start/stop recording" is the **optional Option C full-session recording** (A29/A44). It appears only where that add-on is enabled, and starting it must trigger the visible all-participant recording notice (A30). Correction mode must capture a short correction audio segment **without** needing full-session recording (A43). Not implemented.

## UI states
Pre-class setup, live, correcting-a-student (visually distinct), screen-sharing, ended/wrap-up (attendance summary).

## Responsive behavior
Desktop-primary component per [../system/design-system.md](../system/design-system.md) §4.1 — teachers are expected on the confirmed Windows+Chrome+XPPen setup, so desktop is the priority layout; tablet layout must still work (Part 4.1 doesn't preclude a teacher using a tablet) without shrinking the whiteboard disproportionately.

## Accessibility
Raise-hand queue and permission states must be announced/visible without relying on color alone (e.g. also an icon/label) for teachers with color-vision differences.

## Error states
RTC/network failure mid-class (teacher-side indicator distinct from a student-side one, since the teacher needs actionable recovery info, not just "reconnecting").

## Testing considerations
Full acceptance flow in [../testing/live-class-acceptance.md](../testing/live-class-acceptance.md); hardware behavior in [../testing/device-compatibility.md](../testing/device-compatibility.md).
