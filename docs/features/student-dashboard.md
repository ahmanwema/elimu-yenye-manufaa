# Feature: Student Dashboard

Status: **PROPOSED** design supporting **APPROVED** requirements A18 (student capabilities) and A9 (parental access). Not in the Phase 1 (Live Class) scope — see [../roadmap/phases.md](../roadmap/phases.md).

## Purpose

Give a student a single home base to see their enrollments, upcoming/live classes, progress, results, private corrections, and downloadable materials — and give a parent (once that account model is decided) a read-only view of the same for their linked children.

## User roles

Student (primary), Parent/Guardian (proposed, read-only, see [../system/roles-permissions.md](../system/roles-permissions.md) §3).

## User journey

1. Student logs in, sees enrollments across all teachers/Markaz they study with (A3).
2. Sees upcoming/live classes, joins directly from the dashboard.
3. Reviews past lesson recordings, private corrections, exercise/exam results.
4. Downloads permitted materials for offline use (A18).
5. (Once approved) a Parent views the same information, read-only, for their linked child/children.

## Functional requirements

- Cross-teacher/cross-Markaz enrollment listing (reflecting the multi-tenant membership model, [../system/tenancy.md](../system/tenancy.md)).
- Upcoming live class list with join action, and past recordings list ([lesson-player.md](lesson-player.md)).
- Progress/results summary per course/exercise ([assessments.md](assessments.md)).
- Private corrections review, independent per teacher/enrollment ([student-corrections.md](student-corrections.md)).
- Offline download of permitted materials (subject to teacher/tenant permission on the material itself).

## Data requirements

Aggregates across enrollment, class-session, submission/grade, and correction data already modeled elsewhere ([../system/database.md](../system/database.md)) — this feature is primarily a read-aggregation layer, not new core data.

## Permissions

- A student sees only their own data across their own enrollments.
- A parent (once approved) sees only their explicitly linked children's data, read-only — never write access to a child's account.

## UI states

Empty state (no enrollments yet — prompts to use an invitation link), populated dashboard, offline-download-in-progress, offline-available indicator per material.

## Error handling & edge cases

- A student enrolled with a teacher who is later removed/deactivated: their historical data/access behavior is an **open question** shared with [../system/tenancy.md](../system/tenancy.md).
- Parent linked to a child who later revokes/changes that link (once the model exists): needs a defined re-consent or notification flow.

## Security considerations

Cross-tenant aggregation must not leak one teacher's data into a view constructed for another teacher's enrollment context — the dashboard is a read view over already-RLS-scoped data, not a privileged aggregation bypassing tenant boundaries.

## Dependencies

[../system/tenancy.md](../system/tenancy.md), [lesson-player.md](lesson-player.md), [assessments.md](assessments.md), [student-corrections.md](student-corrections.md), [../components/course-card.md](../components/course-card.md), [../components/mobile-navigation.md](../components/mobile-navigation.md).

## Acceptance criteria

- A student enrolled with two different teachers sees both sets of classes/materials/corrections correctly separated and correctly attributed.
- Offline-downloaded material remains accessible without network connectivity.

## Testing requirements

[../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md) (mobile-first dashboard), [../testing/security-tests.md](../testing/security-tests.md) (cross-enrollment isolation).

## Open questions

Parent account model (shared with [../roadmap/open-questions.md](../roadmap/open-questions.md) item 2); data retention behavior after a teacher relationship ends.

*2026-10-05:* Parent account model resolved — separate account type linked to one or more Students (A27); Parent scope/read-only status still open (item 14). Departed-student retention resolved for Markaz departure — the student keeps their own submissions/corrections, while restricted Markaz content may be removed (A32). Teacher-departure behavior is still open (item 19).
