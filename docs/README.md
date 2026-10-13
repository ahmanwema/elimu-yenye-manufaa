# Documentation Index — Elimu Yenye Manufaa

Start at [../CLAUDE.md](../CLAUDE.md) for the operating rules. This page indexes everything else.

Status tags used throughout: `APPROVED`, `PROPOSED`, `OPEN QUESTION`, `DEFERRED`. Authoritative status list lives in [../DECISIONS.md](../DECISIONS.md) — if a document and `DECISIONS.md` disagree, `DECISIONS.md` wins.

## System (cross-cutting architecture)

- [system/architecture.md](system/architecture.md) — overall system architecture, service boundaries
- [system/technology-evaluation.md](system/technology-evaluation.md) — stack options, comparisons, recommendation
- [system/database.md](system/database.md) — schema approach, multi-tenant data model
- [system/security.md](system/security.md) — authZ/authN, RLS, recording consent, child protection
- [system/tenancy.md](system/tenancy.md) — teacher/Markaz tenant model
- [system/roles-permissions.md](system/roles-permissions.md) — role definitions and permission matrix
- [system/design-system.md](system/design-system.md) — visual identity, RTL/Arabic typography, tokens
- [system/pwa.md](system/pwa.md) — manifest, service worker, offline/caching policy (implemented foundation)

## Features

- [features/live-class.md](features/live-class.md) — **first implementation priority**
- [features/auth-onboarding.md](features/auth-onboarding.md) — email OTP / magic link, invite-first onboarding (implemented 2026-10-13)
- [features/whiteboard.md](features/whiteboard.md)
- [features/pdf-annotations.md](features/pdf-annotations.md)
- [features/student-corrections.md](features/student-corrections.md)
- [features/audio-recording.md](features/audio-recording.md)
- [features/lesson-player.md](features/lesson-player.md)
- [features/student-dashboard.md](features/student-dashboard.md)
- [features/curriculum.md](features/curriculum.md)
- [features/assessments.md](features/assessments.md)
- [features/payments.md](features/payments.md)

### Arabic language learning module

- [features/language-learning/vocabulary.md](features/language-learning/vocabulary.md)
- [features/language-learning/sentence-construction.md](features/language-learning/sentence-construction.md)
- [features/language-learning/grammar-irab.md](features/language-learning/grammar-irab.md)
- [features/language-learning/audio-dictation.md](features/language-learning/audio-dictation.md)
- [features/language-learning/grading-feedback.md](features/language-learning/grading-feedback.md)

## Components

- [components/README.md](components/README.md) — index and shared conventions
- [components/teacher-classroom.md](components/teacher-classroom.md)
- [components/student-classroom.md](components/student-classroom.md)
- [components/whiteboard-canvas.md](components/whiteboard-canvas.md)
- [components/pdf-viewer.md](components/pdf-viewer.md)
- [components/annotation-toolbar.md](components/annotation-toolbar.md)
- [components/live-class-layout.md](components/live-class-layout.md)
- [components/lesson-exercises.md](components/lesson-exercises.md)
- [components/mobile-navigation.md](components/mobile-navigation.md)
- [components/course-card.md](components/course-card.md)

## Testing

- [testing/test-strategy.md](testing/test-strategy.md)
- [testing/device-compatibility.md](testing/device-compatibility.md) — includes XPPen Deco 640 test plan
- [testing/live-class-acceptance.md](testing/live-class-acceptance.md)
- [testing/security-tests.md](testing/security-tests.md)
- [testing/dev-supabase-verification.md](testing/dev-supabase-verification.md) — runbook for verifying against a local/dev Supabase (not yet executed)
- [testing/responsive-ui-tests.md](testing/responsive-ui-tests.md)

## Roadmap

- [roadmap/phases.md](roadmap/phases.md)
- [roadmap/open-questions.md](roadmap/open-questions.md)
