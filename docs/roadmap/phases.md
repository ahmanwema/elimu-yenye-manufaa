# Implementation Roadmap

Status: **PROPOSED** phasing — requires project-owner approval before Phase 1 implementation begins (see [../../DECISIONS.md](../../DECISIONS.md) §2).

## Phase 0 — Foundation (current)

Documentation, architecture, and technology evaluation (this pass). Exit criteria: project owner reviews and approves (in whole or part) the technology stack and Phase 1 scope, and resolves the open questions in [open-questions.md](open-questions.md) that block Phase 1 specifically.

## Phase 1a — Local foundation (DONE locally, 2026-10-13)

Authorized and built locally: project scaffold, Prisma schema + migration files, Supabase Auth plumbing, profiles, Markaz tenants, tenant-scoped memberships (multi-Markaz Teachers), Parent account + Parent–Student link states, server-side authorization, RLS migration, negative tests, basic PWA. Not done: sign-in UI, invitations, applying migrations to any real Supabase project, deployment. See [../../PROGRESS.md](../../PROGRESS.md).

## Phase 1b — Onboarding, permissions, i18n (DONE locally, 2026-10-13)

Email OTP / magic-link sign-in, invite-first onboarding, explicit `parent_link.verify` permission and PENDING → VERIFIED verification, ACTIVE-only parent access, Kiswahili/English/Arabic UI with RTL, teacher basic roster, Markaz Admin appointment requests with Super Admin review, standalone correction-audio data foundation. Not done: VERIFIED → ACTIVE, parent link creation, any Live Class/RTC work, connection to a real Supabase project.

## Phase 1c — Recording & correction media policy (DONE, applied to DEV 2026-10-16)

A66–A100: consent, DOB verification, correction clips, provider-neutral recordings, Option C entitlement, deletion lifecycle, audit. See [../../PROGRESS.md](../../PROGRESS.md).

## Phase 1d — Live Class class structure, capacity & session foundation (DONE locally, 2026-10-19)

A101–A130, Markaz-only: classes, Primary/Co-Teacher assignments, per-session substitutes, enrollment with waitlist/grace/suspension, manual payment-evidence verification, enrollment and live capacities (configurable, no numbers), recurring schedules in the Markaz time zone, scheduled and ad hoc sessions with safety close, vendor-neutral participation state (devices, raise hand, one student mic, whiteboard grants, screen-share authorization), attendance, class chat, Option C session-recording integration, and a provider-neutral Live Class shell. **Not** applied to DEV (pre-apply plan pending owner approval). **Still blocked for the real-time part:** RTC/whiteboard vendor (A35), XPPen test, production job scheduling (OQ59).

## Phase 1 — Live Class MVP (first implementation priority, per brief Part 4 / A11)

Recommended minimal scope to validate the core interaction model before building the rest of the platform:

- Basic auth + minimal tenancy (enough to have a teacher account and student accounts joining via invitation link — full curriculum/course structure not required yet).
- Live Class: teacher audio, whiteboard (write/erase, pressure via XPPen Deco 640), PDF display + annotation, screen share, raise-hand, teacher-controlled student mic grant, text chat, basic attendance.
- Individual student corrections (private annotation layer) — this is architecturally load-bearing (it shapes the whole recording/broadcast design) and should not be deferred past MVP even though it's a "detail" feature, per [../features/student-corrections.md](../features/student-corrections.md).
- Recording (Option B storage approach, once approved) + basic replay. *2026-10-05: Option B is now the approved default correction mechanism (A29). Full-session recording is the optional Option C add-on, so whether "basic replay" of a whole class is in Phase 1 depends on open question 18. Consent (A30) applies to any recording in Phase 1.*
- Minimal student dashboard: just enough to see upcoming/live classes and past recordings — the full dashboard ([../features/student-dashboard.md](../features/student-dashboard.md)) can wait.

Explicitly **out of Phase 1**: full curriculum structure, assessments/grading, payments, language-learning module, parent accounts, Markaz-admin tooling beyond the minimum needed to test with more than one teacher.

**Prerequisite before Phase 1 coding starts**: hardware/network validation per [../testing/device-compatibility.md](../testing/device-compatibility.md) Phases 1–2, since it determines whether pressure-sensitive input is even usable and what latency budget is realistic — this should run against a throwaway prototype, not wait for the full Live Class build. *2026-10-05: the RTC vendor pilot (Agora vs LiveKit on the real target network, A35) is also a prerequisite, since neither vendor is selected. Phase 1 is delivered as PWA + mobile web (A36).*

## Phase 2 — Curriculum & Assessment

[../features/curriculum.md](../features/curriculum.md), [../features/assessments.md](../features/assessments.md), full [../features/student-dashboard.md](../features/student-dashboard.md). Enables organizing Live Class sessions into real courses and adding gradable exercises/exams.

## Phase 3 — Payments & Plans

[../features/payments.md](../features/payments.md), once the business-model open questions (roadmap item 6) are resolved. Enables free/paid tiers and ties class-capacity limits (A15) to a real plan model. *2026-10-05: hybrid structure approved (A34) — five distinct concepts. Prices, revenue sharing, and durations remain open, so this phase is still blocked on item 6's remaining parts.*

## Phase 4 — Parental access & Markaz administration

Full [../system/roles-permissions.md](../system/roles-permissions.md) proposals (Markaz Admin, Parent/Guardian) once their account models are approved (roadmap items 1–2). *2026-10-05: both account models are approved (A26, A27). This phase now waits on the exact permission rows and Parent scope (open questions 13–14), not on the account models. Phase placement is unchanged.*

## Phase 5 — Arabic Language Learning module

[../features/language-learning/](../features/language-learning/) — vocabulary, sentence construction, grammar/I'rab, audio dictation, grading/feedback. Explicitly deferred behind the core platform per the brief's framing of it as a "future" module.

## Phase 6 — Native mobile apps

Expo-based Android/iOS apps ([../system/technology-evaluation.md](../system/technology-evaluation.md) §3), once the Live Class interaction model is validated via PWA + mobile web. *2026-10-05: A36 confirms native apps are not required for MVP; this phase is consistent with that decision. Expo remains proposed (P2).*

## Explicitly deferred, no phase assigned yet

AI-assisted grading (A20); full multi-subject content authoring beyond what's needed to demonstrate the platform.

## Recommended scope for the very first implementation milestone

Within Phase 1, the smallest useful slice is: one teacher, using the XPPen Deco 640 on Windows/Chrome, running a live session with audio + whiteboard (no PDF yet, no recording yet) to two or three test students on different devices — proving the hardware and real-time sync work end-to-end — before adding PDF annotation, private corrections, and recording. This sequencing lets the highest-risk technical unknowns (pointer/pressure support, real-time sync latency) get validated cheaply and early.
