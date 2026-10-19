import { hasActiveRole, isValidId, type Actor } from "./policy";

// Live Class authorization (owner TO-BE approval 2026-10-19, A101–A130). Pure rules, no I/O:
// the services load the class/session context, then ask these functions. Every rule needs the
// actor's own ACTIVE membership in the class's Markaz, so nothing ever crosses a tenant (A101).
//
// Two kinds of authority are kept apart on purpose (A115):
// - TEACHING (Primary Teacher, Co-Teacher, the session's Substitute): teach, whiteboard
//   authoring, screen share, mic control, session start/end.
// - OPERATIONAL (Markaz Admin): class configuration, enrollment, capacity override, payment
//   verification, session start/end, participant removal, mic control, attendance. A Markaz
//   Admin is NOT a teacher by virtue of that role: no whiteboard authoring, no screen share,
//   never Primary/Co/Substitute unless separately assigned (and an ACTIVE Teacher).
// A Super Admin gets no Live Class powers here (none are approved).

export type ClassTeacherRole = "PRIMARY" | "CO_TEACHER";

export type ClassContext = {
  tenantId: string;
  /** ACTIVE (not ended) teacher assignments of the class. */
  teachers: readonly { teacherProfileId: string; role: ClassTeacherRole }[];
};

export type SessionContext = ClassContext & { substituteProfileId: string | null };

/** Effective enrollment state of the actor in this class (null = no open enrollment). */
export type EnrollmentAccess = "WAITLISTED" | "ACTIVE" | "GRACE" | "SUSPENDED" | "ENDED" | null;

export type ClassRelation = {
  primary: boolean;
  coTeacher: boolean;
  /** Only for a session context: the session's assigned substitute. */
  substitute: boolean;
  admin: boolean;
};

function activeTeacher(actor: Actor, tenantId: string) {
  return hasActiveRole(actor, tenantId, "TEACHER");
}

/**
 * The actor's relation to a class (and, given a session, to that session). A teacher assignment
 * counts only while the person is an ACTIVE Teacher of that Markaz: a departed teacher's row is
 * kept as history but grants nothing (A104).
 */
export function classRelation(actor: Actor, ctx: ClassContext | SessionContext): ClassRelation {
  if (!isValidId(ctx.tenantId)) return { primary: false, coTeacher: false, substitute: false, admin: false };
  const teacher = activeTeacher(actor, ctx.tenantId);
  const assigned = (role: ClassTeacherRole) =>
    teacher && ctx.teachers.some((t) => t.teacherProfileId === actor.profileId && t.role === role);
  const substituteProfileId = "substituteProfileId" in ctx ? ctx.substituteProfileId : null;
  return {
    primary: assigned("PRIMARY"),
    coTeacher: assigned("CO_TEACHER"),
    substitute: teacher && substituteProfileId !== null && substituteProfileId === actor.profileId,
    admin: hasActiveRole(actor, ctx.tenantId, "MARKAZ_ADMIN"),
  };
}

const assignedTeacher = (r: ClassRelation) => r.primary || r.coTeacher;
const teaching = (r: ClassRelation) => r.primary || r.coTeacher || r.substitute;

/** A student may take part only with an ACTIVE student membership AND an ACTIVE/GRACE enrollment (A106). */
export function studentHasClassAccess(actor: Actor, ctx: ClassContext, access: EnrollmentAccess): boolean {
  return hasActiveRole(actor, ctx.tenantId, "STUDENT") && (access === "ACTIVE" || access === "GRACE");
}

// --- Class & enrollment -------------------------------------------------------------------

/** Classes are created by a Markaz Admin of that Markaz. */
export function canCreateClass(actor: Actor, tenantId: unknown): boolean {
  return isValidId(tenantId) && hasActiveRole(actor, tenantId, "MARKAZ_ADMIN");
}

/** Class configuration (details, capacity, schedule, archive, teacher assignment): Markaz Admin only (A116: not Co-Teachers). */
export function canManageClass(actor: Actor, ctx: ClassContext): boolean {
  return classRelation(actor, ctx).admin;
}

/** The roster/teaching view of a class: its assigned teachers and the Markaz Admin. */
export function canViewClassAsStaff(actor: Actor, ctx: ClassContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || assignedTeacher(r);
}

/**
 * Seeing a class at all: staff as above, or a student with ANY open enrollment (so a waitlisted
 * or suspended student can see their own state). Parents never (A127).
 */
export function canReadClass(actor: Actor, ctx: ClassContext, access: EnrollmentAccess): boolean {
  if (canViewClassAsStaff(actor, ctx)) return true;
  return hasActiveRole(actor, ctx.tenantId, "STUDENT") && access !== null && access !== "ENDED";
}

/** Enroll / admit from waitlist / end an enrollment: an assigned teacher of the class or a Markaz Admin (A106). */
export function canManageEnrollment(actor: Actor, ctx: ClassContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || assignedTeacher(r);
}

/** Exceeding enrollment capacity is a controlled Markaz Admin override (A110). */
export function canOverrideCapacity(actor: Actor, ctx: ClassContext): boolean {
  return classRelation(actor, ctx).admin;
}

/** Grace extension: an assigned teacher of the class or a Markaz Admin (A108). */
export function canExtendGrace(actor: Actor, ctx: ClassContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || assignedTeacher(r);
}

/** Payment evidence may be SUBMITTED by an assigned teacher or a Markaz Admin (A107). */
export function canSubmitPayment(actor: Actor, ctx: ClassContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || assignedTeacher(r);
}

/** Payment VERIFICATION: Markaz Admin only — a teacher never verifies (A107). */
export function canVerifyPayment(actor: Actor, tenantId: unknown): boolean {
  return isValidId(tenantId) && hasActiveRole(actor, tenantId, "MARKAZ_ADMIN");
}

// --- Sessions ------------------------------------------------------------------------------

/** Create a scheduled or ad hoc session: an assigned teacher or a Markaz Admin. */
export function canCreateSession(actor: Actor, ctx: ClassContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || assignedTeacher(r);
}

/** Start / end: Primary, Co-Teacher, the session's Substitute, Markaz Admin (A113). */
export function canStartOrEndSession(actor: Actor, ctx: SessionContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || teaching(r);
}

/** Cancel a scheduled session: Primary Teacher or Markaz Admin only (A113). */
export function canCancelSession(actor: Actor, ctx: SessionContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || r.primary;
}

/** Assign the per-session substitute: Primary Teacher or Markaz Admin (A105). */
export function canAssignSubstitute(actor: Actor, ctx: SessionContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || r.primary;
}

// --- Live participation (business state only — no media transport) ------------------------

/** Remove a participant, operational override: teaching roles and the Markaz Admin (A115). */
export function canOperateParticipants(actor: Actor, ctx: SessionContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || teaching(r);
}

/** Grant / revoke a student's mic permission: teaching roles and the Markaz Admin (A115–A117). */
export function canControlMic(actor: Actor, ctx: SessionContext): boolean {
  return canOperateParticipants(actor, ctx);
}

/** Grant / revoke a student's whiteboard permission: TEACHING roles only — not the Markaz Admin (A118). */
export function canControlWhiteboard(actor: Actor, ctx: SessionContext): boolean {
  return teaching(classRelation(actor, ctx));
}

/** Teachers author on the whiteboard; a Markaz Admin does not by role (A115, A118). */
export function canAuthorWhiteboard(actor: Actor, ctx: SessionContext): boolean {
  return teaching(classRelation(actor, ctx));
}

/** Screen share: Primary, Co-Teacher, Substitute only (A119). Not students, parents or Markaz Admins. */
export function canScreenShare(actor: Actor, ctx: SessionContext): boolean {
  return teaching(classRelation(actor, ctx));
}

// --- Attendance ----------------------------------------------------------------------------

/** Session attendance list: teaching roles of that session and the Markaz Admin. */
export function canReadSessionAttendance(actor: Actor, ctx: SessionContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || teaching(r);
}

/** Manual attendance correction: Primary, Co-Teacher, Markaz Admin — NOT the Substitute (A122). */
export function canAdjustAttendance(actor: Actor, ctx: ClassContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || assignedTeacher(r);
}

// --- Chat (A120) ----------------------------------------------------------------------------

/**
 * Stored class chat of a session: enrolled students with current access, the class's Primary
 * and Co-Teachers, the Substitute OF THAT SESSION, the Markaz Admin. Never parents, unrelated
 * students or teachers, or another Markaz.
 */
export function canReadSessionChat(actor: Actor, ctx: SessionContext, access: EnrollmentAccess): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || teaching(r) || studentHasClassAccess(actor, ctx, access);
}

// --- Recording (A123–A125) -----------------------------------------------------------------

/** A session recording is authored by a teaching role (the recording's teacher, A78). */
export function canStartSessionRecording(actor: Actor, ctx: SessionContext): boolean {
  return teaching(classRelation(actor, ctx));
}

/** Correcting the participant list before finalization: Primary, Co-Teacher, Markaz Admin (A124). */
export function canCorrectRecordingParticipants(actor: Actor, ctx: ClassContext): boolean {
  const r = classRelation(actor, ctx);
  return r.admin || assignedTeacher(r);
}

/** The participant role a person joins a session with (first match wins). */
export function liveParticipantRole(
  actor: Actor,
  ctx: SessionContext,
  access: EnrollmentAccess,
): "PRIMARY_TEACHER" | "CO_TEACHER" | "SUBSTITUTE_TEACHER" | "MARKAZ_ADMIN" | "STUDENT" | null {
  const r = classRelation(actor, ctx);
  if (r.primary) return "PRIMARY_TEACHER";
  if (r.coTeacher) return "CO_TEACHER";
  if (r.substitute) return "SUBSTITUTE_TEACHER";
  if (r.admin) return "MARKAZ_ADMIN";
  if (studentHasClassAccess(actor, ctx, access)) return "STUDENT";
  return null;
}
