import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadActor } from "@/server/authz/load-actor";
import { AuthorizationError, parentMaySee, type Actor } from "@/server/authz/policy";
import { acceptInvitation, createInvitation, INVITATION_TTL_MS } from "@/server/services/invitations";
import { activateParentLink, requestLinkAsParent, verifyParentLink } from "@/server/services/parent-links";
import { grantTenantPermission } from "@/server/services/permissions";
import { getClipPlaybackUrl, finalizeDirectCaptureClip, registerDirectCaptureClip } from "@/server/services/correction-audio";
import { createSupabaseObjectStorage } from "@/server/storage/supabase-storage";
import { CORRECTION_CLIP_BUCKET } from "@/server/storage/object-storage";
import { ensureAuthUserForInvitation } from "@/server/supabase-admin";
import { buildM4a } from "../support/m4a";

// ============================================================================================
// REAL development Supabase verification (A65). Uses ONLY test accounts at @example.com with
// a unique run tag, and deletes everything it created in afterAll. Never run against a
// project that is not the approved development project.
// ============================================================================================

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SECRET = env("SUPABASE_SECRET_KEY");
const RUN = randomUUID().slice(0, 8);
const email = (who: string) => `elimu-dev-${RUN}-${who}@example.com`;

const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = new pg.Client({ connectionString: env("DIRECT_URL"), ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env("DIRECT_URL"), ssl: { rejectUnauthorized: false } }),
  transactionOptions: { maxWait: 10_000, timeout: 20_000 }, // same as src/server/db.ts
});

const ROLES = [
  "superAdmin", "adminA", "adminB", "teacherAB", "teacherA", "studentX", "studentY",
  "parentActive", "parentVerified", "parentPending", "parentRevoked", "parentNew",
] as const;
type Who = (typeof ROLES)[number];
const ID = {} as Record<Who, string>;
const T = { A: "", B: "" };
const sessions = {} as Record<Who, SupabaseClient>;
const created = { users: [] as string[], tenants: [] as string[], objects: [] as string[] };

/** Real OTP sign-in: the code comes from the admin API instead of an inbox. */
async function signInWithRealOtp(address: string): Promise<SupabaseClient> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: address });
  if (error || !data.properties?.email_otp) throw new Error(`generateLink failed: ${error?.message}`);
  const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await anon.auth.verifyOtp({ email: address, token: data.properties.email_otp, type: "email" });
  if (v.error || !v.data.session) throw new Error(`verifyOtp failed: ${v.error?.message}`);
  return createClient(URL_, PUBLISHABLE, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${v.data.session.access_token}` } },
  });
}

const actorOf = async (who: Who): Promise<Actor> => (await loadActor(db, ID[who]))!;

beforeAll(async () => {
  await sql.connect();
  // Hard guard: refuse to run if the database holds non-test users (A65 / stop condition 1).
  const { rows } = await sql.query(
    `SELECT count(*)::int AS n FROM auth.users WHERE email NOT LIKE 'elimu-dev-%@example.com'`,
  );
  if (rows[0].n > 0) throw new Error(`Refusing to run: ${rows[0].n} non-test auth users present`);

  for (const who of ROLES) {
    const { data, error } = await admin.auth.admin.createUser({ email: email(who), email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${who}: ${error?.message}`);
    ID[who] = data.user.id;
    created.users.push(data.user.id);
  }
  const t = await sql.query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [`Dev Markaz A ${RUN}`, `dev-a-${RUN}`, `Dev Markaz B ${RUN}`, `dev-b-${RUN}`],
  );
  T.A = t.rows[0].id;
  T.B = t.rows[1].id;
  created.tenants.push(T.A, T.B);

  await sql.query(`INSERT INTO platform_admins (profile_id) VALUES ($1)`, [ID.superAdmin]);
  const m = (tenant: string, who: Who, role: string) =>
    sql.query(`INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, $3::"TenantRole")`, [tenant, ID[who], role]);
  await m(T.A, "adminA", "MARKAZ_ADMIN");
  await m(T.B, "adminB", "MARKAZ_ADMIN");
  await m(T.A, "teacherAB", "TEACHER");
  await m(T.B, "teacherAB", "TEACHER");
  await m(T.A, "teacherA", "TEACHER");
  for (const s of ["studentX", "studentY"] as const) await sql.query(`INSERT INTO student_accounts (profile_id) VALUES ($1)`, [ID[s]]);
  await m(T.A, "studentX", "STUDENT");
  await m(T.B, "studentY", "STUDENT");
  for (const p of ["parentActive", "parentVerified", "parentPending", "parentRevoked", "parentNew"] as const) {
    await sql.query(`INSERT INTO parent_accounts (profile_id) VALUES ($1)`, [ID[p]]);
  }
  const link = (parent: Who, status: string) =>
    sql.query(
      `INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id, status, requested_by_id,
         requested_at, verified_by_id, verified_at, activated_by_id, activated_at, revoked_by_id, revoked_at)
       VALUES ($1, $2, $3, $4::"ParentStudentLinkStatus", $1, now() - interval '3 days',
         $5, CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() - interval '2 days' END,
         $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() - interval '1 day' END,
         $7, CASE WHEN $7::uuid IS NULL THEN NULL ELSE now() END)`,
      [
        ID[parent], ID.studentX, T.A, status,
        ["VERIFIED", "ACTIVE"].includes(status) ? ID.adminA : null,
        status === "ACTIVE" ? ID.adminA : null,
        status === "REVOKED" ? ID[parent] : null,
      ],
    );
  await link("parentActive", "ACTIVE");
  await link("parentVerified", "VERIFIED");
  await link("parentPending", "PENDING");
  await link("parentRevoked", "REVOKED");

  for (const who of ROLES) sessions[who] = await signInWithRealOtp(email(who));
}, 300_000);

afterAll(async () => {
  try {
    if (created.objects.length) await admin.storage.from(CORRECTION_CLIP_BUCKET).remove(created.objects);
    if (created.tenants.length) {
      const t = created.tenants;
      await sql.query(`DELETE FROM correction_audio_clips WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM corrections WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM parent_student_links WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM tenant_permission_grants WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM invitations WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM markaz_admin_appointment_requests WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM memberships WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM tenants WHERE id = ANY($1)`, [t]);
    }
    const u = created.users;
    if (u.length) {
      await sql.query(`DELETE FROM parent_student_links WHERE parent_profile_id = ANY($1) OR student_profile_id = ANY($1)`, [u]);
      // Consent rows reference student/parent accounts (RESTRICT). Audit events are append-only
      // by design: this test therefore never triggers an audited action (e.g. a Super Admin read).
      await sql.query(`DELETE FROM recording_consents WHERE student_profile_id = ANY($1)`, [u]);
      for (const table of ["platform_admins", "student_accounts", "parent_accounts"]) {
        await sql.query(`DELETE FROM ${table} WHERE profile_id = ANY($1)`, [u]);
      }
      await sql.query(`DELETE FROM profiles WHERE id = ANY($1)`, [u]);
      for (const id of u) await admin.auth.admin.deleteUser(id);
    }
  } finally {
    await sql.end();
    await db.$disconnect();
  }
}, 300_000);

// ---------------------------------------------------------------------------------------
describe("schema, trigger and helpers on real Supabase", () => {
  it("creating an auth user created exactly one profile (trigger) and nothing else", async () => {
    const { rows } = await sql.query(
      `SELECT (SELECT count(*) FROM profiles WHERE id = $1)::int AS p,
              (SELECT count(*) FROM memberships WHERE profile_id = $1)::int AS m`,
      [ID.parentNew],
    );
    expect(rows[0]).toEqual({ p: 1, m: 0 });
  });

  it("student memberships received a registration number in the approved format", async () => {
    const { rows } = await sql.query(`SELECT registration_number FROM memberships WHERE profile_id = $1`, [ID.studentX]);
    expect(rows[0].registration_number).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  });

  it("RLS is enabled on every application table", async () => {
    const { rows } = await sql.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' AND NOT c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it("has_tenant_permission gives a platform admin no bypass (real JWT claims context)", async () => {
    await sql.query("BEGIN");
    try {
      await sql.query("SET LOCAL ROLE authenticated");
      await sql.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ID.superAdmin, role: "authenticated" })]);
      const { rows } = await sql.query(`SELECT app.has_tenant_permission($1, 'PARENT_LINK_VERIFY') AS ok`, [T.A]);
      expect(rows[0].ok).toBe(false);
    } finally {
      await sql.query("ROLLBACK");
    }
  });
});

// ---------------------------------------------------------------------------------------
describe("RLS through the real Data API (PostgREST) with real JWTs", () => {
  const ids = async (who: Who, table: string, col = "id") => {
    const { data, error } = await sessions[who].from(table).select(col);
    if (error) throw new Error(`${table}: ${error.message}`);
    return ((data ?? []) as unknown as Record<string, string>[]).map((r) => r[col]).sort();
  };

  it("tenant isolation: Markaz A admin sees only A; teacher A+B sees both; teacher A only A", async () => {
    expect(await ids("adminA", "tenants")).toEqual([T.A]);
    expect(await ids("teacherAB", "tenants")).toEqual([T.A, T.B].sort());
    expect(await ids("teacherA", "tenants")).toEqual([T.A]);
  });

  it("student privacy: Student X sees only themself", async () => {
    expect(await ids("studentX", "student_accounts", "profile_id")).toEqual([ID.studentX]);
  });

  it("parents: only ACTIVE sees the child", async () => {
    expect(await ids("parentActive", "student_accounts", "profile_id")).toEqual([ID.studentX]);
    for (const p of ["parentVerified", "parentPending", "parentRevoked"] as const) {
      expect(await ids(p, "student_accounts", "profile_id"), p).toEqual([]);
    }
  });

  it("teacher basic roster: names of active students of own Markaz only, no student accounts", async () => {
    const profiles = await ids("teacherA", "profiles");
    expect(profiles).toContain(ID.studentX);
    expect(profiles).not.toContain(ID.studentY);
    expect(await ids("teacherA", "student_accounts", "profile_id")).toEqual([]);
  });

  it.each(["invitations", "markaz_admin_appointment_requests", "parent_link_events"])(
    "%s is not readable through the Data API",
    async (table) => {
      const { error } = await sessions.adminA.from(table).select("*").limit(1);
      expect(error?.code).toBe("42501");
    },
  );

  it("no direct writes: self-granting platform admin or a permission is refused", async () => {
    const a = await sessions.teacherA.from("platform_admins").insert({ profile_id: ID.teacherA });
    expect(a.error?.code).toBe("42501");
    const b = await sessions.teacherA
      .from("tenant_permission_grants")
      .insert({ tenant_id: T.A, profile_id: ID.teacherA, permission: "PARENT_LINK_VERIFY", granted_by_id: ID.teacherA });
    expect(b.error?.code).toBe("42501");
  });
});

// ---------------------------------------------------------------------------------------
describe("Auth on real Supabase", () => {
  // NOTE: Supabase rejects @example.com in public auth flows ("email_address_invalid"), so a
  // sign-up attempt with a test address would fail for the WRONG reason. These tests therefore
  // require the specific refusal, and check the authoritative project setting first, so no
  // confirmation email can ever be sent to a real mailbox.
  it("public sign-up is disabled in the project settings", async () => {
    const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: PUBLISHABLE } });
    const settings = (await res.json()) as { disable_signup: boolean };
    expect(settings.disable_signup, "Authentication → 'Allow new users to sign up' must be OFF").toBe(true);
  });

  it("a direct sign-up is refused specifically because sign-ups are disabled", async () => {
    const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: PUBLISHABLE } });
    if (!((await res.json()) as { disable_signup: boolean }).disable_signup) {
      throw new Error("sign-ups are enabled — not attempting a sign-up (it could email a real address)");
    }
    const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
    const addr = `elimu-dev-${RUN}-probe@gmail.com`;
    const { data, error } = await anon.auth.signUp({ email: addr, password: randomUUID() + "Aa1!" });
    if (data.user) created.users.push(data.user.id);
    expect(error?.code).toBe("signup_disabled");
  });

  it("ordinary OTP sign-in for an unknown email is refused and creates no user", async () => {
    const anon = createClient(URL_, PUBLISHABLE, { auth: { persistSession: false } });
    // A syntactically valid, non-existent address. shouldCreateUser:false + unknown user means
    // Supabase sends no email.
    const addr = `elimu-dev-${RUN}-unknown@gmail.com`;
    const { error } = await anon.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: false } });
    expect(["otp_disabled", "signup_disabled", "user_not_found"]).toContain(error?.code);
    const { rows } = await sql.query(`SELECT count(*)::int AS n FROM auth.users WHERE email = $1`, [addr]);
    expect(rows[0].n).toBe(0);
  });

  it("invite → server creates the account → real OTP → session → accept (email must match, single use)", async () => {
    const addr = email("invitee");
    const inv = await createInvitation(db, await actorOf("adminA"), { tenantId: T.A, email: addr, target: "STUDENT" });
    await ensureAuthUserForInvitation(addr);
    const { rows } = await sql.query(`SELECT id FROM auth.users WHERE email = $1`, [addr]);
    created.users.push(rows[0].id);
    const client = await signInWithRealOtp(addr);
    const { data: claims } = await client.auth.getUser();
    expect(claims.user?.email).toBe(addr);

    await expect(acceptInvitation(db, { userId: ID.teacherA, email: email("teacherA") }, { token: inv.token })).rejects.toMatchObject({
      code: "email_mismatch",
    });
    const res = await acceptInvitation(db, { userId: rows[0].id, email: addr }, { token: inv.token, tenantId: T.B, role: "MARKAZ_ADMIN" });
    expect(res).toEqual({ tenantId: T.A, target: "STUDENT" });
    await expect(acceptInvitation(db, { userId: rows[0].id, email: addr }, { token: inv.token })).rejects.toMatchObject({ code: "not_found" });
    // The new student now sees their Markaz through the Data API with their real JWT.
    const { data } = await client.from("tenants").select("id");
    expect((data ?? []).map((t: { id: string }) => t.id)).toEqual([T.A]);
  });

  it("an invitation is expired at exactly 7 days (server clock path)", async () => {
    const created_ = new Date();
    const inv = await createInvitation(db, await actorOf("adminA"), { tenantId: T.A, email: email("late"), target: "STUDENT" }, created_);
    await expect(
      acceptInvitation(db, { userId: ID.parentNew, email: email("late") }, { token: inv.token }, new Date(created_.getTime() + INVITATION_TTL_MS)),
    ).rejects.toMatchObject({ code: "expired" });
  });
});

// ---------------------------------------------------------------------------------------
describe("permissions, parent workflow and self-request on the real database", () => {
  it("delegation: Markaz Admin → own Teacher works; cross-tenant and self are refused", async () => {
    await grantTenantPermission(db, await actorOf("adminA"), { tenantId: T.A, profileId: ID.teacherA, permission: "parent_link.activate" });
    await expect(
      grantTenantPermission(db, await actorOf("adminA"), { tenantId: T.B, profileId: ID.teacherAB, permission: "parent_link.verify" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      grantTenantPermission(db, await actorOf("teacherA"), { tenantId: T.A, profileId: ID.teacherA, permission: "parent_link.verify" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("self-request by registration number → verify → activate → parent gains access (real JWT)", async () => {
    await grantTenantPermission(db, await actorOf("adminA"), { tenantId: T.A, profileId: ID.teacherAB, permission: "parent_link.verify" });
    const { rows } = await sql.query(`SELECT registration_number FROM memberships WHERE profile_id = $1`, [ID.studentX]);
    await requestLinkAsParent(db, await actorOf("parentNew"), { tenantSlug: `dev-a-${RUN}`, studentRegistrationNumber: rows[0].registration_number });
    const link = await db.parentStudentLink.findFirstOrThrow({ where: { parentProfileId: ID.parentNew } });
    expect(link.status).toBe("PENDING");
    await verifyParentLink(db, await actorOf("teacherAB"), { linkId: link.id });
    let visible = await sessions.parentNew.from("student_accounts").select("profile_id");
    expect(visible.data).toEqual([]);
    await activateParentLink(db, await actorOf("teacherA"), { linkId: link.id });
    expect(parentMaySee(await actorOf("parentNew"), ID.studentX, "progress")).toBe(true);
    visible = await sessions.parentNew.from("student_accounts").select("profile_id");
    expect(visible.data).toEqual([{ profile_id: ID.studentX }]);
  });

  it("self-request by email, and non-enumeration (identical results)", async () => {
    const a = await actorOf("parentPending");
    const outcomes = [
      { tenantSlug: `dev-b-${RUN}`, studentEmail: email("studentY") },
      { tenantSlug: `dev-a-${RUN}`, studentEmail: "nobody@example.com" },
      { tenantSlug: "no-such-markaz", studentEmail: email("studentY") },
      { tenantSlug: `dev-a-${RUN}`, studentEmail: email("studentX") }, // existing link
    ];
    const results = [];
    for (const input of outcomes) results.push(await requestLinkAsParent(db, a, input).then(() => "same", () => "different"));
    expect(new Set(results)).toEqual(new Set(["same"]));
    expect(await db.parentStudentLink.count({ where: { parentProfileId: ID.parentPending, studentProfileId: ID.studentY } })).toBe(1);
  });

  it("parent invitation with a child needs both grants; result is PENDING only", async () => {
    await expect(
      createInvitation(db, await actorOf("adminA"), { tenantId: T.A, email: email("p2"), target: "PARENT", proposedStudentId: ID.studentX }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------------------
describe("Storage on real Supabase (private dev bucket)", () => {
  it("the correction-clips bucket exists and is PRIVATE", async () => {
    const { data } = await admin.storage.getBucket(CORRECTION_CLIP_BUCKET);
    expect(data?.public).toBe(false);
  });

  // Requires the 2026-10-14 migrations on the development project (owner approval).
  it("signed upload → server M4A inspection → finalize → signed read; authorization decides who gets a URL", async () => {
    const storage = createSupabaseObjectStorage();
    // Consent prerequisites (A70–A72, A81–A82): a VERIFIED minor DOB + guardian consent, set as the owner.
    await sql.query(
      `UPDATE student_accounts SET date_of_birth = '2015-03-01', date_of_birth_entered_by_id = $1, date_of_birth_entered_at = now(), date_of_birth_verified_by_id = $2, date_of_birth_verified_at = now() WHERE profile_id = $1`,
      [ID.studentX, ID.adminA],
    );
    await sql.query(
      `INSERT INTO recording_consents (student_profile_id, method, guardian_profile_id, recorded_by_id, granted_at) VALUES ($1, 'GUARDIAN_ONLINE', $2, $2, now())`,
      [ID.studentX, ID.parentActive],
    );
    const policy = { policy: { minorAgeThresholdYears: 18 } };
    const { rows } = await sql.query(
      `INSERT INTO corrections (tenant_id, student_profile_id, teacher_profile_id, captured_at) VALUES ($1, $2, $3, now()) RETURNING id`,
      [T.A, ID.studentX, ID.teacherA],
    );
    const { clipId, uploadUrl } = await registerDirectCaptureClip(db, storage, await actorOf("teacherA"), {
      correctionId: rows[0].id,
      mimeType: "audio/mp4",
    }, policy);
    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    created.objects.push(clip.storageObjectKey);
    const body = buildM4a({ durationMs: 2500 });
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "audio/mp4" }, body: new Blob([body as BlobPart]) });
    expect(put.ok).toBe(true);
    // The server reads the stored bytes with ranged reads (readRange) to verify AAC/M4A ≤ 60 s.
    await finalizeDirectCaptureClip(db, storage, await actorOf("teacherA"), { clipId }, policy);
    expect(await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).toMatchObject({ byteSize: body.length, durationMs: 2500 });

    for (const who of ["studentX", "teacherA", "adminA", "parentActive"] as const) {
      const { url } = await getClipPlaybackUrl(db, storage, await actorOf(who), clipId);
      const res = await fetch(url);
      expect(res.status, who).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(body);
    }
    // Super Admin access is allowed but always audited (append-only) — covered by the local suite.
    for (const who of ["studentY", "adminB", "parentVerified", "parentPending"] as const) {
      await expect(getClipPlaybackUrl(db, storage, await actorOf(who), clipId), who).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("a client cannot read an object directly by path — neither publicly nor with its own JWT", async () => {
    const key = created.objects[0];
    expect(key).toBeTruthy();
    const pub = await fetch(`${URL_}/storage/v1/object/public/${CORRECTION_CLIP_BUCKET}/${key}`);
    expect(pub.ok).toBe(false);
    const own = await sessions.studentX.storage.from(CORRECTION_CLIP_BUCKET).download(key);
    expect(own.data).toBeNull();
  });
});
