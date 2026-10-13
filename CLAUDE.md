# CLAUDE.md — Elimu Yenye Manufaa

This file is the entry point for any AI assistant or engineer working on this repository. Read it first, every session.

## What this project is

Elimu Yenye Manufaa is a multi-teacher, multi-institution online Islamic education platform (Qur'an, Tajwid, Hifdh, Hadith, Aqidah, Fiqh, Tafsir, Arabic language). Independent teachers and Markaz (institutions) run classes; students self-register and join via invitation links. See [docs/README.md](docs/README.md) for the full documentation map.

**Status as of 2026-10-13 (dev baseline):** All Phase 1–2B features plus A62–A64 implemented. The development Supabase project `elimu-yenye-manufaa` has all 9 migrations, a private `correction-clips` bucket and public sign-ups disabled, and is verified: 24 real-Supabase tests, a 14-step UI E2E, and exact schema parity with PGlite. Local: 388 tests. First LOCAL Git baseline commit exists; no remote, nothing pushed or deployed. Not production. See PROGRESS.md.

(2026-09-30: documentation-and-architecture phase only.)

## Non-negotiable rules for anyone working here

1. **Nothing here is approved by default.** Every requirement, role, permission, schema, and technical choice in this repo is either `APPROVED`, `PROPOSED`, `OPEN QUESTION`, or `DEFERRED`. Check [DECISIONS.md](DECISIONS.md) before treating anything as final. Never silently promote a proposal into an approved requirement.
2. **Do not implement, install, migrate, commit, push, or deploy** without explicit authorization from the project owner for that specific piece of work. Documentation and analysis are pre-authorized; application code needs explicit authorization per scope — the current scope is in [DECISIONS.md](DECISIONS.md) §2 (2026-10-13: local foundation only; no production, deploy, Git init, commit or push).
3. **Before touching any feature**, follow this sequence:
   - Inspect the current repository state (don't assume prior work exists or matches memory).
   - Read this file.
   - Read the relevant docs under `docs/system/`, `docs/features/`, `docs/components/`.
   - Read [DECISIONS.md](DECISIONS.md) and [docs/roadmap/open-questions.md](docs/roadmap/open-questions.md).
   - Write a short implementation plan with acceptance criteria and tests before writing code.
   - If the work falls outside currently approved scope, stop and ask.
4. **Do not copy code, architecture, or assets from any prior "Madrasa App" project.** This is a clean-slate design.
5. **Privacy by construction, not by UI hiding.** Anything involving private student corrections, recordings, or cross-tenant data must be enforced server-side / at the database layer (e.g. Postgres RLS), never only by hiding a button.
6. **Live Class is the first implementation priority**, once architecture is approved. Everything else in the roadmap follows it. See [docs/roadmap/phases.md](docs/roadmap/phases.md).
7. **Prisma bypasses RLS.** Every server-side Prisma query touching tenant or personal data must go through `src/server/authz` first (see [docs/system/security.md](docs/system/security.md) §2.1). Never import `src/server/*` into client components.
8. **Every export of a `"use server"` file is a public endpoint.** Put helpers in `src/server/*` (non-action) modules; `tests/unit/auth-safety.test.ts` pins the allowed action exports.
9. **UI strings live in `src/i18n/dictionaries`** (en defines the shape; sw and ar must match). Never hardcode user-visible text; use logical CSS properties so Arabic RTL mirrors correctly.
10. **Git:** initialized 2026-10-13. Do not commit, add a remote, or push without explicit owner authorization. Before any first commit, re-run the secrets scan described in PROGRESS.md.

## Documentation map (quick links)

| Area | File |
|---|---|
| Documentation index | [docs/README.md](docs/README.md) |
| Architecture | [docs/system/architecture.md](docs/system/architecture.md) |
| Technology evaluation | [docs/system/technology-evaluation.md](docs/system/technology-evaluation.md) |
| Database | [docs/system/database.md](docs/system/database.md) |
| Security | [docs/system/security.md](docs/system/security.md) |
| Tenancy | [docs/system/tenancy.md](docs/system/tenancy.md) |
| Roles & permissions | [docs/system/roles-permissions.md](docs/system/roles-permissions.md) |
| Design system | [docs/system/design-system.md](docs/system/design-system.md) |
| Live Class (first feature) | [docs/features/live-class.md](docs/features/live-class.md) |
| Roadmap | [docs/roadmap/phases.md](docs/roadmap/phases.md) |
| Open questions | [docs/roadmap/open-questions.md](docs/roadmap/open-questions.md) |
| Decisions log | [DECISIONS.md](DECISIONS.md) |
| Progress log | [PROGRESS.md](PROGRESS.md) |

## Languages

The product must support Swahili, Arabic, and English. Arabic content requires RTL layout and correct tashkīl (diacritics) rendering — see [docs/system/design-system.md](docs/system/design-system.md).

## Supabase environment (A65)

Supabase project `elimu-yenye-manufaa` is currently used as the development environment. It must not be treated as production until the project owner explicitly approves production readiness. Use only development data and development URLs. Keep "Allow new users to sign up" disabled.

## Confirmed hosting preference

Stack **approved 2026-10-13** (DECISIONS A39): Next.js, TypeScript, Prisma, Supabase Postgres/Auth/Storage, PWA, Vercel as the intended host. Deployment and production Supabase setup are not yet authorized.

## Commands

`npm run check` (lint + typecheck + tests), `npm run build`, `npm run dev`. Database tests run in-process on PGlite — no external database needed. Details in [README.md](README.md).
