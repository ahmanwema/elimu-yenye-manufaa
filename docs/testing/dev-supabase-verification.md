# Dev Supabase Verification Runbook

Status: **EXECUTED 2026-10-13** against `elimu-yenye-manufaa` (development, A65). Results are in PROGRESS.md. Commands:
- `npm run supabase:preflight` — read-only state report;
- `node --env-file=.env.local scripts/compare-schema.mjs` — schema parity;
- `npm run test:dev-supabase` — 24 checks;
- `node --env-file=.env.local scripts/dev-e2e.mjs` with `next start` running — 14-step UI walkthrough.

All use run-tagged @example.com test accounts and delete their data afterwards.

(Original 2026-10-13 status: NOT YET EXECUTED — no Docker and no credentials on this machine.)

## Option 1 — local stack (preferred)

1. Install Docker Desktop (with WSL2 on Windows) and the Supabase CLI. These are system-level installs, outside this project, and need the owner's go-ahead.
2. `npx supabase init` (creates `supabase/config.toml`). Set, for development only:
   - `[auth] site_url = "http://localhost:3000"`
   - `additional_redirect_urls = ["http://localhost:3000/auth/confirm"]`
   - `[auth.email] enable_signup = true` (needed for invite-created accounts), `otp_length = 6`
   - the magic-link template points at `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
3. `npx supabase start`. Local emails appear in Inbucket/Mailpit (no real email is sent).
4. `.env` / `.env.local` from the CLI output (local URLs and keys only). `DIRECT_URL` and `DATABASE_URL` = the local Postgres URL.
5. `npx prisma migrate deploy` (applies all 6 migrations; the *_rls ones need Supabase's `auth` schema).

## Option 2 — dedicated development project

Before touching it, confirm it is non-production:
- project name/ref is clearly "dev";
- it holds no real users;
- it is not referenced by any production deployment.

If in any doubt, stop. Then repeat steps 4–5 with that project's values.

## What to verify (compare with PGlite)

| Check | How |
|---|---|
| auth.users → profiles trigger | create a user in the dashboard / via OTP; profile row appears |
| RLS parity | run the scenarios of `tests/db/rls*.test.ts` with real JWTs through supabase-js (anon + signed-in users) |
| Helper functions | `select app.has_tenant_permission(...)` as an authenticated user |
| Invitations / appointment requests / events | Data API must return "permission denied" |
| OTP + magic link | sign in at /sw/sign-in; invite flow at /sw/invite/{token} |
| Storage | create a **private** dev bucket `correction-clips`; signed upload/read; denial for other tenants and non-ACTIVE parents |

## Known risk to check first

On hosted Supabase the `postgres` role (used by Prisma) bypasses RLS. That is expected and documented (security.md §2.1); RLS parity applies to Data API traffic only.

## Pending owner-approved changes to the development project (2026-10-14)

Nothing below has been applied. Each needs explicit owner approval:

1. Apply migrations `20261014000000_recording_correction_media` and `20261014000100_recording_correction_media_rls` (`npm run db:deploy:dev`). They are additive; the two new FKs on `correction_audio_clips` are NOT VALID, so existing rows are not rejected.
2. Bucket `correction-clips`: optionally restrict allowed MIME types to `audio/mp4` (plus `audio/x-m4a` if browsers send it). **Do not set a file-size limit** — none is approved (open question 38). The server already validates the stored bytes.
3. Create a **private** bucket `recordings` (only when recording capture is authorized; nothing writes to it yet).
4. Re-run `npm run test:dev-supabase` (the storage test now uploads a real M4A structure and sets consent first) and `scripts/compare-schema.mjs`. Note: `audit_events` is append-only, so any audited action on the dev project leaves permanent audit rows; the real test avoids audited actions.

## Pending owner-approved changes — updated 2026-10-15 (supersedes the list above)

Nothing has been applied. In order, after explicit owner approval:

1. **Migrations** (`npm run db:deploy:dev`), four new ones in sequence:
   `20261014000000_recording_correction_media`, `20261014000100_recording_correction_media_rls`,
   `20261015000000_media_policy_decisions`, `20261015000100_media_policy_decisions_rls`.
   All additive; FKs/CHECKs that could reject existing rows are NOT VALID; the DOB columns are renamed, not dropped.
2. **Bucket `correction-clips`** (stays private): allowed MIME types `audio/mp4` (and `audio/x-m4a` if browsers send it); **file size limit "10MB"** (Supabase's 10 × 1024 × 1024 bytes — matches the server rule).
3. **Bucket `recordings`**: create as **private**, only when recording capture is authorized (Option C enabled + RTC vendor chosen). No size/MIME rule is approved for full recordings.
4. **Scheduled jobs (not authorized yet):** `purgeExpiredMedia` (daily is sufficient; bytes are only removed after the 30-day grace) and `cleanupAbandonedUploads` (7-day rule). Both are idempotent server-side functions with no client entry point.
5. **Re-verify:** `npm run test:dev-supabase` (updated storage test: verified DOB + guardian consent, real M4A bytes, ranged reads), `node scripts/compare-schema.mjs` (PGlite ↔ dev parity), `node scripts/dev-e2e.mjs`. Note: `audit_events` is append-only; audited actions leave permanent rows on the dev project.

## Applied 2026-10-16 (owner APPLY instruction)

The plan above was executed on the DEVELOPMENT project only:

- **Migrations:** the six pending migrations applied in order (15 total); parity exact.
- **`correction-clips` bucket:** private, `allowed_mime_types = ["audio/mp4"]`, `file_size_limit = 10485760`. `audio/x-m4a` was NOT added: the uploader always sends `audio/mp4`.
- **Not done (not authorized):** the `recordings` bucket and any scheduled purge/cleanup job.
- **Verification:**
  - `npm run test:dev-supabase`: 41/41 — `supabase-dev.test.ts` 24 + `media-dev.test.ts` 17;
  - `scripts/dev-e2e.mjs`: 14/14;
  - `scripts/compare-schema.mjs`: no differences.
- **Audit trail:** 41 append-only audit rows from the media verification run remain on DEV by design (see PROGRESS.md 2026-10-16). Future runs of `media-dev.test.ts` add a similar set each time; `supabase-dev.test.ts` adds none.

## DEV pre-apply plan — Live Class foundation (prepared 2026-10-19, NOT applied)

**Status: awaiting explicit owner APPLY approval. No write to the DEV project has been made.**

**Migrations, in this exact order** (after the 15 already applied):

1. `20261019000000_live_class_foundation` — generated offline (`prisma migrate diff`), additive only:
   - 12 new enums: `RecordingParticipantSource`, `ClassStatus`, `ClassTeacherRole`, `ClassEnrollmentStatus`, `AccessPaymentStatus`, `LiveSessionKind`, `LiveSessionStatus`, `LiveSessionEndReason`, `LiveParticipantRole`, `LiveAdmission`, `LiveDeviceMode`, `AttendanceStatus`;
   - new values: `AuditAction` +35, `AuditTargetType` +7 (`ALTER TYPE … ADD VALUE`; first used only by application code after commit);
   - `tenants` + `timezone TEXT NOT NULL DEFAULT 'UTC'`, `class_enrollment_capacity_max INT NULL`, `class_live_capacity_max INT NULL`;
   - `recordings` + `live_session_id UUID NULL` (composite FK `(live_session_id, tenant_id)` → `live_sessions(id, tenant_id)`);
   - `recording_participants` + `source … NOT NULL DEFAULT 'LEGACY_MANUAL'`, `audio_included_from`, `excluded_at`, `excluded_by_id` (all NULL);
   - 12 new tables: `classes`, `class_teacher_assignments`, `class_schedules`, `class_enrollments`, `grace_extensions`, `access_payment_submissions`, `access_payment_submission_enrollments`, `live_sessions`, `live_session_participants`, `live_session_connections`, `attendance_records`, `live_chat_messages`, with their indexes and RESTRICT foreign keys.
2. `20261019000100_live_class_foundation_rls` — hand-written: CHECK constraints, partial unique indexes, function `app.require_active_membership()` (EXECUTE revoked from PUBLIC/anon/authenticated), 4 BEFORE triggers, RLS ENABLE on the 12 tables and `REVOKE ALL … FROM anon, authenticated`. **No policies, no grants.**

**Expected schema after apply** (PGlite, same queries as `scripts/compare-schema.mjs`; DEV baseline in brackets): tables 33 [21], columns 374 [224], constraints 169 [106], indexes 107 [61], enums 32 [20], policies 14 [14 — unchanged], functions 12 [11], triggers 8 [4], grant rows 66 [42 — the 24 new rows are all `select/insert/update/delete = false`].

**Destructive operations:** none (no DROP, no RENAME, no column type change, no rewrite of an applied migration). **Backfills:** none. **Expected row impact:** 0 rows changed. Existing `tenants` rows get `timezone = 'UTC'` and NULL ceilings from the column defaults; existing `recording_participants` (DEV currently has none) would get `source = 'LEGACY_MANUAL'`. Every new CHECK holds for existing rows (new columns are NULL/defaulted), so none needs NOT VALID. Lock impact: brief `ACCESS EXCLUSIVE` on `tenants`, `recordings`, `recording_participants` for `ADD COLUMN` with constant defaults (metadata-only on PostgreSQL 17) — DEV only.

**Gate before apply (read-only):** project ref `jahyvgzqxqldaatitfvz`; sign-ups still disabled; `_prisma_migrations` shows exactly the 15 known migrations with matching checksums; `COMPARE_UNTIL=20261016000100_resolve_recording_policy_rls node --env-file=.env.local scripts/compare-schema.mjs` → no differences (no drift); working tree = the committed Live Class foundation.

**Apply:** `npm run db:deploy:dev` (applies only the two pending migrations).

**Verify after apply:**
- `node --env-file=.env.local scripts/compare-schema.mjs` → "No differences" (the trigger list now includes the 4 new triggers).
- `npm run test:dev-supabase` → existing 41/41 unchanged. Proposed additions (not yet written; need approval because audited actions leave permanent `audit_events` rows on DEV): through PostgREST with real JWTs, every one of the 12 tables refuses SELECT/INSERT for anon, a student, a teacher, a Markaz Admin and a Super Admin; `app.require_active_membership` not executable by `authenticated`; a cross-Markaz assignment insert refused by the trigger.
- `node scripts/dev-e2e.mjs` → 14/14.
- No bucket change is needed (Live Class stores no media). No scheduled job is created (`closeStaleSessions`, `advanceEnrollmentStates` stay unscheduled — OQ59).

**Rollback / recovery:** both migrations are additive. Before any real Live Class data exists, a rollback is a hand-written down script: drop the 4 triggers and the function, drop the 12 tables (reverse FK order), drop the 4 new `recording_participants` columns, `recordings.live_session_id`, the 3 `tenants` columns and the 12 new enum types, then delete the two `_prisma_migrations` rows. New values added to `AuditAction`/`AuditTargetType` **cannot be removed** in PostgreSQL without recreating the type; they are harmless if unused and should be left in place. After real data exists, prefer roll-forward fixes. Take a DEV schema dump (`pg_dump --schema-only`) immediately before applying.

## DEV pre-apply plan — UPDATED for the final Live Class corrections (2026-10-19, NOT applied)

**Supersedes the migration list and expected counts of the plan above** (its gate, verification and rollback steps still apply). Status: awaiting explicit owner APPLY approval; nothing has been written to DEV.

**Migrations, in this exact order** (after the 15 already applied — 4 pending):

1. `20261019000000_live_class_foundation` (additive, generated offline).
2. `20261019000100_live_class_foundation_rls` (constraints, triggers, RLS — server-only).
3. `20261019000200_live_class_decisions` (generated offline, additive): enum `Punctuality`; new values `ClassEnrollmentStatus.PENDING_PAYMENT`, `TenantPermission.PAYMENT_VERIFY`, `AuditAction.ENROLLMENT_WAITLIST_ORDER_OVERRIDE` / `ENROLLMENT_PENDING_PAYMENT`; columns `classes.payment_required` (NOT NULL DEFAULT false), `class_enrollments.queue_override_*` (nullable), `attendance_records.computed_punctuality` / `punctuality` (nullable); `tenants.timezone` → DROP NOT NULL, DROP DEFAULT.
4. `20261019000300_live_class_decisions_rls` (hand-written): `UPDATE tenants SET timezone = NULL` where no `TENANT_TIMEZONE_SET` audit exists (the value came only from migration 1's default); rebuilt `tenant_timezone_present` and `attendance_adjustment_fields`; new `attendance_presence_only`, `attendance_punctuality_with_arrival`, `enrollment_queue_override_fields`.

Migration 3 adds enum values that migration 4 does not use; `prisma migrate deploy` applies each file in its own transaction.

**Expected schema after apply** (PGlite snapshot, same queries as `scripts/compare-schema.mjs`; current DEV in brackets): tables 33 [21], columns 380 [224], constraints 172 [106], indexes 107 [61], enums 33 [20], policies 14 [14], functions 12 [11], triggers 8 [4], grant rows 66 [42, the 24 new ones all false].

**Destructive operations:** none (no DROP TABLE/COLUMN; two CHECK constraints are dropped and immediately re-created in a wider form inside migration 4). **Backfill / row impact:** the only data statement is the time-zone clear. DEV holds **0 tenants** today (last cleanup 2026-10-16), so expected impact is **0 rows**; if tenants exist at apply time, each gets `timezone = NULL` unless an admin had set one — scheduling for that Markaz is then blocked until a Markaz Admin chooses its zone (by decision A131). `payment_required` defaults to false for any existing class (none exist on DEV).

**Gate:** as above (`COMPARE_UNTIL=20261016000100_resolve_recording_policy_rls` → no drift; 15 known migrations, checksums match; sign-ups disabled).

**Apply:** `npm run db:deploy:dev` (applies exactly the 4 pending migrations).

**Verify:** `scripts/compare-schema.mjs` → "No differences"; `npm run test:dev-supabase` 41/41; `scripts/dev-e2e.mjs` 14/14. Proposed extra real-DEV checks (not written yet; audited actions leave permanent rows): the 12 Live Class tables refuse every API role; `app.has_tenant_permission(…, 'PAYMENT_VERIFY')` true only for a staff grant holder; a new Markaz has `timezone IS NULL`.

**Rollback:** as above, plus: drop the three new CHECKs and re-create the two original ones, drop the 6 new columns, drop enum `Punctuality`, `ALTER TABLE tenants ALTER COLUMN timezone SET DEFAULT 'UTC'` (re-filling NULLs with a value would invent a zone — leave NULL and set zones explicitly). Added enum values (`PENDING_PAYMENT`, `PAYMENT_VERIFY`, audit actions) cannot be removed and stay harmless if unused.
