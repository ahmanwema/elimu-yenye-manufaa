import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import {
  cancelOptionCRequest,
  declineOptionC,
  disableOptionC,
  enableOptionC,
  getOptionCStatus,
  listPendingOptionCRequests,
  requestOptionC,
} from "@/server/services/option-c";
import { createRecording, startRecording } from "@/server/services/recordings";
import { actor, createTestPrisma } from "../db/prisma";
import { T, U } from "../support/fixture";
import { M, seedMedia } from "../support/media";

let pg: PGlite;
let db: PrismaClient;
const NOW = new Date("2026-10-15T09:00:00Z");

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedMedia(pg);
});

describe("Option C entitlement: Markaz Admin request → Super Admin approve/enable (A90)", () => {
  it("starts NOT_ENABLED; full recording is unavailable", async () => {
    expect(await getOptionCStatus(db, T.A)).toBe("NOT_ENABLED");
    await expect(createRecording(db, await actor(db, U.teacherA), { tenantId: T.A })).rejects.toMatchObject({ code: "feature_not_enabled" });
  });

  it("a Markaz Admin requests for their own Markaz only; teachers and others cannot", async () => {
    for (const who of [U.teacherA, U.teacherAB, U.adminB, U.studentX, U.parentActive, U.superAdmin]) {
      await expect(requestOptionC(db, await actor(db, who), { tenantId: T.A }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    }
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    expect(await getOptionCStatus(db, T.A)).toBe("PENDING");
    await expect(requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW })).rejects.toMatchObject({ code: "conflict" });
    // Pending is not enabled.
    await expect(createRecording(db, await actor(db, U.teacherA), { tenantId: T.A })).rejects.toMatchObject({ code: "feature_not_enabled" });
  });

  it("only a Super Admin enables, and only a pending request; then recording becomes available in that Markaz only", async () => {
    await expect(enableOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW })).rejects.toMatchObject({ code: "invalid_state" });
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    expect((await listPendingOptionCRequests(db, await actor(db, U.superAdmin))).map((r) => r.tenantId)).toEqual([T.A]);
    for (const who of [U.adminA, U.teacherA, U.adminB]) {
      await expect(enableOptionC(db, await actor(db, who), { tenantId: T.A }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listPendingOptionCRequests(db, await actor(db, who))).rejects.toBeInstanceOf(AuthorizationError);
    }
    await enableOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW });
    expect(await db.recordingEntitlement.findUniqueOrThrow({ where: { tenantId: T.A } })).toMatchObject({
      status: "ENABLED",
      requestedById: U.adminA,
      enabledById: U.superAdmin,
      enabledAt: NOW,
    });

    const teacher = await actor(db, U.teacherA);
    const recordingId = await createRecording(db, teacher, { tenantId: T.A });
    await startRecording(db, teacher, { recordingId, noticeShown: true, teacherNoticeAcknowledged: true });
    await expect(createRecording(db, await actor(db, U.teacherAB), { tenantId: T.B })).rejects.toMatchObject({ code: "feature_not_enabled" });

    const trail = (await db.auditEvent.findMany({ where: { targetType: "RECORDING_ENTITLEMENT" }, orderBy: { createdAt: "asc" } })).map((e) => [e.action, e.actorId]);
    expect(trail).toEqual([
      ["OPTION_C_REQUESTED", U.adminA],
      ["OPTION_C_ENABLED", U.superAdmin],
    ]);
  });

  it("is entitlement only: no price, payment or billing data exists on the model", async () => {
    const columns = await pg.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'recording_entitlements' ORDER BY column_name",
    );
    expect(columns.rows.map((c) => c.column_name)).toEqual([
      "cancelled_at",
      "cancelled_by_id",
      "declined_at",
      "declined_by_id",
      "disabled_at",
      "disabled_by_id",
      "enabled_at",
      "enabled_by_id",
      "requested_at",
      "requested_by_id",
      "status",
      "tenant_id",
      "updated_at",
    ]);
  });
});

describe("Option C cancel / decline / disable (A96)", () => {
  const status = () => getOptionCStatus(db, T.A);

  it("the requesting admin cancels their own pending request; another admin, a teacher or a Super Admin cannot", async () => {
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    for (const who of [M.adminA2, U.teacherA, U.superAdmin, U.adminB]) {
      await expect(cancelOptionCRequest(db, await actor(db, who), { tenantId: T.A }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    }
    await cancelOptionCRequest(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    expect(await status()).toBe("CANCELLED");
    await expect(enableOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(cancelOptionCRequest(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("a Super Admin declines a pending request; a new request may follow", async () => {
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    await expect(declineOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await declineOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW });
    expect(await db.recordingEntitlement.findUniqueOrThrow({ where: { tenantId: T.A } })).toMatchObject({ status: "DECLINED", declinedById: U.superAdmin });
    await expect(createRecording(db, await actor(db, U.teacherA), { tenantId: T.A })).rejects.toMatchObject({ code: "feature_not_enabled" });
    await requestOptionC(db, await actor(db, M.adminA2), { tenantId: T.A }, { now: NOW });
    expect(await db.recordingEntitlement.findUniqueOrThrow({ where: { tenantId: T.A } })).toMatchObject({ status: "PENDING", requestedById: M.adminA2, declinedById: null });
  });

  it("a Super Admin disables an enabled entitlement: new recordings blocked, existing history kept", async () => {
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    await enableOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW });
    const teacher = await actor(db, U.teacherA);
    const existing = await createRecording(db, teacher, { tenantId: T.A, title: "Before disable" });
    const notStarted = await createRecording(db, teacher, { tenantId: T.A });

    await expect(disableOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW })).rejects.toBeInstanceOf(AuthorizationError);
    await disableOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW });
    expect(await db.recordingEntitlement.findUniqueOrThrow({ where: { tenantId: T.A } })).toMatchObject({
      status: "DISABLED",
      disabledById: U.superAdmin,
      enabledById: U.superAdmin,
    });

    await expect(createRecording(db, teacher, { tenantId: T.A })).rejects.toMatchObject({ code: "feature_not_enabled" });
    await expect(startRecording(db, teacher, { recordingId: notStarted, noticeShown: true, teacherNoticeAcknowledged: true })).rejects.toMatchObject({
      code: "feature_not_enabled",
    });
    expect(await db.recording.findUniqueOrThrow({ where: { id: existing } })).toMatchObject({ title: "Before disable", deletedAt: null });
    await expect(disableOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW })).rejects.toMatchObject({ code: "invalid_state" });
    // A100: a re-request is a NEW cycle — PENDING, never ENABLED, until a Super Admin approves again.
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    expect(await db.recordingEntitlement.findUniqueOrThrow({ where: { tenantId: T.A } })).toMatchObject({
      status: "PENDING",
      enabledById: null,
      disabledById: null,
    });
    await expect(createRecording(db, teacher, { tenantId: T.A })).rejects.toMatchObject({ code: "feature_not_enabled" });
    await enableOptionC(db, await actor(db, U.superAdmin), { tenantId: T.A }, { now: NOW });
    expect(await status()).toBe("ENABLED");
  });

  it("A100: a re-request after CANCELLED also starts a new cycle", async () => {
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    await cancelOptionCRequest(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    expect(await db.recordingEntitlement.findUniqueOrThrow({ where: { tenantId: T.A } })).toMatchObject({ status: "PENDING", cancelledById: null });
  });

  it("every step is audited", async () => {
    const admin = await actor(db, U.adminA);
    const sa = await actor(db, U.superAdmin);
    await requestOptionC(db, admin, { tenantId: T.A }, { now: NOW });
    await cancelOptionCRequest(db, admin, { tenantId: T.A }, { now: NOW });
    await requestOptionC(db, admin, { tenantId: T.A }, { now: NOW });
    await declineOptionC(db, sa, { tenantId: T.A }, { now: NOW });
    await requestOptionC(db, admin, { tenantId: T.A }, { now: NOW });
    await enableOptionC(db, sa, { tenantId: T.A }, { now: NOW });
    await disableOptionC(db, sa, { tenantId: T.A }, { now: NOW });
    const actions = (await db.auditEvent.findMany({ where: { targetType: "RECORDING_ENTITLEMENT" } })).map((e) => e.action).sort();
    expect(actions).toEqual(
      ["OPTION_C_REQUESTED", "OPTION_C_CANCELLED", "OPTION_C_REQUESTED", "OPTION_C_DECLINED", "OPTION_C_REQUESTED", "OPTION_C_ENABLED", "OPTION_C_DISABLED"].sort(),
    );
  });

  it("the database keeps each state consistent with its actor (cancel only by the requester)", async () => {
    await requestOptionC(db, await actor(db, U.adminA), { tenantId: T.A }, { now: NOW });
    await expect(
      pg.query("UPDATE recording_entitlements SET status = 'CANCELLED', cancelled_by_id = $2, cancelled_at = now() WHERE tenant_id = $1", [T.A, U.superAdmin]),
    ).rejects.toThrow(/entitlement_cancel_by_requester/);
    await expect(pg.query("UPDATE recording_entitlements SET status = 'DISABLED' WHERE tenant_id = $1", [T.A])).rejects.toThrow(/entitlement_status_fields/);
  });
});
