# Components Index & Conventions

Status: **PROPOSED** — no component has been implemented yet.

Component specs describe intended UI building blocks at a design level (purpose, inputs/outputs, states, responsiveness, accessibility) — not final prop-level API contracts, which are implementation-time decisions made when the component is actually built, informed by whatever framework is approved ([../system/technology-evaluation.md](../system/technology-evaluation.md)).

## Shared conventions

- Every component must define behavior for all three device classes (desktop, tablet, mobile) per [../system/design-system.md](../system/design-system.md) — "shrink the desktop layout" is explicitly disallowed for primary navigation and the whiteboard/classroom surfaces.
- Any component rendering Arabic content must support RTL and tashkīl correctly ([../system/design-system.md](../system/design-system.md) §3).
- Any component exposing a permission-gated control (e.g. write-access toggle) must treat the frontend state as a *reflection* of server-authorized state, never the source of truth ([../system/security.md](../system/security.md)).

## Index

- [teacher-classroom.md](teacher-classroom.md)
- [student-classroom.md](student-classroom.md)
- [whiteboard-canvas.md](whiteboard-canvas.md)
- [pdf-viewer.md](pdf-viewer.md)
- [annotation-toolbar.md](annotation-toolbar.md)
- [live-class-layout.md](live-class-layout.md)
- [lesson-exercises.md](lesson-exercises.md)
- [mobile-navigation.md](mobile-navigation.md)
- [course-card.md](course-card.md)

## Implemented components (2026-10-13)

| Component | File | Notes |
|---|---|---|
| ActionForm | `src/components/action-form.tsx` | Server-action form with pending state and translated result message |
| SignInForm | `src/components/sign-in-form.tsx` | Email → code (OTP) two-step form |
| InviteSignIn | `src/components/invite-sign-in.tsx` | Sends the code to the invited address (chosen server-side) |
| InviteCreateForm | `src/components/invite-create-form.tsx` | Target (incl. PARENT) and optional proposed child (only when the server says the actor may propose); shows the one-time link |
| LanguageSwitcher | `src/components/language-switcher.tsx` | Same page in sw / en / ar; streamed (Suspense) on dynamic routes |

All accept translated strings as props; none contain authorization logic.

2026-10-13: the Markaz workspace adds per-link Verify / Activate / Revoke buttons (each shown only with the matching permission, never for links the viewer is party to), a "Start a parent link" form (`parent_link.create`), and a verifier-delegation panel for Markaz Admins. The account page adds "Link to my child" and "Withdraw". The platform page shows a per-person permission matrix. Every action is re-authorized on the server.
