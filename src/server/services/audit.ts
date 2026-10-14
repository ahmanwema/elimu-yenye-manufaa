import type { PrismaClient } from "@/generated/prisma/client";
import type { AuditAction, AuditTargetType } from "@/generated/prisma/enums";
import type { Actor } from "@/server/authz/policy";

// Append-only audit trail (A80). The table refuses UPDATE/DELETE/TRUNCATE at the database
// level. Never record signed URLs, object keys, dates of birth or other secrets/sensitive
// values in metadata — identifiers and outcome codes only.

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function recordAudit(
  db: Tx | PrismaClient,
  event: {
    actorId: string | null;
    tenantId: string | null;
    action: AuditAction;
    targetType: AuditTargetType;
    targetId: string;
    metadata?: Record<string, string | number | boolean | null>;
    now: Date;
  },
) {
  await db.auditEvent.create({
    data: {
      actorId: event.actorId,
      tenantId: event.tenantId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata ?? undefined,
      createdAt: event.now,
    },
  });
}

/**
 * The mandatory Super Admin read audit (A66). Must be awaited BEFORE any media URL is
 * minted or any data is returned, so a failed audit write means no access.
 */
export async function auditSuperAdminRead(
  db: Tx | PrismaClient,
  actor: Actor,
  target: { tenantId: string; targetType: AuditTargetType; targetId: string },
  now: Date,
) {
  await recordAudit(db, {
    actorId: actor.profileId,
    tenantId: target.tenantId,
    action: "SUPER_ADMIN_MEDIA_READ",
    targetType: target.targetType,
    targetId: target.targetId,
    now,
  });
}
