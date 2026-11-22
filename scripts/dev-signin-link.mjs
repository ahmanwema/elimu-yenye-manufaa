// Prints a one-click sign-in link for ANY existing account on the DEVELOPMENT project (A65).
//
//   node --env-file=.env.local scripts/dev-signin-link.mjs <email> [path] [baseUrl]
//
//   node --env-file=.env.local scripts/dev-signin-link.mjs teacher@example.com
//   node --env-file=.env.local scripts/dev-signin-link.mjs admin@example.com /sw/platform
//   node --env-file=.env.local scripts/dev-signin-link.mjs me@example.com /sw/account https://my-app.vercel.app
//
// With no path, it works out where that person belongs from their roles and sends them there:
// a Super Admin to the platform page, a Markaz Admin or Finance Officer to their Markaz, a
// Teacher to their classes, anyone else to their account page.
//
// WHY THIS EXISTS: sign-in normally emails a code, and Supabase's built-in mailer only delivers
// to project team addresses. Until a real SMTP provider is configured, this is how a DEV account
// gets in. The link is a genuine Supabase magic link minted with the admin API and handed to the
// app's own /auth/confirm route, exactly as the invitation flow does -- no rule is bypassed and
// public sign-ups stay DISABLED.
//
// It signs in an account that ALREADY EXISTS. It never creates one: accounts come from the
// app's own paths (creating a Markaz, an invitation, or a join link). If the address is unknown
// it says so and stops.
//
// Links are SINGLE USE and expire (Supabase OTP lifetime, one hour by default). Re-run for a new
// one. Prints no secret: the service key is read from the environment and never echoed.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const [, , emailArg, pathArg, baseArg] = process.argv;
const BASE = baseArg ?? "http://localhost:3000";
const LOCALE = process.env.DEMO_LOCALE ?? "sw";

if (!emailArg) {
  console.error("usage: node --env-file=.env.local scripts/dev-signin-link.mjs <email> [path] [baseUrl]");
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const admin = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sql = new pg.Client({ connectionString: need("DIRECT_URL"), ssl: { rejectUnauthorized: false } });

/** Finds the account. listUsers is the only lookup the admin API offers, so walk its pages. */
async function findUser(address) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === address);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const user = await findUser(email);
if (!user) {
  console.error(`\nNo account for ${email} on this project.`);
  console.error("This script signs in an account that already exists; it never creates one.");
  console.error("Create it the way the product does: open a Markaz for them (Super Admin,");
  console.error("/{locale}/platform), send them an invitation, or give them a join link.\n");
  process.exit(2);
}

await sql.connect();

const { rows: roles } = await sql.query(
  `SELECT m.role, m.tenant_id, t.name AS tenant_name
     FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.profile_id = $1 AND m.status = 'ACTIVE'
    ORDER BY array_position(
      ARRAY['MARKAZ_ADMIN','FINANCE_OFFICER','TEACHER','STUDENT']::"TenantRole"[], m.role)`,
  [user.id],
);
const { rows: platform } = await sql.query(`SELECT 1 FROM platform_admins WHERE profile_id = $1`, [user.id]);
const isSuperAdmin = platform.length > 0;

/** Where this person's work actually is. */
function destination() {
  if (pathArg) return pathArg;
  if (isSuperAdmin) return `/${LOCALE}/platform`;
  const top = roles[0];
  if (!top) return `/${LOCALE}/account`;
  if (top.role === "MARKAZ_ADMIN") return `/${LOCALE}/markaz/${top.tenant_id}`;
  if (top.role === "FINANCE_OFFICER") return `/${LOCALE}/markaz/${top.tenant_id}/finance`;
  if (top.role === "TEACHER") return `/${LOCALE}/markaz/${top.tenant_id}/classes`;
  return `/${LOCALE}/account`;
}

const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
if (error || !data?.properties?.hashed_token) {
  console.error(`Could not mint a link: ${error?.message ?? "no token returned"}`);
  await sql.end();
  process.exit(3);
}

const next = destination();
const url = `${BASE}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`;

const roleLine = [isSuperAdmin ? "Super Admin (platform)" : null, ...roles.map((r) => `${r.role} in ${r.tenant_name}`)]
  .filter(Boolean)
  .join(", ");

console.log(`\n${email}`);
console.log(`  roles:    ${roleLine || "(no active role yet)"}`);
console.log(`  lands on: ${next}`);
console.log(`\n  ${url}\n`);
console.log("Single use, expires in about an hour. Re-run this for a fresh one.");

await sql.end();
