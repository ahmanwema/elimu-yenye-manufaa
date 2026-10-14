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
  type ConsentMethod,
  type ConsentPolicy,
  type EligibilityResult,
  type LiveConsent,
  type MinorStatus,
} from "@/server/authz/recording-consent";
import { recordAudit, type Tx } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";

// Recording consent & date of birth (A70–A72, completed 2026-10-15 by A81–A83).
//
// - DOB is entered by the student or an ACTIVE guardian, and becomes TRUSTED only once a
//   Markaz Admin verifies it. Re-entering it clears the verification. Minor = age < 18.
// - Minors: an ACTIVE guardian consents online, or a Markaz Admin records VERIFIED OFFLINE
//   consent (only a reference to the evidence is stored).
// - Adults: the student gives — and may withdraw — their OWN consent.
// - Withdrawal: an adult withdraws their own; for a minor, any ACTIVE guardian withdraws.
//   Future capture is blocked and existing affected media goes to the deletion review
//   workflow — nothing is hard-deleted here.
//
// Decided 2026-10-16: a Markaz Admin never verifies a DOB they entered themselves (A93; also a
// DB CHECK); verified offline consent is Markaz-specific (A97). A guardian's online consent
// counts while that guardian still holds an ACTIVE link (A71 "ACTIVE guardian").

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
  const student = await db.studentAccount.findUnique({
    where: { profileId: studentProfileId },
    select: { dateOfBirth: true, dateOfBirthVerifiedAt: true },
  });
  if (!student) return { eligible: false, eligibility: "NO_CONSENT" };
  return evaluateRecordingEligibility({
    dateOfBirth: student.dateOfBirth,
    dateOfBirthVerified: student.dateOfBirthVerifiedAt !== null,
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

// --- Date of birth (A82) -------------------------------------------------------------------

const dobSchema = z.object({ studentProfileId: z.uuid(), dateOfBirth: z.iso.date() });

function parseDob(value: string, now: Date) {
  const dob = new Date(`${value}T00:00:00Z`);
  if (dob.getTime() > now.getTime() || dob.getUTCFullYear() < 1900) throw new DomainError("invalid_input");
  return dob;
}

/**
 * The student (for themself) or an ACTIVE guardian enters the DOB. It is NOT trusted until a
 * Markaz Admin verifies it; entering a new value clears any previous verification. The value
 * itself is never written to the audit trail.
 */
export async function enterDateOfBirth(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now } = opts(options);
  const parsed = dobSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { studentProfileId } = parsed.data;
  if (actor.profileId !== studentProfileId && !hasActiveParentLink(actor, studentProfileId)) throw new AuthorizationError();
  const dob = parseDob(parsed.data.dateOfBirth, now);

  await db.$transaction(async (tx) => {
    const { count } = await tx.studentAccount.updateMany({
      where: { profileId: studentProfileId },
      data: {
        dateOfBirth: dob,
        dateOfBirthEnteredById: actor.profileId,
        dateOfBirthEnteredAt: now,
        dateOfBirthVerifiedById: null,
        dateOfBirthVerifiedAt: null,
      },
    });
    if (count !== 1) throw new AuthorizationError(); // no student account (e.g. an adult non-student)
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId: null,
      action: "DATE_OF_BIRTH_RECORDED",
      targetType: "STUDENT_ACCOUNT",
      targetId: studentProfileId,
      now,
    });
  });
}

const verifySchema = z.object({ tenantId: z.uuid(), studentProfileId: z.uuid(), dateOfBirth: z.iso.date() });

/**
 * A Markaz Admin of a Markaz where the student is ACTIVE verifies the entered DOB (A82). The
 * admin confirms the exact value they checked: if the DOB was changed meanwhile, nothing is
 * verified. A93: an admin never verifies a DOB they entered themselves — another admin must.
 */
export async function verifyDateOfBirth(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now } = opts(options);
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, studentProfileId } = parsed.data;
  if (!hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) throw new AuthorizationError();
  if (!(await studentIsActiveIn(db, tenantId, studentProfileId))) throw new AuthorizationError();
  const expected = new Date(`${parsed.data.dateOfBirth}T00:00:00Z`);

  await db.$transaction(async (tx) => {
    const { count } = await tx.studentAccount.updateMany({
      where: {
        profileId: studentProfileId,
        dateOfBirth: expected,
        dateOfBirthVerifiedAt: null,
        dateOfBirthEnteredById: { not: actor.profileId },
      },
      data: { dateOfBirthVerifiedById: actor.profileId, dateOfBirthVerifiedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await recordAudit(tx, {
      actorId: actor.profileId,
      tenantId,
      action: "DATE_OF_BIRTH_VERIFIED",
      targetType: "STUDENT_ACCOUNT",
      targetId: studentProfileId,
      now,
    });
  });
}

// --- Giving consent ----------------------------------------------------------------------

const studentSchema = z.object({ studentProfileId: z.uuid() });

async function createConsent(
  db: PrismaClient,
  data: {
    studentProfileId: string;
    method: ConsentMethod;
    recordedById: string;
    guardianProfileId?: string;
    tenantId?: string;
    offlineConsenterDescription?: string;
    evidenceReference?: string;
  },
  audit: { action: "CONSENT_GIVEN" | "CONSENT_OFFLINE_VERIFIED"; tenantId: string | null },
  now: Date,
) {
  try {
    return await db.$transaction(async (tx) => {
      const consent = await tx.recordingConsent.create({ data: { ...data, grantedAt: now, createdAt: now }, select: { id: true } });
      await recordAudit(tx, {
        actorId: data.recordedById,
        tenantId: audit.tenantId,
        action: audit.action,
        targetType: "RECORDING_CONSENT",
        targetId: consent.id,
        metadata: { method: data.method },
        now,
      });
      return consent.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

/** A guardian with an ACTIVE link consents online for a minor (A71). */
export async function giveGuardianConsent(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now } = opts(options);
  const parsed = studentSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { studentProfileId } = parsed.data;
  if (!hasActiveParentLink(actor, studentProfileId)) throw new AuthorizationError();
  return createConsent(
    db,
    { studentProfileId, method: "GUARDIAN_ONLINE", guardianProfileId: actor.profileId, recordedById: actor.profileId },
    { action: "CONSENT_GIVEN", tenantId: null },
    now,
  );
}

/**
 * A student gives their OWN consent (A83). It counts only once the student is a VERIFIED
 * adult; it can be given during enrollment, before verification. A student whose verified DOB
 * shows a minor cannot self-consent (a guardian must).
 */
export async function giveOwnConsent(db: PrismaClient, actor: Actor, options: ConsentOptions = {}) {
  const { now, policy } = opts(options);
  const student = await db.studentAccount.findUnique({
    where: { profileId: actor.profileId },
    select: { dateOfBirth: true, dateOfBirthVerifiedAt: true },
  });
  if (!student) throw new AuthorizationError();
  if (student.dateOfBirthVerifiedAt && minorStatus(student.dateOfBirth, now, policy) === "MINOR") throw new DomainError("invalid_state");
  return createConsent(
    db,
    { studentProfileId: actor.profileId, method: "SELF_ONLINE", recordedById: actor.profileId },
    { action: "CONSENT_GIVEN", tenantId: null },
    now,
  );
}

const offlineSchema = z.object({
  tenantId: z.uuid(),
  studentProfileId: z.uuid(),
  consenterDescription: z.string().trim().min(1).max(200),
  evidenceReference: z.string().trim().min(1).max(200),
});

/**
 * A Markaz Admin records VERIFIED OFFLINE consent for a minor after checking evidence (A71).
 * Only who consented and a reference to the evidence are stored — never the evidence.
 */
export async function recordOfflineConsent(db: PrismaClient, actor: Actor, input: unknown, options: ConsentOptions = {}) {
  const { now } = opts(options);
  const parsed = offlineSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, studentProfileId, consenterDescription, evidenceReference } = parsed.data;
  if (!canRecordOfflineConsent(actor, tenantId)) throw new AuthorizationError();
  if (!(await studentIsActiveIn(db, tenantId, studentProfileId))) throw new AuthorizationError();
  return createConsent(
    db,
    {
      studentProfileId,
      method: "OFFLINE_VERIFIED",
      tenantId,
      offlineConsenterDescription: consenterDescription,
      evidenceReference,
      recordedById: actor.profileId,
    },
    { action: "CONSENT_OFFLINE_VERIFIED", tenantId },
    now,
  );
}

// --- Withdrawal (A83) ------------------------------------------------------------------------

const consentIdSchema = z.object({ consentId: z.uuid() });

/**
 * Withdraws a consent. An adult withdraws their own (SELF_ONLINE); for a minor, any guardian
 * with an ACTIVE link withdraws a guardian or verified-offline consent.
 *
 * Effects: future capture is blocked by the eligibility check. Every live clip / recording of
 * the student in a Markaz where they are no longer eligible gets a PENDING deletion request
 * (reason CONSENT_WITHDRAWN) for review. Nothing is deleted here. Returns how many items were
 * sent to review.
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
    consent.method === "SELF_ONLINE"
      ? actor.profileId === consent.studentProfileId
      : hasActiveParentLink(actor, consent.studentProfileId);
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

export type DobState = "MISSING" | "PENDING_VERIFICATION" | "VERIFIED";

export type ConsentSummary = {
  studentProfileId: string;
  dateOfBirthState: DobState;
  /** Derived from the DOB (verified or not); trusted only when the state is VERIFIED. */
  minorStatus: MinorStatus;
  consents: { id: string; method: ConsentMethod; tenantId: string | null; mine: boolean; grantedAt: Date }[];
};

const dobState = (s: { dateOfBirth: Date | null; dateOfBirthVerifiedAt: Date | null }): DobState =>
  !s.dateOfBirth ? "MISSING" : s.dateOfBirthVerifiedAt ? "VERIFIED" : "PENDING_VERIFICATION";

async function summarize(
  db: PrismaClient,
  actor: Actor,
  studentProfileIds: string[],
  filter: (c: { method: string; tenantId: string | null }) => boolean,
  options: ConsentOptions,
) {
  const { now, policy } = opts(options);
  const students = await db.studentAccount.findMany({
    where: { profileId: { in: studentProfileIds } },
    select: {
      profileId: true,
      dateOfBirth: true,
      dateOfBirthVerifiedAt: true,
      dateOfBirthEnteredById: true,
      recordingConsents: {
        where: { withdrawnAt: null },
        select: { id: true, method: true, tenantId: true, guardianProfileId: true, recordedById: true, grantedAt: true },
      },
    },
  });
  return students.map((s) => ({
    student: s,
    summary: {
      studentProfileId: s.profileId,
      dateOfBirthState: dobState(s),
      minorStatus: minorStatus(s.dateOfBirth, now, policy),
      consents: s.recordingConsents.filter(filter).map((c) => ({
        id: c.id,
        method: c.method,
        tenantId: c.tenantId,
        mine: c.guardianProfileId === actor.profileId || c.recordedById === actor.profileId,
        grantedAt: c.grantedAt,
      })),
    } satisfies ConsentSummary,
  }));
}

/** For a student: their own DOB state and consents (A83). */
export async function getMyConsent(db: PrismaClient, actor: Actor, options: ConsentOptions = {}): Promise<ConsentSummary | null> {
  const [row] = await summarize(db, actor, [actor.profileId], () => true, options);
  return row?.summary ?? null;
}

/** For a guardian: consent state of each ACTIVE-linked child. */
export async function listMyChildrenConsent(db: PrismaClient, actor: Actor, options: ConsentOptions = {}): Promise<ConsentSummary[]> {
  const children = actor.parentLinks.filter((l) => l.status === "ACTIVE").map((l) => l.studentProfileId);
  if (children.length === 0) return [];
  return (await summarize(db, actor, children, () => true, options)).map((r) => r.summary);
}

/**
 * For a Markaz Admin: the Markaz's ACTIVE students. The DOB VALUE is included only while it
 * awaits verification (the admin must see what they verify); otherwise only its state.
 */
export async function listTenantConsentOverview(db: PrismaClient, actor: Actor, tenantId: unknown, options: ConsentOptions = {}) {
  if (!isValidId(tenantId) || !canRecordOfflineConsent(actor, tenantId)) throw new AuthorizationError();
  const [members, admins] = await Promise.all([
    db.membership.findMany({ where: { tenantId, role: "STUDENT", status: "ACTIVE" }, select: { profileId: true } }),
    db.membership.findMany({ where: { tenantId, role: "MARKAZ_ADMIN", status: "ACTIVE" }, select: { profileId: true } }),
  ]);
  const rows = await summarize(
    db,
    actor,
    members.map((m) => m.profileId),
    (c) => c.method !== "OFFLINE_VERIFIED" || c.tenantId === tenantId,
    options,
  );
  return rows.map(({ student, summary }) => ({
    ...summary,
    dateOfBirthToVerify:
      summary.dateOfBirthState === "PENDING_VERIFICATION" && student.dateOfBirth
        ? student.dateOfBirth.toISOString().slice(0, 10)
        : null,
    enteredByMe: student.dateOfBirthEnteredById === actor.profileId,
    /** A93: true when only the admin who entered the DOB could verify it — it stays unverified. */
    noOtherVerifier:
      summary.dateOfBirthState === "PENDING_VERIFICATION" && !admins.some((a) => a.profileId !== student.dateOfBirthEnteredById),
  }));
}
