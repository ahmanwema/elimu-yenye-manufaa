# CLAUDE.md — Elimu Yenye Manufaa

This file is the entry point for any AI assistant or engineer working on this repository. Read it first, every session.

## What this project is

Elimu Yenye Manufaa is a multi-teacher, multi-institution online Islamic education platform (Qur'an, Tajwid, Hifdh, Hadith, Aqidah, Fiqh, Tafsir, Arabic language). Independent teachers and Markaz (institutions) run classes; students self-register and join via invitation links. See [docs/README.md](docs/README.md) for the full documentation map.

**Status as of 2026-11-22 (PASSWORD AUTH; DEV at 25):** anyone holding a join link now **registers with
their own password** and is signed in immediately — the link is the authorization and nothing is emailed,
at registration or at any later sign-in (A148–A151). This **supersedes the "passwords are not the primary
login method" part of A45** and removes the SMTP blocker from onboarding: a Super Admin creates a Markaz
(name + code only, no administrator needed), then issues a **role-carrying link** — `MARKAZ_ADMIN`,
`TEACHER`, `FINANCE_OFFICER` or `STUDENT`. A Markaz Admin may issue every role **except `MARKAZ_ADMIN`**
(`joinLinkRoles()` in `src/server/authz/policy.ts`), so A52 still holds. The sign-in page shows email +
password first and keeps the emailed-code route below it. Migration 25 (`join_link_roles`, ADDITIVE)
**applied to DEV**; `compare-schema.mjs` reports **"No differences"** at 25 migrations (35 tables /
401 columns / 190 constraints / 113 indexes / 35 enums / 14 policies / 13 functions / 8 triggers /
70 grants). **824/824 tests in 39 files**, lint and typecheck green. Three properties to preserve when
touching this code: a link **never** sets a password on an address that already has an account
(`createAuthUserWithPassword` returns `"exists"`; the person signs in first and the link then adds only
the membership); sign-in failures always read identically, so accounts cannot be enumerated; the use
ceiling is claimed in one atomic `UPDATE ... RETURNING`. **Known gaps (A151):** no "forgot password" and
**email addresses are unverified** — both wait on an SMTP provider, still undecided, as is the RTC
vendor (A35).

**Status as of 2026-11-22 (DEPLOYED):** the project is **live for the first time** at
**https://elimu-yenye-manufaa.vercel.app** (Vercel project `elimu-yenye-manufaa`, connected to the public
GitHub repo; `master` pushed after a full-history secrets scan, 0 matches). This supersedes the old
"deployment not authorized" scope (A146) but **does not** promote Supabase: the deployed app still uses
the DEVELOPMENT project, A65 still stands, sign-ups stay disabled. Sign-in is by **admin-minted magic
link** (`scripts/dev-signin-link.mjs`, A147) because there is still no SMTP provider — which means
**students cannot be onboarded at all yet**: both the join link and an invitation require a code sent to
the student's own address. Resolving that needs either SMTP or a new admin-side "register a student"
path. Emailed codes would also need the Vercel URL added to Supabase's redirect allow-list; admin-minted
links do not, because `/auth/confirm` verifies the token hash server-side.

**Status as of 2026-11-22 (self-service onboarding; DEV at 24):** the project had **no way to create a Markaz at all** — no service, no action, no UI — which, with invite-first onboarding (A45) and disabled sign-ups (A65), meant a new Markaz could never be opened through the product. Stages 1–2 of [docs/features/self-service-onboarding.md](docs/features/self-service-onboarding.md) now close that (A141–A145): a **Super Admin creates a Markaz together with its first Markaz Admin**, and students join through a **shareable join link** (server-only tables, hash-only storage, expiry, use ceiling enforced atomically, identical refusals) that feeds the payment flow which already existed. Three ADDITIVE migrations (22–24) were **applied to DEV**; `compare-schema.mjs` reports **"No differences"** (35 tables / 400 columns / 189 constraints / 113 indexes / 35 enums / 14 policies / 13 functions / 8 triggers / 70 grants). `security/nextjs-upgrade` was **merged into master** (Next.js 16.4.0 → 16.4.6; on 16.4.0 the CLI security nudge had begun killing the dev server after its first request). **818/818 tests in 39 files**, lint and typecheck green. Nothing pushed, nothing deployed. **Two things still block real use:** no SMTP provider, so Supabase's built-in mailer reaches only project team addresses, and the RTC vendor (A35) is still undecided. **Open issue:** in this checkout `vitest` fails even on an import-free test file while a sibling worktree with byte-identical packages runs the same files green; four clean reinstalls did not fix it, so the suite was run with that worktree's binary. Root cause unknown.

**Status as of 2026-11-04 (recovery; DEV fully applied):** the local working folder was found **empty** — the GitHub remote was the only surviving copy and the project was re-cloned. `npm ci` restored dependencies; local verification re-run green (**751/751 in 36 files**, lint, typecheck, build, secrets scan 0). A read-only DEV preflight then found the six "pending" migrations **already applied**: the development project holds **all 21**, checksums and order matching the repo, and `scripts/compare-schema.mjs` reports **"No differences"** against the full repo (33 tables / 380 columns / 173 constraints / 107 indexes / 33 enums / 14 policies / 12 functions / 8 triggers / 66 grants). 0 auth users, every app table empty, 0 storage objects, sign-ups disabled, `correction-clips` private, no `recordings` bucket; `audit_events` 171 rows. The apply happened after 2026-11-02 on the lost machine and was never logged — **no write to DEV was made in this pass**. `tests/real/live-class-dev.test.ts` was reconstructed (40 tests, typecheck + lint pass) but **has never been executed**; the real-DEV suites have not run since the last six migrations landed. Still nothing deployed; RTC vendor undecided (A35). **Note:** on a Windows checkout (`core.autocrlf=true`) `prisma format --check` and migration checksums both report false mismatches — normalise line endings before believing them.

**Status as of 2026-11-02 (GitHub):** `master` (10 commits, up to 11e914f) pushed on owner request to the **public** GitHub repo https://github.com/ahmanwema/elimu-yenye-manufaa (remote `origin`). Secrets scan over full history beforehand: 0 matches. Nothing deployed; Supabase DEV unchanged.

**Status as of 2026-10-19 (finance role):** dedicated non-teaching `FINANCE_OFFICER` Markaz role implemented locally (A140); Teachers can never verify payment; 6 Live Class migrations pending for DEV (21 locally).

**Status as of 2026-10-19 (final corrections):** A131–A139 implemented locally (attendance vs punctuality, time zone fail-closed, seats/FIFO/paid classes, `payment.verify`, detailed-access wiring, mic handoff); 4 Live Class migrations pending for DEV (19 locally). Updated pre-apply plan in docs/testing/dev-supabase-verification.md.

**Status as of 2026-10-19:** Live Class class structure, capacity & session foundation (A101–A130, Markaz-only, provider-neutral) implemented **LOCALLY**: 2 new additive migrations (17 total locally; DEV still has 15 — pre-apply plan in [docs/testing/dev-supabase-verification.md](docs/testing/dev-supabase-verification.md), awaiting owner approval). No media transport, no RTC vendor (A35), no payment gateway, no scheduled jobs. Live Class rules: `src/server/authz/live-class.ts`; all 12 Live Class tables are server-only.

**Status as of 2026-10-16:** recording & correction media policy (A66–A100) implemented and **applied to the DEV Supabase project** (15 migrations, exact parity; `correction-clips` private, audio/mp4, 10,485,760 bytes). 554 local + 41 real-DEV tests + 14-step E2E. Not production; nothing pushed or deployed. RTC vendor undecided (A35); XPPen pending hardware.

**Status as of 2026-10-13 (dev baseline):** All Phase 1–2B features plus A62–A64 implemented. The development Supabase project `elimu-yenye-manufaa` has all 9 migrations, a private `correction-clips` bucket and public sign-ups disabled, and is verified: 24 real-Supabase tests, a 14-step UI E2E, and exact schema parity with PGlite. Local: 388 tests. First LOCAL Git baseline commit exists; no remote, nothing pushed or deployed. Not production. See PROGRESS.md.

(2026-09-30: documentation-and-architecture phase only.)

## Non-negotiable rules for anyone working here

1. **Nothing here is approved by default.** Every requirement, role, permission, schema, and technical choice in this repo is either `APPROVED`, `PROPOSED`, `OPEN QUESTION`, or `DEFERRED`. Check [DECISIONS.md](DECISIONS.md) before treating anything as final. Never silently promote a proposal into an approved requirement.
2. **Do not implement, install, migrate, commit, push, or deploy** without explicit authorization from the project owner for that specific piece of work. Documentation and analysis are pre-authorized; application code needs explicit authorization per scope — the current scope is in [DECISIONS.md](DECISIONS.md) §2 (latest: 2026-10-19 eighth authorization — local Live Class foundation + one local commit; no DEV apply, production, deploy or push).
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
10. **Git:** initialized 2026-10-13; remote `origin` = https://github.com/ahmanwema/elimu-yenye-manufaa (public, added 2026-11-02). Do not commit or push without explicit owner authorization. Before every push, re-run the secrets scan described in PROGRESS.md — the repo is public.

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
| Live Class (first feature) | [docs/features/live-class.md](docs/features/live-class.md) (implemented foundation: last section) |
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
