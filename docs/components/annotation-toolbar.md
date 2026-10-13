# Component: AnnotationToolbar

Status: **PROPOSED**.

## Purpose
Exposes the teacher's (or a granted student's) whiteboard/PDF tools: pen, erase, undo, shape marks (underline/circle/highlight), note, and — for the teacher only — the class-shared vs. private-correction mode toggle.

## Associated features
[../features/whiteboard.md](../features/whiteboard.md), [../features/pdf-annotations.md](../features/pdf-annotations.md), [../features/student-corrections.md](../features/student-corrections.md).

## Inputs and outputs
- **Inputs**: current user's permission state (write access? teacher?), current active tool/mode.
- **Outputs**: tool-selection and mode-toggle events consumed by [WhiteboardCanvas](whiteboard-canvas.md).

## User interactions
Tap/click to select a tool; a clearly distinct control (not just a subtle color change) for the private-correction mode toggle, given the privacy stakes of getting that toggle's state wrong ([../features/student-corrections.md](../features/student-corrections.md) §UI states).

## UI states
Full toolset (teacher), reduced toolset (granted student — likely pen/erase only, no private-correction mode), hidden/disabled (default student, no write access).

## Responsive behavior
Desktop: full toolbar alongside the large whiteboard, per [../system/design-system.md](../system/design-system.md) §4.1 (teacher tools prioritize the whiteboard, toolbar stays compact). Mobile/tablet: collapses into a compact floating control cluster rather than a fixed sidebar, to preserve writing-surface space.

## Accessibility
Every tool needs a text label/tooltip, not icon-only with no accessible name; the private-correction mode toggle in particular needs an unambiguous, screen-reader-announced state given its privacy consequence.

## Error states
Attempting to use a tool without current server-confirmed permission should be prevented/disabled proactively, not just fail silently after the fact.

## Testing considerations
Mode-toggle clarity/usability testing (since a mis-toggled mode is a privacy bug, not just a UX nuisance); touch-target sizing on mobile.
