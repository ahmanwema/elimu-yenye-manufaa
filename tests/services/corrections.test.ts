import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import { finalizeDirectCaptureClip, registerDirectCaptureClip } from "@/server/services/correction-audio";
import { createCorrection, getCorrection, listStudentCorrections, listTenantCorrections, markAnchorSourceRemoved } from "@/server/services/corrections";
import { actor, createTestPrisma, FakeStorage } from "../db/prisma";
import { T, U } from "../support/fixture";
import { insertGuardianConsent, M, MINOR_DOB, seedMedia, setDob, TEST_POLICY, uploadM4a } from "../support/media";

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
});

const full = {
  tenantId: T.A,
  studentProfileId: U.studentX,
  capturedAt: "2026-10-14T09:15:00+03:00",
  note: "Madd too short in the second word.",
  annotation: { marks: [{ kind: "underline", word: 2 }] },
  anchors: [
    { kind: "LESSON", refId: "lesson-42", snapshot: { label: "Juz 30 — An-Naba, lesson 3" } },
    { kind: "PAGE", refId: "mushaf-582", position: { page: 582 }, snapshot: { label: "Page 582", excerpt: "عَمَّ يَتَسَاءَلُونَ" } },
    { kind: "TIMESTAMP", position: { startMs: 61_000, endMs: 64_500 }, snapshot: { label: "01:01 in the lesson" } },
  ],
};

describe("Option B correction model (A29/A66–A67)", () => {
  it("stores annotation, note/context, the correction timestamp and flexible content anchors with snapshots", async () => {
    const id = await createCorrection(db, await actor(db, U.teacherA), full);
    const c = await getCorrection(db, await actor(db, U.studentX), id);
    expect(c).toMatchObject({
      tenantId: T.A,
      studentProfileId: U.studentX,
      teacherProfileId: U.teacherA,
      note: full.note,
      annotation: full.annotation,
      capturedAt: new Date("2026-10-14T06:15:00Z"),
    });
    expect(c.anchors.map((a) => [a.kind, a.refId, a.snapshot])).toEqual([
      ["LESSON", "lesson-42", { label: "Juz 30 — An-Naba, lesson 3" }],
      ["PAGE", "mushaf-582", { label: "Page 582", excerpt: "عَمَّ يَتَسَاءَلُونَ" }],
      ["TIMESTAMP", null, { label: "01:01 in the lesson" }],
    ]);
  });

  it("anchors need a snapshot object; anchor ids are opaque (no fake foreign keys)", async () => {
    const teacher = await actor(db, U.teacherA);
    await expect(createCorrection(db, teacher, { ...full, anchors: [{ kind: "PAGE", refId: "x" }] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createCorrection(db, teacher, { ...full, anchors: [{ kind: "PAGE", snapshot: {} }] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createCorrection(db, teacher, { ...full, anchors: [{ kind: "VERSE", snapshot: { label: "x" } }] })).rejects.toMatchObject({ code: "invalid_input" });
    // Any identifier is accepted as a reference: there is no lesson/page table to point at yet.
    await createCorrection(db, teacher, { ...full, anchors: [{ kind: "CHUNK", refId: "does-not-exist-anywhere", snapshot: { label: "x" } }] });
    await expect(pg.query("INSERT INTO correction_anchors (correction_id, tenant_id, kind, snapshot) SELECT id, tenant_id, 'PAGE', '[]'::jsonb FROM corrections LIMIT 1")).rejects.toThrow(/anchor_snapshot_is_object/);
  });

  it("when the referenced content is removed, the correction and its snapshot remain", async () => {
    const id = await createCorrection(db, await actor(db, U.teacherA), full);
    expect(await markAnchorSourceRemoved(db, { kind: "PAGE", refId: "mushaf-582" })).toBe(1);
    const c = await getCorrection(db, await actor(db, U.parentActive), id);
    const page = c.anchors.find((a) => a.kind === "PAGE");
    expect(page?.sourceRemovedAt).not.toBeNull();
    expect(page?.snapshot).toEqual({ label: "Page 582", excerpt: "عَمَّ يَتَسَاءَلُونَ" });
    expect(c.note).toBe(full.note);
    expect(await db.correction.count()).toBe(1);
  });

  it("only an ACTIVE teacher of the Markaz creates corrections, for an ACTIVE student there", async () => {
    for (const who of [M.departedTeacher, U.adminA, U.studentX, U.parentActive, U.superAdmin, U.adminB]) {
      await expect(createCorrection(db, await actor(db, who), full)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await expect(createCorrection(db, await actor(db, U.teacherA), { ...full, studentProfileId: U.studentLeft })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(createCorrection(db, await actor(db, U.teacherA), { ...full, studentProfileId: U.studentY })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("Option B works with no full recording anywhere: correction + clip, zero recordings", async () => {
    await setDob(pg, U.studentX, MINOR_DOB);
    await insertGuardianConsent(pg, U.studentX);
    const storage = new FakeStorage();
    const teacher = await actor(db, U.teacherA);
    const correctionId = await createCorrection(db, teacher, full);
    const { clipId } = await registerDirectCaptureClip(db, storage, teacher, { correctionId, mimeType: "audio/mp4" }, { policy: TEST_POLICY });
    await uploadM4a(db, storage, clipId);
    await finalizeDirectCaptureClip(db, storage, teacher, { clipId }, { policy: TEST_POLICY });
    expect(await db.recording.count()).toBe(0);
    const c = await getCorrection(db, await actor(db, U.studentX), correctionId);
    expect(c.audioClips).toEqual([expect.objectContaining({ id: clipId, status: "FINALIZED", isPrimary: true })]);
  });
});

describe("who reads corrections (A66)", () => {
  it("an ACTIVE parent sees the child's corrections from ALL Markaz; non-ACTIVE parents see none", async () => {
    const inA = await createCorrection(db, await actor(db, U.teacherA), full);
    const inB = await createCorrection(db, await actor(db, U.teacherAB), { ...full, tenantId: T.B });
    expect((await listStudentCorrections(db, await actor(db, U.parentActive), U.studentX)).map((c) => c.id).sort()).toEqual([inA, inB].sort());
    for (const who of [U.parentVerified, U.parentPendingA, U.parentRevoked, U.parentUnlinked]) {
      expect(await listStudentCorrections(db, await actor(db, who), U.studentX)).toEqual([]);
    }
    expect((await listStudentCorrections(db, await actor(db, U.studentX), U.studentX)).length).toBe(2);
  });

  it("Markaz Admins see all of their Markaz and nothing of another; teachers see only their own", async () => {
    const byA = await createCorrection(db, await actor(db, U.teacherA), full);
    const byAB = await createCorrection(db, await actor(db, U.teacherAB), full);
    const inB = await createCorrection(db, await actor(db, U.teacherAB), { ...full, tenantId: T.B });
    expect((await listTenantCorrections(db, await actor(db, U.adminA), T.A)).map((c) => c.id).sort()).toEqual([byA, byAB].sort());
    expect((await listTenantCorrections(db, await actor(db, U.adminB), T.B)).map((c) => c.id)).toEqual([inB]);
    expect((await listTenantCorrections(db, await actor(db, U.teacherA), T.A)).map((c) => c.id)).toEqual([byA]);
    await expect(listTenantCorrections(db, await actor(db, U.adminB), T.A)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getCorrection(db, await actor(db, U.adminB), byA)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listTenantCorrections(db, await actor(db, M.departedTeacher), T.A)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a Super Admin may read any correction, and every read is audited", async () => {
    const id = await createCorrection(db, await actor(db, U.teacherA), full);
    await getCorrection(db, await actor(db, U.superAdmin), id);
    expect(await db.auditEvent.findMany({ where: { action: "SUPER_ADMIN_MEDIA_READ" } })).toEqual([
      expect.objectContaining({ actorId: U.superAdmin, tenantId: T.A, targetType: "CORRECTION", targetId: id }),
    ]);
  });
});
