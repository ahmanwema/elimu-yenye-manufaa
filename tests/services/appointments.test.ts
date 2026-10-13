import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import {
  listPendingAppointmentRequests,
  requestMarkazAdminAppointment,
  reviewMarkazAdminAppointment,
} from "@/server/services/appointments";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
});

const adminRoles = (profileId: string, tenantId: string) =>
  db.membership.findMany({ where: { profileId, tenantId, role: "MARKAZ_ADMIN", status: "ACTIVE" } });

async function request(by: string = U.adminA, candidate: string = U.teacherA, tenantId: string = T.A) {
  return requestMarkazAdminAppointment(db, await actor(db, by), { tenantId, candidateProfileId: candidate });
}

describe("requesting", () => {
  it("a Markaz Admin requests an appointment in their own Markaz — no role is granted yet", async () => {
    const req = await request();
    expect(req.status).toBe("PENDING");
    expect(await adminRoles(U.teacherA, T.A)).toEqual([]);
  });

  it("cannot request in a foreign Markaz — no database call is made", async () => {
    const a = await actor(db, U.adminA);
    const spy = spyDb(db);
    await expect(
      requestMarkazAdminAppointment(spy.db, a, { tenantId: T.B, candidateProfileId: U.teacherAB }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(spy.calls).toEqual([]);
  });

  it.each([
    ["a teacher", U.teacherA],
    ["a student", U.studentX],
    ["a Super Admin without a Markaz Admin role (they approve, not request)", U.superAdmin],
  ])("cannot be made by %s", async (_l, who) => {
    await expect(request(who, U.teacherAB)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("the candidate must be an active member of that Markaz and not already its admin, and not the requester", async () => {
    await expect(request(U.adminA, U.studentY)).rejects.toMatchObject({ code: "not_found" }); // B student
    await expect(request(U.adminA, U.studentLeft)).rejects.toMatchObject({ code: "not_found" }); // left A
    await expect(request(U.adminA, U.adminA)).rejects.toMatchObject({ code: "invalid_input" });
    await pg.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'MARKAZ_ADMIN')", [T.A, U.teacherAB]);
    await expect(request(U.adminA, U.teacherAB)).rejects.toMatchObject({ code: "conflict" });
  });

  it("duplicate pending requests are rejected, including two at the same moment", async () => {
    const results = await Promise.allSettled([request(), request()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(request()).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("reviewing", () => {
  it("only a Super Admin may approve or reject — a Markaz Admin cannot, even their own request", async () => {
    const req = await request();
    for (const who of [U.adminA, U.adminB, U.teacherA]) {
      await expect(
        reviewMarkazAdminAppointment(db, await actor(db, who), { requestId: req.id, decision: "APPROVE" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    }
    await expect(listPendingAppointmentRequests(db, await actor(db, U.adminA))).rejects.toBeInstanceOf(AuthorizationError);
    expect(await adminRoles(U.teacherA, T.A)).toEqual([]);
  });

  it("approval grants exactly MARKAZ_ADMIN in exactly the requested Markaz, and records the reviewer", async () => {
    const req = await request();
    await reviewMarkazAdminAppointment(db, await actor(db, U.superAdmin), { requestId: req.id, decision: "APPROVE" });
    expect(await adminRoles(U.teacherA, T.A)).toHaveLength(1);
    expect(await db.membership.count({ where: { profileId: U.teacherA, tenantId: T.B } })).toBe(0);
    expect(await db.markazAdminAppointmentRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({
      status: "APPROVED",
      reviewedById: U.superAdmin,
      requestedById: U.adminA,
    });
  });

  it("rejection grants nothing; a reviewed request cannot be reviewed again", async () => {
    const req = await request();
    const sa = await actor(db, U.superAdmin);
    await reviewMarkazAdminAppointment(db, sa, { requestId: req.id, decision: "REJECT" });
    expect(await adminRoles(U.teacherA, T.A)).toEqual([]);
    await expect(reviewMarkazAdminAppointment(db, sa, { requestId: req.id, decision: "APPROVE" })).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("a Super Admin who is also the requesting Markaz Admin cannot approve their own request", async () => {
    await pg.query("INSERT INTO memberships (tenant_id, profile_id, role) VALUES ($1, $2, 'MARKAZ_ADMIN')", [T.A, U.superAdmin]);
    const req = await request(U.superAdmin, U.teacherA);
    await expect(
      reviewMarkazAdminAppointment(db, await actor(db, U.superAdmin), { requestId: req.id, decision: "APPROVE" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // And the database refuses it independently.
    await expect(
      pg.query("UPDATE markaz_admin_appointment_requests SET status='APPROVED', reviewed_by_id=$1, reviewed_at=now() WHERE id=$2", [
        U.superAdmin,
        req.id,
      ]),
    ).rejects.toThrow(/appointment_reviewer_is_not_requester/);
  });

  it("if the candidate left the Markaz before approval, approval fails and nothing changes", async () => {
    const req = await request();
    await pg.query("UPDATE memberships SET status='ENDED', ended_at=now() WHERE profile_id=$1 AND tenant_id=$2", [U.teacherA, T.A]);
    await expect(
      reviewMarkazAdminAppointment(db, await actor(db, U.superAdmin), { requestId: req.id, decision: "APPROVE" }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect((await db.markazAdminAppointmentRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING");
    expect(await adminRoles(U.teacherA, T.A)).toEqual([]);
  });
});
