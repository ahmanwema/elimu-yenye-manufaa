import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  canRecordOfflineConsent,
  hasActiveParentLink,
  hasActiveRole,
  isValidId,
  type Actor,
} from "@/server/authz/policy";
import {
  evaluateRecordingEligibility,
  minorStatus,
  RECORDING_CONSENT_POLICY,
  type ConsentPolicy,
  type EligibilityResult,
  type LiveConsent,
  type MinorStatus,
} from "@/server/authz/recording-consent";
import { recordAudit, type Tx } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";

// Recording consent & date of birth (owner decisions 2026-10-14, A70–A72).
//
// - DOB is stored; minor status is derived from it (never stored).
// - Minors: an ACTIVE-linked guardian consents online, OR a Markaz Admin records VERIFIED
//   OFFLINE consent after checking evidence (only a reference to it is stored).
// - One consent covers correction clips and full recordings.
// - Withdrawal blocks FUTURE capture and sends existing affected media to the deletion
//   review workflow — nothing is hard-deleted here.
//
// INTERIM choices (owner to confirm; documented in docs/roadmap/open-questions.md):
//   who may record a DOB; who may withdraw; guardian consent requires the guardian to STILL
//   hold an ACTIVE link; offline consent applies only in the verifying Markaz.

export type ConsentOptions = { now?: Date; policy?: ConsentPolicy };

const opts = (o: ConsentOptions = {}) => ({ now: o.now ?? new Date(), policy: o.policy ?? RECORDING_CONSENT_POLICY });

async function studentIsActiveIn(db: Tx | PrismaClient, tenantId: string, studentProfileId: string) {
  const m = await db.membership.findFirst({
    where: { tenantId, profileId: studentProfileId, role: "STUDENT", status: "ACTIVE" },
    select: { id: true },
  });
  return m !== null;
}

/** Live consents of a student, with whether each consenting guardian is still ACTIVE-linked. */
async function loadLiveConsents(db: Tx | PrismaClient, studentProfileId: string): Promise<LiveConsent[]> {
  const rows = await db.recordingConsent.findMany({
    where: { studentProfileId, withdrawnAt: null },
    select: { id: true, method: true, tenantId: true, guardianProfileId: true },
  });
  const guardians = rows.filter((r) => r.guardianProfileId).map((r) => r.guardianProfileId as string);
  const activeLinks = guardians.length
    ? await db.parentStudentLink.findMany({
        where: { studentProfileId, parentProfileId: { in: guardians }, status: "ACTIVE" },
        select: { parentProfileId: true },
      })
    : [];
  const active = new Set(activeLinks.map((l) => l.parentProfileId));
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    tenantId: r.tenantId,
    guardianLinkActive: r.guardianProfileId !== null && active.has(r.guardianProfileId),
  }));
}

/** May this student's audio be captured into recorded media in this Markaz, now? */
export async function getRecordingEligibility(
  db: Tx | PrismaClient,
  studentProfileId: string,
  tenantId: string,
  options: ConsentOptions = {},
): Promise<EligibilityResult> {
  const { now, policy } = opts(options);
  const student = await db.studentAccount.findUnique({ where: { profileId: studentProfileId }, select: { dateOfBirth: true } });
  if (!student) return { eligible: false, eligibility: "NO_CONSENT" };
  return evaluateRecordingEligibility({
    dateOfBirth: student.dateOfBirth,
    consents: await loadLiveConsents(db, studentProfileId),
    tenantId,
    now,
    policy,
  });
}

/** Throws DomainError("consent_required") unless the student's audio may be captured. */
export async function requireRecordingEligibility(
  db: Tx | PrismaClient,
  studentProfileId: string,
  tenantId: string,
  options: ConsentOptions = {},
) {
  const result = await getRecordingEligibility(db, studentProfileId, tenantId, options);
  if (!result.eligible) throw new DomainError("consent_required");
  return result;
}

// --- Date of birth ---------------------------------------------------------------------

const dobSchema = z.object({
  studentProfileId: z.uuid(),
  dateOfBirth: z.iso.date(),
});

/**
 * Who may record a DOB (INTERIM, owner to confirm): a guardian with an ACTIVE link, or a
 * Markaz Admin of a Markaz where the student is ACTIVE. The value itself is never audited.
 */
export async function recordDateOfBirth(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now } = opts(options);
  const parsed = dobSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { studentProfileId } = parsed.data;
  const dob = new Date(`${parsed.data.dateOfBirth}T00:00:00Z`);
  if (dob.getTime() > now.getTime() || dob.getUTCFullYear() < 1900) throw new DomainError("invalid_input");

  let tenantId: string | null = null;
  if (!hasActiveParentLink(actor, studentProfileId)) {
    const adminTenants = actor.memberships.filter((m) => m.role === "MARKAZ_ADMIN" && m.status === "ACTIVE").map((m) => m.tenantId);
    const membership = adminTenants.length
      ? await db.membership.findFirst({
          where: { profileId: studentProfileId, role: "STUDENT", status: "ACTIVE", tenantId: { in: adminTenants } },
          select: { tenantId: true },
        })
      : null;
    if (!membership) throw new AuthorizationError();
    tenantId = membership.tenantId;
  }

  await db.$transaction(async (tx) => {
    const { count } = await tx.studentAccount.updateMany({
      where: { profileId: studentProfileId },
      data: { dateOfBirth: dob, dateOfBirthRecordedById: actor.profileId, dateOfBirthRecordedAt: now },
    });
    if (count !== 1) throw new DomainError("not_found");
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId,
      action: "DATE_OF_BIRTH_RECORDED",
      targetType: "STUDENT_ACCOUNT",
      targetId: studentProfileId,
      now,
    });
  });
}

// --- Giving consent ----------------------------------------------------------------------

const studentSchema = z.object({ studentProfileId: z.uuid() });

/** A guardian with an ACTIVE link consents online (A71 default path). */
export async function giveGuardianConsent(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now } = opts(options);
  const parsed = studentSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { studentProfileId } = parsed.data;
  if (!hasActiveParentLink(actor, studentProfileId)) throw new AuthorizationError();
  try {
    return await db.$transaction(async (tx) => {
      const consent = await tx.recordingConsent.create({
        data: {
          studentProfileId,
          method: "GUARDIAN_ONLINE",
          guardianProfileId: actor.profileId,
          recordedById: actor.profileId,
          grantedAt: now,
          createdAt: now,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorId: actor.profileId,
        tenantId: null,
        action: "CONSENT_GIVEN",
        targetType: "RECORDING_CONSENT",
        targetId: consent.id,
        metadata: { method: "GUARDIAN_ONLINE" },
        now,
      });
      return consent.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

const offlineSchema = z.object({
  tenantId: z.uuid(),
  studentProfileId: z.uuid(),
  consenterDescription: z.string().trim().min(1).max(200),
  evidenceReference: z.string().trim().min(1).max(200),
});

/**
 * A Markaz Admin records VERIFIED OFFLINE consent after checking evidence (A71). Only a
 * short description of who consented and a reference to the evidence are stored — never the
 * evidence itself. Applies in this Markaz only (INTERIM, owner to confirm).
 */
export async function recordOfflineConsent(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now } = opts(options);
  const parsed = offlineSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, studentProfileId, consenterDescription, evidenceReference } = parsed.data;
  if (!canRecordOfflineConsent(actor, tenantId)) throw new AuthorizationError();
  if (!(await studentIsActiveIn(db, tenantId, studentProfileId))) throw new AuthorizationError();
  try {
    return await db.$transaction(async (tx) => {
      const consent = await tx.recordingConsent.create({
        data: {
          studentProfileId,
          method: "OFFLINE_VERIFIED",
          tenantId,
          offlineConsenterDescription: consenterDescription,
          evidenceReference,
          recordedById: actor.profileId,
          grantedAt: now,
          createdAt: now,
        },
        select: { id: true },
      });
      await recordAudit(tx, {
        actorId: actor.profileId,
        tenantId,
        action: "CONSENT_OFFLINE_VERIFIED",
        targetType: "RECORDING_CONSENT",
        targetId: consent.id,
        now,
      });
      return consent.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

// --- Withdrawal --------------------------------------------------------------------------

const consentIdSchema = z.object({ consentId: z.uuid() });

/**
 * Withdraws a consent (A72). Who (INTERIM, owner to confirm): online consent — any guardian
 * with an ACTIVE link to the student; offline consent — a Markaz Admin of its Markaz.
 *
 * Effects: future capture is blocked by the eligibility check. Every live clip / recording of
 * the student in a Markaz where they are no longer eligible gets a PENDING deletion request
 * (reason CONSENT_WITHDRAWN) for a Markaz Admin to review. Nothing is deleted here.
 * Returns how many items were sent to review.
 */
export async function withdrawConsent(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now, policy } = opts(options);
  const parsed = consentIdSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const consent = await db.recordingConsent.findUnique({
    where: { id: parsed.data.consentId },
    select: { id: true, method: true, tenantId: true, studentProfileId: true, withdrawnAt: true },
  });
  if (!consent) throw new AuthorizationError();
  const allowed =
    consent.method === "GUARDIAN_ONLINE"
      ? hasActiveParentLink(actor, consent.studentProfileId)
      : consent.tenantId !== null && hasActiveRole(actor, consent.tenantId, "MARKAZ_ADMIN");
  if (!allowed) throw new AuthorizationError();
  if (consent.withdrawnAt) throw new DomainError("invalid_state");

  return db.$transaction(async (tx) => {
    const { count } = await tx.recordingConsent.updateMany({
      where: { id: consent.id, withdrawnAt: null },
      data: { withdrawnAt: now, withdrawnById: actor.profileId },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: consent.tenantId,
      action: "CONSENT_WITHDRAWN",
      targetType: "RECORDING_CONSENT",
      targetId: consent.id,
      now,
    });
    return flagMediaForReview(tx, actor.profileId, consent.studentProfileId, consent.id, { now, policy });
  });
}

/** Creates CONSENT_WITHDRAWN deletion requests for media the student is no longer eligible for. */
async function flagMediaForReview(
  tx: Tx,
  actorId: string,
  studentProfileId: string,
  consentId: string,
  options: { now: Date; policy: ConsentPolicy },
) {
  const clips = await tx.correctionAudioClip.findMany({
    where: {
      deletedAt: null,
      status: "FINALIZED",
      correction: { studentProfileId },
      deletionRequests: { none: { status: "PENDING" } },
    },
    select: { id: true, tenantId: true },
  });
  const recordings = await tx.recording.findMany({
    where: {
      deletedAt: null,
      participants: { some: { studentProfileId, audioIncluded: true } },
      deletionRequests: { none: { status: "PENDING" } },
    },
    select: { id: true, tenantId: true },
  });

  const eligibleIn = new Map<string, boolean>();
  const stillEligible = async (tenantId: string) => {
    if (!eligibleIn.has(tenantId)) {
      eligibleIn.set(tenantId, (await getRecordingEligibility(tx, studentProfileId, tenantId, options)).eligible);
    }
    return eligibleIn.get(tenantId) as boolean;
  };

  let flagged = 0;
  const targets = [
    ...clips.map((c) => ({ tenantId: c.tenantId, clipId: c.id, recordingId: null as string | null })),
    ...recordings.map((r) => ({ tenantId: r.tenantId, clipId: null as string | null, recordingId: r.id })),
  ];
  for (const t of targets) {
    if (await stillEligible(t.tenantId)) continue;
    const request = await tx.mediaDeletionRequest.create({
      data: {
        tenantId: t.tenantId,
        clipId: t.clipId,
        recordingId: t.recordingId,
        reason: "CONSENT_WITHDRAWN",
        consentId,
        requestedById: actorId,
        requestedAt: options.now,
      },
      select: { id: true },
    });
    await recordAudit(tx, {
      actorId,
      tenantId: t.tenantId,
      action: "MEDIA_DELETION_REQUESTED",
      targetType: "MEDIA_DELETION_REQUEST",
      targetId: request.id,
      metadata: { reason: "CONSENT_WITHDRAWN" },
      now: options.now,
    });
    flagged++;
  }
  return flagged;
}

// --- Read models for the UI ----------------------------------------------------------------

export type ConsentSummary = {
  studentProfileId: string;
  dateOfBirthRecorded: boolean;
  minorStatus: MinorStatus;
  consents: { id: string; method: "GUARDIAN_ONLINE" | "OFFLINE_VERIFIED"; tenantId: string | null; mine: boolean; grantedAt: Date }[];
};

async function summarize(
  db: PrismaClient,
  actor: Actor,
  studentProfileIds: string[],
  filter: (c: { method: string; tenantId: string | null }) => boolean,
  options: ConsentOptions,
): Promise<ConsentSummary[]> {
  const { now, policy } = opts(options);
  const students = await db.studentAccount.findMany({
    where: { profileId: { in: studentProfileIds } },
    select: {
      profileId: true,
      dateOfBirth: true,
      recordingConsents: {
        where: { withdrawnAt: null },
        select: { id: true, method: true, tenantId: true, guardianProfileId: true, recordedById: true, grantedAt: true },
      },
    },
  });
  return students.map((s) => ({
    studentProfileId: s.profileId,
    dateOfBirthRecorded: s.dateOfBirth !== null,
    minorStatus: minorStatus(s.dateOfBirth, now, policy),
    consents: s.recordingConsents.filter(filter).map((c) => ({
      id: c.id,
      method: c.method,
      tenantId: c.tenantId,
      mine: c.guardianProfileId === actor.profileId || c.recordedById === actor.profileId,
      grantedAt: c.grantedAt,
    })),
  }));
}

/** For a guardian: consent state of each ACTIVE-linked child (online consents + any offline). */
export async function listMyChildrenConsent(db: PrismaClient, actor: Actor, options: ConsentOptions = {}) {
  const children = actor.parentLinks.filter((l) => l.status === "ACTIVE").map((l) => l.studentProfileId);
  if (children.length === 0) return [];
  return summarize(db, actor, children, () => true, options);
}

/** For a Markaz Admin: consent state of the Markaz's ACTIVE students (offline consents of this Markaz + online). */
export async function listTenantConsentOverview(db: PrismaClient, actor: Actor, tenantId: unknown, options: ConsentOptions = {}) {
  if (!isValidId(tenantId) || !canRecordOfflineConsent(actor, tenantId)) throw new AuthorizationError();
  const members = await db.membership.findMany({
    where: { tenantId, role: "STUDENT", status: "ACTIVE" },
    select: { profileId: true },
  });
  return summarize(
    db,
    actor,
    members.map((m) => m.profileId),
    (c) => c.method === "GUARDIAN_ONLINE" || c.tenantId === tenantId,
    options,
  );
}
