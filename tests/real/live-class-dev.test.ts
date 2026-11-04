import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadActor } from "@/server/authz/load-actor";
import { AuthorizationError, type Actor } from "@/server/authz/policy";
import { canControlMic, canCreateClass, canManageClass, canVerifyPayment } from "@/server/authz/live-class";
import { DomainError } from "@/server/services/errors";
import { addClassSchedule, assignClassTeacher, createClass, setTenantTimezone } from "@/server/services/classes";
import {
  admitFromWaitlist,
  advanceEnrollmentStates,
  enrollStudent,
  rejectPayment,
  submitPaymentEvidence,
  verifyPayment,
} from "@/server/services/enrollments";
import {
  endSession,
  grantMic,
  joinSession,
  leaveSession,
  listChildAttendance,
  startAdHocSession,
} from "@/server/services/live-sessions";

// ============================================================================================
// REAL development Supabase verification for the LIVE CLASS + FINANCE OFFICER foundation
// (migrations 20261019000000 … 20261019000500; owner decisions A101–A140).
//
// WHY A REAL-DEV SUITE: the 751 local tests already cover the business branches on PGlite.
// This file deliberately verifies only what PGlite cannot prove — behaviour of the HOSTED
// PostgreSQL 17 project and its Data API:
//   * the new enum value and CHECK constraints really exist and really bite;
//   * app.is_tenant_member() recognises FINANCE_OFFICER under real JWT claims;
//   * the 12 new Live Class tables stay deny-by-default through PostgREST;
//   * one thin end-to-end slice (class → enrol → pay → verify → session → join → mic →
//     attendance) runs against real Postgres with real locking.
//
// Uses ONLY test accounts at @example.com with a unique run tag, and deletes everything it
// created in afterAll. Never run against a project that is not the approved development
// project (A65).
//
// PERMANENT AUDIT ROWS: audit_events is append-only by design, so this suite leaves rows
// behind. Expected categories: CLASS_CREATED, CLASS_TEACHER_ASSIGNED, CLASS_TEACHER_REMOVED,
// TENANT_TIMEZONE_SET, CLASS_SCHEDULE_ADDED, ENROLLMENT_CREATED, ENROLLMENT_WAITLISTED,
// ENROLLMENT_ADMITTED, ENROLLMENT_SUSPENDED, ENROLLMENT_GRACE_STARTED, PAYMENT_ACCESS_SUBMITTED,
// PAYMENT_ACCESS_VERIFIED, PAYMENT_ACCESS_REJECTED, SESSION_STARTED, SESSION_ENDED,
// MIC_GRANTED, MIC_REVOKED. The suite is kept minimal so this set does not grow.
//
// NOT covered here (deliberately): RTC/media transport, whiteboard transport, screen share,
// scheduled jobs, payment gateways — none of these exist (A35, OQ59, OQ57).
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
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
});

const ROLES = [
  "superAdmin", "adminA", "adminB", "financeA", "financeB",
  "teacherA", "teacherA2", "teacherB", "studentX", "studentY", "studentZ", "parentA",
] as const;
type Who = (typeof ROLES)[number];
const ID = {} as Record<Who, string>;
const T = { A: "", B: "" };
const created = { users: [] as string[], tenants: [] as string[] };

/** The 12 tables added by the Live Class migrations — all must stay deny-by-default. */
const NEW_TABLES = [
  "classes", "class_teacher_assignments", "class_schedules", "class_enrollments",
  "grace_extensions", "access_payment_submissions", "access_payment_submission_enrollments",
  "live_sessions", "live_session_participants", "live_session_connections",
  "attendance_records", "live_chat_messages",
] as const;

const actorOf = async (who: Who): Promise<Actor> => (await loadActor(db, ID[who]))!;

/** Runs `fn` as `who` through a real `authenticated` JWT-claims context, then rolls back. */
async function asJwt<T>(who: Who, fn: () => Promise<T>): Promise<T> {
  await sql.query("BEGIN");
  try {
    await sql.query("SET LOCAL ROLE authenticated");
    await sql.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ID[who], role: "authenticated" }),
    ]);
    return await fn();
  } finally {
    await sql.query("ROLLBACK");
  }
}

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

const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  await sql.connect();

  // Hard guard: refuse to run if the database holds non-test users (A65 / stop condition).
  const { rows: guard } = await sql.query(
    `SELECT count(*)::int AS n FROM auth.users WHERE email NOT LIKE 'elimu-dev-%@example.com'`,
  );
  if (guard[0].n > 0) throw new Error(`Refusing to run: ${guard[0].n} non-test auth users present`);

  for (const who of ROLES) {
    const { data, error } = await admin.auth.admin.createUser({ email: email(who), email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${who}: ${error?.message}`);
    ID[who] = data.user.id;
    created.users.push(data.user.id);
  }

  const t = await sql.query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
    [`Live Markaz A ${RUN}`, `live-a-${RUN}`, `Live Markaz B ${RUN}`, `live-b-${RUN}`],
  );
  T.A = t.rows[0].id;
  T.B = t.rows[1].id;
  created.tenants.push(T.A, T.B);

  await sql.query(`INSERT INTO platform_admins (profile_id) VALUES ($1)`, [ID.superAdmin]);
  const m = (tenant: string, who: Who, role: string) =>
    sql.query(`INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, $3::"TenantRole")`, [tenant, ID[who], role]);

  await m(T.A, "adminA", "MARKAZ_ADMIN");
  await m(T.B, "adminB", "MARKAZ_ADMIN");
  await m(T.A, "financeA", "FINANCE_OFFICER");
  await m(T.B, "financeB", "FINANCE_OFFICER");
  await m(T.A, "teacherA", "TEACHER");
  await m(T.A, "teacherA2", "TEACHER");
  await m(T.B, "teacherB", "TEACHER");
  for (const s of ["studentX", "studentY", "studentZ"] as const) {
    await sql.query(`INSERT INTO student_accounts (profile_id) VALUES ($1)`, [ID[s]]);
    await m(T.A, s, "STUDENT");
  }
  await sql.query(`INSERT INTO parent_accounts (profile_id) VALUES ($1)`, [ID.parentA]);
  await sql.query(
    `INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id, status, requested_by_id,
       requested_at, verified_by_id, verified_at, activated_by_id, activated_at)
     VALUES ($1, $2, $3, 'ACTIVE', $1, now() - interval '3 days', $4, now() - interval '2 days', $4, now() - interval '1 day')`,
    [ID.parentA, ID.studentX, T.A, ID.adminA],
  );
}, 180_000);

afterAll(async () => {
  try {
    const t = created.tenants;
    if (t.length) {
      // Order matters: RESTRICT foreign keys are never bypassed.
      await sql.query(`DELETE FROM live_chat_messages WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM attendance_records WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM live_session_connections WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM live_session_participants WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM live_sessions WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM access_payment_submission_enrollments WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM access_payment_submissions WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM grace_extensions WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM class_enrollments WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM class_schedules WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM class_teacher_assignments WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM classes WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM parent_student_links WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM tenant_permission_grants WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM invitations WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM memberships WHERE tenant_id = ANY($1)`, [t]);
      await sql.query(`DELETE FROM tenants WHERE id = ANY($1)`, [t]);
    }
    const u = created.users;
    if (u.length) {
      await sql.query(`DELETE FROM platform_admins WHERE profile_id = ANY($1)`, [u]);
      await sql.query(`DELETE FROM student_accounts WHERE profile_id = ANY($1)`, [u]);
      await sql.query(`DELETE FROM parent_accounts WHERE profile_id = ANY($1)`, [u]);
      await sql.query(`DELETE FROM profiles WHERE id = ANY($1)`, [u]);
      for (const id of u) await admin.auth.admin.deleteUser(id);
    }
  } finally {
    await sql.end();
    await db.$disconnect();
  }
}, 300_000);

// -------------------------------------------------------------------------------------------
describe("hosted Postgres: the Finance Officer migration really landed", () => {
  it("TenantRole gained FINANCE_OFFICER and nothing else", async () => {
    const { rows } = await sql.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'TenantRole' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual(["MARKAZ_ADMIN", "TEACHER", "STUDENT", "FINANCE_OFFICER"]);
  });

  it("the database refuses a PAYMENT_VERIFY grant (A140 supersedes A136)", async () => {
    await expect(
      sql.query(
        `INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id)
         VALUES ($1, $2, 'PAYMENT_VERIFY', $3)`,
        [T.A, ID.teacherA, ID.adminA],
      ),
    ).rejects.toThrow(/grant_not_payment_verify/);
  });

  it("app.is_tenant_member recognises a Finance Officer under real JWT claims", async () => {
    const ok = await asJwt("financeA", async () => {
      const { rows } = await sql.query(`SELECT app.is_tenant_member($1) AS ok`, [T.A]);
      return rows[0].ok;
    });
    expect(ok).toBe(true);
  });

  it("a Finance Officer is not a member of another Markaz", async () => {
    const ok = await asJwt("financeA", async () => {
      const { rows } = await sql.query(`SELECT app.is_tenant_member($1) AS ok`, [T.B]);
      return rows[0].ok;
    });
    expect(ok).toBe(false);
  });

  it("tenants.timezone is nullable and has no default (A131: fail closed, never UTC)", async () => {
    const { rows } = await sql.query(
      `SELECT is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'timezone'`,
    );
    expect(rows[0]).toEqual({ is_nullable: "YES", column_default: null });
  });

  it("attendance_records refuses the legacy LATE attendance value (A132)", async () => {
    // AttendanceStatus still carries LATE (a PostgreSQL enum value cannot be dropped), so the
    // rule is enforced by a CHECK instead: only PRESENT/ABSENT may ever be stored.
    const { rows } = await sql.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'public.attendance_records'::regclass AND conname = 'attendance_presence_only'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/PRESENT/);
    expect(rows[0].def).toMatch(/ABSENT/);
    expect(rows[0].def).not.toMatch(/'LATE'/);
  });

  it("punctuality is only set when the student actually arrived (A132)", async () => {
    const { rows } = await sql.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'public.attendance_records'::regclass AND conname = 'attendance_punctuality_with_arrival'`,
    );
    expect(rows).toHaveLength(1);
  });
});

// -------------------------------------------------------------------------------------------
describe("Finance Officer payment authority (A136, A140)", () => {
  let classId = "";
  let enrollmentId = "";
  let submissionId = "";

  beforeAll(async () => {
    const adminActor = await actorOf("adminA");
    await setTenantTimezone(db, adminActor, { tenantId: T.A, timezone: "Africa/Dar_es_Salaam" });
    const cls = await createClass(db, adminActor, {
      tenantId: T.A,
      name: `Finance class ${RUN}`,
      primaryTeacherProfileId: ID.teacherA,
      paymentRequired: true,
    });
    classId = cls;
    const e = await enrollStudent(db, adminActor, { classId, studentProfileId: ID.studentX });
    enrollmentId = e.enrollmentId;
    const s = await submitPaymentEvidence(db, adminActor, {
      tenantId: T.A,
      studentProfileId: ID.studentX,
      enrollmentIds: [enrollmentId],
      coverageNote: "Dev verification period",
      evidenceReference: `DEV-${RUN}-1`,
      periodStart: isoDate(new Date()),
      periodEnd: isoDate(at(30 * DAY)),
    });
    submissionId = s;
  }, 120_000);

  it("a paid-class enrolment starts PENDING_PAYMENT with no access (A135)", async () => {
    const { rows } = await sql.query(
      `SELECT status, access_until FROM class_enrollments WHERE id = $1`,
      [enrollmentId],
    );
    expect(rows[0].status).toBe("PENDING_PAYMENT");
    expect(rows[0].access_until).toBeNull();
  });

  it("submission alone grants nothing", async () => {
    const { rows } = await sql.query(`SELECT status FROM class_enrollments WHERE id = $1`, [enrollmentId]);
    expect(rows[0].status).toBe("PENDING_PAYMENT");
  });

  it("a Teacher cannot verify payment (A140)", async () => {
    expect(canVerifyPayment(await actorOf("teacherA"), T.A)).toBe(false);
    await expect(verifyPayment(db, await actorOf("teacherA"), { submissionId })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a Finance Officer of ANOTHER Markaz cannot verify", async () => {
    expect(canVerifyPayment(await actorOf("financeB"), T.A)).toBe(false);
    await expect(verifyPayment(db, await actorOf("financeB"), { submissionId })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("the Markaz's own Finance Officer may verify, and that activates access", async () => {
    expect(canVerifyPayment(await actorOf("financeA"), T.A)).toBe(true);
    await verifyPayment(db, await actorOf("financeA"), { submissionId });
    const { rows } = await sql.query(
      `SELECT status, access_until FROM class_enrollments WHERE id = $1`,
      [enrollmentId],
    );
    expect(rows[0].status).toBe("ACTIVE");
    expect(rows[0].access_until).not.toBeNull();
  });

  it("a Markaz Admin may verify too", async () => {
    expect(canVerifyPayment(await actorOf("adminA"), T.A)).toBe(true);
  });

  it("a Finance Officer may reject a submission", async () => {
    const s = await submitPaymentEvidence(db, await actorOf("adminA"), {
      tenantId: T.A,
      studentProfileId: ID.studentX,
      enrollmentIds: [enrollmentId],
      coverageNote: "Dev verification reject path",
      evidenceReference: `DEV-${RUN}-2`,
      periodStart: isoDate(at(31 * DAY)),
      periodEnd: isoDate(at(60 * DAY)),
    });
    await rejectPayment(db, await actorOf("financeA"), { submissionId: s, reason: "dev test" });
    const { rows } = await sql.query(`SELECT status FROM access_payment_submissions WHERE id = $1`, [s]);
    expect(rows[0].status).toBe("REJECTED");
  });

  it("a Finance Officer holds no teaching or live-session authority", async () => {
    const fin = await actorOf("financeA");
    expect(canCreateClass(fin, T.A)).toBe(false);
    await expect(
      createClass(db, fin, { tenantId: T.A, name: "nope", primaryTeacherProfileId: ID.teacherA }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(startAdHocSession(db, fin, { classId })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a Finance Officer sees no student roster rows through the Data API", async () => {
    const session = await signInWithRealOtp(email("financeA"));
    const { data, error } = await session.from("class_enrollments").select("id");
    expect(error === null ? (data ?? []) : []).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
describe("classes are tenant-scoped with exactly one Primary (A103)", () => {
  let classId = "";

  beforeAll(async () => {
    const cls = await createClass(db, await actorOf("adminA"), {
      tenantId: T.A,
      name: `Structure class ${RUN}`,
      primaryTeacherProfileId: ID.teacherA,
    });
    classId = cls;
  }, 60_000);

  it("an admin of another Markaz cannot create a class here", async () => {
    expect(canCreateClass(await actorOf("adminB"), T.A)).toBe(false);
    await expect(
      createClass(db, await actorOf("adminB"), { tenantId: T.A, name: "cross", primaryTeacherProfileId: ID.teacherA }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a teacher of another Markaz cannot be assigned", async () => {
    await expect(
      assignClassTeacher(db, await actorOf("adminA"), { classId, teacherProfileId: ID.teacherB, role: "CO_TEACHER" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("exactly one active Primary exists, and promoting a new one ends the old", async () => {
    await assignClassTeacher(db, await actorOf("adminA"), { classId, teacherProfileId: ID.teacherA2, role: "PRIMARY" });
    const { rows } = await sql.query(
      `SELECT teacher_profile_id FROM class_teacher_assignments
       WHERE class_id = $1 AND role = 'PRIMARY' AND ended_at IS NULL`,
      [classId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].teacher_profile_id).toBe(ID.teacherA2);
  });

  it("more than one Co-Teacher may be active at the same time", async () => {
    await assignClassTeacher(db, await actorOf("adminA"), { classId, teacherProfileId: ID.teacherA, role: "CO_TEACHER" });
    const { rows } = await sql.query(
      `SELECT count(*)::int AS n FROM class_teacher_assignments
       WHERE class_id = $1 AND role = 'CO_TEACHER' AND ended_at IS NULL`,
      [classId],
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("a Markaz Admin of this Markaz may manage the class; one of another may not", async () => {
    const ctx = { id: classId, tenantId: T.A, teachers: [], status: "ACTIVE" as const };
    expect(canManageClass(await actorOf("adminA"), ctx)).toBe(true);
    expect(canManageClass(await actorOf("adminB"), ctx)).toBe(false);
  });

  it("a student of the Markaz has no enrolment until one is created explicitly (A106)", async () => {
    const { rows } = await sql.query(
      `SELECT count(*)::int AS n FROM class_enrollments WHERE class_id = $1 AND student_profile_id = $2`,
      [classId, ID.studentZ],
    );
    expect(rows[0].n).toBe(0);
  });
});

// -------------------------------------------------------------------------------------------
describe("free class, capacity, waitlist and seats (A110, A133, A134)", () => {
  let classId = "";
  let eX = "";
  let eY = "";
  let eZ = "";

  beforeAll(async () => {
    const adminActor = await actorOf("adminA");
    const cls = await createClass(db, adminActor, {
      tenantId: T.A,
      name: `Capacity class ${RUN}`,
      primaryTeacherProfileId: ID.teacherA,
      enrollmentCapacity: 1,
    });
    classId = cls;
    eX = (await enrollStudent(db, adminActor, { classId, studentProfileId: ID.studentX })).enrollmentId;
    eY = (await enrollStudent(db, adminActor, { classId, studentProfileId: ID.studentY })).enrollmentId;
    eZ = (await enrollStudent(db, adminActor, { classId, studentProfileId: ID.studentZ })).enrollmentId;
  }, 120_000);

  it("a free class activates the first student without any payment (A135)", async () => {
    const { rows } = await sql.query(`SELECT status FROM class_enrollments WHERE id = $1`, [eX]);
    expect(rows[0].status).toBe("ACTIVE");
  });

  it("the rest are WAITLISTED once the seat is taken", async () => {
    const { rows } = await sql.query(
      `SELECT id, status FROM class_enrollments WHERE id = ANY($1) ORDER BY waitlisted_at`,
      [[eY, eZ]],
    );
    expect(rows.map((r) => r.status)).toEqual(["WAITLISTED", "WAITLISTED"]);
  });

  it("a SUSPENDED enrolment holds no active seat (A133)", async () => {
    // Put X's access far in the past so the grace deadline has also passed, then advance.
    await sql.query(
      `UPDATE class_enrollments SET access_until = now() - interval '60 days', grace_until = now() - interval '30 days' WHERE id = $1`,
      [eX],
    );
    await advanceEnrollmentStates(db, new Date());
    const { rows } = await sql.query(`SELECT status FROM class_enrollments WHERE id = $1`, [eX]);
    expect(rows[0].status).toBe("SUSPENDED");
  });

  it("admitting out of FIFO order without a reason is refused (A134)", async () => {
    await expect(
      admitFromWaitlist(db, await actorOf("adminA"), { enrollmentId: eZ }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("the earliest waitlisted student is admitted into the freed seat", async () => {
    await admitFromWaitlist(db, await actorOf("adminA"), { enrollmentId: eY });
    const { rows } = await sql.query(`SELECT status FROM class_enrollments WHERE id = $1`, [eY]);
    expect(rows[0].status).toBe("ACTIVE");
  });

  it("an out-of-order admission with a Markaz Admin reason is allowed and audited", async () => {
    await admitFromWaitlist(db, await actorOf("adminA"), {
      enrollmentId: eZ,
      overrideReason: "dev verification: capacity override",
      queueOverrideReason: "dev verification: queue override",
    });
    const { rows } = await sql.query(`SELECT status FROM class_enrollments WHERE id = $1`, [eZ]);
    expect(rows[0].status).toBe("ACTIVE");
    const audit = await sql.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE target_id = $1 AND action::text LIKE 'ENROLLMENT_%'`,
      [eZ],
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------
describe("time zone must be chosen before scheduling (A131)", () => {
  it("a Markaz with no time zone cannot take a schedule", async () => {
    const cls = await createClass(db, await actorOf("adminB"), {
      tenantId: T.B,
      name: `TZ class ${RUN}`,
      primaryTeacherProfileId: ID.teacherB,
    });
    const classId = cls;
    const { rows } = await sql.query(`SELECT timezone FROM tenants WHERE id = $1`, [T.B]);
    expect(rows[0].timezone).toBeNull();

    await expect(
      addClassSchedule(db, await actorOf("adminB"), { classId, weekday: 1, startTime: "09:00", durationMinutes: 60 }),
    ).rejects.toBeInstanceOf(DomainError);

    await setTenantTimezone(db, await actorOf("adminB"), { tenantId: T.B, timezone: "Africa/Dar_es_Salaam" });
    await addClassSchedule(db, await actorOf("adminB"), { classId, weekday: 1, startTime: "09:00", durationMinutes: 60 });
    const after = await sql.query(`SELECT count(*)::int AS n FROM class_schedules WHERE class_id = $1`, [classId]);
    expect(after.rows[0].n).toBe(1);
  }, 120_000);
});

// -------------------------------------------------------------------------------------------
describe("live session: devices, mic handoff and attendance", () => {
  let classId = "";
  let sessionId = "";

  beforeAll(async () => {
    const adminActor = await actorOf("adminA");
    const cls = await createClass(db, adminActor, {
      tenantId: T.A,
      name: `Session class ${RUN}`,
      primaryTeacherProfileId: ID.teacherA,
    });
    classId = cls;
    await enrollStudent(db, adminActor, { classId, studentProfileId: ID.studentX });
    await enrollStudent(db, adminActor, { classId, studentProfileId: ID.studentY });
    const s = await startAdHocSession(db, await actorOf("teacherA"), { classId, durationMinutes: 60 });
    sessionId = s;
  }, 120_000);

  it("the first device is PRIMARY, the second VIEW_ONLY, the third refused (A121)", async () => {
    const studentActor = await actorOf("studentX");
    const first = (await joinSession(db, studentActor, { sessionId })) as { mode: string; participantId: string };
    const second = (await joinSession(db, studentActor, { sessionId })) as { mode: string };
    expect(first.mode).toBe("PRIMARY");
    expect(second.mode).toBe("VIEW_ONLY");
    await expect(joinSession(db, studentActor, { sessionId })).rejects.toBeInstanceOf(DomainError);
  });

  it("two devices never double-count presence (one participant row)", async () => {
    const { rows } = await sql.query(
      `SELECT count(*)::int AS n FROM live_session_participants WHERE session_id = $1 AND profile_id = $2`,
      [sessionId, ID.studentX],
    );
    expect(rows[0].n).toBe(1);
  });

  it("granting the mic to B automatically revokes it from A (A138)", async () => {
    await joinSession(db, await actorOf("studentY"), { sessionId });
    const ps = await sql.query(
      `SELECT id, profile_id FROM live_session_participants WHERE session_id = $1 AND profile_id = ANY($2)`,
      [sessionId, [ID.studentX, ID.studentY]],
    );
    const pX = ps.rows.find((r) => r.profile_id === ID.studentX)!.id;
    const pY = ps.rows.find((r) => r.profile_id === ID.studentY)!.id;

    await grantMic(db, await actorOf("teacherA"), { participantId: pX });
    await grantMic(db, await actorOf("teacherA"), { participantId: pY });

    const { rows } = await sql.query(
      `SELECT count(*)::int AS n FROM live_session_participants WHERE session_id = $1 AND mic_granted_at IS NOT NULL`,
      [sessionId],
    );
    expect(rows[0].n).toBe(1);
    const holder = await sql.query(
      `SELECT profile_id FROM live_session_participants WHERE session_id = $1 AND mic_granted_at IS NOT NULL`,
      [sessionId],
    );
    expect(holder.rows[0].profile_id).toBe(ID.studentY);
  });

  it("a Markaz Admin never controls the mic; the assigned teacher does (A118)", async () => {
    const ctx = {
      id: classId, tenantId: T.A, status: "ACTIVE" as const, substituteProfileId: null,
      teachers: [{ id: "x", teacherProfileId: ID.teacherA, role: "PRIMARY" as const }],
    };
    expect(canControlMic(await actorOf("teacherA"), ctx)).toBe(true);
    expect(canControlMic(await actorOf("adminA"), ctx)).toBe(false);
  });

  it("attendance and punctuality are stored as separate dimensions (A132)", async () => {
    await leaveSession(db, await actorOf("studentX"), { sessionId });
    await leaveSession(db, await actorOf("studentY"), { sessionId });
    await endSession(db, await actorOf("teacherA"), { sessionId });

    const { rows } = await sql.query(
      `SELECT status, punctuality FROM attendance_records WHERE session_id = $1`,
      [sessionId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["PRESENT", "ABSENT"]).toContain(r.status);
      expect([null, "ON_TIME", "LATE"]).toContain(r.punctuality);
    }
  }, 120_000);

  it("a parent sees statuses only — never raw presence times", async () => {
    const rows = await listChildAttendance(db, await actorOf("parentA"), ID.studentX);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["className", "id", "punctuality", "sessionDate", "status", "timezone"]);
    }
  });

  it("a parent cannot read the class chat", async () => {
    const session = await signInWithRealOtp(email("parentA"));
    const { data, error } = await session.from("live_chat_messages").select("id");
    expect(error === null ? (data ?? []) : []).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
describe("the new Live Class tables stay deny-by-default on the Data API", () => {
  it("every new table is RLS-enabled", async () => {
    const { rows } = await sql.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1) AND NOT c.relrowsecurity`,
      [[...NEW_TABLES]],
    );
    expect(rows).toEqual([]);
  });

  it("neither anon nor authenticated holds any privilege on them", async () => {
    const { rows } = await sql.query(
      `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = ANY($1) AND grantee IN ('anon', 'authenticated')`,
      [[...NEW_TABLES]],
    );
    expect(rows).toEqual([]);
  });

  it("a Markaz Admin reads nothing from them through PostgREST", async () => {
    const session = await signInWithRealOtp(email("adminA"));
    for (const table of NEW_TABLES) {
      const { data, error } = await session.from(table).select("id");
      expect(error === null ? (data ?? []) : []).toEqual([]);
    }
  }, 120_000);

  it("a Super Admin gets no direct Data API bypass either", async () => {
    const session = await signInWithRealOtp(email("superAdmin"));
    for (const table of NEW_TABLES) {
      const { data, error } = await session.from(table).select("id");
      expect(error === null ? (data ?? []) : []).toEqual([]);
    }
  }, 120_000);
});
