import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import { enableOptionC, getOptionCStatus, listPendingOptionCRequests, requestOptionC } from "@/server/services/option-c";
import { createRecording, startRecording } from "@/server/services/recordings";
import { actor, createTestPrisma } from "../db/prisma";
import { T, U } from "../support/fixture";
import { seedMedia } from "../support/media";

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
    expect(columns.rows.map((c) => c.column_name)).toEqual(["enabled_at", "enabled_by_id", "requested_at", "requested_by_id", "status", "tenant_id", "updated_at"]);
  });
});
