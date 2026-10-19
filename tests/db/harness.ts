import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

// In-process Postgres (PGlite) with a minimal stand-in for the parts of Supabase the
// migrations depend on. This lets the REAL migration files and RLS policies run in
// tests with no external database.
//
// Limits (documented in docs/testing/security-tests.md): this is not Supabase. It does
// not exercise PostgREST, real JWT verification, Supavisor pooling, or the exact role
// attributes of a hosted project. Re-run the same suite against a local Supabase stack
// before relying on it for a release.

const SUPABASE_STANDIN = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  -- Same definition as Supabase's auth.uid().
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  -- Supabase's default: new public tables are granted to the API roles.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  -- Supabase also grants EXECUTE on new public functions to the API roles.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`;

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/** All migrations, in order (optionally only those up to and including `until`). */
export function migrationNames(until?: string): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .filter((n) => !until || n <= until);
}

export async function applyMigrations(db: PGlite, names: string[]) {
  for (const dir of names) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"));
  }
}

/** A fresh database with every migration applied — or, with `until`, only up to that one. */
export async function createTestDatabase(until?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  await applyMigrations(db, migrationNames(until));
  return db;
}

/** Runs `fn` exactly as Supabase's Data API would for a signed-in user with this id. */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    return fn(tx);
  });
}

/** Runs `fn` as an unauthenticated (anon) Data API request. */
export async function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE anon");
    return fn(tx);
  });
}
