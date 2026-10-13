# Component: LiveClassLayout

Status: **PROPOSED**.

## Purpose
The overall lesson-page layout that hosts either the live classroom or the recorded-lesson player, plus lesson title/description, objectives, materials, private corrections, and exercises — implementing the page structure required in brief Part 11.

## Associated features
[../features/live-class.md](../features/live-class.md), [../features/lesson-player.md](../features/lesson-player.md), [../features/student-corrections.md](../features/student-corrections.md).

## Inputs and outputs
- **Inputs**: lesson metadata, live-vs-recorded mode flag, materials list, exercises list, viewer's own private corrections.
- **Outputs**: none beyond composing child components ([teacher-classroom.md](teacher-classroom.md)/[student-classroom.md](student-classroom.md) or the lesson player).

## User interactions
Primarily navigation between the primary whiteboard/player area and the secondary sections below it (materials, corrections, exercises).

## UI states
Live-in-progress, ended-awaiting-recording, recorded-available, no-recording-available (materials/exercises still shown).

## Responsive behavior
- Desktop: primary area (whiteboard/player) large, secondary sections in a sidebar or below.
- Tablet: adaptive width, portrait/landscape both supported, secondary sections collapse to below the primary area rather than a fixed sidebar.
- Mobile: single-column stack — primary area first (fullscreen-capable), then description/objectives/materials/corrections/exercises below, consistent with brief Part 11's specified hierarchy.

## Accessibility
Logical heading/section order matching the visual hierarchy (title → objectives → primary area → materials → corrections → exercises) so it's navigable by screen reader in a sensible order even where the visual layout reorders things responsively.

## Error states
Recording still processing (distinct from "no recording will ever exist"); missing materials/exercises degrade gracefully (section simply doesn't render, rather than showing an error).

## Testing considerations
Layout correctness across desktop/tablet/mobile ([../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md)); live-to-recorded state transition testing.
