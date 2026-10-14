import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuditAction, RecordingEntitlementStatus } from "@/generated/prisma/enums";
import { AuthorizationError, canEnableOptionC, canRequestOptionC, type Actor } from "@/server/authz/policy";
import { recordAudit, type Tx } from "./audit";
import { DomainError } from "./errors";

// Option C (full lesson recording add-on) — FEATURE ENTITLEMENT ONLY (A90, A96). No pricing,
// payment, billing provider or subscription logic.
//
//   NOT_ENABLED / DECLINED / CANCELLED / DISABLED ──request (Markaz Admin, own Markaz)──▶ PENDING
//   PENDING ──enable (Super Admin)──▶ ENABLED ──disable (Super Admin)──▶ DISABLED
//   PENDING ──decline (Super Admin)──▶ DECLINED
//   PENDING ──cancel (the requesting Markaz Admin)──▶ CANCELLED
//
// Only ENABLED makes new full recordings possible. Disabling deletes nothing: existing
// recordings stay under the retention/access rules. Teachers can neither request nor enable.
// A100: after DECLINED, CANCELLED or DISABLED a Markaz Admin may request again — every request
// starts a NEW approval cycle (back to PENDING) that needs a Super Admin again; nothing ever
// returns to ENABLED automatically. The row holds the current cycle; every step is in
// audit_events.

export type OptionCStatus = RecordingEntitlementStatus;

export async function getOptionCStatus(db: Tx | PrismaClient, tenantId: string): Promise<OptionCStatus> {
  const row = await db.recordingEntitlement.findUnique({ where: { tenantId }, select: { status: true } });
  return row?.status ?? "NOT_ENABLED";
}

/** Full-recording creation/start is available only in a Markaz where Option C is ENABLED. */
export async function requireOptionCEnabled(db: Tx | PrismaClient, tenantId: string) {
  if ((await getOptionCStatus(db, tenantId)) !== "ENABLED") throw new DomainError("feature_not_enabled");
}

const tenantSchema = z.object({ tenantId: z.uuid() });
const CLEARED = {
  enabledById: null,
  enabledAt: null,
  declinedById: null,
  declinedAt: null,
  cancelledById: null,
  cancelledAt: null,
  disabledById: null,
  disabledAt: null,
};

function audit(tx: Tx, actor: Actor, tenantId: string, action: AuditAction, now: Date) {
  return recordAudit(tx, { actorId: actor.profileId, tenantId, action, targetType: "RECORDING_ENTITLEMENT", targetId: tenantId, now });
}

/**
 * A Markaz Admin requests Option C for their own Markaz. A new request cycle may start from
 * NOT_ENABLED, DECLINED, CANCELLED or DISABLED; never while one is PENDING or ENABLED.
 */
export async function requestOptionC(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId } = parsed.data;
  if (!canRequestOptionC(actor, tenantId)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const current = await getOptionCStatus(tx, tenantId);
    if (current === "PENDING") throw new DomainError("conflict");
    if (current === "ENABLED") throw new DomainError("invalid_state");
    const data = { status: "PENDING" as const, requestedById: actor.profileId, requestedAt: now, ...CLEARED, updatedAt: now };
    await tx.recordingEntitlement.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    await audit(tx, actor, tenantId, "OPTION_C_REQUESTED", now);
  });
}

/** The Markaz Admin who made the pending request cancels it (A96). Nobody else can. */
export async function cancelOptionCRequest(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId } = parsed.data;
  const row = await db.recordingEntitlement.findUnique({ where: { tenantId }, select: { status: true, requestedById: true } });
  if (!row || row.requestedById !== actor.profileId || !canRequestOptionC(actor, tenantId)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.recordingEntitlement.updateMany({
      where: { tenantId, status: "PENDING", requestedById: actor.profileId },
      data: { status: "CANCELLED", cancelledById: actor.profileId, cancelledAt: now, updatedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await audit(tx, actor, tenantId, "OPTION_C_CANCELLED", now);
  });
}

/** Super Admin decisions on one Markaz: enable / decline a pending request; disable an enabled one. */
async function superAdminTransition(
  db: PrismaClient,
  actor: Actor,
  input: unknown,
  from: RecordingEntitlementStatus,
  to: "ENABLED" | "DECLINED" | "DISABLED",
  action: AuditAction,
  now: Date,
) {
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  if (!canEnableOptionC(actor)) throw new AuthorizationError();
  const { tenantId } = parsed.data;
  const stamp =
    to === "ENABLED"
      ? { enabledById: actor.profileId, enabledAt: now }
      : to === "DECLINED"
        ? { declinedById: actor.profileId, declinedAt: now }
        : { disabledById: actor.profileId, disabledAt: now };
  await db.$transaction(async (tx) => {
    const { count } = await tx.recordingEntitlement.updateMany({ where: { tenantId, status: from }, data: { status: to, ...stamp, updatedAt: now } });
    if (count !== 1) throw new DomainError("invalid_state");
    await audit(tx, actor, tenantId, action, now);
  });
}

/** A Super Admin approves a pending request, enabling Option C for that Markaz. */
export function enableOptionC(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  return superAdminTransition(db, actor, input, "PENDING", "ENABLED", "OPTION_C_ENABLED", options.now ?? new Date());
}

/** A Super Admin declines a pending request (A96). */
export function declineOptionC(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  return superAdminTransition(db, actor, input, "PENDING", "DECLINED", "OPTION_C_DECLINED", options.now ?? new Date());
}

/**
 * A Super Admin disables an enabled entitlement (A96). New full recordings can no longer be
 * created or started; nothing existing is deleted or hidden by this.
 */
export function disableOptionC(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  return superAdminTransition(db, actor, input, "ENABLED", "DISABLED", "OPTION_C_DISABLED", options.now ?? new Date());
}

/** Pending and enabled entitlements across all Markaz, for Super Admins. */
export async function listOptionCForPlatform(db: PrismaClient, actor: Actor) {
  if (!canEnableOptionC(actor)) throw new AuthorizationError();
  return db.recordingEntitlement.findMany({
    where: { status: { in: ["PENDING", "ENABLED"] } },
    select: { tenantId: true, status: true, requestedAt: true, enabledAt: true, tenant: { select: { name: true } } },
    orderBy: { updatedAt: "asc" },
  });
}

/** Back-compat helper: pending requests only. */
export async function listPendingOptionCRequests(db: PrismaClient, actor: Actor) {
  return (await listOptionCForPlatform(db, actor)).filter((r) => r.status === "PENDING");
}

/** For the Markaz page: the status and whether this admin made the pending request. */
export async function getOptionCForMarkaz(db: PrismaClient, actor: Actor, tenantId: string) {
  const row = await db.recordingEntitlement.findUnique({ where: { tenantId }, select: { status: true, requestedById: true } });
  return { status: row?.status ?? ("NOT_ENABLED" as const), requestedByMe: row?.requestedById === actor.profileId };
}
