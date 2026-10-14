import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { CorrectionAnchorKind } from "@/generated/prisma/enums";
import { AuthorizationError, correctionReadAccess, hasActiveRole, isValidId, type Actor } from "@/server/authz/policy";
import { auditSuperAdminRead } from "./audit";
import { DomainError } from "./errors";

// Option B corrections (A29, A66–A68, A76): annotation + note/context + timestamp + anchors,
// with audio clips handled in ./correction-audio.ts. Corrections are academic history: there
// is no delete path. Content anchors are content-neutral (no lesson/page/chunk tables exist
// yet, so ref_id is NOT a foreign key) and always carry a historical snapshot.
//
// Engineering input bounds below are safety limits on request size, not business rules.

const MAX_NOTE_CHARS = 4000;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024;
const MAX_ANCHORS = 10;

const jsonObject = (maxBytes: number) =>
  z
    .record(z.string(), z.unknown())
    .refine((v) => Object.keys(v).length > 0 && JSON.stringify(v).length <= maxBytes);

export const ANCHOR_KINDS = ["LESSON", "PAGE", "CHUNK", "SEGMENT", "TIMESTAMP"] as const satisfies readonly CorrectionAnchorKind[];

const anchorSchema = z.object({
  kind: z.enum(ANCHOR_KINDS),
  refId: z.string().trim().min(1).max(200).optional(),
  position: jsonObject(2048).optional(),
  /** Required: enough context to understand the correction if the content is removed. */
  snapshot: jsonObject(MAX_SNAPSHOT_BYTES),
});

const createSchema = z.object({
  tenantId: z.uuid(),
  studentProfileId: z.uuid(),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().max(MAX_NOTE_CHARS).optional(),
  annotation: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).refine((v) => JSON.stringify(v).length <= MAX_JSON_BYTES).optional(),
  anchors: z.array(anchorSchema).max(MAX_ANCHORS).default([]),
});

/**
 * A Teacher creates a correction for a student of their Markaz. INTERIM (until classes
 * exist): any ACTIVE student of the same Markaz; when class assignments exist this narrows to
 * the teacher's own classes (A51). Audio consent is checked when audio is added, not here.
 */
export async function createCorrection(db: PrismaClient, actor: Actor, input: unknown, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, studentProfileId, note, annotation, anchors } = parsed.data;
  if (!hasActiveRole(actor, tenantId, "TEACHER") || actor.profileId === studentProfileId) throw new AuthorizationError();
  const student = await db.membership.findFirst({
    where: { tenantId, profileId: studentProfileId, role: "STUDENT", status: "ACTIVE" },
    select: { id: true },
  });
  if (!student) throw new AuthorizationError();

  return db.$transaction(async (tx) => {
    const correction = await tx.correction.create({
      data: {
        tenantId,
        studentProfileId,
        teacherProfileId: actor.profileId,
        capturedAt: parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : now,
        note: note || null,
        annotation: (annotation ?? undefined) as Prisma.InputJsonValue | undefined,
        createdAt: now,
      },
      select: { id: true },
    });
    for (const a of anchors) {
      await tx.correctionAnchor.create({
        data: {
          correctionId: correction.id,
          tenantId,
          kind: a.kind,
          refId: a.refId ?? null,
          position: (a.position ?? undefined) as Prisma.InputJsonValue | undefined,
          snapshot: a.snapshot as Prisma.InputJsonValue,
          createdAt: now,
        },
      });
    }
    return correction.id;
  });
}

const correctionSelect = {
  id: true,
  tenantId: true,
  studentProfileId: true,
  teacherProfileId: true,
  capturedAt: true,
  note: true,
  annotation: true,
  createdAt: true,
  tenant: { select: { name: true } },
  student: { select: { profile: { select: { displayName: true } } } },
  teacher: { select: { displayName: true } },
  anchors: {
    select: { id: true, kind: true, refId: true, position: true, snapshot: true, sourceRemovedAt: true },
    orderBy: { createdAt: "asc" as const },
  },
  audioClips: {
    select: {
      id: true,
      status: true,
      isPrimary: true,
      durationMs: true,
      createdAt: true,
      finalizedAt: true,
      deletedAt: true,
      purgedAt: true,
      deletionRequests: { where: { status: "PENDING" as const }, select: { id: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
};

export type CorrectionView = Awaited<ReturnType<typeof loadCorrections>>[number];

function loadCorrections(db: PrismaClient, where: object) {
  return db.correction.findMany({ where, select: correctionSelect, orderBy: { capturedAt: "desc" } });
}

/**
 * One correction with anchors and clip history, for anyone who may read it. A Super Admin
 * read writes the mandatory audit event first.
 */
export async function getCorrection(db: PrismaClient, actor: Actor, correctionId: unknown, options: { now?: Date } = {}) {
  if (!isValidId(correctionId)) throw new AuthorizationError();
  const [correction] = await loadCorrections(db, { id: correctionId });
  if (!correction) throw new AuthorizationError();
  const access = correctionReadAccess(actor, correction);
  if (access === "DENY") throw new AuthorizationError();
  if (access === "ALLOW_AUDITED") {
    await auditSuperAdminRead(db, actor, { tenantId: correction.tenantId, targetType: "CORRECTION", targetId: correction.id }, options.now ?? new Date());
  }
  return correction;
}

/**
 * Corrections of one student visible to the actor: the student themself, or an ACTIVE-linked
 * parent — across ALL of the child's Markaz (A66).
 */
export async function listStudentCorrections(db: PrismaClient, actor: Actor, studentProfileId: unknown) {
  if (!isValidId(studentProfileId)) throw new AuthorizationError();
  const all = await loadCorrections(db, { studentProfileId });
  return all.filter((c) => correctionReadAccess(actor, c) === "ALLOW");
}

/** Corrections in one Markaz: its Markaz Admins see all; an active teacher sees their own. */
export async function listTenantCorrections(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!isValidId(tenantId)) throw new AuthorizationError();
  if (hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) return loadCorrections(db, { tenantId });
  if (hasActiveRole(actor, tenantId, "TEACHER")) return loadCorrections(db, { tenantId, teacherProfileId: actor.profileId });
  throw new AuthorizationError();
}

/**
 * Hook for future content features: when a lesson/page/chunk is removed, its anchors are
 * marked — never deleted — and the correction stays understandable through its snapshot
 * (A76). Server-internal; no client entry point.
 */
export async function markAnchorSourceRemoved(
  db: PrismaClient,
  source: { kind: CorrectionAnchorKind; refId: string },
  now: Date = new Date(),
) {
  const { count } = await db.correctionAnchor.updateMany({
    where: { kind: source.kind, refId: source.refId, sourceRemovedAt: null },
    data: { sourceRemovedAt: now },
  });
  return count;
}
