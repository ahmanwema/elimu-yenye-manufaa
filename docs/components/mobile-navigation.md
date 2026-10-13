# Component: MobileNavigation

Status: **PROPOSED**.

## Purpose
Bottom navigation bar for the major application sections on mobile, replacing the desktop sidebar rather than shrinking it (explicit requirement, brief Part 10.3).

## Associated features
Cross-cutting — used across [../features/student-dashboard.md](../features/student-dashboard.md) and generally on mobile web/PWA.

## Inputs and outputs
- **Inputs**: current route/section, unread/attention indicators (e.g. an active live class, a new graded result).
- **Outputs**: navigation events.

## User interactions
Tap a section icon/label to navigate; indicator badges draw attention to time-sensitive items (e.g. "class starting now").

## UI states
Default, active-section-highlighted, badge-present.

## Responsive behavior
Mobile/small-tablet only — this component does not appear on desktop, where the sidebar ([../system/design-system.md](../system/design-system.md) §4.1) serves the equivalent purpose. This is a distinct component, not a responsive collapse of the sidebar component.

## Accessibility
Touch targets sized for reliable thumb interaction; current section clearly indicated to assistive tech, not just visually.

## Error states
Not applicable beyond standard navigation failure handling.

## Testing considerations
Cross-device testing for touch-target sizing and reachability ([../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md)).
