import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadActor } from "@/server/authz/load-actor";
import type { Actor } from "@/server/authz/policy";
import { acceptInvitation, createInvitation, revokeInvitation } from "@/server/services/invitations";
import { grantTenantPermission } from "@/server/services/permissions";
import { activateParentLink, verifyParentLink } from "@/server/services/parent-links";
import { addClassSchedule, createClass, setTenantTimezone } from "@/server/services/classes";
import { enrollStudent, submitPaymentEvidence, verifyPayment } from "@/server/services/enrollments";
import { endSession, grantMic, joinSession, leaveSession, postChatMessage, startAdHocSession } from "@/server/services/live-sessions";

// =============================================================================================
// DEMO ENVIRONMENT for the DEVELOPMENT Supabase project (A65). NOT a test.
//
// Opt-in only — a normal `npm run test:dev-supabase` skips both blocks:
//   seed:     DEMO_SEED=1     npx vitest run --config vitest.real.config.mts tests/real/_demo
//   teardown: DEMO_TEARDOWN=1 npx vitest run --config vitest.real.config.mts tests/real/_demo
//
// Everything is created through the REAL services, so every authorization rule runs exactly as
// it does in the app: invitations, explicit parent-link grants (A63), Finance Officer payment
// verification (A140), class/teacher/enrolment rules, session and mic rules. Raw SQL is used
// ONLY to bootstrap the three rows for which the application has no path at all — the Markaz
// itself, its first Markaz Admin membership, and the platform-admin row. No authorization check
// and no database constraint is bypassed anywhere.
//
// All demo accounts use elimu-dev-demo-*@example.com, which keeps them inside the
// `elimu-dev-%@example.com` pattern the other real-DEV suites guard on, while the word "demo"
// marks them apart from run-tagged test data. The Markaz is named and slugged DEMO / DEV ONLY.
//
// No business rule is invented here: no capacity ceiling, no price, no amount, no currency.
// Nothing touches RTC, scheduled jobs, the recordings bucket, production or deployment.
// =============================================================================================

const SEED = process.env.DEMO_SEED === "1";
const TEARDOWN = process.env.DEMO_TEARDOWN === "1";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const SECRET = env("SUPABASE_SECRET_KEY");

const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = new pg.Client({ connectionString: env("DIRECT_URL"), ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env("DIRECT_URL"), ssl: { rejectUnauthorized: false } }),
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
});

const TENANT_NAME = "DEMO - Markaz ya Mfano (DEV ONLY)";
const TENANT_SLUG = "demo-markaz-dev-only";
const ROLES = ["superadmin", "markazadmin", "finance", "teacher", "student", "student2", "parent"] as const;
type Who = (typeof ROLES)[number];
const email = (who: Who) => `elimu-dev-demo-${who}@example.com`;

const ID = {} as Record<Who, string>;
let TENANT = "";
const actorOf = async (who: Who): Promise<Actor> => {
  const a = await loadActor(db, ID[who]);
  if (!a) throw new Error(`no actor for ${who}`);
  return a;
};

/** Creates the auth user if it is not there yet; returns its id either way. */
async function ensureUser(who: Who): Promise<string> {
  const address = email(who);
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = list?.users.find((u) => u.email?.toLowerCase() === address);
  if (found) return found.id;
  const { data, error } = await admin.auth.admin.createUser({ email: address, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${who}: ${error?.message}`);
  return data.user.id;
}

/**
 * Invite + accept, i.e. exactly the path a real person walks. Idempotent: if the demo account
 * already holds what the invitation would create, nothing happens; a leftover PENDING
 * invitation from an interrupted run is revoked through the service before a fresh one is cut
 * (its token hash is one-way, so an old row can never be reused).
 */
async function inviteAndAccept(inviter: Who, who: Who, target: string, proposedStudentId?: string) {
  if (target === "PARENT") {
    const already = await db.parentAccount.findUnique({ where: { profileId: ID[who] }, select: { profileId: true } });
    if (already) return;
  } else {
    const { rows } = await sql.query(
      `SELECT 1 FROM memberships WHERE tenant_id = $1 AND profile_id = $2 AND role = $3::"TenantRole" AND status = 'ACTIVE'`,
      [TENANT, ID[who], target],
    );
    if (rows.length) return;
  }

  const inviterActor = await actorOf(inviter);
  const stale = await sql.query(
    `SELECT id FROM invitations WHERE tenant_id = $1 AND email = $2 AND status = 'PENDING'`,
    [TENANT, email(who)],
  );
  for (const r of stale.rows) await revokeInvitation(db, inviterActor, r.id);

  const created = await createInvitation(db, inviterActor, {
    tenantId: TENANT,
    email: email(who),
    target,
    ...(proposedStudentId ? { proposedStudentId } : {}),
  });
  await acceptInvitation(db, { userId: ID[who], email: email(who) }, { token: created.token });
}

const MIN = 60_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  await sql.connect();
}, 120_000);

afterAll(async () => {
  await sql.end();
  await db.$disconnect();
}, 120_000);

describe.skipIf(!SEED)("seed the DEMO environment", () => {
  it("creates demo auth users (Admin API; public sign-ups stay disabled)", async () => {
    for (const who of ROLES) ID[who] = await ensureUser(who);
    expect(Object.keys(ID)).toHaveLength(ROLES.length);
  }, 180_000);

  it("bootstraps the Markaz, its first admin and the platform admin (no app path exists)", async () => {
    const existing = await sql.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
    TENANT = existing.rows[0]?.id
      ?? (await sql.query(`INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id`, [TENANT_NAME, TENANT_SLUG])).rows[0].id;
    await sql.query(
      `INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'MARKAZ_ADMIN')
       ON CONFLICT (tenant_id, profile_id, role) DO NOTHING`,
      [TENANT, ID.markazadmin],
    );
    await sql.query(`INSERT INTO platform_admins (profile_id) VALUES ($1) ON CONFLICT DO NOTHING`, [ID.superadmin]);
    expect(TENANT).toMatch(/^[0-9a-f-]{36}$/);
  }, 120_000);

  it("Super Admin grants the Markaz Admin the explicit parent-link and invitation permissions (A63)", async () => {
    const su = await actorOf("superadmin");
    for (const permission of ["invitation.create", "parent_link.create", "parent_link.verify", "parent_link.activate"]) {
      await grantTenantPermission(db, su, { tenantId: TENANT, profileId: ID.markazadmin, permission }).catch((e) => {
        if (!/conflict/i.test(String(e?.code ?? e?.message ?? e))) throw e;
      });
    }
    const { rows } = await sql.query(
      `SELECT count(*)::int n FROM tenant_permission_grants WHERE tenant_id = $1 AND profile_id = $2 AND revoked_at IS NULL`,
      [TENANT, ID.markazadmin],
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("staff and students join through real invitations", async () => {
    await inviteAndAccept("markazadmin", "teacher", "TEACHER");
    await inviteAndAccept("markazadmin", "finance", "FINANCE_OFFICER");
    await inviteAndAccept("markazadmin", "student", "STUDENT");
    await inviteAndAccept("markazadmin", "student2", "STUDENT");
    const { rows } = await sql.query(`SELECT role FROM memberships WHERE tenant_id = $1 ORDER BY role`, [TENANT]);
    expect(rows.length).toBeGreaterThanOrEqual(5);
  }, 300_000);

  it("the parent is invited with a proposed child, then verified and activated (PENDING -> VERIFIED -> ACTIVE)", async () => {
    await inviteAndAccept("markazadmin", "parent", "PARENT", ID.student);
    const link = (await sql.query(
      `SELECT id, status FROM parent_student_links WHERE tenant_id = $1 AND parent_profile_id = $2`,
      [TENANT, ID.parent],
    )).rows[0];
    const ma = await actorOf("markazadmin");
    if (link.status === "PENDING") await verifyParentLink(db, ma, { linkId: link.id });
    const mid = (await sql.query(`SELECT status FROM parent_student_links WHERE id = $1`, [link.id])).rows[0];
    if (mid.status === "VERIFIED") await activateParentLink(db, ma, { linkId: link.id });
    const after = (await sql.query(`SELECT status FROM parent_student_links WHERE id = $1`, [link.id])).rows[0];
    expect(after.status).toBe("ACTIVE");
  }, 300_000);

  it("the Markaz Admin chooses a time zone, then creates one paid and one free class", async () => {
    const ma = await actorOf("markazadmin");
    await setTenantTimezone(db, ma, { tenantId: TENANT, timezone: "Africa/Dar_es_Salaam" });
    // No enrollmentCapacity / liveCapacity is set: concrete capacity numbers are an open owner
    // decision (OQ5) and nothing may be invented here. Unset means "no class-level limit".
    //
    // createClass has no natural key, so a re-run would silently add a second copy of each
    // class. Guard on the demo name and skip when it is already there.
    const existing = (await sql.query(`SELECT name FROM classes WHERE tenant_id = $1`, [TENANT])).rows.map((r) => r.name);
    if (existing.length >= 2) {
      expect(existing.length).toBeGreaterThanOrEqual(2);
      return;
    }
    const paid = await createClass(db, ma, {
      tenantId: TENANT,
      name: "DEMO - Hifdh ya Juzu Amma",
      subject: "Hifdh",
      description: "Darasa la mfano kwa ajili ya DEV. Si data halisi.",
      primaryTeacherProfileId: ID.teacher,
      paymentRequired: true,
    });
    const free = await createClass(db, ma, {
      tenantId: TENANT,
      name: "DEMO - Lugha ya Kiarabu (Msingi)",
      subject: "Kiarabu",
      description: "Darasa la mfano lisilohitaji malipo. Si data halisi.",
      primaryTeacherProfileId: ID.teacher,
      paymentRequired: false,
    });
    await addClassSchedule(db, ma, { classId: paid, weekday: 6, startTime: "09:00", durationMinutes: 60 });
    await addClassSchedule(db, ma, { classId: free, weekday: 3, startTime: "17:30", durationMinutes: 45 });
    await sql.query(`UPDATE tenants SET name = $1 WHERE id = $2`, [TENANT_NAME, TENANT]);
    expect(typeof paid).toBe("string");
  }, 300_000);

  it("enrols students: paid class waits for payment, free class is active at once", async () => {
    const ma = await actorOf("markazadmin");
    const classes = (await sql.query(
      `SELECT id, name, payment_required FROM classes WHERE tenant_id = $1 ORDER BY payment_required DESC`,
      [TENANT],
    )).rows;
    const paid = classes.find((c) => c.payment_required).id;
    const free = classes.find((c) => !c.payment_required).id;
    for (const s of [ID.student, ID.student2]) {
      await enrollStudent(db, ma, { classId: paid, studentProfileId: s }).catch((e) => {
        if (!/conflict/i.test(String(e?.code ?? e?.message ?? e))) throw e;
      });
    }
    await enrollStudent(db, ma, { classId: free, studentProfileId: ID.student }).catch((e) => {
      if (!/conflict/i.test(String(e?.code ?? e?.message ?? e))) throw e;
    });
    const { rows } = await sql.query(`SELECT count(*)::int n FROM class_enrollments WHERE tenant_id = $1`, [TENANT]);
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  }, 300_000);

  it("Finance Officer verifies one payment and leaves a second one pending", async () => {
    const ma = await actorOf("markazadmin");
    const fin = await actorOf("finance");
    const paid = (await sql.query(`SELECT id FROM classes WHERE tenant_id = $1 AND payment_required ORDER BY created_at LIMIT 1`, [TENANT])).rows[0].id;
    const start = new Date();
    const end = new Date(Date.now() + 30 * 24 * 60 * MIN);

    for (const [who, studentId] of [["student", ID.student], ["student2", ID.student2]] as const) {
      const enrolment = (await sql.query(
        `SELECT id FROM class_enrollments WHERE class_id = $1 AND student_profile_id = $2`,
        [paid, studentId],
      )).rows[0];
      // No amount or currency exists anywhere in the model: a submission carries a reference only.
      const submissionId = await submitPaymentEvidence(db, ma, {
        tenantId: TENANT,
        studentProfileId: studentId,
        enrollmentIds: [enrolment.id],
        coverageNote: "DEMO - kipindi cha mfano cha siku 30",
        evidenceReference: `DEMO-${who.toUpperCase()}-${randomUUID().slice(0, 6)}`,
        periodStart: iso(start),
        periodEnd: iso(end),
      });
      // Only the first is verified, so the Finance page shows both a verified and a pending row.
      if (who === "student") await verifyPayment(db, fin, { submissionId });
    }
    const { rows } = await sql.query(
      `SELECT status, count(*)::int n FROM access_payment_submissions WHERE tenant_id = $1 GROUP BY status ORDER BY status`,
      [TENANT],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  }, 300_000);

  it("runs one finished session (so attendance exists) and leaves one live session open", async () => {
    const teacher = await actorOf("teacher");
    const student = await actorOf("student");
    const paid = (await sql.query(`SELECT id FROM classes WHERE tenant_id = $1 AND payment_required ORDER BY created_at LIMIT 1`, [TENANT])).rows[0].id;

    // Only ONE session per class may be LIVE at a time (partial unique index), so the finished
    // session is settled first and the browsable one is opened after it.
    const openNow = async () =>
      (await sql.query(
        `SELECT id, actual_start_at FROM live_sessions WHERE class_id = $1 AND status IN ('LIVE','SCHEDULED') ORDER BY created_at DESC LIMIT 1`,
        [paid],
      )).rows[0];

    // --- finished session: joined a minute in, stayed almost the whole hour -> PRESENT / ON_TIME ---
    const done = await sql.query(`SELECT id FROM live_sessions WHERE class_id = $1 AND status = 'ENDED' LIMIT 1`, [paid]);
    if (!done.rows.length) {
      const leftover = await openNow();
      const t0 = leftover ? new Date(leftover.actual_start_at) : new Date(Date.now() - 120 * MIN);
      const past = leftover?.id
        ?? (await startAdHocSession(db, teacher, { classId: paid, durationMinutes: 60, title: "DEMO - Kipindi kilichopita" }, { now: t0 }));
      const already = await sql.query(
        `SELECT c.id FROM live_session_connections c JOIN live_session_participants p ON p.id = c.participant_id
         WHERE c.session_id = $1 AND p.profile_id = $2 AND c.disconnected_at IS NULL LIMIT 1`,
        [past, ID.student],
      );
      const connectionId = already.rows[0]?.id
        ?? (await joinSession(db, student, { sessionId: past }, { now: new Date(t0.getTime() + 1 * MIN) })).connectionId;
      await leaveSession(db, student, { connectionId }, { now: new Date(t0.getTime() + 58 * MIN) });
      await endSession(db, teacher, { sessionId: past }, { now: new Date(t0.getTime() + 60 * MIN) });
    }

    // --- live session, open now, long enough to browse ---
    const live = (await openNow())?.id
      ?? (await startAdHocSession(db, teacher, { classId: paid, durationMinutes: 480, title: "DEMO - Kipindi cha sasa (LIVE)" }));
    const alreadyIn = await sql.query(
      `SELECT id FROM live_session_participants WHERE session_id = $1 AND profile_id = $2`,
      [live, ID.student],
    );
    if (!alreadyIn.rows.length) await joinSession(db, student, { sessionId: live });
    const participant = (await sql.query(
      `SELECT id, mic_granted_at FROM live_session_participants WHERE session_id = $1 AND profile_id = $2`,
      [live, ID.student],
    )).rows[0];
    if (!participant.mic_granted_at) await grantMic(db, teacher, { participantId: participant.id });
    // The teacher is connected too — both to be realistic and because only a joined
    // participant may post to the class chat.
    const teacherIn = await sql.query(
      `SELECT id FROM live_session_participants WHERE session_id = $1 AND profile_id = $2`,
      [live, ID.teacher],
    );
    if (!teacherIn.rows.length) await joinSession(db, teacher, { sessionId: live });

    const chat = await sql.query(`SELECT count(*)::int n FROM live_chat_messages WHERE session_id = $1`, [live]);
    if (chat.rows[0].n === 0) {
      await postChatMessage(db, teacher, { sessionId: live, body: "Assalaamu alaykum. Hiki ni kipindi cha MFANO kwa ajili ya DEV." });
      await postChatMessage(db, student, { sessionId: live, body: "Wa alaykumu assalaam, ustadh." });
    }

    const att = await sql.query(`SELECT status, punctuality FROM attendance_records WHERE tenant_id = $1`, [TENANT]);
    expect(att.rows.length).toBeGreaterThan(0);
  }, 600_000);

  it("prints the demo summary", async () => {
    const t = (await sql.query(`SELECT id, name, slug, timezone FROM tenants WHERE slug = $1`, [TENANT_SLUG])).rows[0];
    const classes = (await sql.query(`SELECT id, name, payment_required FROM classes WHERE tenant_id = $1`, [t.id])).rows;
    const sessions = (await sql.query(`SELECT id, title, status FROM live_sessions WHERE tenant_id = $1`, [t.id])).rows;
    const enrol = (await sql.query(`SELECT status, count(*)::int n FROM class_enrollments WHERE tenant_id = $1 GROUP BY status`, [t.id])).rows;
    const pay = (await sql.query(`SELECT status, count(*)::int n FROM access_payment_submissions WHERE tenant_id = $1 GROUP BY status`, [t.id])).rows;
    const att = (await sql.query(`SELECT status, punctuality FROM attendance_records WHERE tenant_id = $1`, [t.id])).rows;
    const audit = (await sql.query(`SELECT count(*)::int n FROM audit_events`)).rows[0].n;
    console.log("\n=== DEMO SUMMARY ===");
    console.log("tenantId:", t.id, "| slug:", t.slug, "| tz:", t.timezone);
    console.log("classes:", JSON.stringify(classes));
    console.log("sessions:", JSON.stringify(sessions));
    console.log("enrollments:", JSON.stringify(enrol));
    console.log("payments:", JSON.stringify(pay));
    console.log("attendance:", JSON.stringify(att));
    console.log("audit_events TOTAL:", audit);
    console.log("userIds:", JSON.stringify(ID));
    expect(t.slug).toBe(TENANT_SLUG);
  }, 120_000);
});

describe.skipIf(!TEARDOWN)("tear the DEMO environment down", () => {
  it("removes every demo row except append-only audit events", async () => {
    const t = (await sql.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG])).rows[0];
    if (t) {
      const id = [t.id];
      for (const table of [
        "live_chat_messages", "attendance_records", "live_session_connections", "live_session_participants",
        "live_sessions", "access_payment_submission_enrollments", "access_payment_submissions",
        "grace_extensions", "class_enrollments", "class_schedules", "class_teacher_assignments", "classes",
        "parent_link_events", "parent_student_links", "tenant_permission_grants", "invitations",
        "markaz_admin_appointment_requests", "memberships",
      ]) {
        await sql.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1)`, [id]);
      }
      await sql.query(`DELETE FROM tenants WHERE id = ANY($1)`, [id]);
    }
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const demo = (list?.users ?? []).filter((u) => u.email?.startsWith("elimu-dev-demo-"));
    const ids = demo.map((u) => u.id);
    if (ids.length) {
      for (const table of ["platform_admins", "student_accounts", "parent_accounts"]) {
        await sql.query(`DELETE FROM ${table} WHERE profile_id = ANY($1)`, [ids]);
      }
      await sql.query(`DELETE FROM profiles WHERE id = ANY($1)`, [ids]);
      for (const u of demo) await admin.auth.admin.deleteUser(u.id);
    }
    const left = (await sql.query(`SELECT count(*)::int n FROM tenants WHERE slug = $1`, [TENANT_SLUG])).rows[0].n;
    expect(left).toBe(0);
  }, 600_000);
});
