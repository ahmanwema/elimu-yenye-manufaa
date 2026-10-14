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
