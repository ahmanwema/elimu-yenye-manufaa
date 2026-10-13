# Elimu Yenye Manufaa

Multi-teacher, multi-Markaz online Islamic education platform. **Current state: local Phase 1 foundation only.** No product features yet, and nothing is deployed or connected to a live Supabase project.

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

Routes: `/` redirects to `/sw` (or the remembered language). Pages: `/{sw|en|ar}`, `/sign-in`, `/invite/{token}`, `/account`, `/markaz/{id}`, `/platform`, `/offline`; plus `/auth/confirm` (magic-link callback).

## Connecting a development Supabase project (not done yet)

1. Use a **local** (`supabase start`) or dedicated **development** project. Do not use production; production access is not authorized.
2. Copy `.env.example` to `.env.local` (app) and `.env` (Prisma CLI) and fill in the values, including `SITE_URL` and (for Storage) the server-only `SUPABASE_SECRET_KEY`. Supabase Auth setup (email templates, redirect allow-list) is listed in [docs/features/auth-onboarding.md](docs/features/auth-onboarding.md).
3. Apply migrations with `npx prisma migrate deploy`. The second migration needs Supabase's `auth` schema, so it will fail on a plain Postgres.
4. Follow [docs/testing/dev-supabase-verification.md](docs/testing/dev-supabase-verification.md) to verify RLS, Auth and Storage against real Supabase. This has not been done yet.

## Version control

Git was initialized on 2026-10-13. Nothing is committed and there is no remote; committing and pushing need explicit owner authorization. `.gitignore` excludes `.env*` (except `.env.example`), build output, generated Prisma client, local Supabase state, databases, logs and key files.

## Layout

See [docs/system/architecture.md](docs/system/architecture.md) §5.1. Security model, including why Prisma traffic is protected by the server authorization layer rather than RLS: [docs/system/security.md](docs/system/security.md) §2.1.
