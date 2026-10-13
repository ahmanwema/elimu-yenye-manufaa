# Component: LessonExercises

Status: **PROPOSED**.

## Purpose
Displays the exercises/assessments associated with a lesson (on both the live and recorded lesson page), and lets a student navigate into a submission flow.

## Associated features
[../features/assessments.md](../features/assessments.md), [../features/lesson-player.md](../features/lesson-player.md).

## Inputs and outputs
- **Inputs**: list of exercises tied to the lesson, per-exercise submission/grading status for the current student.
- **Outputs**: navigation into a specific exercise's submission UI (out of scope for this component itself).

## User interactions
Tap/click an exercise to open it; view status (not started/in progress/awaiting grading/graded).

## UI states
Empty (no exercises for this lesson), populated list with per-item status badges.

## Responsive behavior
List/card layout that reflows from a multi-column desktop view to a single-column mobile list, consistent with [course-card.md](course-card.md) conventions.

## Accessibility
Status badges must convey meaning via text/label, not color alone.

## Error states
Exercise data fails to load: show a retry state, not an empty list indistinguishable from "no exercises."

## Testing considerations
Status-badge accuracy against actual submission/grading state ([../testing/security-tests.md](../testing/security-tests.md) for ensuring a student never sees another student's status here).
