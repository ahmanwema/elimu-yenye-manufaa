# Device Compatibility — XPPen Deco 640 Testing Plan

Status: **PROPOSED test plan** — not yet executed (no application exists to test against yet).

## Why this needs its own real test, not just manufacturer claims

XPPen publishes OS-level compatibility (Windows 7+, macOS 10.13+, Chrome OS 88+, Android 10+, Linux) and driver-level pressure sensitivity (16,384 levels, 5080 LPI, 220 RPS report rate, 60° tilt). None of that establishes whether **our specific browser-based whiteboard**, built on the W3C Pointer Events API inside Chrome, actually receives pressure/tilt data correctly — that depends on the XPPen Windows driver's "Windows Ink" compatibility mode and how Chrome's Pointer Events implementation surfaces `pressure`/`tiltX`/`tiltY` for that device class. This must be verified directly, per the brief's explicit instruction.

## Hardware specs to test against (confirmed from XPPen's published specs)

- Active area 16cm × 9cm, USB-C interface, battery-free pen, 16,384 pressure levels, 5080 LPI resolution, 220 RPS report rate, 60° tilt support, 10mm reading height.

## Test plan

### Phase 1 — Baseline driver/OS verification
1. Install the latest XPPen driver for the Deco 640 on the target Windows machine.
2. Confirm the tablet is recognized in XPPen's driver utility and that Windows Ink compatibility is enabled (this is the setting most likely to determine whether Chrome's Pointer Events receive pressure data at all).
3. Verify basic OS-level pen input works in a native Windows app (e.g. Windows Ink Workspace) as a sanity baseline before testing the browser.

### Phase 2 — Raw browser Pointer Events verification
4. In Chrome, open a minimal test page (a bare `<canvas>` with `pointerdown`/`pointermove`/`pointerup` listeners logging `event.pressure`, `event.pointerType`, `event.tiltX/Y`, `event.width/height`) — this isolates the browser/driver behavior from any application code.
5. Record: does `pointerType` correctly report `"pen"` (not `"mouse"` or `"touch"`)? Does `pressure` vary meaningfully across light/heavy strokes, or report a flat `0.5`/`1.0` (a common failure mode when a device isn't recognized as a true pressure-sensitive pen by the browser)? Does tilt report non-zero values?
6. Test pen-down, pen-move (drag), pen-up, and the eraser end of the stylus (if the Deco 640's pen has one) separately.
7. Repeat with Chrome fully updated to its latest stable version, since Pointer Events pressure handling has historically had browser-version-dependent bugs.

### Phase 3 — Application-context verification
8. Once a whiteboard prototype exists ([../features/whiteboard.md](../features/whiteboard.md)), repeat the pressure/tilt checks inside the actual whiteboard component, since event handling inside a framework (React synthetic events, canvas library abstractions) can alter or drop pointer event fields if not implemented carefully.
9. Test erasing (both an eraser tool and, if supported, the pen's physical eraser end).
10. Test digital handwriting quality subjectively (line smoothness, latency, any visible input lag) at normal writing speed, not just isolated taps.
11. Test PDF annotation: does pressure/pen input work identically when the canvas is layered over a rendered PDF page, not just a blank canvas?
12. Test sustained use (a full simulated lesson length) for driver stability/disconnection issues.

### Phase 4 — Real-time sync verification
13. With a second device (a phone) as a viewing student, verify strokes drawn with the tablet appear live and pressure-varied strokes actually render with varying width/opacity on the receiving end (assuming the whiteboard renders pressure visually) — end-to-end, not just local capture.
14. Test late-join and reconnect scenarios specifically while mid-stroke on the tablet, to catch any edge case unique to continuous pressure-varying input (as opposed to simple discrete clicks).

## Pass/fail criteria

- **Pass**: `pointerType === "pen"`, pressure varies meaningfully and correlates with actual applied pressure, tilt reports plausible values, and strokes render smoothly in the actual whiteboard component with no perceptible extra input lag versus a mouse.
- **Fail / needs mitigation**: pressure reports flat/binary values, or `pointerType` misreports as `"mouse"` — in this case the whiteboard should still function (fall back to a fixed stroke width) rather than being blocked on pressure support, since pressure sensitivity is a quality enhancement, not a functional requirement of "can the teacher write and can students see it."

## Reporting

Results should be logged back into this document (or a dated addendum) once Phase 1–2 testing is actually run — this document currently describes the *plan*, not results, since no testing has occurred yet.
