import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, canEnableOptionC, canRequestOptionC, type Actor } from "@/server/authz/policy";
import { recordAudit, type Tx } from "./audit";
import { DomainError } from "./errors";

// Option C (full lesson recording add-on) — FEATURE ENTITLEMENT ONLY (A90). No pricing,
// payment, billing provider or subscription logic (commercial terms are not approved, A34/A44).
//
//   NOT_ENABLED ──request (Markaz Admin, own Markaz)──▶ PENDING ──approve/enable (Super Admin)──▶ ENABLED
//
// Teachers can neither request nor enable it. No disable/decline path was approved.

export type OptionCStatus = "NOT_ENABLED" | "PENDING" | "ENABLED";

export async function getOptionCStatus(db: Tx | PrismaClient, tenantId: string): Promise<OptionCStatus> {
  const row = await db.recordingEntitlement.findUnique({ where: { tenantId }, select: { status: true } });
  return row?.status ?? "NOT_ENABLED";
}

/** Full-recording features are available only in a Markaz where Option C is ENABLED. */
export async function requireOptionCEnabled(db: Tx | PrismaClient, tenantId: string) {
  if ((await getOptionCStatus(db, tenantId)) !== "ENABLED") throw new DomainError("feature_not_enabled");
}

const tenantSchema = z.object({ tenantId: z.uuid() });

/** A Markaz Admin requests Option C for their own Markaz. */
export async function requestOptionC(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId } = parsed.data;
  if (!canRequestOptionC(actor, tenantId)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const current = await getOptionCStatus(tx, tenantId);
    if (current !== "NOT_ENABLED") throw new DomainError(current === "PENDING" ? "conflict" : "invalid_state");
    await tx.recordingEntitlement.upsert({
      where: { tenantId },
      create: { tenantId, status: "PENDING", requestedById: actor.profileId, requestedAt: now, updatedAt: now },
      update: { status: "PENDING", requestedById: actor.profileId, requestedAt: now, updatedAt: now },
    });
    await recordAudit(tx, { actorId: actor.profileId, tenantId, action: "OPTION_C_REQUESTED", targetType: "RECORDING_ENTITLEMENT", targetId: tenantId, now });
  });
}

/** A Super Admin approves a pending request, enabling Option C for that Markaz. */
export async function enableOptionC(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  if (!canEnableOptionC(actor)) throw new AuthorizationError();
  const { tenantId } = parsed.data;
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.recordingEntitlement.updateMany({
      where: { tenantId, status: "PENDING" },
      data: { status: "ENABLED", enabledById: actor.profileId, enabledAt: now, updatedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, { actorId: actor.profileId, tenantId, action: "OPTION_C_ENABLED", targetType: "RECORDING_ENTITLEMENT", targetId: tenantId, now });
  });
}

/** Pending Option C requests across all Markaz, for Super Admins. */
export async function listPendingOptionCRequests(db: PrismaClient, actor: Actor) {
  if (!canEnableOptionC(actor)) throw new AuthorizationError();
  return db.recordingEntitlement.findMany({
    where: { status: "PENDING" },
    select: { tenantId: true, requestedAt: true, tenant: { select: { name: true, slug: true } } },
    orderBy: { requestedAt: "asc" },
  });
}
