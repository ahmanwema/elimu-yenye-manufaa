import type { PrismaClient } from "@/generated/prisma/client";
import type { EnrollmentAccess, SessionContext } from "@/server/authz/live-class";
import { AuthorizationError, isValidId } from "@/server/authz/policy";
import type { Tx } from "./audit";
import { effectiveEnrollmentState } from "./live-rules";

// Loads the context the pure Live Class rules (src/server/authz/live-class.ts) decide on.
// An unknown or malformed id is reported exactly like a forbidden one (no existence oracle).

type Db = Tx | PrismaClient;

const classSelect = {
  id: true,
  tenantId: true,
  name: true,
  subject: true,
  description: true,
  status: true,
  enrollmentCapacity: true,
  liveCapacity: true,
  teachers: { where: { endedAt: null }, select: { id: true, teacherProfileId: true, role: true } },
  tenant: { select: { timezone: true, classEnrollmentCapacityMax: true, classLiveCapacityMax: true } },
} as const;

export async function loadClassContext(db: Db, classId: unknown) {
  if (!isValidId(classId)) throw new AuthorizationError();
  const found = await db.class.findUnique({ where: { id: classId }, select: classSelect });
  if (!found) throw new AuthorizationError();
  return found;
}

export type LoadedClass = Awaited<ReturnType<typeof loadClassContext>>;

export async function loadSessionContext(db: Db, sessionId: unknown) {
  if (!isValidId(sessionId)) throw new AuthorizationError();
  const session = await db.liveSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      tenantId: true,
      classId: true,
      kind: true,
      status: true,
      title: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      actualStartAt: true,
      actualEndAt: true,
      recordingEnabled: true,
      substituteProfileId: true,
      class: { select: classSelect },
    },
  });
  if (!session) throw new AuthorizationError();
  const ctx: SessionContext = {
    tenantId: session.tenantId,
    teachers: session.class.teachers,
    substituteProfileId: session.substituteProfileId,
  };
  return { session, ctx };
}

export type LoadedSession = Awaited<ReturnType<typeof loadSessionContext>>["session"];

/** The person's open (non-ENDED) enrollment in a class, if any. */
export async function openEnrollment(db: Db, classId: string, studentProfileId: string) {
  return db.classEnrollment.findFirst({
    where: { classId, studentProfileId, status: { not: "ENDED" } },
    select: { id: true, status: true, accessUntil: true, graceUntil: true },
  });
}

/** Effective enrollment access of a person in a class at `now` (null = none). */
export async function enrollmentAccess(db: Db, classId: string, profileId: string, now: Date): Promise<EnrollmentAccess> {
  const e = await openEnrollment(db, classId, profileId);
  return e ? effectiveEnrollmentState(e, now) : null;
}

export async function hasActiveMembership(db: Db, tenantId: string, profileId: string, role: "TEACHER" | "STUDENT" | "MARKAZ_ADMIN") {
  const m = await db.membership.findFirst({ where: { tenantId, profileId, role, status: "ACTIVE" }, select: { id: true } });
  return m !== null;
}

/** Serializes capacity decisions on one class / session (seat counting must not race). */
export async function lockClass(tx: Tx, classId: string) {
  await tx.$queryRaw`SELECT id FROM public.classes WHERE id = ${classId}::uuid FOR UPDATE`;
}

export async function lockSession(tx: Tx, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM public.live_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
}
