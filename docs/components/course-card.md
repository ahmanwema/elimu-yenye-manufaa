# Component: CourseCard

Status: **PROPOSED**.

## Purpose
Card representation of a course/curriculum node in a browsable catalog or dashboard list, showing enough context (title, progress, next lesson) to be the primary navigation unit into a course.

## Associated features
[../features/student-dashboard.md](../features/student-dashboard.md), [../features/curriculum.md](../features/curriculum.md).

## Inputs and outputs
- **Inputs**: course/curriculum-node metadata, viewer's progress (if enrolled), next-upcoming-lesson info.
- **Outputs**: navigation event into the course/curriculum view.

## User interactions
Tap/click to open; progress indicator communicates status at a glance.

## UI states
Not-enrolled (catalog browsing), enrolled-in-progress, enrolled-completed.

## Responsive behavior
Multi-column grid on desktop/tablet, single-column stack on mobile — a genuine reflow, not a scaled-down desktop card (per [../system/design-system.md](../system/design-system.md) §4.3).

## Accessibility
Progress indicator must have a text equivalent (e.g. "60% complete"), not rely on a bar's fill level alone; card must be operable via keyboard (focusable, activatable) on desktop.

## Error states
Missing thumbnail/metadata degrades to a sensible placeholder, not a broken layout.

## Testing considerations
Grid reflow testing across breakpoints ([../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md)).
