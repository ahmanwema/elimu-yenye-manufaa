import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  AuthorizationError,
  hasGrantedPermission,
  hasTenantPermission,
  requireGrantedPermission,
  type Actor,
} from "@/server/authz/policy";
import { DomainError } from "./errors";

// Parent–Student link lifecycle (A46–A48, A55–A57):
//
//   (none | REVOKED) ──request──▶ PENDING ──verify──▶ VERIFIED ──activate──▶ ACTIVE
//          ▲                         │                   │                     │
//          └─────────────────────────┴──── revoke ───────┴─────────────────────┘
//
// - request: the parent (self, tenant-bound) or staff holding parent_link.create
// - verify:   staff holding parent_link.verify   in the link's Markaz
// - activate: staff holding parent_link.activate in the link's Markaz (VERIFIED only)
// - revoke:   the parent (own links) or staff holding parent_link.revoke in the link's Markaz
// Only ACTIVE grants a parent any access. Every change is a conditional update (so an
// illegal or racing transition changes nothing) plus an append-only event row.

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type LinkStatus = "PENDING" | "VERIFIED" | "ACTIVE" | "REVOKED";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const linkIdSchema = z.object({ linkId: z.uuid() });

async function studentIsActiveIn(db: Tx | PrismaClient, tenantId: string, studentProfileId: string) {
  const m = await db.membership.findFirst({
    where: { tenantId, profileId: studentProfileId, role: "STUDENT", status: "ACTIVE" },
    select: { id: true },
  });
  return m !== null;
}

/**
 * Opens a request cycle: creates a PENDING link, or re-opens a REVOKED one (its history
 * stays in parent_link_events). Any other existing state is a conflict.
 */
export async function openLinkRequest(
  tx: Tx,
  input: {
    parentProfileId: string;
    studentProfileId: string;
    tenantId: string;
    initiatedBy: "PARENT" | "STAFF";
    actorId: string;
    now: Date;
  },
) {
  const { parentProfileId, studentProfileId, tenantId, initiatedBy, actorId, now } = input;
  if (parentProfileId === studentProfileId) throw new DomainError("invalid_input");
  const existing = await tx.parentStudentLink.findUnique({
    where: { parentProfileId_studentProfileId: { parentProfileId, studentProfileId } },
    select: { id: true, status: true },
  });

  if (!existing) {
    const link = await tx.parentStudentLink.create({
      data: {
        parentProfileId,
        studentProfileId,
        tenantId,
        status: "PENDING",
        initiatedBy,
        requestedById: actorId,
        requestedAt: now,
        statusChangedById: actorId,
        statusChangedAt: now,
        createdAt: now,
      },
      select: { id: true },
    });
    await tx.parentLinkEvent.create({ data: { linkId: link.id, fromStatus: null, toStatus: "PENDING", actorId, createdAt: now } });
    return link.id;
  }

  if (existing.status !== "REVOKED") throw new DomainError("conflict");
  const { count } = await tx.parentStudentLink.updateMany({
    where: { id: existing.id, status: "REVOKED" },
    data: {
      status: "PENDING",
      tenantId,
      initiatedBy,
      requestedById: actorId,
      requestedAt: now,
      verifiedById: null,
      verifiedAt: null,
      activatedById: null,
      activatedAt: null,
      revokedById: null,
      revokedAt: null,
      statusChangedById: actorId,
      statusChangedAt: now,
    },
  });
  if (count !== 1) throw new DomainError("conflict");
  await tx.parentLinkEvent.create({ data: { linkId: existing.id, fromStatus: "REVOKED", toStatus: "PENDING", actorId, createdAt: now } });
  return existing.id;
}

/** Normalizes a typed registration number: upper-case, spaces and dashes removed. */
export function normalizeRegistrationNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

const slugSchema = z.string().trim().toLowerCase().min(1).max(100);
const registrationNumberSchema = z
  .string()
  .transform(normalizeRegistrationNumber)
  .pipe(z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/));

// A64: Markaz code + EITHER the student's email OR their registration number in that Markaz.
const parentRequestSchema = z.union([
  z.object({ tenantSlug: slugSchema, studentEmail: emailSchema }).strict(),
  z.object({ tenantSlug: slugSchema, studentRegistrationNumber: registrationNumberSchema }).strict(),
]);

/** Form-style input: the unused identifier field may be present but empty. Both filled is invalid. */
function cleanParentRequestInput(input: unknown) {
  if (!input || typeof input !== "object") return input;
  const { tenantSlug, studentEmail, studentRegistrationNumber } = input as Record<string, unknown>;
  const present = (v: unknown) => typeof v === "string" && v.trim() !== "";
  if (present(studentEmail) && present(studentRegistrationNumber)) return { invalid: true };
  if (present(studentEmail)) return { tenantSlug, studentEmail };
  if (present(studentRegistrationNumber)) return { tenantSlug, studentRegistrationNumber };
  return { tenantSlug };
}

async function findStudentForRequest(
  db: PrismaClient,
  tenantId: string,
  request: { studentEmail: string } | { studentRegistrationNumber: string },
): Promise<string | null> {
  if ("studentRegistrationNumber" in request) {
    const m = await db.membership.findFirst({
      where: { tenantId, role: "STUDENT", status: "ACTIVE", registrationNumber: request.studentRegistrationNumber },
      select: { profileId: true },
    });
    return m?.profileId ?? null;
  }
  // Identity email lives in Supabase Auth (auth.users), not in the application schema.
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM auth.users u
    JOIN public.memberships m ON m.profile_id = u.id
    WHERE lower(u.email) = ${request.studentEmail}
      AND m.tenant_id = ${tenantId}::uuid AND m.role = 'STUDENT' AND m.status = 'ACTIVE'
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

/**
 * A parent asks to be linked to their child in a Markaz (A56, A64), naming the child by
 * email OR registration number. It returns the same (nothing) for success, unknown Markaz,
 * unknown or mismatched child, and an already-existing link, so the form cannot be used to
 * discover Markaz, students, emails, registration numbers or links. Only malformed input is
 * rejected, which depends on nothing stored. A request only ever creates PENDING.
 */
export async function requestLinkAsParent(db: PrismaClient, actor: Actor, input: unknown, now = new Date()): Promise<void> {
  const parsed = parentRequestSchema.safeParse(cleanParentRequestInput(input));
  if (!parsed.success) throw new DomainError("invalid_input");
  const parent = await db.parentAccount.findUnique({ where: { profileId: actor.profileId }, select: { profileId: true } });
  if (!parent) throw new AuthorizationError();

  const tenant = await db.tenant.findUnique({ where: { slug: parsed.data.tenantSlug }, select: { id: true } });
  if (!tenant) return;
  const studentId = await findStudentForRequest(db, tenant.id, parsed.data);
  if (!studentId || studentId === actor.profileId) return;
  const student = { id: studentId };

  try {
    await db.$transaction((tx) =>
      openLinkRequest(tx, {
        parentProfileId: actor.profileId,
        studentProfileId: student.id,
        tenantId: tenant.id,
        initiatedBy: "PARENT",
        actorId: actor.profileId,
        now,
      }),
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "conflict") return; // same answer either way
    throw error;
  }
}

const staffCreateSchema = z.object({ tenantId: z.uuid(), parentEmail: emailSchema, studentProfileId: z.uuid() });

/** Staff holding parent_link.create in that Markaz start a link for an existing parent account. */
export async function createLinkAsStaff(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const parsed = staffCreateSchema.safeParse(input);
  if (!parsed.success) throw new AuthorizationError();
  const tenantId = requireGrantedPermission(actor, parsed.data.tenantId, "parent_link.create");
  const { studentProfileId } = parsed.data;
  if (studentProfileId === actor.profileId) throw new AuthorizationError();
  if (!(await studentIsActiveIn(db, tenantId, studentProfileId))) throw new DomainError("invalid_state");

  const parents = await db.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM auth.users u
    JOIN public.parent_accounts p ON p.profile_id = u.id
    WHERE lower(u.email) = ${parsed.data.parentEmail}
    LIMIT 1`;
  const parent = parents[0];
  if (!parent) throw new DomainError("not_found");
  // Staff do not initiate links where they are the parent; they use the parent path.
  if (parent.id === actor.profileId) throw new AuthorizationError();

  return db.$transaction((tx) =>
    openLinkRequest(tx, {
      parentProfileId: parent.id,
      studentProfileId,
      tenantId,
      initiatedBy: "STAFF",
      actorId: actor.profileId,
      now,
    }),
  );
}

async function loadLink(db: PrismaClient, input: unknown) {
  const parsed = linkIdSchema.safeParse(input);
  if (!parsed.success) throw new AuthorizationError();
  const link = await db.parentStudentLink.findUnique({
    where: { id: parsed.data.linkId },
    select: { id: true, tenantId: true, parentProfileId: true, studentProfileId: true, status: true },
  });
  // Not found and not authorized are indistinguishable to the caller.
  if (!link) throw new AuthorizationError();
  return link;
}

async function transition(
  db: PrismaClient,
  linkId: string,
  from: readonly LinkStatus[],
  to: LinkStatus,
  actorId: string,
  data: Record<string, unknown>,
  now: Date,
) {
  await db.$transaction(async (tx) => {
    const current = await tx.parentStudentLink.findUnique({ where: { id: linkId }, select: { status: true } });
    if (!current || !from.includes(current.status)) throw new DomainError("invalid_state");
    const { count } = await tx.parentStudentLink.updateMany({
      where: { id: linkId, status: current.status },
      data: { ...data, status: to, statusChangedById: actorId, statusChangedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");
    await tx.parentLinkEvent.create({ data: { linkId, fromStatus: current.status, toStatus: to, actorId, createdAt: now } });
  });
}

function requireNotParty(actor: Actor, link: { parentProfileId: string; studentProfileId: string }) {
  if (actor.profileId === link.parentProfileId || actor.profileId === link.studentProfileId) {
    throw new AuthorizationError();
  }
}

/** PENDING → VERIFIED (A46). */
export async function verifyParentLink(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const link = await loadLink(db, input);
  requireGrantedPermission(actor, link.tenantId, "parent_link.verify");
  requireNotParty(actor, link);
  if (!(await studentIsActiveIn(db, link.tenantId, link.studentProfileId))) throw new DomainError("invalid_state");
  await transition(db, link.id, ["PENDING"], "VERIFIED", actor.profileId, { verifiedById: actor.profileId, verifiedAt: now }, now);
}

/** VERIFIED → ACTIVE (A55). Never from PENDING or REVOKED. */
export async function activateParentLink(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const link = await loadLink(db, input);
  requireGrantedPermission(actor, link.tenantId, "parent_link.activate");
  requireNotParty(actor, link);
  if (!(await studentIsActiveIn(db, link.tenantId, link.studentProfileId))) throw new DomainError("invalid_state");
  await transition(db, link.id, ["VERIFIED"], "ACTIVE", actor.profileId, { activatedById: actor.profileId, activatedAt: now }, now);
}

const NOT_REVOKED: readonly LinkStatus[] = ["PENDING", "VERIFIED", "ACTIVE"];

/** A parent withdraws one of THEIR OWN links (A57). */
export async function revokeOwnParentLink(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const link = await loadLink(db, input);
  if (link.parentProfileId !== actor.profileId) throw new AuthorizationError();
  await transition(db, link.id, NOT_REVOKED, "REVOKED", actor.profileId, { revokedById: actor.profileId, revokedAt: now }, now);
}

/** Staff holding parent_link.revoke in the link's Markaz revoke a link (A57). */
export async function revokeParentLinkAsStaff(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  const link = await loadLink(db, input);
  requireGrantedPermission(actor, link.tenantId, "parent_link.revoke");
  await transition(db, link.id, NOT_REVOKED, "REVOKED", actor.profileId, { revokedById: actor.profileId, revokedAt: now }, now);
}

/** Links of one Markaz, for its Markaz Admins and holders of any parent-link permission there. */
export async function listTenantParentLinks(db: PrismaClient, actor: Actor, tenantId: unknown) {
  const canRead =
    hasTenantPermission(actor, tenantId, "tenant.parent_links.read") ||
    (["parent_link.create", "parent_link.verify", "parent_link.activate", "parent_link.revoke"] as const).some((p) =>
      hasGrantedPermission(actor, tenantId, p),
    );
  if (!canRead) throw new AuthorizationError();
  return db.parentStudentLink.findMany({
    where: { tenantId: tenantId as string },
    select: {
      id: true,
      status: true,
      initiatedBy: true,
      parentProfileId: true,
      studentProfileId: true,
      requestedAt: true,
      verifiedAt: true,
      activatedAt: true,
      revokedAt: true,
      parent: { select: { profile: { select: { displayName: true } } } },
      student: { select: { profile: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** A parent's own links. The child's name is shown only once the link is ACTIVE. */
export async function listMyParentLinks(db: PrismaClient, actor: Actor) {
  const links = await db.parentStudentLink.findMany({
    where: { parentProfileId: actor.profileId },
    select: {
      id: true,
      status: true,
      tenant: { select: { name: true } },
      student: { select: { profile: { select: { displayName: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return links.map((l) => ({
    id: l.id,
    status: l.status,
    markazName: l.tenant.name,
    studentName: l.status === "ACTIVE" ? l.student.profile.displayName : null,
  }));
}
