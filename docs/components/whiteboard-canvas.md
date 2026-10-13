# Component: WhiteboardCanvas

Status: **PROPOSED**.

## Purpose
The rendering + input-capture surface for the digital whiteboard: renders the current operation-log state and captures pen/touch/mouse input when the current user has write access.

## Associated features
[../features/whiteboard.md](../features/whiteboard.md), [../features/pdf-annotations.md](../features/pdf-annotations.md) (used as the annotation layer over a rendered PDF page), [../features/student-corrections.md](../features/student-corrections.md).

## Inputs and outputs
- **Inputs**: current document/page id, current operation-log snapshot + live op stream, current user's write-permission state (server-derived), active tool (pen/erase/undo), active visibility mode (class-shared vs private-to-student, teacher only).
- **Outputs**: emitted stroke/erase/undo operations (sent to the server for authorization + broadcast); does not locally assume an operation is valid until server-acknowledged for anything beyond optimistic local rendering.

## User interactions
Pen-down/move/up via Pointer Events (with pressure where available), erase gesture, undo action, (teacher only) toggling private-correction mode.

## UI states
Read-only (no write access), active-write, private-correction-mode (teacher), reconnecting, stale/optimistic-pending (a local stroke drawn but not yet server-acknowledged).

## Responsive behavior
Canvas coordinate space is normalized (0–1 relative to page bounds), not pixel-locked, so it renders correctly at any container size — from a teacher's large desktop monitor to a small phone screen. Touch-target sizing for tool controls scales up on touch devices.

## Accessibility
Pure freehand drawing is inherently visual; the component should still expose a text-alternative summary where feasible (e.g. "3 corrections on this page" for screen-reader users) even though the strokes themselves aren't meaningfully describable — full accessibility treatment is a design-time task, not solved by this spec alone.

## Error states
Failed-to-send operation (network issue) — should retry/queue rather than silently drop a stroke; server-rejected operation (e.g. permission revoked mid-stroke) — should roll back the optimistic local render.

## Testing considerations
Pointer Events + pressure behavior across the XPPen Deco 640 in Chrome ([../testing/device-compatibility.md](../testing/device-compatibility.md)); operation ordering under simulated network jitter; permission-revocation mid-stroke behavior.
