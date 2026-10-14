# PROGRESS.md — Elimu Yenye Manufaa

Chronological, factual log of what has actually happened. Do not record intentions here — record completed state. See [DECISIONS.md](DECISIONS.md) for approval status of anything mentioned here.

## 2026-09-30 — Project initialization

- Repository inspected: empty directory, not yet a git repository, no prior code, no `references/ui/` folder present (Codefinity screenshots were not available — written requirements from the brief were used instead, per the brief's own fallback instruction).
- Created initial documentation structure: `CLAUDE.md`, `DECISIONS.md`, `PROGRESS.md`, and the full `docs/` tree (system, features, features/language-learning, components, testing, roadmap).
- Performed technical research to ground recommendations in current (2026) facts rather than assumption, specifically: XPPen Deco 640 hardware specs and OS/browser compatibility claims, real-time communication provider pricing (LiveKit / Agora / Daily.co), whiteboard sync architecture precedent (tldraw sync), Supabase Row Level Security multi-tenant patterns, and Next.js/Expo cross-platform strategy.
- Produced the required first report (technology options, Live Class architecture proposal, hardware test plan, correction-storage comparison, roadmap, and open questions for owner approval).
- No application code, dependencies, database, or infrastructure was created or modified. No commit, push, or deploy occurred (none of these are authorized yet — see [DECISIONS.md](DECISIONS.md) §2).

## 2026-10-05 — Business decision reconciliation (BR-01–BR-13)

- Repository re-inspected: still not a git repository; still documentation only (43 Markdown files); no application code, schema, migrations, RLS policies, tests, or PWA configuration exist.
- Recorded the project owner's 13 business decisions as approved rows A26–A38 in [DECISIONS.md](DECISIONS.md), with a supersession/refinement record (§1.1) covering P4, P6, P7, P8 and refinements of A4, A15, A21. No historical entry was deleted.
- Updated [docs/roadmap/open-questions.md](docs/roadmap/open-questions.md): items 2, 4, 9, 10, 12 resolved; items 1, 3, 6, 7 partially resolved; items 5, 8, 11 still open. Added items 13–20 (gaps the approved rules leave open).
- Reconciled affected docs: student-corrections, audio-recording, live-class, payments, pdf-annotations, lesson-player, student-dashboard, curriculum, roles-permissions, tenancy, security, technology-evaluation, architecture, database, phases, security-tests.
- A pre-edit copy of all documentation was saved outside the repository (session scratchpad), because there is no git history to revert to.
- No application code, dependencies, database, storage, or infrastructure was created or modified. No commit, push, or deploy.

## 2026-10-13 — Phase 1 local foundation implemented

- Pre-state verified: docs only (43 Markdown files), not a Git repository, no code. Matches the 2026-10-13 audit. The 2026-10-05 scratchpad docs backup no longer existed; a fresh backup of all docs was taken before editing.
- Scaffolded Next.js 16.4.0 + React 19.3.0 + TypeScript 5.9 (strict), with ESLint 9 (eslint-config-next 16.4.0). Installed locally: Prisma 7.10.0 (+ pg adapter), @supabase/ssr 0.12.7, @supabase/supabase-js 2.117.3, zod 4.6.7, server-only. Dev: Vitest 5.0.4, PGlite 0.5.9, dotenv.
- Prisma schema: profiles (= auth.users.id), platform_admins, tenants (Markaz), memberships (tenant-scoped role, ACTIVE/ENDED), student_accounts, parent_accounts, parent_student_links (PENDING/VERIFIED/ACTIVE/REVOKED). Migration SQL generated offline (`prisma migrate diff`, no database connection). A hand-written Supabase migration adds the auth.users FK, profile trigger, integrity checks, helper functions and read-only, deny-by-default RLS.
- Server authorization layer (`src/server/authz`) + authorize-then-query data access (`src/server/data`). Supabase Auth plumbing (server/browser clients, proxy session refresh) with lazy env validation. Basic PWA (manifest, placeholder icons, minimal service worker, offline page).
- Tests: 91 passing (unit authz/data-access/env + RLS and schema tests executing the real migrations on in-process PGlite). Mutation check: weakening two RLS policies made 9 tests fail. Lint clean, typecheck clean, production build succeeds without credentials, local `next start` smoke test passed.
- Docs reconciled: A39–A44 + §1.2 supersession record (P1 approved with Prisma; A17 exception for ACTIVE-linked parents; OQ13 direction, OQ14 scope, OQ15 resolved), new open questions 21–26, security §2.1 (Prisma bypasses RLS), database §7, roles §2.2, tenancy §5.1, architecture §5.1, new docs/system/pwa.md, README.md.
- NOT done: no live Supabase project, no migration applied anywhere, no deploy, no Git init, no commit/push, no RTC/payments/recording/correction clips/Live Class.

## 2026-10-13 — Phase 1.5 / 2A implemented locally

- Pre-state verified: matched the Phase 1 report; baseline lint/typecheck/91 tests/build all passed.
- Docs: decisions A45–A54 recorded (§1.3 supersession); open questions 22, 24, 25, 26 resolved, 14 partially; new 27–30 (teacher invitations, invitation TTL, parent link creation, who assigns `parent_link.verify`). New docs/features/auth-onboarding.md; updated roles-permissions §2.3, tenancy §5.2, security §3.1–3.3, database §8, architecture, pwa, student-corrections, audio-recording, phases, security-tests, components README, CLAUDE.md, README.md.
- Schema (local only): `tenant_permission_grants`, `invitations`, `markaz_admin_appointment_requests`, minimal `corrections`, `correction_audio_clips`; `parent_student_links` gained `tenant_id` + verification audit. Migrations 20261013000200 (offline diff) and 20261013000300 (constraints, partial unique indexes, RLS). Applied only to in-memory PGlite.
- App: localized routes (sw default, en, ar RTL; cookie persistence via proxy), email OTP / magic-link sign-in, invite-first onboarding, Markaz workspace (roster, invitations, parent links + verify, appointment request), platform admin (appointment review, verifier grants), standalone correction-audio services + vendor-neutral storage contract.
- Security fix during the build: an OTP helper exported from a "use server" file would have been a public endpoint able to create accounts; moved to a non-action module and pinned by a test.
- Tests: 275 passing (14 files), incl. service tests on real Prisma over PGlite (`pglite-prisma-adapter`, dev-only). Mutation check: 6/6 deliberate security weakenings caught. Lint, typecheck, build pass; local HTTP smoke test (locale redirects, cookie, lang/dir, RTL, translated text, auth callback fallback) passed.
- Known: `npm audit` reports high-severity advisories in `mysql2`/`deepmerge-ts` pulled in by the Prisma 7.10 CLI/config (not used at runtime against Postgres); the only offered fix downgrades Prisma — not applied.
- NOT done: real Supabase project, any migration on a live DB, buckets, deploy, Git init, commit/push, RTC, recording, VERIFIED → ACTIVE, parent link creation.

## 2026-10-13 — Parent-link workflow, invitations, Git (third authorization)

- Pre-state verified: matched the Phase 2A report; baseline 275/275, lint, typecheck, build passed.
- **Git initialized** (branch `master`, no commits, no remote). `.gitignore` hardened (keys/credentials, Supabase local state, databases, logs). 147 files would be tracked; secrets scan over them found 0 matches; `.env.example` has no values. Nothing staged.
- Decisions A55–A61 recorded (§1.4); open questions 14, 27–30 resolved; interim choices recorded as 31–33.
- Schema (local only): 4 more explicit permissions, parent-link audit columns + `parent_link_events`, invitation `kind`/nullable `role`/`proposed_student_id`. Migrations 20261013000400 (offline diff) and 20261013000500 (state CHECKs, NULLS NOT DISTINCT pending index, permission function, RLS).
- Implemented: parent self-request (non-enumerating), staff create, verify, activate, parent withdraw, staff revoke (conditional updates + event history); Markaz Admin delegation of `parent_link.verify`; teacher invitations (`invitation.create`); parent invitations (proposed child → PENDING only); fixed 7-day expiry with a tested boundary; UI for all of it in sw/en/ar.
- Tests: 355 passing (18 files). Mutation check: 7/7 new rule-breaks caught. Lint, typecheck, build, local HTTP smoke test passed.
- **Dev Supabase verification NOT performed:** no Docker / WSL / Supabase CLI on this machine and no dev-project credentials. Runbook: docs/testing/dev-supabase-verification.md. No Supabase project of any kind was touched.
- NOT done: commits, remote, push, deploy, RTC, payments, recording.

## 2026-10-13 — Fourth authorization: delegation, self-request, single Supabase dev project (COMPLETED)

- Pre-state verified (branch master, no commits, 355/355, build OK).
- Implemented: A62 (Markaz Admin may assign all five permissions to own ACTIVE Teachers), A63 (child proposal needs invitation.create + parent_link.create), A64 (self-request by Markaz code + email OR registration number, non-enumerating). Student registration number: migrations 20261013000600/0700 (per-Markaz, random, immutable, trigger-assigned).
- Security hardening: OTP never creates accounts; invited accounts are created server-side via the admin API after token validation; Supabase public sign-ups are DISABLED (verified: disable_signup=true).
- **Supabase project `elimu-yenye-manufaa` (ref jahyvgzqxqldaatitfvz, PostgreSQL 17.11, eu-central-1) used as DEVELOPMENT (A65).** Read-only preflight beforehand: 0 auth users, 0 tables, 0 buckets — safe for development.
- Applied 9 migrations (8 existing + 20261013000800, found by verification). Schema parity with PGlite: tables, columns, constraints, indexes, enums, policies, functions, triggers and grants all identical (scripts/compare-schema.mjs).
- Differences found and fixed: (1) Supabase grants EXECUTE on new public functions to anon/authenticated, so the SECURITY DEFINER trigger function was executable → revoked (migration 0800), and the PGlite stand-in now mimics the grant. (2) A 7-statement transaction exceeded Prisma's 5 s default at ~230 ms round-trip to eu-central-1 → transaction timeout 20 s / maxWait 10 s. (3) A test false positive: Supabase rejects @example.com in public auth flows, so the sign-up test passed for the wrong reason → rewritten to require the authoritative setting and the specific signup_disabled error.
- Created private dev bucket `correction-clips`.
- Real-Supabase suite (tests/real, `npm run test:dev-supabase`): 24/24 — trigger, RLS through PostgREST with real JWTs from real OTP verification, server-only tables, write refusal, sign-up disabled, unknown-email OTP refused, invite → account → OTP → session → accept (email match, tamper-proof, single use, 7-day expiry), delegation, self-request by registration number and by email (non-enumerating), parent PENDING→VERIFIED→ACTIVE gaining real Data API access, Storage signed upload/read with allow/deny matrix and no direct path access.
- UI E2E (scripts/dev-e2e.mjs against next start): 14/14 — invite page, real /auth/confirm, session cookie, real accept form submitted without JS, membership created, single use, account in sw/en/ar (RTL).
- All test data removed after each run (0 users, 0 objects remain). No real users or data added; no production domain configured.
- Local: 388 tests (19 files), lint, typecheck, build pass.
- Not verified: actual email delivery to an inbox (manual), RTC, payments.

## 2026-10-13 — RTC + whiteboard pilot prepared (evaluation only)

- Baseline verified: commit 2972fe4, 388/388, clean tree.
- Doc audit: stale assumptions recorded (approximate prices, "LiveKit preferred" wording, continuous-recording default, whiteboard-over-data-channel vs A16).
- Official-source desk research:
  - LiveKit revokes publishing server-side; Agora documents no selective server-side revoke.
  - Agora subscriber tokens restrict publishing only with co-host authentication.
  - The Agora Web SDK documents no data-send API.
  - Both support per-participant audio recording.
  - Pricing re-verified.
- Throwaway harness `pilot/rtc/`: own package, excluded from the app.
  - Server-side roles, unguessable rooms, LiveKit server-enforced mic grant/revoke, Agora client-cooperative model.
  - Force-publish / ignore-revoke security tests; whiteboard over Supabase Realtime vs the LiveKit data channel.
  - XPPen pointer logging; JSONL telemetry + analyzer.
  - Pilot server tests 5/5; HTTPS smoke test OK; app checks unchanged (388/388, build OK).
- **NOT run:** device/network tests. They need owner-created Agora and LiveKit development accounts (credentials absent), the physical devices (Android phones, XPPen Deco 640), and a decision on a public tunnel for 4G tests. No measured RTC numbers exist yet. **Vendor: owner decision pending.**
- Not committed (no commit authorized in this task).

## 2026-10-13 — RTC + whiteboard pilot run (automated, one PC)

- Both providers validated with owner-created development credentials, stored in git-ignored `pilot/rtc/.env.local` and never printed.
- New `pilot/rtc/automation/run.mjs` drives the real pilot page in installed Chrome 155 (headless, fake microphone) as 1 teacher + 3 students through S1–S6. `compare.mjs` generates `results/automated-comparison.md`.
- Harness fixes found by running:
  - LiveKit now publishes on the server permission event (the grant raced the permission update);
  - whiteboard counters reset per transport;
  - canvas fully visible;
  - undo/eraser added.
- 4 full runs, alternating LK → AG → AG → LK, S6 = 10 min, on this PC's REAL NETWORK; S4 interruptions SIMULATED.
- Observed:
  - **S3 security:** LiveKit blocked force-publish and server-unpublished an ignore-revoke client (2/2). Agora let unauthorized audio reach the teacher and kept transmitting after revoke (2/2; co-host authentication not enabled).
  - **S2 timing:** LiveKit grant→audio ~1.75 s vs Agora ~2.4–4.2 s; revoke→silence ~0.5–1.2 s vs ~1.1–2.4 s.
  - **S6:** LiveKit 54/54 in both runs; Agora 2/54 in run 1 (teacher audio repeatedly unpublished at the students; cause undetermined) and 54/54 in run 2.
  - **Whiteboard:** Supabase Realtime delivered all strokes but out of order (0–4 per student). The LiveKit data channel kept order, with ping RTT ~225 vs ~600 ms. Offline-recovery checks are inconclusive.
- Details: [docs/testing/rtc-pilot-results.md](docs/testing/rtc-pilot-results.md) §4.
- **Not run:** phones, 4G/hotspot, XPPen, real voices, 60-min session.
- **Vendor and whiteboard transport: owner decision pending (A35 unchanged).**
- Pilot tests 5/5; app check 388/388; build OK. One local commit, not pushed.

## 2026-10-14 — RTC pilot Phase 2: real-device Wi-Fi test; pilot phase closed

**Pilot hardening, before any device access:**
- The token server listens on 127.0.0.1 only.
- `/api/config` returns only the "configured" flags. Whiteboard (Supabase dev) settings come only after a valid code.
- Telemetry requires a valid code; the code is never stored in events.
- Wrong codes lock a client out after 10 tries per 10 min.
- New `gateway.mjs` serves only the built `dist/` plus 7 allow-listed API endpoints. It uses HTTPS for the LAN with a local self-signed 7-day certificate in git-ignored `.certs/`. Its loopback HTTP listener for a tunnel was prepared but never used.
- Exposure probes (env files, source, results, traversal, `/@fs`, other ports) were all refused. No secrets in the bundle; no codes in logs.
- Pilot tests: 7/7.

**Owner test:**
- Windows Chrome teacher + realme 7i (Android 10, Chrome 153) on the same Wi-Fi, both providers, real voice.
- Findings: [docs/testing/rtc-pilot-results.md](docs/testing/rtc-pilot-results.md) §5. Evidence: `pilot/rtc/results/real-device/2026-10-14-wifi.json`.

**Closed by the owner:**
- XPPen: **pending hardware**.
- Agora co-host authentication: **deferred**.
- Hotspot / 4G: not run. The **Cloudflare tunnel was never opened** (cloudflared was never installed).
- Pilot server and gateway stopped; ports 5443 / 5480 / 8787 confirmed closed.
- **No vendor selected (A35 unchanged).**

**Firewall review (not changed):** Windows has two pre-existing "Node.js JavaScript Runtime" inbound Allow rules, created by an earlier click on the Windows prompt. They cover TCP and UDP, any port, any remote address, Public profile. They are not needed now. Recommendation: remove them, or narrow them to a specific port + `LocalSubnet` when LAN tests resume.

## 2026-10-14 — Recording & correction media policy implemented (local, A66–A80)

- Owner decisions recorded as A66–A80 (DECISIONS §1, §1.6). Resolved: open questions 15 (stale), 16, 17, 19, 20, 23. New open items 34–45; each is implemented fail-closed or with the narrowest interim rule.
- **Migrations** `20261014000000_recording_correction_media` (additive, generated offline) and `20261014000100_recording_correction_media_rls` (CHECKs, partial unique indexes, append-only audit trigger, RLS). Applied to PGlite only — **not** to the dev Supabase project (owner approval needed; see docs/testing/dev-supabase-verification.md).
- **Built:**
  - correction model (annotation, note, flexible anchors with snapshots);
  - primary/history clips;
  - server-side AAC-in-M4A ≤ 60 s inspection of stored bytes;
  - DOB + derived minor status;
  - guardian online / verified offline consent with withdrawal → deletion review;
  - provider-neutral recordings (notice, participants and capture plan, submit/approve/revoke, segments, gated parent playback);
  - deletion lifecycle (request → admin approval → soft delete + archive → 30-day purge of bytes only);
  - audited Super Admin access;
  - UI on the Markaz and account pages (sw/en/ar).
- **Not built (by decision):** RTC capture/egress/extraction workers (vendor undecided, A35), Option C entitlement, scheduling of purge/cleanup.
- **Fail-closed:** the minor age threshold is unset, so no student is currently recording-eligible.
- Tests: 511 local (27 files; +123), lint, typecheck and build pass. `tests/real` was updated but not run (needs the new migrations on the dev project).

## 2026-10-15 — Media policy decisions completed (local, A81–A91)

- Owner decisions A81–A91 recorded and implemented:
  - under-18 threshold; DOB entered by student/guardian and verified by a Markaz Admin;
  - adult self-consent; withdrawal actors;
  - no deletion self-approval (second admin; single admin → stays pending); cancel/decline;
  - 7-day abandoned-upload cleanup; 10 MB clip limit;
  - recording reject/resubmit; explicit current-clip selection;
  - teacher recording notice; Option C request → Super Admin enable (entitlement only).
- Migrations `20261015000000_media_policy_decisions` (additive; DOB columns renamed) and `20261015000100_media_policy_decisions_rls`. Applied to PGlite only.
- UI:
  - account: own DOB and consent, guardian DOB and consent;
  - Markaz: DOB verification, decline/cancel, reject/resubmit, Make current, Option C request;
  - platform: Option C enable.
- Tests: 539 local (28 files; +28), lint, typecheck, build pass. Real Supabase NOT changed; pending plan in docs/testing/dev-supabase-verification.md.
- Remaining open: items 41, 42, 46–50 (open-questions.md); RTC vendor (A35); XPPen (hardware).

## Status snapshot

| Area | Status |
|---|---|
| Documentation foundation | Done (this pass) |
| Business rules BR-01–BR-13 | Recorded as approved (A26–A38), docs reconciled 2026-10-05 |
| Technology stack | **Approved** (A39), installed locally |
| Database schema | 9 migrations applied to the DEVELOPMENT Supabase project (parity verified); 4 further local migrations (2026-10-14/15, media policy) NOT yet applied there |
| Auth / tenancy / roles / Parent links | Foundation implemented (no sign-in UI, no invitations, no link workflow) |
| PWA | Basic foundation (manifest, placeholder icons, minimal SW) |
| Tests | 539 local (2026-10-15) + 24 real-Supabase + 14-step UI E2E (real suites last run 2026-10-13) |
| Version control | Git initialized; first local baseline commit created 2026-10-13; no remote |
| Auth / onboarding / i18n | Implemented locally (OTP + magic link, invite-first, sw/en/ar + RTL) |
| Parent links | Full workflow implemented (request/create → verify → activate → revoke) with explicit permissions and audit history |
| Correction & recording media | Policy foundation implemented locally (A66–A80): consent, primary/history clips, M4A ≤ 60 s validation, approval, deletion lifecycle, audit; no RTC capture/extraction |
| Live Class architecture | Proposed, awaiting approval |
| Live Class implementation | Not started |
| Any other feature | Not started |
| Hosting/infrastructure setup | Not started (not authorized) |
| First deployment | Not started |

## Next expected step

Owner confirms the interpretations listed in the latest report (child proposal by Markaz Admins needs both explicit grants; registration-number format) and chooses the next feature scope. Production readiness is NOT approved; the Supabase project stays development-only.
