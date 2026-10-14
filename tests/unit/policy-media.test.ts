import { describe, expect, it } from "vitest";
import {
  canApproveMediaDeletion,
  canApproveRecording,
  canReadCorrection,
  canRecordOfflineConsent,
  canRequestMediaDeletion,
  canRevokeRecordingApproval,
  correctionReadAccess,
  recordingStaffAccess,
  type Actor,
} from "@/server/authz/policy";
import { actorFor } from "../support/actors";
import { T, U } from "../support/fixture";

const correction = { tenantId: T.A, studentProfileId: U.studentX, teacherProfileId: U.teacherA };

/** teacherA after leaving Markaz A (membership ENDED). */
const departedTeacher: Actor = {
  ...actorFor(U.teacherA),
  memberships: [{ tenantId: T.A, role: "TEACHER", status: "ENDED" }],
};

describe("correction media read access (A66)", () => {
  it.each([
    ["student owner", actorFor(U.studentX), "ALLOW"],
    ["other student", actorFor(U.studentY), "DENY"],
    ["active authoring teacher", actorFor(U.teacherA), "ALLOW"],
    ["departed authoring teacher", departedTeacher, "DENY"],
    ["other teacher of the same Markaz", actorFor(U.teacherAB), "DENY"],
    ["Markaz Admin of the same Markaz", actorFor(U.adminA), "ALLOW"],
    ["Markaz Admin of another Markaz", actorFor(U.adminB), "DENY"],
    ["ACTIVE parent", actorFor(U.parentActive), "ALLOW"],
    ["VERIFIED parent", actorFor(U.parentVerified), "DENY"],
    ["PENDING parent", actorFor(U.parentPendingA), "DENY"],
    ["REVOKED parent", actorFor(U.parentRevoked), "DENY"],
    ["Super Admin (only with the mandatory audit)", actorFor(U.superAdmin), "ALLOW_AUDITED"],
  ] as const)("%s → %s", (_l, actor, expected) => {
    expect(correctionReadAccess(actor, correction)).toBe(expected);
  });

  it("an ACTIVE parent reads the child's corrections in EVERY Markaz (link verified in A)", () => {
    expect(correctionReadAccess(actorFor(U.parentActive), { ...correction, tenantId: T.B, teacherProfileId: U.teacherAB })).toBe("ALLOW");
  });

  it("the un-audited check (mirrors RLS) never lets a Super Admin through", () => {
    expect(canReadCorrection(actorFor(U.superAdmin), correction)).toBe(false);
    expect(canReadCorrection(actorFor(U.adminA), correction)).toBe(true);
  });
});

describe("full recording staff access (A77)", () => {
  const recording = { tenantId: T.A, teacherProfileId: U.teacherA };
  it.each([
    [actorFor(U.teacherA), "ALLOW"],
    [departedTeacher, "DENY"],
    [actorFor(U.teacherAB), "DENY"],
    [actorFor(U.adminA), "ALLOW"],
    [actorFor(U.adminB), "DENY"],
    [actorFor(U.superAdmin), "ALLOW_AUDITED"],
    [actorFor(U.studentX), "DENY"],
    [actorFor(U.parentActive), "DENY"], // parents only through the approval/consent gates
  ] as const)("%# → %s", (actor, expected) => {
    expect(recordingStaffAccess(actor, recording)).toBe(expected);
  });
});

describe("deletion and approval authority (A73, A78)", () => {
  const target = { tenantId: T.A, teacherProfileId: U.teacherA };
  it("the authoring teacher (active) or a same-Markaz admin may REQUEST deletion", () => {
    expect(canRequestMediaDeletion(actorFor(U.teacherA), target)).toBe(true);
    expect(canRequestMediaDeletion(actorFor(U.adminA), target)).toBe(true);
    expect(canRequestMediaDeletion(departedTeacher, target)).toBe(false);
    expect(canRequestMediaDeletion(actorFor(U.teacherAB), target)).toBe(false);
    expect(canRequestMediaDeletion(actorFor(U.adminB), target)).toBe(false);
    expect(canRequestMediaDeletion(actorFor(U.superAdmin), target)).toBe(false);
  });

  it("only a same-Markaz admin APPROVES deletion — never a teacher; not their own request (interim)", () => {
    expect(canApproveMediaDeletion(actorFor(U.adminA), { tenantId: T.A, requestedById: U.teacherA })).toBe(true);
    expect(canApproveMediaDeletion(actorFor(U.teacherA), { tenantId: T.A, requestedById: U.adminA })).toBe(false);
    expect(canApproveMediaDeletion(actorFor(U.adminB), { tenantId: T.A, requestedById: U.teacherA })).toBe(false);
    expect(canApproveMediaDeletion(actorFor(U.adminA), { tenantId: T.A, requestedById: U.adminA })).toBe(false);
    expect(canApproveMediaDeletion(actorFor(U.superAdmin), { tenantId: T.A, requestedById: U.teacherA })).toBe(false);
  });

  it("recordings: a same-Markaz admin approves and revokes; the teacher never approves", () => {
    const recording = { tenantId: T.A, teacherProfileId: U.teacherA };
    expect(canApproveRecording(actorFor(U.adminA), recording)).toBe(true);
    expect(canApproveRecording(actorFor(U.teacherA), recording)).toBe(false);
    expect(canApproveRecording(actorFor(U.adminB), recording)).toBe(false);
    expect(canRevokeRecordingApproval(actorFor(U.adminA), recording)).toBe(true);
    expect(canRevokeRecordingApproval(actorFor(U.teacherA), recording)).toBe(false);
  });

  it("verified offline consent is recorded by a same-Markaz admin only", () => {
    expect(canRecordOfflineConsent(actorFor(U.adminA), T.A)).toBe(true);
    expect(canRecordOfflineConsent(actorFor(U.adminA), T.B)).toBe(false);
    expect(canRecordOfflineConsent(actorFor(U.teacherA), T.A)).toBe(false);
    expect(canRecordOfflineConsent(actorFor(U.superAdmin), T.A)).toBe(false);
    expect(canRecordOfflineConsent(actorFor(U.adminA), "not-a-uuid")).toBe(false);
  });
});
