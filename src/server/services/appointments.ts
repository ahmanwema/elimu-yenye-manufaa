import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, requireTenantPermission, type Actor } from "@/server/authz/policy";
import { DomainError, isUniqueViolation } from "./errors";
import { activateMembership } from "./invitations";

// Markaz Admin appointment (A52):
//   MARKAZ_ADMIN requests → SUPER_ADMIN approves/rejects → membership granted on approval.
// A Markaz Admin can never grant the role directly, and nobody reviews their own request.

const requestSchema = z.object({ tenantId: z.uuid(), candidateProfileId: z.uuid() });

export async function requestMarkazAdminAppointment(db: PrismaClient, actor: Actor, input: unknown) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new AuthorizationError();
  const tenantId = requireTenantPermission(actor, parsed.data.tenantId, "tenant.admin_appointment.request");
  const { candidateProfileId } = parsed.data;
  if (candidateProfileId === actor.profileId) throw new DomainError("invalid_input");

  // The candidate must already be an ACTIVE member of THIS Markaz (anyone else must be
  // invited first), and must not already be one of its admins.
  const candidateRoles = await db.membership.findMany({
    where: { tenantId, profileId: candidateProfileId, status: "ACTIVE" },
    select: { role: true },
  });
  if (candidateRoles.length === 0) throw new DomainError("not_found");
  if (candidateRoles.some((m) => m.role === "MARKAZ_ADMIN")) throw new DomainError("conflict");

  try {
    return await db.markazAdminAppointmentRequest.create({
      data: { tenantId, candidateProfileId, requestedById: actor.profileId },
      select: { id: true, status: true },
    });
  } catch (error) {
    // Partial unique index: one PENDING request per (tenant, candidate), race-safe.
    if (isUniqueViolation(error)) throw new DomainError("conflict");
    throw error;
  }
}

/** Members a Markaz Admin may propose: ACTIVE members of that Markaz who are not admins (and not themselves). */
export async function listAppointmentCandidates(db: PrismaClient, actor: Actor, tenantId: unknown) {
  const id = requireTenantPermission(actor, tenantId, "tenant.admin_appointment.request");
  const rows = await db.membership.findMany({
    where: { tenantId: id, status: "ACTIVE" },
    select: { role: true, profile: { select: { id: true, displayName: true } } },
  });
  const admins = new Set(rows.filter((r) => r.role === "MARKAZ_ADMIN").map((r) => r.profile.id));
  const seen = new Map<string, string | null>();
  for (const r of rows) {
    if (!admins.has(r.profile.id) && r.profile.id !== actor.profileId) seen.set(r.profile.id, r.profile.displayName);
  }
  return [...seen].map(([profileId, displayName]) => ({ profileId, displayName }));
}

/** A Markaz Admin sees their Markaz's requests. */
export async function listTenantAppointmentRequests(db: PrismaClient, actor: Actor, tenantId: unknown) {
  const id = requireTenantPermission(actor, tenantId, "tenant.admin_appointment.request");
  return db.markazAdminAppointmentRequest.findMany({
    where: { tenantId: id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      candidate: { select: { displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Super Admin review queue. */
export async function listPendingAppointmentRequests(db: PrismaClient, actor: Actor) {
  if (!actor.isPlatformAdmin) throw new AuthorizationError();
  return db.markazAdminAppointmentRequest.findMany({
    where: { status: "PENDING" },
    select: {
      id: true,
      createdAt: true,
      requestedById: true,
      tenant: { select: { id: true, name: true } },
      candidate: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

const reviewSchema = z.object({ requestId: z.uuid(), decision: z.enum(["APPROVE", "REJECT"]) });

export async function reviewMarkazAdminAppointment(db: PrismaClient, actor: Actor, input: unknown, now = new Date()) {
  if (!actor.isPlatformAdmin) throw new AuthorizationError();
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("invalid_input");
  const { requestId, decision } = parsed.data;

  await db.$transaction(async (tx) => {
    const request = await tx.markazAdminAppointmentRequest.findUnique({
      where: { id: requestId },
      select: { id: true, tenantId: true, candidateProfileId: true, requestedById: true, status: true },
    });
    if (!request) throw new DomainError("not_found");
    if (request.requestedById === actor.profileId) throw new AuthorizationError();

    const { count } = await tx.markazAdminAppointmentRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: actor.profileId, reviewedAt: now },
    });
    if (count !== 1) throw new DomainError("invalid_state");

    if (decision === "APPROVE") {
      // Re-check at approval time: the candidate must still be an ACTIVE member.
      const stillMember = await tx.membership.findFirst({
        where: { tenantId: request.tenantId, profileId: request.candidateProfileId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!stillMember) throw new DomainError("invalid_state"); // rolls the approval back
      await activateMembership(tx, request.tenantId, request.candidateProfileId, "MARKAZ_ADMIN");
    }
  });
}
