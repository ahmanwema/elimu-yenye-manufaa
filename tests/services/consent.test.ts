import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import {
  enterDateOfBirth,
  getMyConsent,
  getRecordingEligibility,
  giveGuardianConsent,
  giveOwnConsent,
  listMyChildrenConsent,
  listTenantConsentOverview,
  recordOfflineConsent,
  verifyDateOfBirth,
  withdrawConsent,
} from "@/server/services/consent";
import { finalizeDirectCaptureClip, getClipPlaybackUrl, registerDirectCaptureClip } from "@/server/services/correction-audio";
import { createRecording, getCapturePlan, registerRecordingParticipants } from "@/server/services/recordings";
import { actor, createTestPrisma, FakeStorage } from "../db/prisma";
import { T, U } from "../support/fixture";
import { ADULT_DOB, enableOptionCFor, insertCorrection, M, MINOR_DOB, seedMedia, setDob, uploadM4a } from "../support/media";

let pg: PGlite;
let db: PrismaClient;
let storage: FakeStorage;
const NOW = new Date("2026-10-14T12:00:00Z");
const O = { now: NOW };

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
  storage = new FakeStorage();
});

const dobOf = (id: string) => db.studentAccount.findUniqueOrThrow({ where: { profileId: id } });

describe("date of birth: entered by student or guardian, verified by a Markaz Admin (A82)", () => {
  it("the student or an ACTIVE guardian enters it; it starts unverified; the value is never audited", async () => {
    await enterDateOfBirth(db, await actor(db, U.studentX), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    expect(await dobOf(U.studentX)).toMatchObject({ dateOfBirthEnteredById: U.studentX, dateOfBirthVerifiedAt: null });
    await enterDateOfBirth(db, await actor(db, U.parentActive), { studentProfileId: U.studentX, dateOfBirth: "2015-03-02" }, O);
    expect(await dobOf(U.studentX)).toMatchObject({ dateOfBirthEnteredById: U.parentActive });
    const audit = await db.auditEvent.findMany({ where: { action: "DATE_OF_BIRTH_RECORDED" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("2015");
  });

  it.each([
    ["a VERIFIED parent", U.parentVerified],
    ["a Markaz Admin (verifies, does not enter)", U.adminA],
    ["a teacher", U.teacherA],
    ["another student", U.studentY],
    ["a Super Admin", U.superAdmin],
  ])("%s may not enter it", async (_l, who) => {
    await expect(enterDateOfBirth(db, await actor(db, who), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("only a Markaz Admin of the student's Markaz verifies — and only the value they saw", async () => {
    await enterDateOfBirth(db, await actor(db, U.parentActive), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    const input = { tenantId: T.A, studentProfileId: U.studentX, dateOfBirth: MINOR_DOB };
    for (const who of [U.teacherA, U.parentActive, U.studentX, U.superAdmin]) {
      await expect(verifyDateOfBirth(db, await actor(db, who), input, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await expect(verifyDateOfBirth(db, await actor(db, U.adminB), { ...input, tenantId: T.A }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(verifyDateOfBirth(db, await actor(db, U.adminA), { ...input, dateOfBirth: "2014-01-01" }, O)).rejects.toMatchObject({ code: "invalid_state" });
    await verifyDateOfBirth(db, await actor(db, U.adminA), input, O);
    expect(await dobOf(U.studentX)).toMatchObject({ dateOfBirthVerifiedById: U.adminA, dateOfBirthVerifiedAt: NOW });
    expect(await db.auditEvent.count({ where: { action: "DATE_OF_BIRTH_VERIFIED", actorId: U.adminA, tenantId: T.A } })).toBe(1);
  });

  it("re-entering a DOB clears the verification (fail closed until verified again)", async () => {
    await setDob(pg, U.studentX, MINOR_DOB);
    await enterDateOfBirth(db, await actor(db, U.studentX), { studentProfileId: U.studentX, dateOfBirth: "2015-04-01" }, O);
    expect((await dobOf(U.studentX)).dateOfBirthVerifiedAt).toBeNull();
  });

  it("a student- or guardian-entered DOB is verified by an admin; the database refuses self-verification", async () => {
    await enterDateOfBirth(db, await actor(db, U.studentX), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    await verifyDateOfBirth(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    await expect(
      pg.query("UPDATE student_accounts SET date_of_birth_verified_by_id = date_of_birth_entered_by_id WHERE profile_id = $1", [U.studentX]),
    ).rejects.toThrow(/student_dob_not_self_verified/);
  });

  it("A93 with a single admin: their own entry stays unverified and the overview says why", async () => {
    // Markaz B has exactly one admin (adminB), here also an ACTIVE guardian of studentY.
    await pg.query("INSERT INTO parent_accounts (profile_id) VALUES ($1)", [U.adminB]);
    await pg.query(
      `INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id, status, requested_by_id, verified_by_id, verified_at, activated_by_id, activated_at)
       VALUES ($1, $2, $3, 'ACTIVE', $1, $1, now(), $1, now())`,
      [U.adminB, U.studentY, T.B],
    );
    await enterDateOfBirth(db, await actor(db, U.adminB), { studentProfileId: U.studentY, dateOfBirth: MINOR_DOB }, O);
    await expect(verifyDateOfBirth(db, await actor(db, U.adminB), { tenantId: T.B, studentProfileId: U.studentY, dateOfBirth: MINOR_DOB }, O)).rejects.toMatchObject({
      code: "invalid_state",
    });
    const row = (await listTenantConsentOverview(db, await actor(db, U.adminB), T.B, O)).find((s) => s.studentProfileId === U.studentY);
    expect(row).toMatchObject({ dateOfBirthState: "PENDING_VERIFICATION", enteredByMe: true, noOtherVerifier: true });
    expect(await getRecordingEligibility(db, U.studentY, T.B, O)).toMatchObject({ eligible: false, eligibility: "DATE_OF_BIRTH_UNVERIFIED" });
  });

  it("A93: an admin who entered the DOB (as a guardian) cannot verify it; a second admin can", async () => {
    // adminA2 is also an ACTIVE guardian of studentX in this scenario.
    await pg.query("INSERT INTO parent_accounts (profile_id) VALUES ($1)", [M.adminA2]);
    await pg.query(
      `INSERT INTO parent_student_links (parent_profile_id, student_profile_id, tenant_id, status, requested_by_id, verified_by_id, verified_at, activated_by_id, activated_at)
       VALUES ($1, $2, $3, 'ACTIVE', $1, $4, now(), $4, now())`,
      [M.adminA2, U.studentX, T.A, U.adminA],
    );
    await enterDateOfBirth(db, await actor(db, M.adminA2), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    await expect(verifyDateOfBirth(db, await actor(db, M.adminA2), { tenantId: T.A, studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O)).rejects.toMatchObject({
      code: "invalid_state",
    });
    await verifyDateOfBirth(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
  });

  it("rejects future, implausible and malformed dates", async () => {
    const a = await actor(db, U.studentX);
    for (const dateOfBirth of ["2027-01-01", "1850-01-01", "14/10/2015"]) {
      await expect(enterDateOfBirth(db, a, { studentProfileId: U.studentX, dateOfBirth }, O)).rejects.toMatchObject({ code: "invalid_input" });
    }
  });

  it("unverified DOB fails eligibility; verification enables the downstream checks", async () => {
    await setDob(pg, U.studentX, MINOR_DOB, false);
    await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toEqual({ eligible: false, eligibility: "DATE_OF_BIRTH_UNVERIFIED" });
    await verifyDateOfBirth(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: true });
  });

  it("the Markaz Admin sees the DOB value only while it awaits verification", async () => {
    await enterDateOfBirth(db, await actor(db, U.studentX), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    const before = (await listTenantConsentOverview(db, await actor(db, U.adminA), T.A, O)).find((s) => s.studentProfileId === U.studentX);
    expect(before).toMatchObject({ dateOfBirthState: "PENDING_VERIFICATION", dateOfBirthToVerify: MINOR_DOB, enteredByMe: false });
    await verifyDateOfBirth(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, O);
    const after = (await listTenantConsentOverview(db, await actor(db, U.adminA), T.A, O)).find((s) => s.studentProfileId === U.studentX);
    expect(after).toMatchObject({ dateOfBirthState: "VERIFIED", minorStatus: "MINOR", dateOfBirthToVerify: null });
  });
});

describe("minor consent (A71, A83)", () => {
  beforeEach(() => setDob(pg, U.studentX, MINOR_DOB));

  it("a minor without consent cannot be recorded; an ACTIVE guardian's consent makes them eligible everywhere", async () => {
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
    const id = await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toEqual({ eligible: true, eligibility: "CONSENTED", consentId: id });
    expect(await getRecordingEligibility(db, U.studentX, T.B, O)).toMatchObject({ eligible: true });
    expect(await db.auditEvent.count({ where: { action: "CONSENT_GIVEN", targetId: id } })).toBe(1);
  });

  it("non-ACTIVE guardians and others cannot consent; twice is a conflict", async () => {
    for (const who of [U.parentVerified, U.parentPendingA, U.parentRevoked, U.parentUnlinked, U.studentX, U.adminA, U.superAdmin]) {
      await expect(giveGuardianConsent(db, await actor(db, who), { studentProfileId: U.studentX }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    await expect(giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O)).rejects.toMatchObject({ code: "conflict" });
  });

  it("guardian consent stops counting when that guardian's link is no longer ACTIVE", async () => {
    await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    await pg.query("UPDATE parent_student_links SET status = 'REVOKED', revoked_by_id = parent_profile_id, revoked_at = now() WHERE parent_profile_id = $1", [U.parentActive]);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: false, eligibility: "NO_CONSENT" });
  });

  it("a Markaz Admin records VERIFIED OFFLINE consent (who, evidence reference, verifier, when) — valid in that Markaz only", async () => {
    const id = await recordOfflineConsent(
      db,
      await actor(db, U.adminA),
      { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "Mother — A. Hassan", evidenceReference: "Form 2026/117" },
      O,
    );
    expect(await db.recordingConsent.findUniqueOrThrow({ where: { id } })).toMatchObject({
      method: "OFFLINE_VERIFIED",
      tenantId: T.A,
      recordedById: U.adminA,
      offlineConsenterDescription: "Mother — A. Hassan",
      evidenceReference: "Form 2026/117",
      grantedAt: NOW,
    });
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: true, consentId: id });
    expect(await getRecordingEligibility(db, U.studentX, T.B, O)).toMatchObject({ eligible: false });
    for (const who of [U.adminB, U.teacherA, U.superAdmin, U.parentActive]) {
      await expect(recordOfflineConsent(db, await actor(db, who), { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "x", evidenceReference: "y" }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("an ACTIVE guardian withdraws a minor's consent (guardian or offline); others cannot", async () => {
    const online = await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    const offline = await recordOfflineConsent(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "x", evidenceReference: "y" }, O);
    for (const who of [U.parentVerified, U.adminA, U.teacherA, U.superAdmin, U.studentX]) {
      await expect(withdrawConsent(db, await actor(db, who), { consentId: online }, O)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(withdrawConsent(db, await actor(db, who), { consentId: offline }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await withdrawConsent(db, await actor(db, U.parentActive), { consentId: online }, O);
    await withdrawConsent(db, await actor(db, U.parentActive), { consentId: offline }, O);
    await expect(withdrawConsent(db, await actor(db, U.parentActive), { consentId: online }, O)).rejects.toMatchObject({ code: "invalid_state" });
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: false, eligibility: "NO_CONSENT" });
  });
});

describe("adult consent (A83)", () => {
  beforeEach(() => setDob(pg, U.studentX, ADULT_DOB));

  it("an adult gives their own consent and becomes eligible; a guardian cannot substitute", async () => {
    await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: false, eligibility: "NO_CONSENT" });
    const id = await giveOwnConsent(db, await actor(db, U.studentX), O);
    expect(await db.recordingConsent.findUniqueOrThrow({ where: { id } })).toMatchObject({ method: "SELF_ONLINE", recordedById: U.studentX, guardianProfileId: null, tenantId: null });
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: true, consentId: id });
    await expect(giveOwnConsent(db, await actor(db, U.studentX), O)).rejects.toMatchObject({ code: "conflict" });
    expect((await getMyConsent(db, await actor(db, U.studentX), O))?.consents.map((c) => c.method).sort()).toEqual(["GUARDIAN_ONLINE", "SELF_ONLINE"]);
  });

  it("own consent can be given during enrollment (before verification) and counts once the DOB is verified", async () => {
    await setDob(pg, U.studentX, ADULT_DOB, false);
    await giveOwnConsent(db, await actor(db, U.studentX), O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligibility: "DATE_OF_BIRTH_UNVERIFIED" });
    await verifyDateOfBirth(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, dateOfBirth: ADULT_DOB }, O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: true });
  });

  it("a VERIFIED minor cannot self-consent; a non-student cannot either", async () => {
    await setDob(pg, U.studentX, MINOR_DOB);
    await expect(giveOwnConsent(db, await actor(db, U.studentX), O)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(giveOwnConsent(db, await actor(db, U.parentActive), O)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("only the adult withdraws their own consent; withdrawal blocks future capture", async () => {
    const id = await giveOwnConsent(db, await actor(db, U.studentX), O);
    for (const who of [U.parentActive, U.adminA, U.teacherA, U.superAdmin]) {
      await expect(withdrawConsent(db, await actor(db, who), { consentId: id }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await withdrawConsent(db, await actor(db, U.studentX), { consentId: id }, O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligible: false, eligibility: "NO_CONSENT" });
    const correctionId = await insertCorrection(pg, T.A, U.studentX, U.teacherA);
    await expect(registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId, mimeType: "audio/mp4" }, O)).rejects.toMatchObject({ code: "consent_required" });
    expect(await db.auditEvent.count({ where: { action: "CONSENT_WITHDRAWN", actorId: U.studentX } })).toBe(1);
  });
});

describe("withdrawal (A72): future capture blocked; existing media goes to review, nothing is deleted", () => {
  async function setupWithClip() {
    await setDob(pg, U.studentX, MINOR_DOB);
    const consentId = await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    const correctionId = await insertCorrection(pg, T.A, U.studentX, U.teacherA);
    const teacher = await actor(db, U.teacherA);
    const { clipId } = await registerDirectCaptureClip(db, storage, teacher, { correctionId, mimeType: "audio/mp4" }, O);
    await uploadM4a(db, storage, clipId);
    await finalizeDirectCaptureClip(db, storage, teacher, { clipId }, O);
    return { consentId, correctionId, clipId };
  }

  it("withdrawing blocks new clips and flags existing ones for Markaz Admin review", async () => {
    const { consentId, correctionId, clipId } = await setupWithClip();
    expect(await withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O)).toBe(1);
    await expect(registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId, mimeType: "audio/mp4" }, O)).rejects.toMatchObject({ code: "consent_required" });
    expect(await db.mediaDeletionRequest.findMany()).toEqual([expect.objectContaining({ clipId, reason: "CONSENT_WITHDRAWN", consentId, status: "PENDING", tenantId: T.A })]);
    expect((await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).deletedAt).toBeNull();
    expect(storage.deleted).toEqual([]);
    await getClipPlaybackUrl(db, storage, await actor(db, U.studentX), clipId);
  });

  it("media stays out of review in a Markaz where another valid consent still applies", async () => {
    const { consentId } = await setupWithClip();
    await recordOfflineConsent(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "x", evidenceReference: "y" }, O);
    expect(await withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O)).toBe(0);
  });
});

describe("live participation is separate from recording eligibility (A72)", () => {
  it("a student without consent is a participant, but their audio is excluded from recorded media", async () => {
    await enableOptionCFor(pg, T.A);
    await setDob(pg, U.studentX, MINOR_DOB);
    const teacher = await actor(db, U.teacherA);
    const recordingId = await createRecording(db, teacher, { tenantId: T.A }, O);
    await registerRecordingParticipants(db, teacher, { recordingId, studentProfileIds: [U.studentX] }, O);
    expect(await getCapturePlan(db, teacher, { recordingId })).toEqual([{ studentProfileId: U.studentX, includeAudio: false, eligibility: "NO_CONSENT" }]);

    await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    const second = await createRecording(db, teacher, { tenantId: T.A }, O);
    await registerRecordingParticipants(db, teacher, { recordingId: second, studentProfileIds: [U.studentX] }, O);
    expect(await getCapturePlan(db, teacher, { recordingId: second })).toEqual([{ studentProfileId: U.studentX, includeAudio: true, eligibility: "CONSENTED" }]);
  });

  it("nothing in the live-class/mic path consults recording consent", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
    const users = files(join(process.cwd(), "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("generated"))
      .filter((f) => /\b(get|require)RecordingEligibility\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), "").replace(/\\/g, "/"));
    // 2026-10-19: session-recording.ts (Live Class ↔ Option C, A125) evaluates consent to decide
    // whether a participant's AUDIO enters the recording — never whether they may join.
    expect(users.sort()).toEqual([
      "/src/server/services/consent.ts",
      "/src/server/services/correction-audio.ts",
      "/src/server/services/recordings.ts",
      "/src/server/services/session-recording.ts",
    ]);
    // The live session / join / mic module never consults consent itself, and the recording
    // integration only uses the NON-throwing check, so consent can never block live participation.
    const read = (p: string) => readFileSync(join(process.cwd(), ...p.split("/")), "utf8");
    expect(read("src/server/services/live-sessions.ts")).not.toMatch(/\b(get|require)RecordingEligibility\b/);
    expect(read("src/server/services/session-recording.ts")).not.toMatch(/\brequireRecordingEligibility\b/);
  });

  it("the guardian's view shows the DOB state and derived status", async () => {
    await setDob(pg, U.studentX, MINOR_DOB, false);
    expect((await listMyChildrenConsent(db, await actor(db, U.parentActive), O))[0]).toMatchObject({ dateOfBirthState: "PENDING_VERIFICATION" });
    await setDob(pg, U.studentX, MINOR_DOB);
    expect((await listMyChildrenConsent(db, await actor(db, U.parentActive), O))[0]).toMatchObject({ dateOfBirthState: "VERIFIED", minorStatus: "MINOR" });
  });
});
