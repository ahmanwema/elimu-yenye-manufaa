# Feature: Recorded Lesson Player

Status: **PROPOSED**, supporting brief Part 11.1 (recorded-lesson replay on the same lesson page as the live experience).

## Purpose

After a Live Class session ends, let the same lesson page support replay of the teacher's audio, whiteboard activity, and PDF annotations in sync, with the lesson's materials, private corrections, and exercises shown below the player — mirroring the live layout's information hierarchy (Part 11).

## User roles

Student (primary consumer), Teacher (reviews own past sessions).

## User journey

1. Student opens a lesson that has a completed recording.
2. The primary player area replays the whiteboard/PDF activity in sync with the teacher's audio, using the same timeline.
3. Student can scrub/seek; the whiteboard state at any point reconstructs correctly from the operation log + nearest snapshot (per [whiteboard.md](whiteboard.md)), not from a video re-render.
4. Below the player: lesson description, materials, the student's own private corrections (navigable independently of scrubbing the whole recording — brief Part 11.1), and associated exercises.

## Functional requirements

- Synchronized playback of: teacher audio, whiteboard/annotation operations, PDF page changes/annotations, and other relevant lesson events (e.g. permission grants, if surfaced) — Part 11.1.
- Seeking must reconstruct correct whiteboard/PDF state at the target time from the operation log + snapshots, not require re-playing from zero.
- Private corrections are listed as discrete, directly-navigable items (jump to that point in playback), not something the student must find by scrubbing.
- Materials and exercises tied to the lesson are shown below the player, consistent with the live layout's hierarchy (Part 11).

## Data requirements

Reuses the same operation-log/snapshot data as live ([whiteboard.md](whiteboard.md), [pdf-annotations.md](pdf-annotations.md)) plus the recording metadata from [audio-recording.md](audio-recording.md); no separate "replay-only" data model.

## Permissions

- A student sees only their own private corrections layered into the replay; class-shared content is visible to all enrolled students; cross-tenant access is denied by the same RLS rules as the live session ([student-corrections.md](student-corrections.md)).
- Teachers can review their own sessions in full (including, appropriately, all students' private corrections they authored, since they authored them).

## UI states

- Player loading/buffering.
- Playing / paused / seeking.
- "No recording available" state (e.g. recording failed, or teacher didn't enable it) — should degrade gracefully to showing materials/exercises without a player.

## Error handling & edge cases

- Corrupted or partial operation log for a session: playback should degrade to "best available" reconstruction rather than failing entirely, with a visible note if data is incomplete.
- Very long sessions: seeking performance must not degrade linearly with session length — depends on the snapshotting strategy in [whiteboard.md](whiteboard.md).

## Security considerations

Same private-annotation exclusion rules as live class apply identically to replay — replay is not a separate security boundary, it's the same data under the same RLS-enforced visibility rules ([student-corrections.md](student-corrections.md)).

## Dependencies

[whiteboard.md](whiteboard.md), [pdf-annotations.md](pdf-annotations.md), [audio-recording.md](audio-recording.md), [student-corrections.md](student-corrections.md), [../components/live-class-layout.md](../components/live-class-layout.md).

## Acceptance criteria

- Seeking to an arbitrary point in a recorded session reconstructs the correct whiteboard/PDF state within a bounded reconstruction time regardless of total session length.
- A student's private corrections are individually navigable in the replay UI without scrubbing the full recording.
- No other student's private corrections ever appear in a given student's replay.

## Testing requirements

[../testing/live-class-acceptance.md](../testing/live-class-acceptance.md), [../testing/security-tests.md](../testing/security-tests.md).

## Open questions

Final recording/annotation storage architecture (shared with [audio-recording.md](audio-recording.md) and [student-corrections.md](student-corrections.md)) remains open per brief Part 11.1. *2026-10-05: the correction-storage tier is decided (Option B default, Option C full-session recording as optional add-on — A29). Still open: whether full-class audio replay exists only when Option C is enabled (open question 18), and the technical storage design.*
