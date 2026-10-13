# Component: PdfViewer

Status: **PROPOSED**.

## Purpose
Renders a PDF page (book, worksheet, or Qur'an page) in-browser and hosts the [WhiteboardCanvas](whiteboard-canvas.md) as its annotation overlay, keyed to the current page.

## Associated features
[../features/pdf-annotations.md](../features/pdf-annotations.md), [../features/live-class.md](../features/live-class.md).

## Inputs and outputs
- **Inputs**: document reference, current page number, zoom level.
- **Outputs**: page-change events (used to re-key the annotation overlay to the new page's operation log).

## User interactions
Page navigation (next/prev/jump), zoom, (teacher) page selection from their material library.

## UI states
Loading/rendering, loaded, page-transition, error (failed to render — e.g. corrupt file).

## Responsive behavior
Page rendering scales to container width; on mobile, defaults to a fullscreen viewing mode rather than a small embedded pane (per [../system/design-system.md](../system/design-system.md) §4.3).

## Accessibility
Provide page-number and document-title context to assistive tech; zoom controls must be keyboard/touch operable, not mouse-only.

## Error states
Corrupt/unsupported PDF, slow network on a large file (progressive loading indicator rather than a frozen blank page).

## Testing considerations
Rendering fidelity across screen sizes ([../testing/responsive-ui-tests.md](../testing/responsive-ui-tests.md)); annotation-overlay alignment persists correctly across zoom/resize; large-file performance on lower-end Android devices.
