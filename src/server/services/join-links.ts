import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { loadActor } from "@/server/authz/load-actor";
import { AuthorizationError, canManageJoinLinks, joinLinkRoles, type Actor, type TenantRole } from "@/server/authz/policy";
import { recordAudit } from "./audit";
import { enrollStudent } from "./enrollments";
import { DomainError } from "./errors";
import { activateMembership, generateInvitationToken, hashInvitationToken, isExpired } from "./invitations";

// Shareable join links (owner decisions 2026-11-22, Stage 2 of self-service onboarding).
//
// One link, many students, typically forwarded over WhatsApp. This is NOT an invitation: an
// invitation (A60) is bound to one email address and is single use. A join link is bound to
// nobody, which is exactly why it is treated as a credential:
//
//   * only a Markaz Admin may issue one (canManageJoinLinks) -- never a Teacher, and no
//     explicit grant reaches it;
//   * only the hash is stored, so a leaked database cannot reconstruct a working link;
//   * every link has an expiry and may have a maximum number of uses, and both are enforced
//     in ONE atomic statement so concurrent redemptions cannot exceed the ceiling;
//   * every refusal looks the same from outside, so the link's state cannot be probed;
//   * both tables are server-only (deny-by-default RLS).
//
// The student redeeming a link is not signed in yet and has no account, so redemption is
// necessarily server-side: the action layer creates the auth account for the address they
// typed, and only then calls `redeemJoinLink`.

/** Links live for at most 90 days. Longer than an invitation (A60: 7 days) because this one is
 *  meant to sit in a WhatsApp group for a term, but never unbounded. */
const MAX_TTL_DAYS = 90;
const DAY_MS = 86_400_000;

const createSchema = z.object({
  tenantId: z.uuid(),
  /** The role the person receives. Only a Super Admin may ask for MARKAZ_ADMIN (A52). */
  role: z.enum(["MARKAZ_ADMIN", "TEACHER", "STUDENT", "FINANCE_OFFICER"]),
  /** Optional, STUDENT links only. When set, redeeming also enrols them in this class. */
  classId: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.uuid().optional()),
  label: z.string().trim().min(1).max(120),
  expiresInDays: z.coerce.number().int().min(1).max(MAX_TTL_DAYS),
  maxUses: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.coerce.number().int().min(1).max(10_000).optional(),
  ),
});

/**
 * What anyone joining types. The email and password are handled by the action layer, which has
 * to create the auth account before this runs.
 *
 * Gender and date of birth are STUDENT-only: the other roles have no student account to put
 * them on. The date of birth drives the recording-consent rules (A66+) and is recorded as
 * self-entered; a Markaz Admin still has to VERIFY it (A82) before it is trusted.
 */
export const redeemDetailsSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(32),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  dateOfBirth: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.date().optional()),
});

/**
 * Minimum password length. Supabase's own default is 6; eight is the shortest this project is
 * willing to accept, because a join link is a bearer credential and the password is the only
 * thing standing between a forwarded link and a working account afterwards.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(200);

export const joinTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Creates a link and returns its raw token ONCE. The token is never stored or recoverable. */
export async function createJoinLink(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, role, classId, label, expiresInDays, maxUses } = parsed.data;
  if (!canManageJoinLinks(actor, tenantId)) throw new AuthorizationError();
  // A52: only a Super Admin may hand out MARKAZ_ADMIN, by link or any other route.
  if (!joinLinkRoles(actor, tenantId).includes(role)) throw new AuthorizationError();
  // A class only makes sense for a student (also a CHECK constraint).
  if (classId && role !== "STUDENT") throw new DomainError("invalid_input");

  if (classId) {
    // A link may only point at a class of its own Markaz (also a database trigger).
    const cls = await db.class.findUnique({ where: { id: classId }, select: { tenantId: true, status: true } });
    if (!cls || cls.tenantId !== tenantId) throw new DomainError("not_found");
    if (cls.status !== "ACTIVE") throw new DomainError("invalid_state");
  }

  const { token, tokenHash } = generateInvitationToken();
  const link = await db.joinLink.create({
    data: {
      tenantId,
      role,
      classId: classId ?? null,
      tokenHash,
      label,
      expiresAt: new Date(now.getTime() + expiresInDays * DAY_MS),
      maxUses: maxUses ?? null,
      createdById: actor.profileId,
      createdAt: now,
    },
    select: { id: true, label: true, role: true, expiresAt: true, maxUses: true },
  });
  await recordAudit(db, {
    actorId: actor.profileId,
    tenantId,
    action: "JOIN_LINK_CREATED",
    targetType: "JOIN_LINK",
    targetId: link.id,
    metadata: { role, classId: classId ?? null, maxUses: maxUses ?? null },
    now,
  });
  return { ...link, token };
}

/** The Markaz's links, newest first. Never the token hash. */
export async function listJoinLinks(db: PrismaClient, actor: Actor, tenantId: unknown) {
  if (!canManageJoinLinks(actor, tenantId)) throw new AuthorizationError();
  return db.joinLink.findMany({
    where: { tenantId: tenantId as string },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      role: true,
      status: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      createdAt: true,
      class: { select: { id: true, name: true } },
    },
  });
}

export async function revokeJoinLink(db: PrismaClient, actor: Actor, joinLinkId: unknown, now = new Date()) {
  if (!z.uuid().safeParse(joinLinkId).success) throw new DomainError("invalid_input");
  const link = await db.joinLink.findUnique({
    where: { id: joinLinkId as string },
    select: { id: true, tenantId: true, status: true },
  });
  if (!link) throw new DomainError("not_found");
  if (!canManageJoinLinks(actor, link.tenantId)) throw new AuthorizationError();
  if (link.status !== "ACTIVE") throw new DomainError("invalid_state");

  await db.joinLink.update({
    where: { id: link.id },
    data: { status: "REVOKED", revokedById: actor.profileId, revokedAt: now },
  });
  await recordAudit(db, {
    actorId: actor.profileId,
    tenantId: link.tenantId,
    action: "JOIN_LINK_REVOKED",
    targetType: "JOIN_LINK",
    targetId: link.id,
    now,
  });
}

export type JoinLinkPreview =
  | { state: "invalid" }
  | { state: "valid"; tenantName: string; role: TenantRole; className: string | null };

/**
 * What an unauthenticated visitor is shown before typing anything: the Markaz name and, if the
 * link names one, the class name. Nothing else — no roster, no counts, no other class.
 *
 * Revoked, expired and exhausted all return `invalid`, identically, so a stale link cannot be
 * used to learn whether it ever existed.
 */
export async function previewJoinLink(db: PrismaClient, token: unknown, now = new Date()): Promise<JoinLinkPreview> {
  const parsed = joinTokenSchema.safeParse(token);
  if (!parsed.success) return { state: "invalid" };
  const link = await db.joinLink.findUnique({
    where: { tokenHash: hashInvitationToken(parsed.data) },
    select: {
      status: true,
      role: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      tenant: { select: { name: true } },
      class: { select: { name: true } },
    },
  });
  if (!link || !usable(link, now)) return { state: "invalid" };
  return { state: "valid", tenantName: link.tenant.name, role: link.role, className: link.class?.name ?? null };
}

function usable(
  link: { status: "ACTIVE" | "REVOKED"; expiresAt: Date; maxUses: number | null; useCount: number },
  now: Date,
): boolean {
  if (link.status !== "ACTIVE") return false;
  if (isExpired(link.expiresAt, now)) return false;
  return link.maxUses === null || link.useCount < link.maxUses;
}

/**
 * Redeems a link for a person whose auth account the action layer has just prepared.
 *
 * Creates the student account and the ACTIVE STUDENT membership, records the use, and — when
 * the link names a class — enrols them in it. The enrolment runs as the link's CREATOR, because
 * a Markaz Admin issuing a link is what authorizes the enrolment; the student has no such
 * authority of their own. That also means a link stops enrolling if its creator loses the admin
 * role, which fails closed, as it should.
 *
 * Idempotent per person: a second redemption of the same link by the same profile changes
 * nothing and consumes no further use.
 */
export async function redeemJoinLink(
  db: PrismaClient,
  input: { token: unknown; profileId: string; details: unknown },
  now = new Date(),
) {
  const token = joinTokenSchema.safeParse(input.token);
  const details = redeemDetailsSchema.safeParse(input.details);
  if (!token.success || !details.success) throw new DomainError("invalid_input");
  if (!z.uuid().safeParse(input.profileId).success) throw new DomainError("invalid_input");
  if (details.data.dateOfBirth && details.data.dateOfBirth > now) throw new DomainError("invalid_input");

  const link = await db.joinLink.findUnique({
    where: { tokenHash: hashInvitationToken(token.data) },
    select: { id: true, tenantId: true, role: true, classId: true, status: true, expiresAt: true, maxUses: true, useCount: true, createdById: true },
  });
  // Unknown, revoked, expired and exhausted are all reported the same way.
  if (!link || !usable(link, now)) throw new DomainError("expired");
  // A student is the only role with a student account, so only a student supplies these.
  const isStudent = link.role === "STUDENT";
  if (isStudent && (!details.data.gender || !details.data.dateOfBirth)) throw new DomainError("invalid_input");

  await db.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id: input.profileId }, select: { id: true } });
    if (!profile) throw new DomainError("invalid_state");

    const already = await tx.joinLinkUse.findUnique({
      where: { joinLinkId_profileId: { joinLinkId: link.id, profileId: input.profileId } },
      select: { id: true },
    });

    if (!already) {
      // Claim the use in ONE atomic statement, so concurrent redemptions can never take the link
      // past its ceiling. Prisma cannot compare two columns, so this is raw SQL. It runs inside
      // the transaction: if anything below fails, the seat is given back rather than burnt.
      const claimed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE join_links
           SET use_count = use_count + 1
         WHERE id = ${link.id}::uuid
           AND status = 'ACTIVE'
           AND expires_at > ${now}
           AND (max_uses IS NULL OR use_count < max_uses)
        RETURNING id
      `);
      if (claimed.length !== 1) throw new DomainError("expired");
    }

    await tx.profile.update({
      where: { id: input.profileId },
      data: { displayName: details.data.displayName, phone: details.data.phone },
    });
    if (isStudent) {
      await tx.studentAccount.upsert({
        where: { profileId: input.profileId },
        create: {
          profileId: input.profileId,
          gender: details.data.gender,
          dateOfBirth: details.data.dateOfBirth,
          dateOfBirthEnteredById: input.profileId,
          dateOfBirthEnteredAt: now,
        },
        // A82: re-entering a date clears any verification. Joining never grants a verified one.
        update: {
          gender: details.data.gender,
          dateOfBirth: details.data.dateOfBirth,
          dateOfBirthEnteredById: input.profileId,
          dateOfBirthEnteredAt: now,
          dateOfBirthVerifiedById: null,
          dateOfBirthVerifiedAt: null,
        },
      });
    }
    await activateMembership(tx, link.tenantId, input.profileId, link.role);

    if (!already) {
      await tx.joinLinkUse.create({
        data: { joinLinkId: link.id, tenantId: link.tenantId, profileId: input.profileId, usedAt: now },
      });
      await recordAudit(tx, {
        actorId: input.profileId,
        tenantId: link.tenantId,
        action: "JOIN_LINK_REDEEMED",
        targetType: "JOIN_LINK",
        targetId: link.id,
        metadata: { role: link.role },
        now,
      });
    }
  });

  if (link.classId) {
    const issuer = await loadActor(db, link.createdById);
    if (!issuer) throw new DomainError("invalid_state");
    try {
      await enrollStudent(db, issuer, { classId: link.classId, studentProfileId: input.profileId }, { now });
    } catch (error) {
      // Already enrolled from an earlier redemption: the student is in, which is the point.
      if (!(error instanceof DomainError && error.code === "conflict")) throw error;
    }
  }

  return { tenantId: link.tenantId, role: link.role, classId: link.classId };
}
