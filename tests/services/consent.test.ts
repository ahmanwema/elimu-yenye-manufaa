import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import {
  getRecordingEligibility,
  giveGuardianConsent,
  listMyChildrenConsent,
  listTenantConsentOverview,
  recordDateOfBirth,
  recordOfflineConsent,
  withdrawConsent,
} from "@/server/services/consent";
import { finalizeDirectCaptureClip, getClipPlaybackUrl, registerDirectCaptureClip } from "@/server/services/correction-audio";
import { createRecording, getCapturePlan, registerRecordingParticipants } from "@/server/services/recordings";
import { actor, createTestPrisma, FakeStorage } from "../db/prisma";
import { T, U } from "../support/fixture";
import { ADULT_DOB, insertCorrection, M, MINOR_DOB, seedMedia, setDob, TEST_POLICY, uploadM4a } from "../support/media";

let pg: PGlite;
let db: PrismaClient;
let storage: FakeStorage;
const O = { policy: TEST_POLICY };
const NOW = new Date("2026-10-14T12:00:00Z");

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
  storage = new FakeStorage();
});

describe("date of birth (A70): stored; minor status derived, never stored", () => {
  it("an ACTIVE guardian or a Markaz Admin of the student's Markaz may record it — audited without the value", async () => {
    await recordDateOfBirth(db, await actor(db, U.parentActive), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, { now: NOW });
    await recordDateOfBirth(db, await actor(db, U.adminA), { studentProfileId: U.studentX, dateOfBirth: "2015-03-02" }, { now: NOW });
    const student = await db.studentAccount.findUniqueOrThrow({ where: { profileId: U.studentX } });
    expect(student.dateOfBirth?.toISOString().slice(0, 10)).toBe("2015-03-02");
    const audit = await db.auditEvent.findMany({ where: { action: "DATE_OF_BIRTH_RECORDED" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("2015");
    // There is no is_minor column: status comes from the DOB.
    expect(Object.keys(student)).not.toContain("isMinor");
  });

  it.each([
    ["a VERIFIED parent", U.parentVerified],
    ["a teacher", U.teacherA],
    ["the student", U.studentX],
    ["a Super Admin", U.superAdmin],
  ])("%s may not record it", async (_l, who) => {
    await expect(recordDateOfBirth(db, await actor(db, who), { studentProfileId: U.studentX, dateOfBirth: MINOR_DOB }, { now: NOW })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("an admin may record it only for a student ACTIVE in their own Markaz", async () => {
    // studentY studies only in Markaz B.
    await expect(recordDateOfBirth(db, await actor(db, U.adminA), { studentProfileId: U.studentY, dateOfBirth: MINOR_DOB }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await recordDateOfBirth(db, await actor(db, U.adminB), { studentProfileId: U.studentY, dateOfBirth: MINOR_DOB }, { now: NOW });
    // A student who LEFT Markaz A is no longer that admin's to update.
    await expect(recordDateOfBirth(db, await actor(db, U.adminA), { studentProfileId: U.studentLeft, dateOfBirth: MINOR_DOB }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects future or implausible dates", async () => {
    const a = await actor(db, U.adminA);
    await expect(recordDateOfBirth(db, a, { studentProfileId: U.studentX, dateOfBirth: "2027-01-01" }, { now: NOW })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(recordDateOfBirth(db, a, { studentProfileId: U.studentX, dateOfBirth: "1850-01-01" }, { now: NOW })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(recordDateOfBirth(db, a, { studentProfileId: U.studentX, dateOfBirth: "14/10/2015" }, { now: NOW })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("is derived per policy in the read models", async () => {
    await setDob(pg, U.studentX, MINOR_DOB);
    expect((await listMyChildrenConsent(db, await actor(db, U.parentActive), { ...O, now: NOW }))[0]).toMatchObject({ minorStatus: "MINOR", dateOfBirthRecorded: true });
    await setDob(pg, U.studentX, ADULT_DOB);
    expect((await listMyChildrenConsent(db, await actor(db, U.parentActive), { ...O, now: NOW }))[0]).toMatchObject({ minorStatus: "ADULT" });
    // The shipped policy has no threshold yet: status unknown.
    expect((await listMyChildrenConsent(db, await actor(db, U.parentActive), { now: NOW }))[0]).toMatchObject({ minorStatus: "UNKNOWN" });
  });
});

describe("giving consent (A71)", () => {
  beforeEach(() => setDob(pg, U.studentX, MINOR_DOB));

  it("a minor without consent cannot be recorded; an ACTIVE guardian's consent makes them eligible everywhere", async () => {
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toEqual({ eligible: false, eligibility: "NO_CONSENT" });
    const id = await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toEqual({ eligible: true, eligibility: "CONSENTED", consentId: id });
    expect(await getRecordingEligibility(db, U.studentX, T.B, O)).toMatchObject({ eligible: true });
    const consent = await db.recordingConsent.findUniqueOrThrow({ where: { id } });
    expect(consent).toMatchObject({ method: "GUARDIAN_ONLINE", guardianProfileId: U.parentActive, recordedById: U.parentActive, tenantId: null });
    expect(await db.auditEvent.count({ where: { action: "CONSENT_GIVEN", targetId: id } })).toBe(1);
  });

  it("only an ACTIVE guardian may consent online; twice is a conflict", async () => {
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
      { ...O, now: NOW },
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
    expect(await db.auditEvent.count({ where: { action: "CONSENT_OFFLINE_VERIFIED", actorId: U.adminA } })).toBe(1);
  });

  it("offline consent: only a same-Markaz admin, for an ACTIVE student of that Markaz", async () => {
    const input = { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "x", evidenceReference: "y" };
    for (const who of [U.adminB, U.teacherA, U.superAdmin, U.parentActive]) {
      await expect(recordOfflineConsent(db, await actor(db, who), input, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await expect(recordOfflineConsent(db, await actor(db, U.adminA), { ...input, studentProfileId: U.studentY }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(recordOfflineConsent(db, await actor(db, U.adminA), { ...input, evidenceReference: " " }, O)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("adults and students without a DOB are not eligible (owner decisions pending), whatever consent exists", async () => {
    await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    await setDob(pg, U.studentX, ADULT_DOB);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligibility: "ADULT_CONSENT_UNDECIDED" });
    await pg.query("UPDATE student_accounts SET date_of_birth = NULL, date_of_birth_recorded_by_id = NULL, date_of_birth_recorded_at = NULL WHERE profile_id = $1", [U.studentX]);
    expect(await getRecordingEligibility(db, U.studentX, T.A, O)).toMatchObject({ eligibility: "DATE_OF_BIRTH_MISSING" });
  });

  it("the Markaz overview shows this Markaz's offline consents and online consents, nothing from other Markaz", async () => {
    await giveGuardianConsent(db, await actor(db, U.parentActive), { studentProfileId: U.studentX }, O);
    await recordOfflineConsent(db, await actor(db, M.adminA2), { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "x", evidenceReference: "y" }, O);
    const overview = await listTenantConsentOverview(db, await actor(db, U.adminA), T.A, O);
    expect(overview.find((s) => s.studentProfileId === U.studentX)?.consents.map((c) => c.method).sort()).toEqual(["GUARDIAN_ONLINE", "OFFLINE_VERIFIED"]);
    await expect(listTenantConsentOverview(db, await actor(db, U.adminB), T.A, O)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("withdrawal (A72): blocks FUTURE capture; existing media goes to review, nothing is deleted", () => {
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
    const flagged = await withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O);
    expect(flagged).toBe(1);
    await expect(
      registerDirectCaptureClip(db, storage, await actor(db, U.teacherA), { correctionId, mimeType: "audio/mp4" }, O),
    ).rejects.toMatchObject({ code: "consent_required" });
    const requests = await db.mediaDeletionRequest.findMany();
    expect(requests).toEqual([expect.objectContaining({ clipId, reason: "CONSENT_WITHDRAWN", consentId, status: "PENDING", tenantId: T.A })]);
    // Not deleted: the clip is still finalized, its bytes exist, and it still plays until an admin approves.
    expect((await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } })).deletedAt).toBeNull();
    expect(storage.deleted).toEqual([]);
    await getClipPlaybackUrl(db, storage, await actor(db, U.studentX), clipId);
    expect(await db.auditEvent.count({ where: { action: "CONSENT_WITHDRAWN", targetId: consentId } })).toBe(1);
  });

  it("media stays out of review in a Markaz where another valid consent still applies", async () => {
    const { consentId } = await setupWithClip();
    await recordOfflineConsent(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "x", evidenceReference: "y" }, O);
    expect(await withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O)).toBe(0);
  });

  it("who may withdraw: an ACTIVE guardian (online), a same-Markaz admin (offline); not twice", async () => {
    const { consentId } = await setupWithClip();
    for (const who of [U.parentVerified, U.adminA, U.teacherA, U.superAdmin]) {
      await expect(withdrawConsent(db, await actor(db, who), { consentId }, O)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O);
    await expect(withdrawConsent(db, await actor(db, U.parentActive), { consentId }, O)).rejects.toMatchObject({ code: "invalid_state" });

    const offline = await recordOfflineConsent(db, await actor(db, U.adminA), { tenantId: T.A, studentProfileId: U.studentX, consenterDescription: "x", evidenceReference: "y" }, O);
    await expect(withdrawConsent(db, await actor(db, U.adminB), { consentId: offline }, O)).rejects.toBeInstanceOf(AuthorizationError);
    await withdrawConsent(db, await actor(db, M.adminA2), { consentId: offline }, O);
  });
});

describe("live participation is separate from recording eligibility (A72)", () => {
  it("a student without consent is a participant of the session, but their audio is excluded from recorded media", async () => {
    await setDob(pg, U.studentX, MINOR_DOB); // minor, no consent
    const teacher = await actor(db, U.teacherA);
    const recordingId = await createRecording(db, teacher, { tenantId: T.A }, O);
    await registerRecordingParticipants(db, teacher, { recordingId, studentProfileIds: [U.studentX] }, O);
    expect(await getCapturePlan(db, teacher, { recordingId })).toEqual([{ studentProfileId: U.studentX, includeAudio: false, eligibility: "NO_CONSENT" }]);

    // With consent the same student's audio may be included.
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
      .filter((f) => readFileSync(f, "utf8").includes("getRecordingEligibility") || readFileSync(f, "utf8").includes("requireRecordingEligibility"))
      .map((f) => f.replace(process.cwd(), "").replace(/\\/g, "/"));
    expect(users.sort()).toEqual([
      "/src/server/services/consent.ts",
      "/src/server/services/correction-audio.ts",
      "/src/server/services/recordings.ts",
    ]);
  });
});
