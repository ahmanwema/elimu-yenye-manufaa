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

## 2026-10-16 — Remaining recording policy decisions (local, A92–A98) + DEV pre-apply preflight

- Implemented:
  - A92 Markaz Admin author may approve/reject own recording (deletion self-approval still refused);
  - A93 no DOB self-verification (service + DB CHECK; single-admin Markaz stays unverified, UI explains);
  - A94 student access to own approved recordings;
  - A95 parent visibility on consent valid AT CAPTURE (participant snapshot) — later withdrawal → review, not auto-hide;
  - A96 Option C cancel/decline/disable;
  - A97 offline consent Markaz-specific;
  - A98 10 MB = 10,485,760 bytes.
- Migrations `20261016000000_resolve_recording_policy` (additive) and `20261016000100_resolve_recording_policy_rls`. PGlite only.
- Fixed a documentation slip from 2026-10-15: the "Parent account model" heading in roles-permissions.md had been overwritten; restored.
- Tests: 553 local (28 files; +14), lint, typecheck, build pass.
- Read-only preflight of the DEV Supabase project (no writes) — see the 2026-10-16 report.
- Open: 49 (job scheduling), 51 (departed student and full recordings — interim refused), 52 (re-request after decline/cancel/disable — implemented as allowed).

## 2026-10-16 — DEV Supabase apply (owner APPLY instruction)

- Final decisions recorded first: **A99** (departed student → full Markaz recordings denied; own corrections kept) and **A100** (Option C re-request after DECLINED/CANCELLED/DISABLED = new cycle, Super Admin again, never auto-enabled). Local tests 554/554.
- **Pre-apply gate re-confirmed:**
  - project ref `jahyvgzqxqldaatitfvz`; 0 auth users; sign-ups disabled;
  - 9 migrations applied, checksums matching; live schema = migrations 1–9 (no drift);
  - working tree contained only the authorized changes.
- **Applied with `npm run db:deploy:dev`**, all succeeded, in order: `20261014000000`, `20261014000100`, `20261015000000`, `20261015000100`, `20261016000000`, `20261016000100`. Now **15 applied**.
- **Schema parity after apply:** exact (`scripts/compare-schema.mjs` "No differences"). 21 tables, 224 columns, 106 constraints, 61 indexes, 20 enums, 14 policies, 11 functions, 4 triggers (incl. the 2 audit append-only triggers), 42 grants.
- **Bucket `correction-clips`:** private; allowed MIME `["audio/mp4"]`; file_size_limit 10485760. Before: no MIME or size limit. No other bucket; `recordings` NOT created. No jobs scheduled.
- **Real verification:**
  - `npm run test:dev-supabase` — 41/41 (24 existing + 17 new in `tests/real/media-dev.test.ts`);
  - `scripts/dev-e2e.mjs` — 14/14.
- **Permanent audit rows (append-only, intentionally NOT deleted):** 41, all from the media verification run, referencing deleted test tenants/users:
  - SUPER_ADMIN_MEDIA_READ 1; RECORDING_SUBMITTED 4; RECORDING_APPROVED 3; RECORDING_REJECTED 1; RECORDING_TEACHER_NOTICE_ACKNOWLEDGED 4;
  - MEDIA_DELETION_REQUESTED 8 (3 manual + 5 from the consent-withdrawal review); MEDIA_DELETION_APPROVED 1; MEDIA_DELETION_CANCELLED 1; MEDIA_DELETION_DECLINED 1;
  - CONSENT_GIVEN 2; CONSENT_OFFLINE_VERIFIED 1; CONSENT_WITHDRAWN 1; DATE_OF_BIRTH_RECORDED 1; DATE_OF_BIRTH_VERIFIED 1; CORRECTION_CLIP_REPLACED 2;
  - OPTION_C_REQUESTED 4; OPTION_C_ENABLED 2; OPTION_C_CANCELLED 1; OPTION_C_DECLINED 1; OPTION_C_DISABLED 1.
- **Cleanup:** all test auth users, tenants, app rows and storage objects removed; DEV now holds 0 users, 0 objects, empty app tables except those 41 audit rows; sign-ups still disabled.

## 2026-10-19 — Live Class class structure, capacity & session foundation (local, A101–A130)

- Pre-state verified: commit 2c89136, clean tree, baseline **554/554**.
- Owner TO-BE approval recorded as **A101–A130** (DECISIONS §1, supersession record §1.9; eighth authorization in §2). Open-question 18 resolved (A123); 5 and 13 refined; new items 53–60 record interpretations and what stays open.
- **Migrations (local only):** `20261019000000_live_class_foundation` (offline diff, additive) and `20261019000100_live_class_foundation_rls` (CHECKs, partial unique indexes, membership-guard trigger function + 4 triggers, RLS on, all API grants revoked). 12 new tables, +3 `tenants` columns, `recordings.live_session_id`, +4 `recording_participants` columns. No DROP, no backfill, 0 rows changed.
- **Built:**
  - Markaz-only classes: one Primary (explicit replacement), Co-Teachers, per-session Substitute; teacher departure keeps history;
  - enrollment with WAITLIST / ACTIVE / GRACE (7 days, extendable) / SUSPENDED / ENDED, effective-state access checks, capacity override (Markaz Admin, reason, audited);
  - manual payment-evidence submission → Markaz Admin verification → access period (no amounts/providers);
  - enrollment and live capacities (students only; plan ceilings by Super Admin; no numbers);
  - Markaz IANA time zone (default UTC), weekly schedules, scheduled + ad hoc (60-min default) sessions, −15 min join/start, safety close at end + 30 (re-runnable entry point, not scheduled);
  - vendor-neutral participation: one primary + one view-only device, admission / WAITING_FOR_SLOT with FIFO promotion, raise hand, one student mic, whiteboard grants, screen-share authorization, removal; `getMyDeviceCapabilities()` as the future adapter boundary;
  - attendance from the union of admitted presence intervals (≥ 50 % PRESENT, else late arrival → LATE, else ABSENT), audited manual correction, parent status-only view;
  - persistent class chat with A120 visibility;
  - Option C session recordings: checked at session start and recording start, participants from presence, consent at capture, late joiners excluded until consent passes, audited pre-finalization corrections;
  - UI (sw/en/ar, RTL): Markaz classes list/detail, payments verification, time zone, provider-neutral Live Class shell (states plainly that no audio exists), student "My classes"/attendance, parent child attendance, platform capacity ceilings.
- **Not built (by decision):** any RTC/whiteboard/screen-share transport or vendor SDK, payment amounts/gateways, production scheduling, DEV apply.
- Tests: **703 local** (33 files; +149: 6 new suites), lint, typecheck and build pass; 5/5 deliberate security mutations caught. Real Supabase **not** changed; DEV pre-apply plan in docs/testing/dev-supabase-verification.md.

## 2026-10-19 — Final Live Class decision corrections (local, A131–A139)

- Pre-state: commit a3d1655, clean tree, 703/703.
- Decisions recorded as A131–A139 (DECISIONS §1, supersession §1.10, ninth authorization §2); open questions 53–58 resolved.
- **Migrations (local only, additive):** `20261019000200_live_class_decisions` (offline diff) and `20261019000300_live_class_decisions_rls` (timezone null-handling, attendance/punctuality and queue-override CHECKs). Existing migrations untouched (repository convention: new pairs, no squashing). 19 locally; DEV still 15.
- **Implemented:** attendance PRESENT/ABSENT separate from punctuality ON_TIME/LATE (parents see both statuses, no timestamps); no default Markaz time zone, scheduling fails closed (`timezone_required`), UI banner; only ACTIVE/GRACE hold a seat (SUSPENDED freed, renewal into a full class → WAITLIST); FIFO waitlist with audited Markaz Admin order override; per-class `payment_required` with PENDING_PAYMENT; `payment.verify` explicit permission as finance authority; A51 detailed-student resolver wired to current assignments + ACTIVE/GRACE enrollments (`NO_CLASSES_YET` removed); audited mic handoff.
- Tests: **740 local** (35 files; +37), lint, typecheck, build pass; Prisma format/validate/generate clean; migration 3 equals a fresh offline diff; secrets scan 0 matches. Real Supabase NOT changed; updated pre-apply plan in docs/testing/dev-supabase-verification.md.

## 2026-10-19 — Dedicated Finance Officer role (local, A140)

- Pre-state: commit 4e1b2d8, clean tree, 740/740.
- Owner decision A140 recorded (DECISIONS §1, supersession §1.11, tenth authorization): Finance Officer/Accountant is a real non-teaching Markaz role; Teacher cannot verify payment. Supersedes the A136 implementation that let Teachers hold `payment.verify`.
- **Migrations (local only, additive):** `20261019000400_finance_officer_role` (TenantRole + FINANCE_OFFICER) and `20261019000500_finance_officer_role_rls` (CHECK refusing PAYMENT_VERIFY grants; `app.is_tenant_member` includes the role). 21 locally; DEV still 15.
- **Implemented:** FINANCE_OFFICER membership (tenant.read only, not grant-eligible), invitations by Markaz Admin / Super Admin, verify/reject by Markaz Admin or Finance Officer only, `payment.verify` removed from grantable permissions, Finance page (payments + enrollment access periods only), role labels sw/en/ar.
- Tests: **751 local** (36 files; +11), lint, typecheck, build pass; Prisma format/validate/generate clean; secrets scan 0 matches. Real Supabase NOT changed; final 6-migration pre-apply order in docs/testing/dev-supabase-verification.md.

## 2026-11-02 — Pushed to GitHub (owner request)

- Owner created the **public** repo `ahmanwema/elimu-yenye-manufaa` and asked for the project to be uploaded.
- Pre-push secrets scan over the full `git log -p` history (JWTs, `sb_secret_`/`sb_publishable_` keys, credentialed Postgres URLs, service-role values, private keys, API tokens): 0 real matches, placeholders only. `.env.local` is ignored.
- Remote `origin` added; `master` (10 commits, up to 11e914f) pushed and tracking `origin/master`.
- NOT pushed: untracked `tests/real/live-class-dev.test.ts`. NOT done: deploy, DEV Supabase changes, production.

## 2026-11-04 — Working copy recovered from GitHub; DEV found ALREADY at 21 migrations

Context: the local working folder `C:\Projects\elimu-yenye-manufaa` was found **empty** (no `.git`). The
GitHub repository was the only surviving copy, so it was re-cloned. Everything untracked was lost with
the old machine state: `.env.local`, `.env`, `node_modules`, and the untracked
`tests/real/live-class-dev.test.ts`.

- **Dependencies restored** with `npm ci` (532 packages, from the committed lockfile — no upgrades).
  Working tree stayed clean; `node_modules` and `src/generated` are git-ignored.
- **Environment recreated** by the owner into `.env.local` (git-ignored) for the DEVELOPMENT project
  `jahyvgzqxqldaatitfvz`, pooler host `aws-1-eu-central-1`, session pooler (port 5432). No secret was
  printed at any point. `.env` was created as an inert fallback (all keys commented out) so the two
  files can never disagree.
- **Local verification, re-run in full and all green:** `npm test` **751/751 in 36 files** (783 s) —
  exactly the 2026-10-19 baseline, confirming the clone is faithful; `npm run lint` pass;
  `npm run typecheck` pass; `npm run build` pass; `prisma validate` pass; `prisma generate` clean.
  Secrets scan over the working tree and the full `git log -p`: **0 real matches** (prose mentions and
  the `sb_publishable_test` stub only).
- **`prisma format --check` reports "unformatted files" on this machine — a false alarm.** The clone
  was made with `core.autocrlf=true`, so every file on disk has CRLF while Prisma writes LF. Diffing a
  formatted copy against the repo with CR stripped gives **0 content differences**. The schema was NOT
  reformatted: doing so would produce a whole-file diff with no change in meaning.
- **READ-ONLY DEV preflight produced an unexpected result: the six "pending" migrations are already
  applied.** The DEVELOPMENT project holds **21 of 21** migrations, not 15:
  - schema parity against the **full current repo**: `scripts/compare-schema.mjs` → **"No differences"**
    — tables 33, columns 380, constraints 173, indexes 107, enums 33, policies 14, functions 12,
    triggers 8, grants 66. These are exactly the numbers the pre-apply plan predicted;
  - migration history intact: all 21 present **in the repo's order**, checksums matching, 0 unfinished,
    0 rolled back. (A first check reported 21/21 checksum mismatches; that was the same CRLF artefact —
    LF-normalised, all 21 match.)
  - 0 auth users; every application table 0 rows; 0 storage objects; sign-ups disabled;
    `correction-clips` private; `recordings` bucket still absent.
  - `audit_events`: **171 rows** (was 41), dated 2026-10-13 (41), 2026-10-18 (43) and 2026-01-06→2030-01-06
    (87, test-controlled future timestamps). The actions include the full Live Class set —
    CLASS_CREATED, CLASS_TEACHER_ASSIGNED, ENROLLMENT_WAITLISTED, ENROLLMENT_WAITLIST_ORDER_OVERRIDE,
    CLASS_CAPACITY_OVERRIDE, PAYMENT_ACCESS_VERIFIED, TENANT_TIMEZONE_SET, SESSION_STARTED,
    SESSION_SAFETY_CLOSED, MIC_GRANTED, MIC_REVOKED, WHITEBOARD_GRANTED.
- **Conclusion (inference, stated as such):** the apply and a full real-DEV verification run were
  carried out **after 2026-11-02** on the machine that was later lost, and cleaned up properly (all app
  tables are empty). They were never recorded here, which is why this log said 15. The exact date and
  operator are **not known** — the evidence above is circumstantial but consistent. Nothing in this
  pass re-ran those tests, so none of their results is restated here as freshly verified.
- **No write of any kind was made to DEV in this pass.** `npm run db:deploy:dev` was never run: there
  was nothing to apply. The owner's DEV APPLY authorisation therefore went unused.
- **`tests/real/live-class-dev.test.ts` reconstructed** (669 lines, 40 tests) from the current
  implementation, DECISIONS A101–A140, roles-permissions, the DEV verification runbook and the existing
  `tests/real/` patterns. It is deliberately narrow: it asserts only what PGlite cannot prove — the
  hosted enum/CHECK constraints, `app.is_tenant_member` under real JWT claims, deny-by-default on the
  12 new tables through PostgREST, and one end-to-end slice (class → enrol → pay → verify → session →
  join → mic → attendance). **Typecheck and lint pass; it has NEVER been executed**, because the owner
  chose not to spend further permanent audit rows re-verifying an already-verified project. Treat it as
  unverified until it is run once.
- **Dependency advisories recorded, nothing upgraded** (upgrades were out of scope): `npm audit` reports
  22 (1 critical, 4 high, 17 moderate). The critical one is Next.js 16.4.0 — unauthenticated RCE in the
  Image Optimization API when SVG files are used. This codebase does **not** use `next/image` anywhere
  and does not set `dangerouslyAllowSVG`, and nothing is deployed, so there is no live exposure today.
  It must be resolved before any deployment. `next build` also halts once per run with a security
  nudge and succeeds on retry.

## 2026-11-22 — Self-service onboarding Stages 1 & 2 (A141–A145); Next.js upgrade merged; DEV at 24

- **The gap that was found first:** the application had **no path at all to create a Markaz** — no service,
  no action, no UI. Combined with invite-first onboarding (A45) and disabled sign-ups (A65), a new Markaz
  could never be opened through the product: there was nobody to issue its first invitation. The owner's
  request ("a teacher opens Home Madrasa and students join by a WhatsApp link") was blocked on this, not on
  the payment flow — which turned out to be **already built** (`PENDING_PAYMENT`, `submitPaymentEvidence`,
  `verifyPayment` writing `accessUntil` from the verified period, grace, A107/A140).
- Plan written first and kept: [docs/features/self-service-onboarding.md](docs/features/self-service-onboarding.md).
- **Stage 1 implemented** — `src/server/services/tenants.ts` (`createTenant`, `listTenants`),
  `canCreateTenant` (Super Admin only, A141), `createTenantAction`, and a form on `/{locale}/platform`.
  Creation makes the tenant, the first ACTIVE `MARKAZ_ADMIN` membership and that person's auth account in
  one authorized operation, with a `TENANT_CREATED` audit event; `alsoTeacher` is opt-in (A145).
  Authorization is checked **before** Supabase is asked to prepare any account.
- **Stage 2 implemented** — shareable join links (A142): `join_links` + `join_link_uses` (server-only,
  deny-by-default RLS like the Live Class tables), `createJoinLink` / `listJoinLinks` / `revokeJoinLink` /
  `previewJoinLink` / `redeemJoinLink`, the public `/{locale}/join/{token}` page, and the Markaz Admin UI.
  Only the token hash is stored; the raw token is shown once. A use is claimed in ONE atomic statement
  inside the redemption transaction, so concurrent redemptions cannot exceed `max_uses` and a failure gives
  the seat back. Unknown, cancelled, expired and exhausted links are refused identically. Enrolment runs as
  the link's **creator**, so a link stops enrolling if its issuer loses the admin role (fails closed).
- **Schema additions (A143):** `profiles.phone`, `student_accounts.gender` with a new `Gender` enum —
  neither existed. The date of birth collected at join is self-entered and deliberately **not** verified
  (A82 verification still required).
- **Three ADDITIVE migrations** (22–24), split so the new `AuditAction`/`AuditTargetType` values are added
  before they are used, as the FINANCE_OFFICER role did.
- **Applied to the DEVELOPMENT Supabase project** (owner-authorised this session): `prisma migrate deploy`
  applied exactly the three pending migrations. `scripts/compare-schema.mjs` then reported **"No
  differences"** — 35 tables / 400 columns / 189 constraints / 113 indexes / 35 enums / 14 policies /
  13 functions / 8 triggers / 70 grants. DEV now holds **24** migrations.
- **`security/nextjs-upgrade` merged into `master`** (fast-forward, owner-authorised): Next.js 16.4.0 →
  16.4.6. This was necessary as well as hygienic — on 16.4.0 the CLI security nudge had begun killing the
  dev server *after its first request*, not just at startup. On 16.4.6 the server survives repeated
  requests and the nudge is gone.
- **Verification: 818/818 tests in 39 files** (was 751 in 36), lint and typecheck clean. 65 new tests cover
  tenant creation and its denials, join-link issue/preview/redeem, idempotency per person, the concurrency
  ceiling (5 racers, 3 succeed), cross-tenant refusal, and deny-by-default RLS on both new tables.
- **Open issue, not root-caused:** in this checkout `vitest` fails even for a test file with no imports
  ("Cannot read properties of undefined (reading 'config')"), while a sibling git worktree with
  byte-identical `vitest`/`@vitest/mocker` packages and identical versions across all 394 installed
  packages runs the same files green. Four clean reinstalls (including `npm cache verify` and a full
  `node_modules` removal) did not fix it, and upgrading to 16.4.6 did not either; running the worktree's
  `vitest.mjs` against this directory passes. The suite above was therefore run with that binary. The
  project files and config are not implicated — only this directory's `node_modules`.
- Nothing pushed. No production, no deploy, no SMTP provider, no RTC vendor, no payment gateway.

## 2026-11-22 — First deployment: pushed to GitHub, deployed to Vercel (A146, A147)

- **Pushed `master` to the public GitHub repository** (`bf54912..135a937`, 6 commits) after the pre-push
  secrets scan required by CLAUDE.md rule 10: `.env.local` confirmed ignored, only `.env.example` files
  tracked, and **0 matches** across 64,004 lines of full `git log -p --all` history.
- **Deployed to Vercel** — project `elimu-yenye-manufaa`, auto-connected to the GitHub repository.
  Production URL **https://elimu-yenye-manufaa.vercel.app** (`/sw` returns 200 publicly). The
  deployment-specific URL is protected by Vercel and returns 302; the clean production alias is the one
  to use. Six production environment variables set from `.env.local`; `SITE_URL` points at the
  production URL. `npm run build` passed locally first, with all three new `join` routes present.
- **This is the first deployment of the project**, and it supersedes the standing "deployment not
  authorized" scope (A146). It does **not** promote Supabase: the deployed app still uses the
  DEVELOPMENT project, A65 still stands, and sign-ups stay disabled.
- **Verified live, end to end:** an admin-minted magic link signed in successfully against the
  production URL. Note that this works **without** touching Supabase's redirect allow-list, because
  `/auth/confirm` verifies the token hash server-side rather than relying on a Supabase redirect.
  Emailed codes (the sign-in form, invitations, joining) would still need the allow-list updated — and
  SMTP — before they work for anyone outside the project team.
- **`scripts/dev-signin-link.mjs` added** (A147): mints a magic link for any account that already
  exists, and works out the person's destination from their ACTIVE roles. It never creates an account.
- **One investigation note:** a first live test landed on `/sw/account` instead of `/sw/platform`. This
  was **not** an application fault — Git Bash's MSYS path conversion rewrote the `/sw/platform`
  argument into a Windows path, which `safeRedirectPath` correctly rejected in favour of the default.
  Re-run with `MSYS_NO_PATHCONV=1`, the destination is honoured.
- **Still blocked for real students:** both the join link and an invitation require a code sent to the
  student's own address, and the built-in mailer reaches only project team addresses. Deploying did not
  change this, and could not have.

## 2026-11-22 — Password self-registration through role-carrying join links (A148–A151); DEV at 25

- **The mailer wall was removed rather than worked around.** Every onboarding route built so far needed
  a code delivered to the person's own inbox, and the built-in Supabase mailer reaches only project team
  addresses — so no student and no new Markaz Admin could get in at all (A147). The owner chose
  **password authentication** over an SMTP provider: the join link itself is the authorization, and the
  person sets their own password while using it. Nothing is emailed, at registration or at any later
  sign-in.
- **A join link now carries a role** (A148). `join_links.role` with a `TenantRole` default of `STUDENT`,
  plus `join_link_class_only_for_students` (a class may be named only on a student link). Who may issue
  which role is an authorization rule, not a column: `joinLinkRoles()` in `src/server/authz/policy.ts`
  returns every role to a Super Admin and every role **except `MARKAZ_ADMIN`** to an ACTIVE Markaz
  Admin, so A52 still holds. The form offers exactly those roles and the server re-checks on submit.
- **Registration is one step** (A149): name, phone, email, password (students additionally gender and
  date of birth) → account created → signed in immediately → redirected to their own area. Minimum
  password length **8**, above Supabase's own floor of 6, because the link is bearer-grade and the
  password is all that protects the account afterwards. `src/app/[locale]/sign-in/page.tsx` now shows
  email + password first and keeps the emailed-code form below it, as the owner asked.
- **A Markaz can now be created with no administrator at all**, so the normal path is: Super Admin
  creates the Markaz (name + code only), then issues a `MARKAZ_ADMIN` link and sends it. `createTenant`
  takes `adminProfileId` as optional and writes `firstAdminId: null` into the audit event in that case.
- **Three security properties, each pinned by a test:**
  - `createAuthUserWithPassword` returns `{ state: "exists" }` and sets **nothing** when the address
    already has an account — a bearer link must never seize an address its holder does not control
    (A150). That person signs in first instead, and the link then adds only the membership.
  - `signInWithPassword` always reports `invalid_credentials`, whether the address is unknown or the
    password is wrong, so sign-in cannot be used to enumerate accounts. A 429 maps to `rate_limited`.
  - The use ceiling is still claimed in one atomic `UPDATE ... RETURNING` inside the transaction, so two
    simultaneous redemptions of a last remaining use cannot both succeed.
- **Migration 25 (`20261122000300_join_link_roles`) applied to the DEVELOPMENT Supabase project.**
  ADDITIVE only: one column with a default and one CHECK. `scripts/compare-schema.mjs` then reports
  **"No differences"** against the full repo at 25 migrations — 35 tables / **401 columns** /
  **190 constraints** / 113 indexes / 35 enums / 14 policies / 13 functions / 8 triggers / 70 grants.
- **Verification: 824/824 tests in 39 files**, lint clean, typecheck clean, `npm run build` clean with
  every `/join/[token]` route present. (Still run with the sibling worktree's vitest binary — the
  open issue from the previous entry is unchanged and not root-caused.)
- **Two gaps recorded rather than hidden** (A151): there is **no "forgot password"** — no mail can carry
  a reset, so for now a Markaz Admin issues a fresh link — and **email addresses are not verified**, so
  the address is an identifier and not a proven contact. An SMTP provider closes both; it stays
  undecided.

## Status snapshot

| Area | Status |
|---|---|
| Documentation foundation | Done (this pass) |
| Business rules BR-01–BR-13 | Recorded as approved (A26–A38), docs reconciled 2026-10-05 |
| Technology stack | **Approved** (A39), installed locally |
| Database schema | **All 25 migrations applied** to the DEVELOPMENT Supabase project (15 on 2026-10-16; six more at an unrecorded date after 2026-11-02 — see the 2026-11-04 entry; the last four on 2026-11-22). Exact parity with the full repo verified after that apply: "No differences" (35 tables / 401 columns) |
| Auth / tenancy / roles / Parent links | Foundation implemented (no sign-in UI, no invitations, no link workflow) |
| PWA | Basic foundation (manifest, placeholder icons, minimal SW) |
| Tests | **824 local in 39 files, green 2026-11-22** (plus lint and typecheck; run with a sibling worktree's vitest binary — see that entry's open issue). Real-Supabase 41/41 and the 14-step UI E2E: last *recorded* run 2026-10-16 against 15 migrations, **not re-run since**; `tests/real/live-class-dev.test.ts` has still never been executed |
| Version control | Git initialized; first local baseline commit 2026-10-13; pushed 2026-11-02 to the public GitHub repo ahmanwema/elimu-yenye-manufaa. **2026-11-04: that remote was the only surviving copy** — the local folder was empty and the project was re-cloned from it |
| Auth / onboarding / i18n | Implemented locally (**email + password primary** since 2026-11-22, A149; OTP + magic link kept as a second route; invite-first; sw/en/ar + RTL) |
| Parent links | Full workflow implemented (request/create → verify → activate → revoke) with explicit permissions and audit history |
| Correction & recording media | Policy foundation implemented locally (A66–A80): consent, primary/history clips, M4A ≤ 60 s validation, approval, deletion lifecycle, audit; no RTC capture/extraction |
| Live Class architecture | Class structure/capacity/session foundation APPROVED (A101–A130); real-time layer still proposed (vendor undecided, A35) |
| Live Class implementation | Provider-neutral foundation implemented 2026-10-19 and **applied to DEV** (schema parity exact, 2026-11-04). Still **no media transport of any kind** — no audio, video, whiteboard or screen share (A35 undecided) |
| Self-service onboarding | Stages 1–2 implemented and applied to DEV (A141–A145, A148–A151): a Super Admin creates a Markaz, then issues a **role-carrying join link** (Markaz Admin, Teacher, Finance Officer or Student). The holder registers in one step with **their own password** and is signed in immediately — no mail is involved, at registration or afterwards. Students land in the existing payment flow. Stage 4 (open, uninvited teacher self-registration) **not started and undecided**. Open gaps: no "forgot password", and email addresses are unverified (A151) |
| Any other feature | Not started |
| Hosting/infrastructure setup | **Vercel project `elimu-yenye-manufaa`, connected to the GitHub repo** (2026-11-22, A146). No custom domain. Still pointing at the DEVELOPMENT Supabase project |
| First deployment | **Done 2026-11-22** — https://elimu-yenye-manufaa.vercel.app, public, verified live. NOT production: A65 still stands and sign-ups stay disabled |

## Next expected step

(2026-11-04) The DEV database now matches the repo exactly, so the schema work has nowhere further to
go without a business decision. The two things that actually unblock progress are both the owner's:
the **RTC vendor (A35)** — without it there is no audio, video, whiteboard or screen share, and Live
Class remains a state-and-chat page — and **concrete capacity numbers (OQ5)**, which the vendor
configuration and cost model depend on. Secondary, and cheap once authorised: **scheduled jobs
(OQ59)**, without which grace/suspension states and session safety-close never advance on their own.
Before any deployment, the Next.js critical advisory must also be resolved.

One verification debt is outstanding and should be paid the next time real-DEV tests are run for any
reason: `tests/real/live-class-dev.test.ts` has never been executed, and the base real-DEV suite has
not run since the last six migrations were applied.

(2026-10-19) Owner reviews the Live Class foundation report, confirms or changes the interim interpretations (open questions 53–58), and decides whether to APPLY the two Live Class migrations to the DEV project per the pre-apply plan. RTC vendor (A35), payment terms (OQ57) and job scheduling (OQ59) remain owner decisions.

Earlier (2026-10-16 and before, kept for history): Owner confirms the interpretations listed in the latest report (child proposal by Markaz Admins needs both explicit grants; registration-number format) and chooses the next feature scope. Production readiness is NOT approved; the Supabase project stays development-only.
