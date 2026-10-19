import type { PrismaClient } from "@/generated/prisma/client";
import { canReadStudentDetail, hasActiveRole, isValidId, type Actor, type ClassAssignmentResolver } from "@/server/authz/policy";
import { effectiveEnrollmentState } from "@/server/services/live-rules";

// A51 wired to real classes (A137, 2026-10-19). A Teacher may read DETAILED (non-private) data of
// a student only when ALL hold:
//   - the teacher has an ACTIVE Teacher membership in that Markaz;
//   - the teacher is CURRENTLY assigned (not ended) as Primary or Co-Teacher to an ACTIVE class
//     of that Markaz;
//   - the student holds ACTIVE or GRACE access in THAT class (effective state, so an expired
//     access period counts immediately).
// A per-session Substitute gets no ongoing detailed access. Markaz Admin and the student
// themself are decided by canReadStudentDetail() as before. Private categories keep their own
// rules and are never unlocked by this.

/** Builds the resolver for one teacher in one Markaz from current class data. */
export async function loadTeachingResolver(db: PrismaClient, tenantId: string, teacherProfileId: string, now: Date): Promise<ClassAssignmentResolver> {
  const enrollments = await db.classEnrollment.findMany({
    where: {
      tenantId,
      status: { in: ["ACTIVE", "GRACE"] },
      class: { status: "ACTIVE", tenantId, teachers: { some: { teacherProfileId, endedAt: null } } },
    },
    select: { studentProfileId: true, status: true, accessUntil: true, graceUntil: true },
  });
  const taught = new Set(
    enrollments.filter((e) => ["ACTIVE", "GRACE"].includes(effectiveEnrollmentState(e, now))).map((e) => e.studentProfileId),
  );
  return (input) => input.tenantId === tenantId && input.teacherProfileId === teacherProfileId && taught.has(input.studentProfileId);
}

/**
 * The server-side decision for detailed student data in one Markaz. Loads only what is needed;
 * a malformed id or a non-member is simply "not allowed".
 */
export async function canReadStudentDetailNow(
  db: PrismaClient,
  actor: Actor,
  input: { tenantId: unknown; studentProfileId: unknown },
  now: Date = new Date(),
): Promise<boolean> {
  const { tenantId, studentProfileId } = input;
  if (!isValidId(tenantId) || !isValidId(studentProfileId)) return false;
  if (actor.profileId !== studentProfileId && !hasActiveRole(actor, tenantId, "MARKAZ_ADMIN") && !hasActiveRole(actor, tenantId, "TEACHER")) return false;
  const membership = await db.membership.findFirst({
    where: { tenantId, profileId: studentProfileId, role: "STUDENT", status: "ACTIVE" },
    select: { id: true },
  });
  const teaches = hasActiveRole(actor, tenantId, "TEACHER") ? await loadTeachingResolver(db, tenantId, actor.profileId, now) : () => false;
  return canReadStudentDetail(actor, { tenantId, studentProfileId, studentIsActiveInTenant: membership !== null }, teaches);
}
