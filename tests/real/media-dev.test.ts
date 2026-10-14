import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { loadActor } from "@/server/authz/load-actor";
import { AuthorizationError, type Actor } from "@/server/authz/policy";
import {
  enterDateOfBirth,
  getRecordingEligibility,
  giveGuardianConsent,
  giveOwnConsent,
  recordOfflineConsent,
  verifyDateOfBirth,
  withdrawConsent,
} from "@/server/services/consent";
import { finalizeDirectCaptureClip, getClipPlaybackUrl, registerDirectCaptureClip } from "@/server/services/correction-audio";
import { createCorrection, listStudentCorrections } from "@/server/services/corrections";
import { approveMediaDeletion, cancelMediaDeletion, declineMediaDeletion, purgeExpiredMedia, requestMediaDeletion } from "@/server/services/media-deletion";
import { cancelOptionCRequest, declineOptionC, disableOptionC, enableOptionC, getOptionCStatus, requestOptionC } from "@/server/services/option-c";
import {
  approveRecording,
  createRecording,
  getRecordingPlaybackUrl,
  registerRecordingParticipants,
  rejectRecording,
  startRecording,
  submitRecordingForApproval,
} from "@/server/services/recordings";
import { CORRECTION_CLIP_BUCKET, MAX_CORRECTION_CLIP_BYTES, type ObjectStorage } from "@/server/storage/object-storage";
import { createSupabaseObjectStorage } from "@/server/storage/supabase-storage";
import { buildM4a } from "../support/m4a";

// ============================================================================================
// REAL development Supabase verification of the recording & correction media policy
// (A66–A100). Test accounts only (@example.com, unique run tag); everything is removed in
// afterAll EXCEPT audit_events, which are append-only by design: the rows this run creates are
// counted and printed so they can be documented.
// Full recordings use DB-only media rows and a stub signer: the `recordings` bucket is
// deliberately NOT created (capture is not authorized).
// ============================================================================================

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};
const URL_ = env("NEXT_PUBLIC_SUPABASE_URL");
const PUBLISHABLE = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const RUN = randomUUID().slice(0, 8);
const email = (who: string) => `elimu-dev-${RUN}-m-${who}@example.com`;

const admin = createClient(URL_, env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const sql = new pg.Client({ connectionString: env("DIRECT_URL"), ssl: { rejectUnauthorized: false } });
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env("DIRECT_URL"), ssl: { rejectUnauthorized: false } }),
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
});
const storage = createSupabaseObjectStorage();
/** Signer for DB-only recording media (no recordings bucket exists). Authorization runs first. */
const recordingSigner: ObjectStorage = {
  ...storage,
  createSignedDownloadUrl: async (_b, key) => ({ url: `stub://recordings/${key}` }),
};

const ROLES = [
  "superAdmin", "adminA", "adminA2", "adminB", "teacherA", "teacherAB",
  "studentX", "studentZ", "studentAdult", "studentLeft", "studentY", "parentActive", "parentVerified",
] as const;
type Who = (typeof ROLES)[number];
const ID = {} as Record<Who, string>;
const T = { A: "", B: "" };
const sessions = {} as Partial<Record<Who, SupabaseClient>>;
const created = { users: [] as string[], tenants: [] as string[], objects: [] as string[] };
const startedAt = new Date();
const MINOR_DOB = "2015-03-01";
const ADULT_DOB = "1995-03-01";
const correctionIds: Record<string, string> = {};

const actorOf = async (who: Who): Promise<Actor> => (await loadActor(db, ID[who]))!;

async function signIn(address: string): Promise<SupabaseClient> {
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

/** Owner-path verified DOB: entered by the student, verified by adminA (A82/A93). */
async function verifiedDob(who: Who, dob: string) {
  await sql.query(
    `UPDATE student_accounts SET date_of_birth = $2, date_of_birth_entered_by_id = $1, date_of_birth_entered_at = now(),
       date_of_birth_verified_by_id = $3, date_of_birth_verified_at = now() WHERE profile_id = $1`,
    [ID[who], dob, ID.adminA],
  );
}

async function putM4a(clipId: string, uploadUrl: string, bytes: Uint8Array, contentType = "audio/mp4") {
  const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
  created.objects.push(clip.storageObjectKey);
  return fetch(uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: new Blob([bytes as BlobPart]) });
}

/** A finalized clip on correction `key` made by `teacher`. */
async function finalizedClip(key: string, teacher: Who, durationMs = 2000) {
  const t = await actorOf(teacher);
  const { clipId, uploadUrl } = await registerDirectCaptureClip(db, storage, t, { correctionId: correctionIds[key], mimeType: "audio/mp4" });
  const put = await putM4a(clipId, uploadUrl, buildM4a({ durationMs }));
  expect(put.ok).toBe(true);
  await finalizeDirectCaptureClip(db, storage, t, { clipId });
  return clipId;
}

beforeAll(async () => {
  await sql.connect();
  const { rows } = await sql.query(`SELECT count(*)::int AS n FROM auth.users WHERE email NOT LIKE 'elimu-dev-%@example.com'`);
  if (rows[0].n > 0) throw new Error(`Refusing to run: ${rows[0].n} non-test auth users present`);

  for (const who of ROLES) {
    const { data, error } = await admin.auth.admin.createUser({ email: email(who), email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${who}: ${error?.message}`);
    ID[who] = data.user.id;
    created.users.push(data.user.id);
  }
  const t = await sql.query(`INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`, [
    `Media Dev A ${RUN}`, `media-a-${RUN}`, `Media Dev B ${RUN}`, `media-b-${RUN}`,
  ]);
  T.A = t.rows[0].id;
  T.B = t.rows[1].id;
  created.tenants.push(T.A, T.B);

  await sql.query(`INSERT INTO platform_admins (profile_id) VALUES ($1)`, [ID.superAdmin]);
  const m = (tenant: string, who: Who, role: string, status = "ACTIVE") =>
    sql.query(
      `INSERT INTO memberships (tenant_id, profile_id, role, status, ended_at) VALUES ($1, $2, $3::"TenantRole", $4::"MembershipStatus", CASE WHEN $4 = 'ENDED' THEN now() END)`,
      [tenant, ID[who], role, status],
    );
  await m(T.A, "adminA", "MARKAZ_ADMIN");
  await m(T.A, "adminA2", "MARKAZ_ADMIN");
  await m(T.A, "adminA2", "TEACHER");
  await m(T.B, "adminB", "MARKAZ_ADMIN");
  await m(T.A, "teacherA", "TEACHER");
  await m(T.A, "teacherAB", "TEACHER");
  await m(T.B, "teacherAB", "TEACHER");
  for (const s of ["studentX", "studentZ", "studentAdult", "studentLeft", "studentY"] as const) {
    await sql.query(`INSERT INTO student_accounts (profile_id) VALUES ($1)`, [ID[s]]);
  }
  await m(T.A, "studentX", "STUDENT");
  await m(T.B, "studentX", "STUDENT");
  await m(T.A, "studentZ", "STUDENT");
  await m(T.B, "studentZ", "STUDENT");
  await m(T.A, "studentAdult", "STUDENT");
  await m(T.A, "studentLeft", "STUDENT");
  await m(T.B, "studentY", "STUDENT");
  for (const p of ["parentActive", "parentVerified"] as const) await sql.query(`INSERT INTO parent_accounts (profile_id) VALUES ($1)`, [ID[p]]);
  const link = (parent: Who, student: Who, status: string) =>
    sql.query(
      `INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id, status, requested_by_id, verified_by_id, verified_at, activated_by_id, activated_at)
       VALUES ($1, $2, $3, $4::"ParentStudentLinkStatus", $1, $5, now(), $6, CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() END)`,
      [ID[parent], ID[student], T.A, status, ID.adminA, status === "ACTIVE" ? ID.adminA : null],
    );
  await link("parentActive", "studentX", "ACTIVE");
  await link("parentActive", "studentLeft", "ACTIVE");
  await link("parentVerified", "studentX", "VERIFIED");

  for (const who of ["studentX", "studentLeft", "adminA", "adminB", "parentActive", "parentVerified", "superAdmin"] as const) {
    sessions[who] = await signIn(email(who));
  }
}, 300_000);

afterAll(async () => {
  try {
    // Document the permanent audit rows this run created (append-only; never deleted).
    const audit = await sql.query(
      `SELECT action, count(*)::int AS n FROM audit_events WHERE created_at >= $1 AND (tenant_id = ANY($2) OR actor_id = ANY($3)) GROUP BY 1 ORDER BY 1`,
      [startedAt, created.tenants, created.users],
    );
    console.log(`[media-dev ${RUN}] permanent audit rows created:`, JSON.stringify(audit.rows));

    if (created.objects.length) await admin.storage.from(CORRECTION_CLIP_BUCKET).remove(created.objects);
    const t = created.tenants;
    const u = created.users;
    if (t.length) {
      for (const q of [
        `DELETE FROM media_deletion_requests WHERE tenant_id = ANY($1)`,
        `DELETE FROM recording_segments WHERE tenant_id = ANY($1)`,
        `DELETE FROM recording_participants WHERE tenant_id = ANY($1)`,
        `DELETE FROM correction_audio_clips WHERE tenant_id = ANY($1)`,
        `DELETE FROM correction_anchors WHERE tenant_id = ANY($1)`,
        `DELETE FROM corrections WHERE tenant_id = ANY($1)`,
        `DELETE FROM recordings WHERE tenant_id = ANY($1)`,
        `DELETE FROM recording_entitlements WHERE tenant_id = ANY($1)`,
        `DELETE FROM recording_consents WHERE tenant_id = ANY($1)`,
        `DELETE FROM parent_student_links WHERE tenant_id = ANY($1)`,
        `DELETE FROM memberships WHERE tenant_id = ANY($1)`,
      ]) await sql.query(q, [t]);
    }
    if (u.length) {
      await sql.query(`DELETE FROM recording_consents WHERE student_profile_id = ANY($1)`, [u]);
      await sql.query(`DELETE FROM parent_student_links WHERE parent_profile_id = ANY($1) OR student_profile_id = ANY($1)`, [u]);
      for (const table of ["platform_admins", "student_accounts", "parent_accounts"]) await sql.query(`DELETE FROM ${table} WHERE profile_id = ANY($1)`, [u]);
    }
    if (t.length) await sql.query(`DELETE FROM tenants WHERE id = ANY($1)`, [t]);
    if (u.length) {
      await sql.query(`DELETE FROM profiles WHERE id = ANY($1)`, [u]);
      for (const id of u) await admin.auth.admin.deleteUser(id);
    }
  } finally {
    await sql.end();
    await db.$disconnect();
  }
}, 300_000);

// ---------------------------------------------------------------------------------------
describe("correction-clips bucket on real Supabase", () => {
  it("is private, accepts only audio/mp4, and limits files to 10,485,760 bytes", async () => {
    const { data, error } = await admin.storage.getBucket(CORRECTION_CLIP_BUCKET);
    expect(error).toBeNull();
    expect(data).toMatchObject({ public: false, allowed_mime_types: ["audio/mp4"], file_size_limit: MAX_CORRECTION_CLIP_BYTES });
  });
});

describe("DOB / consent on real Supabase", () => {
  it("unverified DOB fails eligibility; the admin who entered it cannot verify; a second admin can", async () => {
    await enterDateOfBirth(db, await actorOf("studentAdult"), { studentProfileId: ID.studentAdult, dateOfBirth: ADULT_DOB });
    expect(await getRecordingEligibility(db, ID.studentAdult, T.A)).toMatchObject({ eligibility: "DATE_OF_BIRTH_UNVERIFIED" });
    // Simulate the DOB having been entered by adminA (e.g. as a guardian).
    await sql.query(`UPDATE student_accounts SET date_of_birth_entered_by_id = $2 WHERE profile_id = $1`, [ID.studentAdult, ID.adminA]);
    await expect(verifyDateOfBirth(db, await actorOf("adminA"), { tenantId: T.A, studentProfileId: ID.studentAdult, dateOfBirth: ADULT_DOB })).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(
      sql.query(`UPDATE student_accounts SET date_of_birth_verified_by_id = date_of_birth_entered_by_id, date_of_birth_verified_at = now() WHERE profile_id = $1`, [ID.studentAdult]),
    ).rejects.toThrow(/student_dob_not_self_verified/);
    await verifyDateOfBirth(db, await actorOf("adminA2"), { tenantId: T.A, studentProfileId: ID.studentAdult, dateOfBirth: ADULT_DOB });
  });

  it("adult self-consent works", async () => {
    await giveOwnConsent(db, await actorOf("studentAdult"));
    expect(await getRecordingEligibility(db, ID.studentAdult, T.A)).toMatchObject({ eligible: true });
  });

  it("minor ACTIVE-guardian consent works in every Markaz; offline consent only in its own Markaz", async () => {
    await verifiedDob("studentX", MINOR_DOB);
    await giveGuardianConsent(db, await actorOf("parentActive"), { studentProfileId: ID.studentX });
    expect(await getRecordingEligibility(db, ID.studentX, T.A)).toMatchObject({ eligible: true });
    expect(await getRecordingEligibility(db, ID.studentX, T.B)).toMatchObject({ eligible: true });

    await verifiedDob("studentZ", MINOR_DOB);
    await recordOfflineConsent(db, await actorOf("adminA"), { tenantId: T.A, studentProfileId: ID.studentZ, consenterDescription: "Test guardian", evidenceReference: `TEST-${RUN}` });
    expect(await getRecordingEligibility(db, ID.studentZ, T.A)).toMatchObject({ eligible: true });
    expect(await getRecordingEligibility(db, ID.studentZ, T.B)).toMatchObject({ eligible: false, eligibility: "NO_CONSENT" });
  });
});

describe("correction media on real Supabase", () => {
  it("setup: corrections in Markaz A and B for the same child; one for a departing student", async () => {
    correctionIds.xA = await createCorrection(db, await actorOf("teacherA"), { tenantId: T.A, studentProfileId: ID.studentX, note: "A", anchors: [{ kind: "PAGE", snapshot: { label: "p1" } }] });
    correctionIds.xB = await createCorrection(db, await actorOf("teacherAB"), { tenantId: T.B, studentProfileId: ID.studentX, note: "B" });
    correctionIds.left = await createCorrection(db, await actorOf("teacherA"), { tenantId: T.A, studentProfileId: ID.studentLeft, note: "L" });
  });

  it("signed upload → server M4A inspection → finalize → signed playback; denied callers get no URL", async () => {
    const clipId = await finalizedClip("xA", "teacherA");
    for (const who of ["studentX", "teacherA", "adminA", "parentActive"] as const) {
      const { url } = await getClipPlaybackUrl(db, storage, await actorOf(who), clipId);
      expect((await fetch(url)).status, who).toBe(200);
    }
    for (const who of ["adminB", "parentVerified", "studentY", "teacherAB"] as const) {
      await expect(getClipPlaybackUrl(db, storage, await actorOf(who), clipId), who).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("exactly 10,485,760 bytes is accepted end to end; one byte more is refused by the bucket", async () => {
    const t = await actorOf("teacherA");
    const header = buildM4a({ durationMs: 30_000, mdatBytes: 0 }).length;
    const ok = await registerDirectCaptureClip(db, storage, t, { correctionId: correctionIds.xA, mimeType: "audio/mp4" });
    const okBytes = buildM4a({ durationMs: 30_000, mdatBytes: MAX_CORRECTION_CLIP_BYTES - header });
    expect(okBytes.length).toBe(10_485_760);
    expect((await putM4a(ok.clipId, ok.uploadUrl, okBytes)).ok).toBe(true);
    await finalizeDirectCaptureClip(db, storage, t, { clipId: ok.clipId });
    expect((await db.correctionAudioClip.findUniqueOrThrow({ where: { id: ok.clipId } })).byteSize).toBe(10_485_760);

    const big = await registerDirectCaptureClip(db, storage, t, { correctionId: correctionIds.xA, mimeType: "audio/mp4" });
    const put = await putM4a(big.clipId, big.uploadUrl, buildM4a({ durationMs: 30_000, mdatBytes: MAX_CORRECTION_CLIP_BYTES - header + 1 }));
    expect(put.ok).toBe(false);
  });

  it("the bucket refuses a non-audio/mp4 upload", async () => {
    const t = await actorOf("teacherA");
    const reg = await registerDirectCaptureClip(db, storage, t, { correctionId: correctionIds.xA, mimeType: "audio/mp4" });
    expect((await putM4a(reg.clipId, reg.uploadUrl, buildM4a({ durationMs: 1000 }), "audio/webm")).ok).toBe(false);
  });

  it("no public or direct client read of a stored clip", async () => {
    const clip = await db.correctionAudioClip.findFirstOrThrow({ where: { correctionId: correctionIds.xA, status: "FINALIZED" } });
    expect((await fetch(`${URL_}/storage/v1/object/public/${CORRECTION_CLIP_BUCKET}/${clip.storageObjectKey}`)).ok).toBe(false);
    const own = await sessions.studentX!.storage.from(CORRECTION_CLIP_BUCKET).download(clip.storageObjectKey);
    expect(own.data).toBeNull();
  });

  it("RLS through PostgREST: student, same-Markaz admin, ACTIVE parent across Markaz — nobody else (no Super Admin Data API path)", async () => {
    const ids = async (who: Who) => {
      const { data, error } = await sessions[who]!.from("corrections").select("id").in("id", [correctionIds.xA, correctionIds.xB]);
      expect(error).toBeNull();
      return (data ?? []).map((r) => r.id).sort();
    };
    expect(await ids("studentX")).toEqual([correctionIds.xA, correctionIds.xB].sort());
    expect(await ids("parentActive")).toEqual([correctionIds.xA, correctionIds.xB].sort());
    expect(await ids("adminA")).toEqual([correctionIds.xA]);
    expect(await ids("adminB")).toEqual([correctionIds.xB]);
    expect(await ids("parentVerified")).toEqual([]);
    expect(await ids("superAdmin")).toEqual([]);
    const dob = await sessions.studentX!.from("student_accounts").select("date_of_birth");
    expect(dob.error?.code).toBe("42501");
  });

  it("a departed student keeps their own corrections", async () => {
    await sql.query(`UPDATE memberships SET status = 'ENDED', ended_at = now() WHERE profile_id = $1 AND tenant_id = $2`, [ID.studentLeft, T.A]);
    expect((await listStudentCorrections(db, await actorOf("studentLeft"), ID.studentLeft)).map((c) => c.id)).toEqual([correctionIds.left]);
    const { data } = await sessions.studentLeft!.from("corrections").select("id");
    expect((data ?? []).map((r) => r.id)).toEqual([correctionIds.left]);
  });

  it("a Super Admin plays a clip only through the audited server path (one permanent audit row)", async () => {
    const clip = await db.correctionAudioClip.findFirstOrThrow({ where: { correctionId: correctionIds.xA, status: "FINALIZED", deletedAt: null } });
    await getClipPlaybackUrl(db, storage, await actorOf("superAdmin"), clip.id);
    const { rows } = await sql.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'SUPER_ADMIN_MEDIA_READ' AND actor_id = $1 AND target_id = $2`, [ID.superAdmin, clip.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe("deletion workflow on real Supabase", () => {
  it("cancel by requester, decline by admin, self-approval refused, second admin approves, hidden, no early purge", async () => {
    const clipId = await finalizedClip("xA", "teacherA");
    const r1 = await requestMediaDeletion(db, await actorOf("teacherA"), { clipId });
    await cancelMediaDeletion(db, await actorOf("teacherA"), { requestId: r1 });
    const r2 = await requestMediaDeletion(db, await actorOf("teacherA"), { clipId });
    await declineMediaDeletion(db, await actorOf("adminA"), { requestId: r2, reason: "test" });
    expect((await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).deletedAt).toBeNull();

    const r3 = await requestMediaDeletion(db, await actorOf("adminA"), { clipId });
    await expect(approveMediaDeletion(db, await actorOf("adminA"), { requestId: r3 })).rejects.toMatchObject({ code: "second_admin_required" });
    await approveMediaDeletion(db, await actorOf("adminA2"), { requestId: r3 });
    await expect(getClipPlaybackUrl(db, storage, await actorOf("studentX"), clipId)).rejects.toMatchObject({ code: "invalid_state" });

    const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
    expect(await purgeExpiredMedia(db, storage, { now: new Date() })).toBe(0); // grace period not over
    expect((await storage.statObject(clip.storageBucket, clip.storageObjectKey)).exists).toBe(true);
  });
});

describe("Option C on real Supabase", () => {
  it("request → cancel → request → decline → request → enable → disable (history kept) → re-request (new cycle, no auto-enable) → enable", async () => {
    const admin_ = await actorOf("adminA");
    const sa = await actorOf("superAdmin");
    await requestOptionC(db, admin_, { tenantId: T.A });
    await cancelOptionCRequest(db, admin_, { tenantId: T.A });
    await requestOptionC(db, admin_, { tenantId: T.A });
    await declineOptionC(db, sa, { tenantId: T.A });
    await requestOptionC(db, admin_, { tenantId: T.A });
    await enableOptionC(db, sa, { tenantId: T.A });
    const teacher = await actorOf("teacherA");
    const before = await createRecording(db, teacher, { tenantId: T.A, title: "before disable" });
    await disableOptionC(db, sa, { tenantId: T.A });
    await expect(createRecording(db, teacher, { tenantId: T.A })).rejects.toMatchObject({ code: "feature_not_enabled" });
    await expect(startRecording(db, teacher, { recordingId: before, noticeShown: true, teacherNoticeAcknowledged: true })).rejects.toMatchObject({ code: "feature_not_enabled" });
    expect(await db.recording.findUnique({ where: { id: before } })).not.toBeNull();
    await requestOptionC(db, admin_, { tenantId: T.A });
    expect(await getOptionCStatus(db, T.A)).toBe("PENDING");
    await expect(createRecording(db, teacher, { tenantId: T.A })).rejects.toMatchObject({ code: "feature_not_enabled" });
    await enableOptionC(db, sa, { tenantId: T.A });
    expect(await getOptionCStatus(db, T.A)).toBe("ENABLED");
  });
});

describe("full recordings on real Supabase (DB-only media)", () => {
  /** A finished, started recording (author `teacher`) with the given participants registered now. */
  async function recordingWith(teacher: Who, students: Who[]) {
    const a = await actorOf(teacher);
    const id = await createRecording(db, a, { tenantId: T.A });
    await startRecording(db, a, { recordingId: id, noticeShown: true, teacherNoticeAcknowledged: true });
    await registerRecordingParticipants(db, a, { recordingId: id, studentProfileIds: students.map((s) => ID[s]) });
    await sql.query(
      `UPDATE recordings SET storage_bucket = 'recordings', storage_object_key = 'recordings/test-' || id, byte_size = 1, duration_ms = 60000, media_finalized_at = now() WHERE id = $1`,
      [id],
    );
    return id;
  }
  const play = async (who: Who, recordingId: string) => getRecordingPlaybackUrl(db, recordingSigner, await actorOf(who), { recordingId });

  it("a Markaz Admin author approves and rejects their own recordings; an ordinary teacher cannot approve", async () => {
    const author = await actorOf("adminA2");
    const r1 = await recordingWith("adminA2", ["studentX"]);
    await submitRecordingForApproval(db, author, { recordingId: r1 });
    await expect(approveRecording(db, await actorOf("teacherA"), { recordingId: r1, scope: "WHOLE" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(approveRecording(db, await actorOf("adminB"), { recordingId: r1, scope: "WHOLE" })).rejects.toBeInstanceOf(AuthorizationError);
    await approveRecording(db, author, { recordingId: r1, scope: "WHOLE" });
    const r2 = await recordingWith("adminA2", ["studentX"]);
    await submitRecordingForApproval(db, author, { recordingId: r2 });
    await rejectRecording(db, author, { recordingId: r2 });
    expect((await db.recording.findUniqueOrThrow({ where: { id: r2 } })).status).toBe("REJECTED");
  });

  it("parent and student visibility: consent valid AT CAPTURE; later withdrawal → still visible + review; departed student denied", async () => {
    // studentLeft re-joins Markaz A for this scenario, still WITHOUT consent (invalid at capture).
    await sql.query(`UPDATE memberships SET status = 'ACTIVE', ended_at = NULL WHERE profile_id = $1 AND tenant_id = $2`, [ID.studentLeft, T.A]);
    const id = await recordingWith("teacherA", ["studentX", "studentZ", "studentLeft"]);
    await submitRecordingForApproval(db, await actorOf("teacherA"), { recordingId: id });
    await approveRecording(db, await actorOf("adminA"), { recordingId: id, scope: "WHOLE" });
    const included = Object.fromEntries(
      (await db.recordingParticipant.findMany({ where: { recordingId: id } })).map((p) => [p.studentProfileId, p.audioIncluded]),
    );
    expect(included).toEqual({ [ID.studentX]: true, [ID.studentZ]: true, [ID.studentLeft]: false });

    await play("parentActive", id);
    await play("studentX", id);
    await play("studentZ", id);
    await expect(play("parentVerified", id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(play("studentY", id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(play("studentLeft", id)).rejects.toBeInstanceOf(AuthorizationError); // no consent at capture

    // A99: once studentZ leaves Markaz A, that Markaz's full recordings are denied to them.
    await sql.query(`UPDATE memberships SET status = 'ENDED', ended_at = now() WHERE profile_id = $1 AND tenant_id = $2`, [ID.studentZ, T.A]);
    await expect(play("studentZ", id)).rejects.toBeInstanceOf(AuthorizationError);

    // A95: later withdrawal does not hide history; it goes to review and blocks future capture.
    const consent = await db.recordingConsent.findFirstOrThrow({ where: { studentProfileId: ID.studentX, method: "GUARDIAN_ONLINE", withdrawnAt: null } });
    await withdrawConsent(db, await actorOf("parentActive"), { consentId: consent.id });
    await play("parentActive", id);
    await play("studentX", id);
    expect(await db.mediaDeletionRequest.count({ where: { recordingId: id, reason: "CONSENT_WITHDRAWN", status: "PENDING" } })).toBe(1);
    await expect(registerDirectCaptureClip(db, storage, await actorOf("teacherA"), { correctionId: correctionIds.xA, mimeType: "audio/mp4" })).rejects.toMatchObject({
      code: "consent_required",
    });
  });

  it("consent invalid at capture → never visible, even to an ACTIVE guardian of that child", async () => {
    const lone = await recordingWith("teacherA", ["studentLeft"]);
    await submitRecordingForApproval(db, await actorOf("teacherA"), { recordingId: lone });
    await approveRecording(db, await actorOf("adminA"), { recordingId: lone, scope: "WHOLE" });
    await expect(play("parentActive", lone)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(play("studentLeft", lone)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
