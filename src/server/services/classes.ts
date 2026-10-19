import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { canCreateClass, canManageClass, canReadClass, canViewClassAsStaff, classRelation } from "@/server/authz/live-class";
import { AuthorizationError, hasActiveRole, isValidId, type Actor } from "@/server/authz/policy";
import { isValidTimeZone } from "@/lib/timezone";
import { recordAudit } from "./audit";
import { enrollmentAccess, hasActiveMembership, loadClassContext, requireMarkazTimezone } from "./class-context";
import { DomainError, isUniqueViolation } from "./errors";
import { capacityWithinCeiling, effectiveCapacity, effectiveEnrollmentState, SEAT_HOLDING_STATES } from "./live-rules";

// Classes (owner TO-BE approval 2026-10-19, A101–A104, A109, A112). MARKAZ-ONLY: every class
// belongs to exactly one Markaz; independent-teacher workspaces are out of scope (A101).
// Class configuration (details, capacity, schedule, archive, teachers) is a Markaz Admin
// action; Co-Teachers never change configuration or capacity (A116).

export type ClassOptions = { now?: Date };

const capacityInput = z.union([z.int().min(1).max(100_000), z.null()]).optional();

// --- Markaz settings --------------------------------------------------------------------------

const tzSchema = z.object({ tenantId: z.uuid(), timezone: z.string().trim() });

/** A Markaz Admin sets their Markaz's IANA time zone (schedules are interpreted in it). */
export async function setTenantTimezone(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = tzSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, timezone } = parsed.data;
  if (!hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) throw new AuthorizationError();
  if (!isValidTimeZone(timezone)) throw new DomainError("invalid_input");
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { timezone } });
    await recordAudit(tx, { actorId: actor.profileId, tenantId, action: "TENANT_TIMEZONE_SET", targetType: "TENANT", targetId: tenantId, metadata: { timezone }, now });
  });
}

const limitsSchema = z.object({
  tenantId: z.uuid(),
  classEnrollmentCapacityMax: z.union([z.int().min(1).max(100_000), z.null()]),
  classLiveCapacityMax: z.union([z.int().min(1).max(100_000), z.null()]),
});

/**
 * Plan/package-level capacity ceilings of a Markaz (A109). Platform-level configuration, so a
 * Super Admin sets them (a Markaz Admin never sets global plan terms, A40). No numbers are
 * approved: NULL means "no ceiling" and nothing in code supplies a default (A33). A ceiling
 * below an existing class's configured value is refused — nothing is lowered silently.
 */
export async function setTenantCapacityLimits(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = limitsSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  if (!actor.isPlatformAdmin) throw new AuthorizationError();
  const { tenantId, classEnrollmentCapacityMax, classLiveCapacityMax } = parsed.data;
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new DomainError("not_found");
    const classes = await tx.class.findMany({ where: { tenantId, status: "ACTIVE" }, select: { enrollmentCapacity: true, liveCapacity: true } });
    const fits = classes.every(
      (c) => capacityWithinCeiling(c.enrollmentCapacity, classEnrollmentCapacityMax) && capacityWithinCeiling(c.liveCapacity, classLiveCapacityMax),
    );
    if (!fits) throw new DomainError("conflict");
    await tx.tenant.update({ where: { id: tenantId }, data: { classEnrollmentCapacityMax, classLiveCapacityMax } });
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId,
      action: "TENANT_CAPACITY_LIMITS_SET",
      targetType: "TENANT",
      targetId: tenantId,
      metadata: { classEnrollmentCapacityMax, classLiveCapacityMax },
      now,
    });
  });
}

// --- Classes ----------------------------------------------------------------------------------

const createSchema = z.object({
  tenantId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  primaryTeacherProfileId: z.uuid(),
  enrollmentCapacity: capacityInput,
  paymentRequired: z.boolean().optional(),
  liveCapacity: capacityInput,
});

/** A Markaz Admin creates a class WITH its Primary Teacher (exactly one, A103). */
export async function createClass(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const d = parsed.data;
  if (!canCreateClass(actor, d.tenantId)) throw new AuthorizationError();
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: d.tenantId }, select: { classEnrollmentCapacityMax: true, classLiveCapacityMax: true } });
  const enrollmentCapacity = d.enrollmentCapacity ?? null;
  const liveCapacity = d.liveCapacity ?? null;
  if (!capacityWithinCeiling(enrollmentCapacity, tenant.classEnrollmentCapacityMax) || !capacityWithinCeiling(liveCapacity, tenant.classLiveCapacityMax)) {
    throw new DomainError("limit_exceeded");
  }
  // Only an ACTIVE Teacher of THIS Markaz (also enforced by a DB trigger).
  if (!(await hasActiveMembership(db, d.tenantId, d.primaryTeacherProfileId, "TEACHER"))) throw new AuthorizationError();
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    const created = await tx.class.create({
      data: {
        tenantId: d.tenantId,
        name: d.name,
        subject: d.subject || null,
        description: d.description || null,
        enrollmentCapacity,
        paymentRequired: d.paymentRequired ?? false,
        liveCapacity,
        createdById: actor.profileId,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    await tx.classTeacherAssignment.create({
      data: { tenantId: d.tenantId, classId: created.id, teacherProfileId: d.primaryTeacherProfileId, role: "PRIMARY", assignedById: actor.profileId, assignedAt: now },
    });
    await recordAudit(tx, { actorId: actor.profileId, tenantId: d.tenantId, action: "CLASS_CREATED", targetType: "CLASS", targetId: created.id, now });
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: d.tenantId,
      action: "CLASS_TEACHER_ASSIGNED",
      targetType: "CLASS",
      targetId: created.id,
      metadata: { teacherProfileId: d.primaryTeacherProfileId, role: "PRIMARY" },
      now,
    });
    return created.id;
  });
}

const updateSchema = z.object({
  classId: z.uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  subject: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  enrollmentCapacity: capacityInput,
  liveCapacity: capacityInput,
  paymentRequired: z.boolean().optional(),
});

/**
 * A Markaz Admin edits class details and capacities (at or below the plan ceiling). Lowering
 * a capacity never removes anyone; it only affects who is admitted next.
 */
export async function updateClass(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const d = parsed.data;
  const cls = await loadClassContext(db, d.classId);
  if (!canManageClass(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  const enrollmentCapacity = d.enrollmentCapacity === undefined ? cls.enrollmentCapacity : d.enrollmentCapacity;
  const liveCapacity = d.liveCapacity === undefined ? cls.liveCapacity : d.liveCapacity;
  if (
    !capacityWithinCeiling(enrollmentCapacity, cls.tenant.classEnrollmentCapacityMax) ||
    !capacityWithinCeiling(liveCapacity, cls.tenant.classLiveCapacityMax)
  ) {
    throw new DomainError("limit_exceeded");
  }
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await tx.class.update({
      where: { id: cls.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.subject !== undefined ? { subject: d.subject || null } : {}),
        ...(d.description !== undefined ? { description: d.description || null } : {}),
        enrollmentCapacity,
        ...(d.paymentRequired !== undefined ? { paymentRequired: d.paymentRequired } : {}),
        liveCapacity,
        updatedAt: now,
      },
    });
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: cls.tenantId,
      action: "CLASS_UPDATED",
      targetType: "CLASS",
      targetId: cls.id,
      metadata: { enrollmentCapacity, liveCapacity, paymentRequired: d.paymentRequired ?? cls.paymentRequired },
      now,
    });
  });
}

/** A Markaz Admin archives a class: no new enrollments or sessions; all history is kept. */
export async function archiveClass(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = z.object({ classId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const cls = await loadClassContext(db, parsed.data.classId);
  if (!canManageClass(actor, cls)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const live = await tx.liveSession.count({ where: { classId: cls.id, status: "LIVE" } });
    if (live > 0) throw new DomainError("invalid_state");
    const { count } = await tx.class.updateMany({
      where: { id: cls.id, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: now, archivedById: actor.profileId, updatedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, { actorId: actor.profileId, tenantId: cls.tenantId, action: "CLASS_ARCHIVED", targetType: "CLASS", targetId: cls.id, now });
  });
}

// --- Teacher assignment (A103–A104) ------------------------------------------------------------

const assignSchema = z.object({ classId: z.uuid(), teacherProfileId: z.uuid(), role: z.enum(["PRIMARY", "CO_TEACHER"]) });

/**
 * A Markaz Admin assigns a teacher. PRIMARY replaces the current Primary in one transaction —
 * explicitly, never silently (A104); the previous row is ended and kept as history. Only an
 * ACTIVE Teacher of the same Markaz may be assigned (also a DB trigger).
 */
export async function assignClassTeacher(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { classId, teacherProfileId, role } = parsed.data;
  const cls = await loadClassContext(db, classId);
  if (!canManageClass(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  if (!(await hasActiveMembership(db, cls.tenantId, teacherProfileId, "TEACHER"))) throw new AuthorizationError();
  const now = options.now ?? new Date();
  const existing = cls.teachers.find((t) => t.teacherProfileId === teacherProfileId);
  const currentPrimary = cls.teachers.find((t) => t.role === "PRIMARY");
  if (existing?.role === role) throw new DomainError("conflict");
  if (role === "CO_TEACHER" && existing?.role === "PRIMARY") throw new DomainError("invalid_state"); // replace the Primary first

  await db.$transaction(async (tx) => {
    const end = async (assignmentId: string, endedTeacher: string, endedRole: string) => {
      const { count } = await tx.classTeacherAssignment.updateMany({ where: { id: assignmentId, endedAt: null }, data: { endedAt: now, endedById: actor.profileId } });
      if (count !== 1) throw new DomainError("conflict");
      await recordAudit(tx, {
        actorId: actor.profileId,
        tenantId: cls.tenantId,
        action: "CLASS_TEACHER_REMOVED",
        targetType: "CLASS",
        targetId: cls.id,
        metadata: { teacherProfileId: endedTeacher, role: endedRole },
        now,
      });
    };
    if (role === "PRIMARY") {
      if (currentPrimary) await end(currentPrimary.id, currentPrimary.teacherProfileId, "PRIMARY");
      if (existing) await end(existing.id, teacherProfileId, existing.role); // a Co-Teacher promoted to Primary
    }
    try {
      await tx.classTeacherAssignment.create({ data: { tenantId: cls.tenantId, classId: cls.id, teacherProfileId, role, assignedById: actor.profileId, assignedAt: now } });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError("conflict");
      throw error;
    }
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: cls.tenantId,
      action: "CLASS_TEACHER_ASSIGNED",
      targetType: "CLASS",
      targetId: cls.id,
      metadata: { teacherProfileId, role, replacedProfileId: role === "PRIMARY" ? (currentPrimary?.teacherProfileId ?? null) : null },
      now,
    });
  });
}

/**
 * A Markaz Admin ends a Co-Teacher assignment. The Primary cannot be removed — only replaced
 * (exactly one active Primary, A103). The ended row stays as history; nothing else is deleted.
 */
export async function removeCoTeacher(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = z.object({ assignmentId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const row = await db.classTeacherAssignment.findUnique({ where: { id: parsed.data.assignmentId }, select: { id: true, classId: true, role: true, teacherProfileId: true, endedAt: true } });
  if (!row) throw new AuthorizationError();
  const cls = await loadClassContext(db, row.classId);
  if (!canManageClass(actor, cls)) throw new AuthorizationError();
  if (row.role === "PRIMARY" || row.endedAt) throw new DomainError("invalid_state");
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.classTeacherAssignment.updateMany({ where: { id: row.id, endedAt: null }, data: { endedAt: now, endedById: actor.profileId } });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: cls.tenantId,
      action: "CLASS_TEACHER_REMOVED",
      targetType: "CLASS",
      targetId: cls.id,
      metadata: { teacherProfileId: row.teacherProfileId, role: row.role },
      now,
    });
  });
}

// --- Recurring schedule (A112) ------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const scheduleSchema = z.object({
  classId: z.uuid(),
  weekday: z.coerce.number().int().min(0).max(6),
  startTime: z.string().regex(TIME),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  validFrom: z.iso.date().optional(),
  validUntil: z.iso.date().optional(),
});

/** A Markaz Admin adds a weekly slot, in the MARKAZ's local time. */
export async function addClassSchedule(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const d = parsed.data;
  if (d.validFrom && d.validUntil && d.validUntil < d.validFrom) throw new DomainError("invalid_input");
  const cls = await loadClassContext(db, d.classId);
  if (!canManageClass(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  // A131: a weekly slot is Markaz-local wall time — meaningless until the zone is chosen.
  requireMarkazTimezone(cls.tenant.timezone);
  const [hh, mm] = d.startTime.split(":").map(Number);
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    const row = await tx.classSchedule.create({
      data: {
        tenantId: cls.tenantId,
        classId: cls.id,
        weekday: d.weekday,
        startMinute: hh * 60 + mm,
        durationMinutes: d.durationMinutes,
        validFrom: d.validFrom ? new Date(`${d.validFrom}T00:00:00Z`) : null,
        validUntil: d.validUntil ? new Date(`${d.validUntil}T00:00:00Z`) : null,
        createdById: actor.profileId,
        createdAt: now,
      },
      select: { id: true },
    });
    await recordAudit(tx, { actorId: actor.profileId, tenantId: cls.tenantId, action: "CLASS_SCHEDULE_ADDED", targetType: "CLASS", targetId: cls.id, now });
    return row.id;
  });
}

/** A Markaz Admin ends a weekly slot. Already generated sessions are untouched. */
export async function endClassSchedule(db: PrismaClient, actor: Actor, input: unknown, options: ClassOptions = {}) {
  const parsed = z.object({ scheduleId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const row = await db.classSchedule.findUnique({ where: { id: parsed.data.scheduleId }, select: { id: true, classId: true } });
  if (!row) throw new AuthorizationError();
  const cls = await loadClassContext(db, row.classId);
  if (!canManageClass(actor, cls)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.classSchedule.updateMany({ where: { id: row.id, endedAt: null }, data: { endedAt: now, endedById: actor.profileId } });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, { actorId: actor.profileId, tenantId: cls.tenantId, action: "CLASS_SCHEDULE_ENDED", targetType: "CLASS", targetId: cls.id, now });
  });
}

// --- Reads ----------------------------------------------------------------------------------------

/**
 * ACTIVE Teachers of a Markaz (id + display name only), for choosing a class teacher or a
 * session substitute. Markaz Admins and Teachers of that Markaz.
 */
export async function listActiveTeachers(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!isValidId(tenantId)) throw new AuthorizationError();
  if (!hasActiveRole(actor, tenantId, "MARKAZ_ADMIN") && !hasActiveRole(actor, tenantId, "TEACHER")) throw new AuthorizationError();
  const rows = await db.membership.findMany({
    where: { tenantId, role: "TEACHER", status: "ACTIVE" },
    select: { profileId: true, profile: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ profileId: r.profileId, displayName: r.profile.displayName }));
}

/** Plan capacity ceilings of every Markaz, for Super Admins. */
export async function listTenantCapacityLimits(db: PrismaClient, actor: Actor) {
  if (!actor.isPlatformAdmin) throw new AuthorizationError();
  return db.tenant.findMany({
    select: { id: true, name: true, classEnrollmentCapacityMax: true, classLiveCapacityMax: true },
    orderBy: { name: "asc" },
  });
}

/** The Markaz's time zone and plan ceilings (anyone with tenant access). */
export async function getTenantClassSettings(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!isValidId(tenantId) || !actor.memberships.some((m) => m.tenantId === tenantId && m.status === "ACTIVE")) throw new AuthorizationError();
  return db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, classEnrollmentCapacityMax: true, classLiveCapacityMax: true } });
}

/**
 * Classes of a Markaz visible to the actor: a Markaz Admin sees all; a teacher the classes they
 * are actively assigned to; a student the classes they hold an open enrollment in.
 */
export async function listClasses(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!isValidId(tenantId)) throw new AuthorizationError();
  const admin = hasActiveRole(actor, tenantId, "MARKAZ_ADMIN");
  const teacher = hasActiveRole(actor, tenantId, "TEACHER");
  const student = hasActiveRole(actor, tenantId, "STUDENT");
  if (!admin && !teacher && !student) throw new AuthorizationError();
  const or = [
    ...(teacher ? [{ teachers: { some: { teacherProfileId: actor.profileId, endedAt: null } } }] : []),
    ...(student ? [{ enrollments: { some: { studentProfileId: actor.profileId, status: { not: "ENDED" as const } } } }] : []),
  ];
  return db.class.findMany({
    where: admin ? { tenantId } : { tenantId, OR: or },
    select: {
      id: true,
      name: true,
      subject: true,
      status: true,
      enrollmentCapacity: true,
      liveCapacity: true,
      teachers: { where: { endedAt: null }, select: { role: true, teacherProfileId: true, teacher: { select: { displayName: true } } } },
      _count: { select: { enrollments: { where: { status: { in: [...SEAT_HOLDING_STATES] } } } } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

/**
 * Everything the class page shows, filtered by the actor's relation. Staff (assigned teachers,
 * Markaz Admin) see the roster, waitlist, schedules and payment state; a student sees only their
 * own enrollment state, the teachers and the sessions. Raw presence is never part of this.
 */
export async function getClassOverview(db: PrismaClient, actor: Actor, classId: unknown, options: ClassOptions = {}) {
  const now = options.now ?? new Date();
  const cls = await loadClassContext(db, classId);
  const access = await enrollmentAccess(db, cls.id, actor.profileId, now);
  if (!canReadClass(actor, cls, access)) throw new AuthorizationError();
  const staff = canViewClassAsStaff(actor, cls);
  const relation = classRelation(actor, cls);

  const [teachers, sessions, schedules, enrollments] = await Promise.all([
    db.classTeacherAssignment.findMany({
      where: { classId: cls.id },
      select: { id: true, role: true, teacherProfileId: true, assignedAt: true, endedAt: true, teacher: { select: { displayName: true } } },
      orderBy: { assignedAt: "asc" },
    }),
    db.liveSession.findMany({
      where: { classId: cls.id },
      select: {
        id: true,
        kind: true,
        status: true,
        title: true,
        scheduledStartAt: true,
        scheduledEndAt: true,
        recordingEnabled: true,
        substituteProfileId: true,
        substitute: { select: { displayName: true } },
        endReason: true,
      },
      orderBy: { scheduledStartAt: "desc" },
      take: 100,
    }),
    db.classSchedule.findMany({
      where: { classId: cls.id, endedAt: null },
      select: { id: true, weekday: true, startMinute: true, durationMinutes: true, validFrom: true, validUntil: true },
      orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
    }),
    staff
      ? db.classEnrollment.findMany({
          where: { classId: cls.id },
          select: {
            id: true,
            studentProfileId: true,
            status: true,
            enrolledAt: true,
            waitlistedAt: true,
            accessUntil: true,
            graceUntil: true,
            capacityOverrideAt: true,
            capacityOverrideReason: true,
            queueOverrideReason: true,
            endedAt: true,
            student: { select: { profile: { select: { displayName: true } } } },
          },
          orderBy: [{ waitlistedAt: "asc" }, { enrolledAt: "asc" }],
        })
      : db.classEnrollment.findMany({
          where: { classId: cls.id, studentProfileId: actor.profileId, status: { not: "ENDED" } },
          select: { id: true, studentProfileId: true, status: true, enrolledAt: true, waitlistedAt: true, accessUntil: true, graceUntil: true, capacityOverrideAt: true, capacityOverrideReason: true, queueOverrideReason: true, endedAt: true, student: { select: { profile: { select: { displayName: true } } } } },
        }),
  ]);

  const withState = enrollments.map((e) => ({ ...e, effectiveStatus: effectiveEnrollmentState(e, now) }));
  const seatsTaken = withState.filter((e) => SEAT_HOLDING_STATES.includes(e.effectiveStatus)).length;
  return {
    class: {
      id: cls.id,
      tenantId: cls.tenantId,
      name: cls.name,
      subject: cls.subject,
      description: cls.description,
      status: cls.status,
      enrollmentCapacity: cls.enrollmentCapacity,
      paymentRequired: cls.paymentRequired,
      liveCapacity: cls.liveCapacity,
      timezone: cls.tenant.timezone,
      ceilings: { enrollment: cls.tenant.classEnrollmentCapacityMax, live: cls.tenant.classLiveCapacityMax },
      effectiveEnrollmentCapacity: effectiveCapacity(cls.enrollmentCapacity, cls.tenant.classEnrollmentCapacityMax),
      effectiveLiveCapacity: effectiveCapacity(cls.liveCapacity, cls.tenant.classLiveCapacityMax),
    },
    relation,
    staff,
    myAccess: access,
    // Students see only current teachers; staff also see ended rows (history).
    teachers: staff ? teachers : teachers.filter((t) => !t.endedAt).map((t) => ({ ...t, teacherProfileId: t.teacherProfileId })),
    sessions,
    schedules,
    enrollments: withState,
    seatsTaken: staff ? seatsTaken : null,
  };
}
