# Feature: Digital Whiteboard

Status: **PROPOSED** design supporting the **APPROVED** Live Class whiteboard requirement (A13, A16).

## Purpose

Give the teacher a real-time writing/erasing surface, synchronized live to every connected student, with per-student write permission the teacher explicitly controls, and support for late joiners and reconnection without losing state.

## User roles

Teacher (default write access), Student (read-only unless explicitly granted), Super Admin (no special whiteboard access beyond support tooling).

## User journey

1. Teacher opens a whiteboard page (blank, or backing a PDF page — see [pdf-annotations.md](pdf-annotations.md)).
2. Teacher writes/erases with the XPPen Deco 640; strokes appear live for all students.
3. A student is granted write access for their turn (e.g. to answer a question on the board); they write; teacher revokes access afterward.
4. A student who joins mid-lesson sees the current board state immediately, not a replay from zero.
5. A student's connection drops and reconnects; their board recovers to the current state without manual refresh being the only recovery path.

## Functional requirements

- Pen-down/move/up capture via the browser Pointer Events API, including pressure where the device/driver/browser combination supports it (see hardware test plan, [../testing/device-compatibility.md](../testing/device-compatibility.md) — this must not be assumed from manufacturer marketing claims alone, per brief 4.1).
- Erase tool, distinct from "undo."
- Undo of the most recent local operation (teacher-side at minimum).
- Write access is off by default for students; only an explicit, revocable teacher grant enables it (A16); this must be checked server-side on every write operation.
- Stroke synchronization to all connected clients with low enough latency to feel "live" (concrete latency target pending network testing — [../testing/live-class-acceptance.md](../testing/live-class-acceptance.md)).
- Coordinate normalization: strokes are stored in a device-independent coordinate space (e.g. normalized 0–1 relative to page/canvas bounds) so they render correctly across different screen sizes/aspect ratios rather than being pinned to the teacher's pixel dimensions.
- Whiteboard state recovery for late joiners and reconnecting clients via periodic snapshots (see below).
- Synchronization with PDF pages: whiteboard operations are scoped to a specific (document, page) key when annotating a PDF, so switching pages shows the correct annotation layer — see [pdf-annotations.md](pdf-annotations.md).

## Data requirements

- An ordered, timestamped **operation log** per (document/board, page): each operation is one of `stroke_start`, `stroke_point(s)`, `stroke_end`, `erase`, `undo`, tagged with author and — critically — a **visibility** field (`class_shared` vs `private_to_student:<id>`) so correction-mode strokes (see [student-corrections.md](student-corrections.md)) never broadcast beyond their owner.
- Periodic **snapshots**: a compacted representation of "all operations up to time T" so a late joiner fetches one snapshot + the small tail of ops since it, rather than replaying an entire session's operation history.

## Permissions

- Teacher: always has write access on their own class's boards.
- Student: read-only by default; write access is a per-student, per-session grant, revocable at any time, checked on the server for every incoming operation (not just at connection time).
- Visibility-scoped operations (private corrections) are only delivered to their owner + teacher at the transport level, not merely filtered client-side — see [student-corrections.md](student-corrections.md) and [../system/security.md](../system/security.md) §4.

## UI states

- Idle/read-only viewer (default student).
- Active-write (teacher, or a granted student) — shows pen/erase/undo tools.
- Reconnecting — shows a distinct "reconnecting…" state rather than a frozen or blank board.
- Correction mode (teacher only) — visually distinct so the teacher can tell they're marking privately vs. writing to the whole class.

## Error handling & edge cases

- Out-of-order operation delivery (network jitter): the log must be ordered server-side (sequence number / logical clock), not trusted to arrive in send order.
- A revoked student continues sending operations after revocation (e.g. a stale client): server must reject them post-revocation, not merely stop the UI from generating them.
- Undo across a permission boundary (e.g. undoing after write access was revoked mid-stroke): needs a defined server-side rule — PROPOSED: an in-flight stroke is finalized before a revocation takes effect, rather than partially applied.
- Very long sessions accumulating a large operation log: snapshotting must keep replay cost bounded regardless of session length.

## Security considerations

- Every operation is authorized server-side against current permission state at the time it's received, not the time it was created client-side (A16, brief 4.3).
- Private-visibility operations must never be included in any payload sent to a non-owner client, including any recording/export pipeline — see [student-corrections.md](student-corrections.md) and [audio-recording.md](audio-recording.md).

## Dependencies

[pdf-annotations.md](pdf-annotations.md), [student-corrections.md](student-corrections.md), [../system/technology-evaluation.md](../system/technology-evaluation.md) §5 (sync approach), [../testing/device-compatibility.md](../testing/device-compatibility.md).

## Acceptance criteria

- Teacher strokes drawn with the XPPen Deco 640 in Chrome render live on a student's device with visible continuity (no dropped segments under normal network conditions).
- A student joining after 50+ operations have occurred sees the correct current state without manually requesting a refresh.
- A revoked student's write attempts are rejected by the server and never appear on any other client's board.
- Reconnection after a simulated network drop restores the correct current board state.

## Testing requirements

Hardware/pointer-event testing: [../testing/device-compatibility.md](../testing/device-compatibility.md). Functional/acceptance testing: [../testing/live-class-acceptance.md](../testing/live-class-acceptance.md). Permission-enforcement testing: [../testing/security-tests.md](../testing/security-tests.md).

## Open questions

- Concrete latency target (depends on network testing results, not yet run).
- Whether undo should be available to students during a granted-write turn, or teacher-only.
