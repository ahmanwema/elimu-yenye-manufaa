import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  hasGrantedPermission,
  hasTenantPermission,
  INVITE_TARGETS,
  invitableTargets,
  type Actor,
  type InviteTarget,
  type TenantRole,
} from "@/server/authz/policy";
import { DomainError, isUniqueViolation } from "./errors";
import { openLinkRequest } from "./parent-links";

// Invite-first onboarding (A45, A59–A61).
//
// - The raw token (256 bits) is returned ONCE to the inviter and never stored; only its
//   SHA-256 hash is persisted. A leaked database row cannot be turned back into a link.
// - Acceptance takes only the token. Tenant, target and email come from the stored row.
// - Acceptance requires a Supabase session whose (verified) email equals the invited email.
// - A PARENT invitation creates a parent account. A proposed child becomes a PENDING link
//   request — never access; the normal PENDING → VERIFIED → ACTIVE workflow still applies.

/** Approved business rule (A60): invitations are valid for exactly 7 days. */
export const INVITATION_TTL_DAYS = 7;
export const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

export type AuthIdentity = { userId: string; email: string | null };

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const createSchema = z.object({
  tenantId: z.uuid(),
  email: emailSchema,
  target: z.enum(INVITE_TARGETS),
  // Optional, PARENT only. Empty form value means "no proposed child".
  proposedStudentId: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.uuid().optional()),
});

export function generateInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

const targetOf = (inv: { kind: "MEMBERSHIP" | "PARENT"; role: TenantRole | null }): InviteTarget =>
  inv.kind === "PARENT" ? "PARENT" : (inv.role as TenantRole);

/** Valid strictly before expiresAt; at expiresAt it is expired. */
export function isExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export async function createInvitation(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { tenantId, email, target, proposedStudentId } = parsed.data;
  if (!invitableTargets(actor, tenantId).includes(target)) throw new AuthorizationError();

  if (proposedStudentId) {
    // A63: proposing a child requires BOTH explicit grants in this Markaz —
    // invitation.create AND parent_link.create — for every inviter, Markaz Admins included.
    if (target !== "PARENT") throw new DomainError("invalid_input");
    if (
      !hasGrantedPermission(actor, tenantId, "invitation.create") ||
      !hasGrantedPermission(actor, tenantId, "parent_link.create")
    ) {
      throw new AuthorizationError();
    }
  }

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new DomainError("not_found");
  if (proposedStudentId) {
    const active = await db.membership.findFirst({
      where: { tenantId, profileId: proposedStudentId, role: "STUDENT", status: "ACTIVE" },
      select: { id: true },
    });
    if (!active) throw new DomainError("invalid_state");
  }

  const { token, tokenHash } = generateInvitationToken();
  try {
    const invitation = await db.invitation.create({
      data: {
        tokenHash,
        email,
        tenantId,
        kind: target === "PARENT" ? "PARENT" : "MEMBERSHIP",
        role: target === "PARENT" ? null : target,
        proposedStudentId: proposedStudentId ?? null,
        invitedById: actor.profileId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      },
      select: { id: true, email: true, kind: true, role: true, expiresAt: true },
    });
    return { id: invitation.id, email: invitation.email, target: targetOf(invitation), expiresAt: invitation.expiresAt, token };
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

/**
 * Pending invitations of a tenant (never the token hash). Markaz/Super Admins see all;
 * a teacher with invitation.create sees the ones they issued.
 */
export async function listPendingInvitations(db: PrismaClient, actor: Actor, tenantId: unknown) {
  const all = hasTenantPermission(actor, tenantId, "tenant.invitations.manage");
  if (!all && invitableTargets(actor, tenantId).length === 0) throw new AuthorizationError();
  const rows = await db.invitation.findMany({
    where: { tenantId: tenantId as string, status: "PENDING", ...(all ? {} : { invitedById: actor.profileId }) },
    select: { id: true, email: true, kind: true, role: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, email: r.email, target: targetOf(r), createdAt: r.createdAt, expiresAt: r.expiresAt }));
}

/**
 * Revocation: Markaz/Super Admins for any invitation they could issue; a teacher only for
 * invitations they issued themselves (and may still issue).
 */
export async function revokeInvitation(db: PrismaClient, actor: Actor, invitationId: unknown, now = new Date()) {
  if (!z.uuid().safeParse(invitationId).success) throw new AuthorizationError();
  const invitation = await db.invitation.findUnique({
    where: { id: invitationId as string },
    select: { id: true, tenantId: true, kind: true, role: true, invitedById: true },
  });
  if (!invitation || !invitableTargets(actor, invitation.tenantId).includes(targetOf(invitation))) {
    throw new AuthorizationError();
  }
  const isAdmin = hasTenantPermission(actor, invitation.tenantId, "tenant.invitations.manage");
  if (!isAdmin && invitation.invitedById !== actor.profileId) throw new AuthorizationError();
  const { count } = await db.invitation.updateMany({
    where: { id: invitation.id, status: "PENDING" },
    data: { status: "REVOKED", revokedAt: now, revokedById: actor.profileId },
  });
  if (count !== 1) throw new DomainError("invalid_state");
}

export type InvitationPreview =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "valid"; tenantName: string; target: InviteTarget; maskedEmail: string };

/** Public preview for the invitation page. Reveals nothing for an unknown token. */
export async function previewInvitation(db: PrismaClient, token: unknown, now = new Date()): Promise<InvitationPreview> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return { state: "invalid" };
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(parsed.data) },
    select: { status: true, expiresAt: true, kind: true, role: true, email: true, tenant: { select: { name: true } } },
  });
  if (!invitation || invitation.status !== "PENDING") return { state: "invalid" };
  if (isExpired(invitation.expiresAt, now)) return { state: "expired" };
  return {
    state: "valid",
    tenantName: invitation.tenant.name,
    target: targetOf(invitation),
    maskedEmail: maskEmail(invitation.email),
  };
}

/**
 * The invited email, for sending the sign-in code. Only the server ever sees it in full;
 * the client supplies the token, never the address.
 */
export async function invitedEmailForToken(db: PrismaClient, token: unknown, now = new Date()): Promise<string> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) throw new DomainError("not_found");
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(parsed.data) },
    select: { status: true, expiresAt: true, email: true },
  });
  if (!invitation || invitation.status !== "PENDING") throw new DomainError("not_found");
  if (isExpired(invitation.expiresAt, now)) throw new DomainError("expired");
  return invitation.email;
}

const acceptSchema = z.object({ token: tokenSchema });

/**
 * Accepts an invitation for the signed-in identity. The input is parsed down to the
 * token only — any tenantId / role / target / email the client adds is discarded.
 */
export async function acceptInvitation(db: PrismaClient, identity: AuthIdentity, input: unknown, now = new Date()) {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("not_found");
  const tokenHash = hashInvitationToken(parsed.data.token);

  return db.$transaction(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tenantId: true,
        kind: true,
        role: true,
        proposedStudentId: true,
        invitedById: true,
        email: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!invitation || invitation.status !== "PENDING") throw new DomainError("not_found");
    if (isExpired(invitation.expiresAt, now)) throw new DomainError("expired");
    if (!identity.email || identity.email.trim().toLowerCase() !== invitation.email) {
      throw new DomainError("email_mismatch");
    }

    // Conditional update: exactly one acceptance can win a race; expiry re-checked here.
    const { count } = await tx.invitation.updateMany({
      where: { id: invitation.id, status: "PENDING", expiresAt: { gt: now } },
      data: { status: "ACCEPTED", acceptedAt: now, acceptedById: identity.userId },
    });
    if (count !== 1) throw new DomainError("not_found");

    const profile = await tx.profile.findUnique({ where: { id: identity.userId }, select: { id: true } });
    if (!profile) throw new DomainError("invalid_state");

    if (invitation.kind === "PARENT") {
      await tx.parentAccount.upsert({ where: { profileId: identity.userId }, create: { profileId: identity.userId }, update: {} });
      if (invitation.proposedStudentId && invitation.proposedStudentId !== identity.userId) {
        const stillStudent = await tx.membership.findFirst({
          where: {
            tenantId: invitation.tenantId,
            profileId: invitation.proposedStudentId,
            role: "STUDENT",
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (stillStudent) {
          try {
            await openLinkRequest(tx, {
              parentProfileId: identity.userId,
              studentProfileId: invitation.proposedStudentId,
              tenantId: invitation.tenantId,
              initiatedBy: "STAFF",
              actorId: invitation.invitedById,
              now,
            });
          } catch (error) {
            // An existing open link already covers this relationship.
            if (!(error instanceof DomainError && error.code === "conflict")) throw error;
          }
        }
      }
      return { tenantId: invitation.tenantId, target: "PARENT" as InviteTarget };
    }

    const role = invitation.role as TenantRole;
    if (role === "STUDENT") {
      await tx.studentAccount.upsert({ where: { profileId: identity.userId }, create: { profileId: identity.userId }, update: {} });
    }
    await activateMembership(tx, invitation.tenantId, identity.userId, role);
    return { tenantId: invitation.tenantId, target: role as InviteTarget };
  });
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Creates the membership, or re-activates an ENDED one (rejoining). Idempotent. */
export async function activateMembership(tx: Tx, tenantId: string, profileId: string, role: TenantRole) {
  const existing = await tx.membership.findUnique({
    where: { tenantId_profileId_role: { tenantId, profileId, role } },
    select: { id: true, status: true },
  });
  if (!existing) {
    await tx.membership.create({ data: { tenantId, profileId, role } });
  } else if (existing.status === "ENDED") {
    await tx.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE", endedAt: null } });
  }
}
