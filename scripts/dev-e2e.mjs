// End-to-end walkthrough against the running app (next start on BASE) and the DEVELOPMENT
// Supabase project (A65). Test data only (@example.com, run-tagged); everything is deleted
// at the end. Usage: node --env-file=.env.local scripts/dev-e2e.mjs [baseUrl]
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sql = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
const cleanup = { users: [], tenant: null };
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Minimal cookie jar
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function store(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (/max-age=0/i.test(c) || value === "") jar.delete(name);
    else jar.set(name, value);
  }
}
async function get(path) {
  const res = await fetch(BASE + path, { headers: { cookie: cookieHeader() }, redirect: "manual" });
  store(res);
  return res;
}

/** Extracts the <form> that contains a given hidden field and returns its fields. */
function formWith(html, fieldName) {
  for (const m of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
    if (!m[1].includes(`name="${fieldName}"`)) continue;
    const fields = [];
    for (const input of m[1].matchAll(/<input\b[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(input[0])?.[1];
      const value = /value="([^"]*)"/.exec(input[0])?.[1] ?? "";
      if (name) fields.push([name, value.replace(/&quot;/g, '"').replace(/&amp;/g, "&")]);
    }
    return fields;
  }
  return null;
}

try {
  await sql.connect();
  const nonTest = (await sql.query(`SELECT count(*)::int AS n FROM auth.users WHERE email NOT LIKE 'elimu-dev-%@example.com'`)).rows[0].n;
  if (nonTest > 0) throw new Error(`refusing: ${nonTest} non-test users present`);

  // --- setup: a Markaz with an admin, and an invitation created the way the service does ---
  const adminEmail = `elimu-dev-${RUN}-e2eadmin@example.com`;
  const inviteeEmail = `elimu-dev-${RUN}-e2einvitee@example.com`;
  const a = await admin.auth.admin.createUser({ email: adminEmail, email_confirm: true });
  cleanup.users.push(a.data.user.id);
  cleanup.tenant = (await sql.query(`INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`E2E Markaz ${RUN}`, `e2e-${RUN}`])).rows[0].id;
  await sql.query(`INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'MARKAZ_ADMIN')`, [cleanup.tenant, a.data.user.id]);
  const token = randomBytes(32).toString("base64url");
  await sql.query(
    `INSERT INTO invitations (token_hash, email, tenant_id, kind, role, invited_by_id, expires_at)
     VALUES ($1, $2, $3, 'MEMBERSHIP', 'STUDENT', $4, now() + interval '7 days')`,
    [createHash("sha256").update(token).digest("hex"), inviteeEmail, cleanup.tenant, a.data.user.id],
  );

  // --- 1. invitation page, signed out (Kiswahili) ---
  let res = await get(`/sw/invite/${token}`);
  let html = await res.text();
  check("invite page (sw) shows the invitation, masked email", res.status === 200 && html.includes(`E2E Markaz ${RUN}`) && html.includes("e***@example.com"));
  check("invite page offers 'Tuma msimbo' (send code)", html.includes("Tuma msimbo wa kuingia"));

  // --- 2. account creation for the invited email (what sendInviteCode does), then magic link ---
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email: inviteeEmail, email_confirm: false });
  if (cErr) throw new Error(`createUser: ${cErr.message}`);
  cleanup.users.push(created.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: inviteeEmail });
  const hashed = link.data.properties.hashed_token;
  res = await get(`/auth/confirm?token_hash=${hashed}&type=magiclink&next=${encodeURIComponent(`/sw/invite/${token}`)}`);
  const location = res.headers.get("location") ?? "";
  check("/auth/confirm verifies the magic link and redirects to the invite", [302, 303, 307].includes(res.status) && location.endsWith(`/sw/invite/${token}`), `HTTP ${res.status}`);
  check("a Supabase session cookie was set", [...jar.keys()].some((k) => k.startsWith("sb-")));

  // --- 3. signed in: invite page offers Accept; submit the real form (no JS) ---
  res = await get(`/sw/invite/${token}`);
  html = await res.text();
  check("signed-in invite page shows 'Kubali mwaliko'", html.includes("Kubali mwaliko"));
  const fields = formWith(html, "token");
  check("accept form found in server-rendered HTML", fields !== null);
  const body = new FormData();
  for (const [k, v] of fields ?? []) body.append(k, v);
  res = await fetch(`${BASE}/sw/invite/${token}`, { method: "POST", body, headers: { cookie: cookieHeader() }, redirect: "manual" });
  store(res);
  const membership = (await sql.query(`SELECT role, status FROM memberships WHERE profile_id = $1`, [created.user.id])).rows;
  check("submitting the form created exactly the invited membership", membership.length === 1 && membership[0].role === "STUDENT" && membership[0].status === "ACTIVE", JSON.stringify(membership));
  const inv = (await sql.query(`SELECT status FROM invitations WHERE tenant_id = $1`, [cleanup.tenant])).rows[0];
  check("invitation is now ACCEPTED (single use)", inv.status === "ACCEPTED");

  // --- 4. session reload + authorized pages in three languages ---
  res = await get(`/sw/account`);
  html = await res.text();
  check("account (sw): signed in, Markaz listed with role", html.includes("Umeingia kama") && html.includes(`E2E Markaz ${RUN}`) && html.includes("Mwanafunzi"));
  check("account (sw): student sees own registration number", /<strong dir="ltr">[23456789A-HJ-NP-Z]{8}<\/strong>/.test(html));
  res = await get(`/en/account`);
  html = await res.text();
  check("account (en): English, signed in", html.includes("Signed in as") && html.includes('lang="en" dir="ltr"'));
  res = await get(`/ar/account`);
  html = await res.text();
  check("account (ar): Arabic, RTL, signed in", html.includes('lang="ar" dir="rtl"') && html.includes("تم تسجيل الدخول باسم"));
  res = await get(`/sw/markaz/${cleanup.tenant}`);
  html = await res.text();
  check("Markaz page: a student sees no admin sections", res.status === 200 && !html.includes("Tengeneza mwaliko"));
  res = await get(`/sw/invite/${token}`);
  html = await res.text();
  check("re-opening the used invitation shows it as no longer valid", html.includes("Mwaliko huu si halali"));
} catch (error) {
  failures++;
  console.log(`✗ walkthrough aborted: ${error.message}`);
} finally {
  if (cleanup.tenant) {
    await sql.query(`DELETE FROM invitations WHERE tenant_id = $1`, [cleanup.tenant]);
    await sql.query(`DELETE FROM memberships WHERE tenant_id = $1`, [cleanup.tenant]);
    await sql.query(`DELETE FROM tenants WHERE id = $1`, [cleanup.tenant]);
  }
  if (cleanup.users.length) {
    await sql.query(`DELETE FROM student_accounts WHERE profile_id = ANY($1)`, [cleanup.users]);
    await sql.query(`DELETE FROM profiles WHERE id = ANY($1)`, [cleanup.users]);
    for (const id of cleanup.users) await admin.auth.admin.deleteUser(id);
  }
  await sql.end();
  console.log(failures === 0 ? "\nE2E: all checks passed" : `\nE2E: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
