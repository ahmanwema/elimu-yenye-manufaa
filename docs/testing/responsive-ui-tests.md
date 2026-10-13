# Responsive UI Testing

Status: **PROPOSED**.

## Scope

Verifies the desktop/tablet/mobile layout requirements in [../system/design-system.md](../system/design-system.md) and the component specs under `docs/components/` are actually met — "resizes without breaking" is not the same bar as "is a genuinely adapted layout per device class," which is what the brief requires (explicitly disallowing "just shrink the desktop layout" for mobile).

## Required checks

1. **Desktop**: sidebar + main area + course cards render correctly at common desktop widths; teacher whiteboard view prioritizes canvas space over chrome ([../components/teacher-classroom.md](../components/teacher-classroom.md)).
2. **Tablet**: both portrait and landscape orientations tested explicitly (not just one assumed orientation); sidebar collapses/overlays rather than persisting at the cost of whiteboard space.
3. **Mobile**: bottom navigation present and functional ([../components/mobile-navigation.md](../components/mobile-navigation.md)); course cards/lists reflow to single-column ([../components/course-card.md](../components/course-card.md)); whiteboard supports a genuine fullscreen mode.
4. **RTL/Arabic rendering**: Qur'anic text with tashkīl renders correctly at multiple device sizes and zoom levels; mixed-direction UI (RTL content panel inside an LTR-language UI shell, or vice versa) is explicitly tested, not assumed to "just work." ([../system/design-system.md](../system/design-system.md) §3)
5. **Annotation alignment across screen sizes**: a stroke/mark made on one device's screen size renders in the correct relative position on a differently-sized viewing device ([../components/whiteboard-canvas.md](../components/whiteboard-canvas.md), [../components/pdf-viewer.md](../components/pdf-viewer.md)).
6. **Accessible reading sizes**: text scaling/zoom does not break layout, particularly for sustained Qur'an/Hifdh reading sessions.

## Method

Real-device testing (at minimum: one desktop browser, one Android phone, one iOS device, one tablet) is required for the whiteboard/canvas-alignment and RTL checks — browser dev-tool device emulation is insufficient for pointer/touch-input and font-rendering fidelity claims.
