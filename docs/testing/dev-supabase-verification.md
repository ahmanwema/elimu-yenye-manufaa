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
