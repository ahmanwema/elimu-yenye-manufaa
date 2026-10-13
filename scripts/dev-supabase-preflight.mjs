// READ-ONLY preflight for the development Supabase project (A65).
// Changes nothing. Prints no secrets and no full email addresses.
//
// Usage: node --env-file=.env.local scripts/dev-supabase-preflight.mjs
//
// It reports what is needed to decide whether the project is safe to use as DEVELOPMENT:
// project ref, auth user count + email domains, application tables + row counts, applied
// Prisma migrations, storage buckets, and the Auth "sign-up" setting.
import pg from "pg";

const need = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DIRECT_URL"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")} (values are never printed)`);
  process.exit(2);
}

const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log(`Supabase project ref: ${url.hostname.split(".")[0]}`);
console.log(`Database host:        ${new URL(process.env.DIRECT_URL).hostname}`);

const client = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");
  const q = async (sql, params = []) => (await client.query(sql, params)).rows;

  const users = await q(`SELECT count(*)::int AS n,
    count(*) FILTER (WHERE last_sign_in_at IS NOT NULL)::int AS signed_in,
    min(created_at) AS first, max(created_at) AS last FROM auth.users`);
  console.log(`auth.users: ${users[0].n} (ever signed in: ${users[0].signed_in}; first ${users[0].first ?? "-"}; last ${users[0].last ?? "-"})`);
  const domains = await q(`SELECT lower(split_part(email, '@', 2)) AS domain, count(*)::int AS n
    FROM auth.users GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
  for (const d of domains) console.log(`  domain ${d.domain || "(none)"}: ${d.n}`);

  const tables = await q(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`);
  console.log(`public tables: ${tables.length}`);
  for (const { table_name } of tables) {
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM public."${table_name.replace(/"/g, '""')}"`);
    console.log(`  ${table_name}: ${n} rows`);
  }

  const hasPrisma = tables.some((t) => t.table_name === "_prisma_migrations");
  if (hasPrisma) {
    const m = await q(`SELECT migration_name, finished_at IS NOT NULL AS done FROM public._prisma_migrations ORDER BY started_at`);
    console.log(`applied migrations: ${m.length}`);
    for (const r of m) console.log(`  ${r.done ? "✓" : "✗"} ${r.migration_name}`);
  } else {
    console.log("applied migrations: none (_prisma_migrations absent)");
  }

  const buckets = await q(`SELECT name, public FROM storage.buckets ORDER BY name`).catch(() => []);
  console.log(`storage buckets: ${buckets.length}`);
  for (const b of buckets) console.log(`  ${b.name} (${b.public ? "PUBLIC" : "private"})`);
  const objects = await q(`SELECT count(*)::int AS n FROM storage.objects`).catch(() => [{ n: "?" }]);
  console.log(`storage objects: ${objects[0].n}`);
  await client.query("ROLLBACK");
} finally {
  await client.end();
}

// Public Auth settings endpoint (no secret needed).
const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
  headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
});
if (res.ok) {
  const s = await res.json();
  console.log(`auth: disable_signup=${s.disable_signup} email_enabled=${s.external?.email} mailer_autoconfirm=${s.mailer_autoconfirm}`);
} else {
  console.log(`auth settings: HTTP ${res.status}`);
}
