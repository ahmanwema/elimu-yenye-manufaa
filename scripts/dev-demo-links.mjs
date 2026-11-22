// Prints a fresh one-click sign-in link for each DEMO role on the DEVELOPMENT project (A65).
//
//   node --env-file=.env.local scripts/dev-demo-links.mjs [baseUrl]
//
// Each link is a real Supabase magic link minted with the admin API and handed to the app's own
// /auth/confirm route, exactly as the invitation flow does. Public sign-ups stay DISABLED; no
// password exists and none is printed. Links are SINGLE USE and expire (Supabase OTP lifetime,
// one hour by default) — just run this again for a new set.
//
// Prints no secret: the service key is read from the environment and never echoed.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const BASE = process.argv[2] ?? "http://localhost:3000";
const LOCALE = process.env.DEMO_LOCALE ?? "sw";

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const admin = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sql = new pg.Client({ connectionString: need("DIRECT_URL"), ssl: { rejectUnauthorized: false } });

const ROLES = [
  ["superadmin", "Super Admin", () => `/${LOCALE}/platform`],
  ["markazadmin", "Markaz Admin", (c) => `/${LOCALE}/markaz/${c.tenantId}`],
  ["finance", "Finance Officer", (c) => `/${LOCALE}/markaz/${c.tenantId}/finance`],
  ["teacher", "Teacher", (c) => (c.liveId ? `/${LOCALE}/live/${c.liveId}` : `/${LOCALE}/markaz/${c.tenantId}/classes`)],
  ["student", "Student", (c) => (c.liveId ? `/${LOCALE}/live/${c.liveId}` : `/${LOCALE}/account`)],
  ["student2", "Student 2 (hajalipa)", () => `/${LOCALE}/account`],
  ["parent", "Parent", () => `/${LOCALE}/account`],
];

await sql.connect();
const tenant = (await sql.query(`SELECT id, name FROM tenants WHERE slug = 'demo-markaz-dev-only'`)).rows[0];
if (!tenant) throw new Error("demo Markaz not found — run the DEMO_SEED block first");
const live = (await sql.query(`SELECT id FROM live_sessions WHERE tenant_id = $1 AND status = 'LIVE' ORDER BY created_at DESC LIMIT 1`, [tenant.id])).rows[0];
const paid = (await sql.query(`SELECT id FROM classes WHERE tenant_id = $1 AND payment_required ORDER BY created_at LIMIT 1`, [tenant.id])).rows[0];
const ctx = { tenantId: tenant.id, liveId: live?.id, classId: paid?.id };

console.log(`\nDEMO Markaz: ${tenant.name}`);
console.log(`tenantId:    ${tenant.id}`);
console.log(`live session:${live ? ` ${live.id}` : " (none open)"}`);
console.log(`base:        ${BASE}   locale: ${LOCALE}\n`);

for (const [who, label, nextOf] of ROLES) {
  const address = `elimu-dev-demo-${who}@example.com`;
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: address });
  if (error || !data?.properties?.hashed_token) {
    console.log(`${label}\n  (could not mint a link: ${error?.message ?? "no token"})\n`);
    continue;
  }
  const next = nextOf(ctx);
  const url = `${BASE}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`;
  console.log(`${label}  <${address}>`);
  console.log(`  lands on: ${next}`);
  console.log(`  ${url}\n`);
}

console.log("Links are single use and time limited. Re-run this script for a fresh set.");
await sql.end();
