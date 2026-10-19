import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuditAction } from "@/generated/prisma/enums";
import { canExtendGrace, canManageEnrollment, canOverrideCapacity, canSubmitPayment, canVerifyPayment } from "@/server/authz/live-class";
import { AuthorizationError, isValidId, type Actor } from "@/server/authz/policy";
import { recordAudit, type Tx } from "./audit";
import { hasActiveMembership, loadClassContext, lockClass, type LoadedClass } from "./class-context";
import { DomainError, isUniqueViolation } from "./errors";
import { effectiveCapacity, effectiveEnrollmentState, graceDeadline, SEAT_HOLDING_STATES, type EnrollmentState } from "./live-rules";

// Enrollment, waitlist, grace and MANUAL payment/access verification (owner TO-BE approval
// 2026-10-19, A106–A110).
//
//   (enroll) ──seat free──▶ ACTIVE ──access period ends──▶ GRACE (7 days, extendable) ──▶ SUSPENDED
//      │                     ▲                                │                             │
//      └─class full─▶ WAITLISTED ──admit──┘   verified renewal └──────────▶ ACTIVE ◀─────────┘
//   any open state ──end (staff)──▶ ENDED (row kept as history)
//
// Payment: an assigned teacher or Markaz Admin SUBMITS evidence (a reference, never the evidence
// itself); only a Markaz Admin VERIFIES (A107). Verification extends access_until and returns
// GRACE/SUSPENDED enrollments to ACTIVE. No amounts, currencies, prices, providers, invoices,
// refunds or revenue sharing exist here — none are decided (A34).

export type EnrollmentOptions = { now?: Date };

async function audit(tx: Tx, actorId: string | null, tenantId: string, action: AuditAction, targetId: string, now: Date, metadata?: Record<string, string | number | boolean | null>) {
  await recordAudit(tx, { actorId, tenantId, action, targetType: "CLASS_ENROLLMENT", targetId, metadata, now });
}

/** Seats currently held in a class (ACTIVE, GRACE, SUSPENDED — students only, A109). */
async function seatsTaken(tx: Tx, classId: string, now: Date) {
  const rows = await tx.classEnrollment.findMany({
    where: { classId, status: { in: [...SEAT_HOLDING_STATES] } },
    select: { status: true, accessUntil: true, graceUntil: true },
  });
  return rows.filter((r) => SEAT_HOLDING_STATES.includes(effectiveEnrollmentState(r, now))).length;
}

function hasFreeSeat(cls: LoadedClass, taken: number) {
  const capacity = effectiveCapacity(cls.enrollmentCapacity, cls.tenant.classEnrollmentCapacityMax);
  return capacity === null || taken < capacity;
}

const overrideReason = z.string().trim().min(1).max(500).optional();
const enrollSchema = z.object({ classId: z.uuid(), studentProfileId: z.uuid(), overrideReason });

/**
 * An assigned teacher or a Markaz Admin enrolls an ACTIVE student of the class's Markaz (A106).
 * Class full → WAITLISTED (A110), unless a Markaz Admin gives a controlled override with a reason
 * (recorded on the row and audited). Capacity counts students only.
 */
export async function enrollStudent(db: PrismaClient, actor: Actor, input: unknown, options: EnrollmentOptions = {}) {
  const parsed = enrollSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { classId, studentProfileId, overrideReason: reason } = parsed.data;
  const cls = await loadClassContext(db, classId);
  if (!canManageEnrollment(actor, cls)) throw new AuthorizationError();
  if (reason && !canOverrideCapacity(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  // An ACTIVE student membership in THIS Markaz (also a DB trigger). Anything else looks forbidden.
  if (!(await hasActiveMembership(db, cls.tenantId, studentProfileId, "STUDENT"))) throw new AuthorizationError();
  const now = options.now ?? new Date();

  return db.$transaction(async (tx) => {
    await lockClass(tx, cls.id);
    const free = hasFreeSeat(cls, await seatsTaken(tx, cls.id, now));
    const status: EnrollmentState = free || reason ? "ACTIVE" : "WAITLISTED";
    let id: string;
    try {
      const row = await tx.classEnrollment.create({
        data: {
          tenantId: cls.tenantId,
          classId: cls.id,
          studentProfileId,
          status,
          enrolledById: actor.profileId,
          enrolledAt: now,
          statusChangedAt: now,
          waitlistedAt: status === "WAITLISTED" ? now : null,
          ...(!free && reason ? { capacityOverrideById: actor.profileId, capacityOverrideAt: now, capacityOverrideReason: reason } : {}),
        },
        select: { id: true },
      });
      id = row.id;
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError("conflict"); // already has an open enrollment
      throw error;
    }
    await audit(tx, actor.profileId, cls.tenantId, status === "WAITLISTED" ? "ENROLLMENT_WAITLISTED" : "ENROLLMENT_CREATED", id, now, { classId: cls.id });
    if (!free && reason) {
      await recordAudit(tx, { actorId: actor.profileId, tenantId: cls.tenantId, action: "CLASS_CAPACITY_OVERRIDE", targetType: "CLASS", targetId: cls.id, metadata: { enrollmentId: id }, now });
    }
    return { enrollmentId: id, status };
  });
}

async function loadEnrollment(db: Tx | PrismaClient, enrollmentId: unknown) {
  if (!isValidId(enrollmentId)) throw new AuthorizationError();
  const e = await db.classEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, classId: true, tenantId: true, studentProfileId: true, status: true, accessUntil: true, graceUntil: true },
  });
  if (!e) throw new AuthorizationError();
  return e;
}

const admitSchema = z.object({ enrollmentId: z.uuid(), overrideReason });

/** Admit a WAITLISTED student when a seat is free (or by a Markaz Admin override). */
export async function admitFromWaitlist(db: PrismaClient, actor: Actor, input: unknown, options: EnrollmentOptions = {}) {
  const parsed = admitSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const e = await loadEnrollment(db, parsed.data.enrollmentId);
  const cls = await loadClassContext(db, e.classId);
  const reason = parsed.data.overrideReason;
  if (!canManageEnrollment(actor, cls)) throw new AuthorizationError();
  if (reason && !canOverrideCapacity(actor, cls)) throw new AuthorizationError();
  if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  if (!(await hasActiveMembership(db, cls.tenantId, e.studentProfileId, "STUDENT"))) throw new DomainError("access_inactive");
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    await lockClass(tx, cls.id);
    const free = hasFreeSeat(cls, await seatsTaken(tx, cls.id, now));
    if (!free && !reason) throw new DomainError("limit_exceeded");
    const { count } = await tx.classEnrollment.updateMany({
      where: { id: e.id, status: "WAITLISTED" },
      data: {
        status: "ACTIVE",
        statusChangedAt: now,
        ...(!free && reason ? { capacityOverrideById: actor.profileId, capacityOverrideAt: now, capacityOverrideReason: reason } : {}),
      },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await audit(tx, actor.profileId, cls.tenantId, "ENROLLMENT_ADMITTED_FROM_WAITLIST", e.id, now);
    if (!free && reason) {
      await recordAudit(tx, { actorId: actor.profileId, tenantId: cls.tenantId, action: "CLASS_CAPACITY_OVERRIDE", targetType: "CLASS", targetId: cls.id, metadata: { enrollmentId: e.id }, now });
    }
  });
}

/** End an enrollment (any open state). The row is kept as history (A106). */
export async function endEnrollment(db: PrismaClient, actor: Actor, input: unknown, options: EnrollmentOptions = {}) {
  const parsed = z.object({ enrollmentId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const e = await loadEnrollment(db, parsed.data.enrollmentId);
  const cls = await loadClassContext(db, e.classId);
  if (!canManageEnrollment(actor, cls)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.classEnrollment.updateMany({
      where: { id: e.id, status: { not: "ENDED" } },
      data: { status: "ENDED", endedAt: now, endedById: actor.profileId, statusChangedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await audit(tx, actor.profileId, cls.tenantId, "ENROLLMENT_ENDED", e.id, now, { from: e.status });
  });
}

// --- Grace (A108) ------------------------------------------------------------------------------

const graceSchema = z.object({
  enrollmentId: z.uuid(),
  /** Manually chosen date (YYYY-MM-DD → end of that UTC day) or instant. No maximum (A108). */
  graceUntil: z.union([z.iso.datetime({ offset: true }), z.iso.date()]),
  reason: z.string().trim().min(1).max(500),
});

/**
 * An assigned teacher of the class or a Markaz Admin extends grace for a student whose access
 * period has ended (effective GRACE or SUSPENDED). Records student/enrollment, new date, reason,
 * grantor and time; audited. A SUSPENDED student returns to GRACE until the new date.
 */
export async function extendGrace(db: PrismaClient, actor: Actor, input: unknown, options: EnrollmentOptions = {}) {
  const parsed = graceSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const e = await loadEnrollment(db, parsed.data.enrollmentId);
  const cls = await loadClassContext(db, e.classId);
  if (!canExtendGrace(actor, cls)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  const until = parsed.data.graceUntil.length === 10 ? new Date(`${parsed.data.graceUntil}T23:59:59Z`) : new Date(parsed.data.graceUntil);
  if (until.getTime() <= now.getTime()) throw new DomainError("invalid_input");
  const state = effectiveEnrollmentState(e, now);
  if (state !== "GRACE" && state !== "SUSPENDED") throw new DomainError("invalid_state");
  const previous = e.accessUntil ? graceDeadline(e.accessUntil, e.graceUntil) : e.graceUntil;
  await db.$transaction(async (tx) => {
    const { count } = await tx.classEnrollment.updateMany({
      where: { id: e.id, status: e.status },
      data: { status: "GRACE", graceUntil: until, statusChangedAt: now },
    });
    if (count !== 1) throw new DomainError("conflict");
    await tx.graceExtension.create({
      data: { tenantId: cls.tenantId, enrollmentId: e.id, previousGraceUntil: previous, graceUntil: until, reason: parsed.data.reason, grantedById: actor.profileId, grantedAt: now },
    });
    await audit(tx, actor.profileId, cls.tenantId, "GRACE_EXTENDED", e.id, now, { from: state, graceUntil: until.toISOString() });
  });
}

/**
 * Deterministic lifecycle step (A108) — a SAFE, re-runnable entry point for a future scheduled
 * job. NOT scheduled anywhere (no production scheduler is authorized). Access decisions never
 * depend on it having run: they use effectiveEnrollmentState().
 */
export async function advanceEnrollmentStates(db: PrismaClient, now: Date = new Date()) {
  const rows = await db.classEnrollment.findMany({
    where: { status: { in: ["ACTIVE", "GRACE"] }, accessUntil: { not: null, lt: now } },
    select: { id: true, tenantId: true, status: true, accessUntil: true, graceUntil: true },
  });
  let grace = 0;
  let suspended = 0;
  for (const e of rows) {
    const next = effectiveEnrollmentState(e, now);
    if (next === e.status) continue;
    await db.$transaction(async (tx) => {
      const graceUntil = e.graceUntil ?? graceDeadline(e.accessUntil as Date, null);
      const { count } = await tx.classEnrollment.updateMany({
        where: { id: e.id, status: e.status },
        data: { status: next, graceUntil, statusChangedAt: now },
      });
      if (count !== 1) return;
      await audit(tx, null, e.tenantId, next === "GRACE" ? "ENROLLMENT_GRACE_STARTED" : "ENROLLMENT_SUSPENDED", e.id, now, { from: e.status });
      if (next === "GRACE") grace++;
      else suspended++;
    });
  }
  return { grace, suspended };
}

// --- Manual payment/access verification (A107) -------------------------------------------------

const submitSchema = z.object({
  tenantId: z.uuid(),
  studentProfileId: z.uuid(),
  enrollmentIds: z.array(z.uuid()).min(1).max(50),
  coverageNote: z.string().trim().min(1).max(500),
  evidenceReference: z.string().trim().min(1).max(200),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
});

/**
 * Submit payment evidence for an access period. Covers one or more of the student's enrollments
 * (a class, a subject's classes, a package…). The submitter must be allowed for EVERY covered
 * class. Submission grants nothing — only verification does.
 */
export async function submitPaymentEvidence(db: PrismaClient, actor: Actor, input: unknown, options: EnrollmentOptions = {}) {
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const d = parsed.data;
  const periodStart = new Date(`${d.periodStart}T00:00:00Z`);
  const periodEnd = new Date(`${d.periodEnd}T23:59:59Z`);
  if (periodEnd <= periodStart) throw new DomainError("invalid_input");
  const ids = [...new Set(d.enrollmentIds)];
  const enrollments = await db.classEnrollment.findMany({
    where: { id: { in: ids }, tenantId: d.tenantId, studentProfileId: d.studentProfileId, status: { notIn: ["ENDED", "WAITLISTED"] } },
    select: { id: true, classId: true },
  });
  if (enrollments.length !== ids.length) throw new AuthorizationError();
  for (const classId of new Set(enrollments.map((e) => e.classId))) {
    if (!canSubmitPayment(actor, await loadClassContext(db, classId))) throw new AuthorizationError();
  }
  const now = options.now ?? new Date();
  return db.$transaction(async (tx) => {
    const row = await tx.accessPaymentSubmission.create({
      data: {
        tenantId: d.tenantId,
        studentProfileId: d.studentProfileId,
        coverageNote: d.coverageNote,
        evidenceReference: d.evidenceReference,
        periodStart,
        periodEnd,
        submittedById: actor.profileId,
        submittedAt: now,
      },
      select: { id: true },
    });
    await tx.accessPaymentSubmissionEnrollment.createMany({ data: ids.map((enrollmentId) => ({ submissionId: row.id, enrollmentId, tenantId: d.tenantId })) });
    // The reference text is NOT copied into the audit trail.
    await recordAudit(tx, { actorId: actor.profileId, tenantId: d.tenantId, action: "PAYMENT_ACCESS_SUBMITTED", targetType: "PAYMENT_SUBMISSION", targetId: row.id, metadata: { enrollments: ids.length }, now });
    return row.id;
  });
}

async function loadSubmission(db: PrismaClient, submissionId: unknown) {
  if (!isValidId(submissionId)) throw new AuthorizationError();
  const s = await db.accessPaymentSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, tenantId: true, status: true, periodEnd: true, enrollments: { select: { enrollmentId: true } } },
  });
  if (!s) throw new AuthorizationError();
  return s;
}

/**
 * A Markaz Admin verifies a submission: access is extended to the period end and every covered
 * open enrollment in GRACE or SUSPENDED returns to ACTIVE (renewal restores access).
 */
export async function verifyPayment(db: PrismaClient, actor: Actor, input: unknown, options: EnrollmentOptions = {}) {
  const parsed = z.object({ submissionId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const s = await loadSubmission(db, parsed.data.submissionId);
  if (!canVerifyPayment(actor, s.tenantId)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.accessPaymentSubmission.updateMany({
      where: { id: s.id, status: "SUBMITTED" },
      data: { status: "VERIFIED", verifiedById: actor.profileId, verifiedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    const rows = await tx.classEnrollment.findMany({
      where: { id: { in: s.enrollments.map((e) => e.enrollmentId) }, status: { notIn: ["ENDED", "WAITLISTED"] } },
      select: { id: true, status: true, accessUntil: true, graceUntil: true },
    });
    for (const e of rows) {
      const before = effectiveEnrollmentState(e, now);
      const accessUntil = e.accessUntil && e.accessUntil > s.periodEnd ? e.accessUntil : s.periodEnd;
      await tx.classEnrollment.update({ where: { id: e.id }, data: { status: "ACTIVE", accessUntil, graceUntil: null, statusChangedAt: now } });
      if (before === "GRACE" || before === "SUSPENDED") await audit(tx, actor.profileId, s.tenantId, "ENROLLMENT_REACTIVATED", e.id, now, { from: before });
    }
    await recordAudit(tx, { actorId: actor.profileId, tenantId: s.tenantId, action: "PAYMENT_ACCESS_VERIFIED", targetType: "PAYMENT_SUBMISSION", targetId: s.id, metadata: { enrollments: rows.length }, now });
  });
}

/** A Markaz Admin rejects a submission (optional reason). Access is untouched. */
export async function rejectPayment(db: PrismaClient, actor: Actor, input: unknown, options: EnrollmentOptions = {}) {
  const parsed = z.object({ submissionId: z.uuid(), reason: z.string().trim().max(500).optional() }).safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const s = await loadSubmission(db, parsed.data.submissionId);
  if (!canVerifyPayment(actor, s.tenantId)) throw new AuthorizationError();
  const now = options.now ?? new Date();
  await db.$transaction(async (tx) => {
    const { count } = await tx.accessPaymentSubmission.updateMany({
      where: { id: s.id, status: "SUBMITTED" },
      data: { status: "REJECTED", rejectedById: actor.profileId, rejectedAt: now, rejectionReason: parsed.data.reason || null },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, { actorId: actor.profileId, tenantId: s.tenantId, action: "PAYMENT_ACCESS_REJECTED", targetType: "PAYMENT_SUBMISSION", targetId: s.id, now });
  });
}

/** Payment submissions of a Markaz, for its Markaz Admins (the verifiers). */
export async function listPaymentSubmissions(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!canVerifyPayment(actor, tenantId)) throw new AuthorizationError();
  return db.accessPaymentSubmission.findMany({
    where: { tenantId: tenantId as string },
    select: {
      id: true,
      status: true,
      coverageNote: true,
      evidenceReference: true,
      periodStart: true,
      periodEnd: true,
      submittedAt: true,
      student: { select: { profile: { select: { displayName: true } } } },
      enrollments: { select: { enrollment: { select: { class: { select: { name: true } } } } } },
    },
    orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
    take: 200,
  });
}

/** A student's grace extensions (staff of the class only). */
export async function listGraceExtensions(db: PrismaClient, actor: Actor, enrollmentId: unknown) {
  const e = await loadEnrollment(db, enrollmentId);
  const cls = await loadClassContext(db, e.classId);
  if (!canExtendGrace(actor, cls)) throw new AuthorizationError();
  return db.graceExtension.findMany({ where: { enrollmentId: e.id }, orderBy: { grantedAt: "desc" } });
}
