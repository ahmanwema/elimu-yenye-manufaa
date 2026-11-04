# Elimu Yenye Manufaa

Multi-teacher, multi-Markaz online Islamic education platform.

**Current state (2026-11-04).** The business and data foundation is built and applied to a
**development** Supabase project: multi-tenancy, roles (including a dedicated Finance Officer),
invite-first authentication, Swahili/English/Arabic with RTL, the full parent–student link workflow,
the correction and recording-media policy layer, and the Live Class foundation — classes, teachers,
enrolment, manual payment and access periods, grace, waitlist, schedules, sessions, attendance,
persistent chat and mic/whiteboard/screen-share **permissions**. All 21 migrations are applied to the
development project and the schema matches this repository exactly.

**What does not exist yet.** There is **no real-time media of any kind** — no audio, no video, no
whiteboard drawing and no screen share — because no RTC vendor has been chosen (A35). The Live Class
page renders business state and text chat only, and says so. There is also no payment gateway, no
pricing, no scheduled job runner, and **nothing is deployed**: no production project, no domain, no
production users. Treat the development project as development only (A65).

Start with [CLAUDE.md](CLAUDE.md) (working rules), [DECISIONS.md](DECISIONS.md) (what is approved) and [docs/README.md](docs/README.md).

## Requirements

Node.js 20.9+ (developed on 24) and npm.

## Run locally

```bash
npm install          # also generates the Prisma client
npm run check        # lint + typecheck + all tests (no database needed)
npm run build        # production build; works with no credentials
npm run dev          # http://localhost:3000
```

Without Supabase credentials the app runs and the account pages say accounts are not connected. That is expected.

Routes: `/` redirects to `/sw` (or the remembered language). Pages, all under `/{sw|en|ar}`:
`/`, `/sign-in`, `/invite/{token}`, `/account`, `/platform`, `/offline`, `/markaz/{id}`,
`/markaz/{id}/classes`, `/markaz/{id}/classes/{classId}`, `/markaz/{id}/finance`,
`/live/{sessionId}`; plus `/auth/confirm` (magic-link callback, not locale-prefixed).

## Connecting a development Supabase project

A development project is already set up and carries all 21 migrations. These steps are for recreating
the connection on a new machine, or for standing up a fresh development project.

1. Use a **local** (`supabase start`) or dedicated **development** project. Do not use production; production access is not authorized.
2. Copy `.env.example` to `.env.local` and fill in the values, including `SITE_URL` and (for Storage) the server-only `SUPABASE_SECRET_KEY`. `.env.local` is enough: `prisma.config.ts` and the real-DEV test config both read `[".env.local", ".env"]`, first match wins, so filling both invites silent disagreement. Use the **Session pooler** connection string (port 5432) for `DATABASE_URL` and `DIRECT_URL` — Prisma's migrations need a session connection, and the direct host is IPv6-only. URL-encode any `@ : / ? # [ ] %` or space in the password. Check every key names the **same project ref**. Supabase Auth setup (email templates, redirect allow-list) is listed in [docs/features/auth-onboarding.md](docs/features/auth-onboarding.md).
3. Inspect the project read-only first with `npm run supabase:preflight` (project ref, users, tables, applied migrations, buckets, sign-up state — prints no secrets).
4. Apply migrations with `npm run db:deploy:dev`. The second migration needs Supabase's `auth` schema, so it will fail on a plain Postgres.
5. Follow [docs/testing/dev-supabase-verification.md](docs/testing/dev-supabase-verification.md) to verify RLS, Auth and Storage against real Supabase, and `node --env-file=.env.local scripts/compare-schema.mjs` for schema parity. Note that the real-DEV suites write permanent `audit_events` rows, which are append-only by design.

On Windows, a checkout made with `core.autocrlf=true` stores every file with CRLF. Prisma writes LF, so
`prisma format --check` reports "unformatted files" and migration checksums appear to mismatch, in both
cases wrongly. Compare with line endings normalised before believing either.

## Version control

Git was initialized on 2026-10-13. The remote `origin` is the **public** repository
[ahmanwema/elimu-yenye-manufaa](https://github.com/ahmanwema/elimu-yenye-manufaa), added and first
pushed on 2026-11-02. Every push needs explicit owner authorization and a re-run of the secrets scan
described in PROGRESS.md — the repository is public. `.gitignore` excludes `.env*` (except
`.env.example`), build output, generated Prisma client, local Supabase state, databases, logs and key
files.

On 2026-11-04 the remote turned out to be the only surviving copy: the local working folder was found
empty and the project was re-cloned from GitHub. Anything untracked at that point was lost. Keep
`.env.local` backed up somewhere outside the working folder.

## Layout

See [docs/system/architecture.md](docs/system/architecture.md) §5.1. Security model, including why Prisma traffic is protected by the server authorization layer rather than RLS: [docs/system/security.md](docs/system/security.md) §2.1.
