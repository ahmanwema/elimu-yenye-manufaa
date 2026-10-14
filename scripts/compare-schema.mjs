// READ-ONLY schema parity check: real development Supabase vs in-process PGlite (with the
// same migrations and the minimal Supabase stand-in used by the test suite).
// Usage: node --env-file=.env.local scripts/compare-schema.mjs
// Pre-apply drift check: COMPARE_UNTIL=<last migration already on the project> limits PGlite
// to the migrations up to and including that name.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

const SNAPSHOT = {
  tables: `SELECT c.relname AS k, c.relrowsecurity::text AS v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations'`,
  columns: `SELECT table_name||'.'||column_name AS k, data_type||' null='||is_nullable||' default='||coalesce(column_default,'') AS v
            FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations'`,
  constraints: `SELECT conrelid::regclass::text||' '||conname AS k, pg_get_constraintdef(oid) AS v FROM pg_constraint
                WHERE connamespace='public'::regnamespace AND conrelid::regclass::text <> '_prisma_migrations'
                AND contype <> 'n'`, // PG18 catalogs NOT NULL as constraints; nullability is compared under columns
  indexes: `SELECT indexname AS k, indexdef AS v FROM pg_indexes WHERE schemaname='public' AND tablename <> '_prisma_migrations'`,
  enums: `SELECT t.typname AS k, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS v FROM pg_type t
          JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY 1`,
  policies: `SELECT tablename||' '||policyname AS k, cmd||' roles='||array_to_string(roles,',')||' using='||coalesce(qual,'') AS v
             FROM pg_policies WHERE schemaname='public'`,
  functions: `SELECT n.nspname||'.'||p.proname AS k, 'secdef='||p.prosecdef||' config='||coalesce(array_to_string(p.proconfig,','),'')
                ||' authenticated_exec='||has_function_privilege('authenticated', p.oid, 'EXECUTE') AS v
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='app' OR (n.nspname='public' AND p.proname='handle_new_auth_user')`,
  triggers: `SELECT tgrelid::regclass::text||' '||tgname AS k, pg_get_triggerdef(oid) AS v FROM pg_trigger
             WHERE NOT tgisinternal AND tgname IN ('on_auth_user_created','memberships_assign_registration_number',
             'audit_events_no_update_delete','audit_events_no_truncate')`,
  grants: `SELECT c.relname||' '||r.rolname AS k,
             'select='||has_table_privilege(r.rolname, c.oid, 'SELECT')||' insert='||has_table_privilege(r.rolname, c.oid, 'INSERT')
             ||' update='||has_table_privilege(r.rolname, c.oid, 'UPDATE')||' delete='||has_table_privilege(r.rolname, c.oid, 'DELETE') AS v
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
           WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> '_prisma_migrations' AND r.rolname IN ('anon','authenticated')`,
};

// Normalize cosmetic differences between PostgreSQL versions (casts, whitespace).
const norm = (s) =>
  String(s ?? "")
    .replace(/::(text|character varying|"[A-Za-z]+"|[a-z_]+)(\[\])?/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function snapshot(query) {
  const out = {};
  for (const [section, sql] of Object.entries(SNAPSHOT)) {
    const rows = await query(sql);
    out[section] = Object.fromEntries(rows.map((r) => [r.k, norm(r.v)]));
  }
  return out;
}

// Real Supabase
const real = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await real.connect();
await real.query("BEGIN READ ONLY");
const realSnap = await snapshot(async (sql) => (await real.query(sql)).rows);
const version = (await real.query("SHOW server_version")).rows[0].server_version;
await real.query("ROLLBACK");
await real.end();

// PGlite with the same migrations (stand-in identical to tests/db/harness.ts)
const lite = new PGlite();
await lite.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated; GRANT USAGE ON SCHEMA public TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;`);
const dir = join(process.cwd(), "prisma", "migrations");
for (const d of readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort().filter((n) => !process.env.COMPARE_UNTIL || n <= process.env.COMPARE_UNTIL)) {
  await lite.exec(readFileSync(join(dir, d, "migration.sql"), "utf8"));
}
const liteSnap = await snapshot(async (sql) => (await lite.query(sql)).rows);
await lite.close();

console.log(`Real Supabase PostgreSQL ${version} vs PGlite (PostgreSQL 18)`);
let differences = 0;
for (const section of Object.keys(SNAPSHOT)) {
  const a = realSnap[section];
  const b = liteSnap[section];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const diffs = keys.filter((k) => a[k] !== b[k]);
  console.log(`${diffs.length === 0 ? "✓" : "✗"} ${section}: ${Object.keys(a).length} real / ${Object.keys(b).length} pglite${diffs.length ? `, ${diffs.length} differ` : ""}`);
  for (const k of diffs) {
    differences++;
    console.log(`    ${k}\n      real:   ${a[k] ?? "(missing)"}\n      pglite: ${b[k] ?? "(missing)"}`);
  }
}
console.log(differences === 0 ? "\nNo differences." : `\n${differences} difference(s).`);
