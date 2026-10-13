# System Architecture

Status: Stack **APPROVED 2026-10-13** (A39: Next.js, TypeScript, Prisma, Supabase Postgres/Auth/Storage, PWA, Vercel intended); local foundation implemented (§5.1). The rest of this document stays **PROPOSED**. (Original 2026-09-30 status: PROPOSED — no final stack is approved — see [technology-evaluation.md](technology-evaluation.md) and [../../DECISIONS.md](../../DECISIONS.md)).

## 1. Goals this architecture must satisfy

- One codebase-family that can reach desktop web, mobile web, installable PWA, and eventually native Android/iOS, without duplicating business logic three times.
- Real-time audio + synchronized whiteboard + PDF annotation with acceptable latency on mid-range Android phones over East-African mobile data.
- Strict multi-tenant data isolation (independent teachers and Markaz) enforced at the data layer, not just in application code.
- Private per-student annotations that survive screen sharing and recording without leaking to other students.
- Incremental delivery: Live Class must be buildable and useful before the rest of the platform exists.

## 2. High-level shape (PROPOSED)

```
┌─────────────────────────────┐        ┌──────────────────────────┐
│  Web client (Next.js/React) │        │ Mobile client (Expo/RN,   │
│  desktop + mobile web + PWA │        │ React Native Web shared)  │
└──────────────┬───────────────┘        └─────────────┬────────────┘
               │  shared TS packages (types, API client, domain logic)
               ▼                                       ▼
        ┌─────────────────────────────────────────────────┐
        │           Application/API layer (Next.js         │
        │  server actions/route handlers, or thin backend) │
        └───────────────┬───────────────────┬──────────────┘
                         │                   │
                         ▼                   ▼
              ┌────────────────────┐  ┌───────────────────────┐
              │ Supabase Postgres  │  │ Real-time layer:       │
              │ (RLS-enforced),    │  │ RTC SFU (audio/screen) │
              │ Auth, Storage      │  │ + whiteboard sync      │
              └────────────────────┘  │ service (data channel/ │
                                       │ WebSocket)             │
                                       └───────────────────────┘
```

## 3. Layers

### 3.1 Client layer
- Web: Next.js (App Router), TypeScript, React. Serves desktop, mobile web, and — via manifest/service worker — the installable PWA.
- Mobile: Expo + React Native, reusing shared packages for API access, domain types, and (where feasible) UI logic via React Native Web, rather than a hand-written separate mobile codebase.
- Shared package(s): domain types, validation schemas, API client, permission-check helpers — imported by both web and mobile so business rules aren't duplicated or drift apart.

### 3.2 Application/API layer
- Handles auth, invitation-link redemption, curriculum CRUD, assessment submission/grading workflow, payment webhooks.
- Enforces authorization in two places: (a) database RLS as the hard boundary, (b) API-level checks for anything RLS can't naturally express (e.g. rate-limiting invitation redemption).

### 3.3 Data layer
- Postgres (via Supabase) as system of record: users, tenants, courses, enrollments, exercises, submissions, payments, invitations, annotations metadata.
- Object storage for PDFs, audio submissions, recordings, exported certificates.
- See [database.md](database.md) for schema approach and [tenancy.md](tenancy.md) for the multi-tenant model.

### 3.4 Real-time layer (Live Class)
- Audio (and screen share) transport: an SFU-based RTC provider — see comparison in [technology-evaluation.md](technology-evaluation.md).
- Whiteboard/annotation sync: a separate concern from audio transport — an operation-log protocol, not a general CRDT (see [../features/whiteboard.md](../features/whiteboard.md)) — carried either over the RTC provider's data channel or a dedicated lightweight WebSocket/broadcast channel.
- Recording: audio track recording (via the RTC provider's egress/recording feature) kept **separate** from the whiteboard operation log, so private per-student layers can be filtered out of what gets replayed to whom. See [../features/student-corrections.md](../features/student-corrections.md).
- 2026-10-05 constraints: the RTC provider is unselected (Agora and LiveKit are both pilot candidates, A35). Full-session recording is the optional Option C add-on, while corrections default to Option B short clips (A29). Large media goes to Supabase Storage for now (A38).

## 4. Cross-cutting concerns

- **Multi-tenancy**: [tenancy.md](tenancy.md)
- **Security & authorization**: [security.md](security.md)
- **Roles & permissions**: [roles-permissions.md](roles-permissions.md)
- **Design system**: [design-system.md](design-system.md)

## 5. Why not a monolith mobile-native rewrite from day one

Building fully separate native iOS/Android apps in parallel with web, before Live Class is even validated, would multiply engineering cost for a feature set (whiteboard + audio) that still needs to prove itself technically on the target hardware first (see [../testing/device-compatibility.md](../testing/device-compatibility.md)). The PROPOSED approach defers native app store distribution until after PWA + mobile web validate the interaction model. ~~This is a recommendation, not a decision~~ — **2026-10-05: the MVP part is now APPROVED (A36)**: MVP is PWA + mobile web; native Android/iOS are not required for MVP and may follow in later phases ([../roadmap/open-questions.md](../roadmap/open-questions.md) item 9). The mobile *stack* in §3.1 is still proposed.

## 5.1 What actually exists (2026-10-13 local foundation)

The stack is approved (A39). The mobile Expo client in §2–3 is still a later-phase proposal (P2) and does not exist.

```
src/
  app/                    Next.js App Router: home (static shell + streamed account panel),
                          /offline, manifest.ts, service-worker registration
  proxy.ts                Supabase session-cookie refresh only (not authorization)
  env.ts                  Lazy zod validation of environment variables
  lib/supabase-browser.ts Browser Supabase client (publishable key; subject to RLS)
  server/                 Server-only code (never imported by client components)
    auth.ts               Supabase token → Profile → Actor (per request, uncached)
    db.ts                 Prisma client (pg adapter) — bypasses RLS
    supabase.ts           Server Supabase client bound to request cookies
    authz/policy.ts       Pure authorization rules (tenant, parent, student)
    authz/load-actor.ts   Loads memberships / platform-admin / parent links
    data/*.ts             Data access: authorize first, then tenant-scoped query
  generated/prisma/       Generated client (git-ignored)
prisma/                   schema.prisma + migrations (init + Supabase auth/RLS)
public/                   sw.js, placeholder icons
tests/                    unit (policy, data access, env) + db (RLS, schema) on PGlite
```

**Phase 2A additions (2026-10-13):** `src/app/[locale]/…` (localized routes: home, sign-in, invite/[token], account, markaz/[tenantId], platform, offline), `src/app/auth/confirm` (magic-link callback), `src/i18n/` (locales, typed dictionaries sw/en/ar), `src/components/` (client forms, language switcher), `src/server/actions/` (thin server actions), `src/server/services/` (invitations, parent links, roster, appointments, permissions, correction audio, platform), `src/server/storage/` (vendor-neutral ObjectStorage + Supabase implementation), `src/server/otp.ts`.

The line below is the Phase 1 status, kept for history: Not built: invitations, sign-in UI, courses, Live Class, whiteboard, PDF, recording, corrections, payments, i18n, native apps. Nothing is deployed or connected to a live Supabase project.

## 6. Explicit non-goals of this document

This document does not select final vendors, does not define the database schema in detail, and does not authorize implementation. See [../../DECISIONS.md](../../DECISIONS.md) for what is actually approved.
