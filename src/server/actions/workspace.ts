"use server";

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requestMarkazAdminAppointment, reviewMarkazAdminAppointment } from "@/server/services/appointments";
import {
  activateParentLink,
  createLinkAsStaff,
  requestLinkAsParent,
  revokeOwnParentLink,
  revokeParentLinkAsStaff,
  verifyParentLink,
} from "@/server/services/parent-links";
import { grantTenantPermission, revokeTenantPermission } from "@/server/services/permissions";
import { DomainError } from "@/server/services/errors";
import { field, runAsActor } from "./run";

// Markaz workspace + account + platform admin actions. Every one goes through a service
// that authorizes the actor before any database write.

// --- Parent links -------------------------------------------------------------------
export async function requestLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    requestLinkAsParent(db, actor, {
      tenantSlug: field(formData, "tenantSlug"),
      studentEmail: field(formData, "studentEmail"),
      studentRegistrationNumber: field(formData, "studentRegistrationNumber"),
    }),
  );
}

export async function createLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await createLinkAsStaff(db, actor, {
      tenantId: field(formData, "tenantId"),
      parentEmail: field(formData, "parentEmail"),
      studentProfileId: field(formData, "studentProfileId"),
    });
  });
}

export async function verifyLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => verifyParentLink(db, actor, { linkId: field(formData, "linkId") }));
}

export async function activateLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => activateParentLink(db, actor, { linkId: field(formData, "linkId") }));
}

export async function revokeLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeParentLinkAsStaff(db, actor, { linkId: field(formData, "linkId") }));
}

export async function withdrawMyLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeOwnParentLink(db, actor, { linkId: field(formData, "linkId") }));
}

// --- Markaz Admin appointment -------------------------------------------------------
export async function requestAppointmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await requestMarkazAdminAppointment(db, actor, {
      tenantId: field(formData, "tenantId"),
      candidateProfileId: field(formData, "candidateProfileId"),
    });
  });
}

export async function reviewAppointmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) =>
    reviewMarkazAdminAppointment(db, actor, {
      requestId: field(formData, "requestId"),
      decision: field(formData, "decision"),
    }),
  );
}

// --- Explicit permissions -----------------------------------------------------------
// The permission name comes from the form but is validated against the grantable list,
// and canAssignPermission() decides whether THIS actor may assign it to THIS grantee.
export async function grantPermissionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    await grantTenantPermission(db, actor, {
      tenantId: field(formData, "tenantId"),
      profileId: field(formData, "profileId"),
      permission: field(formData, "permission"),
    });
  });
}

export async function revokePermissionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeTenantPermission(db, actor, field(formData, "grantId")));
}

// --- Profile ------------------------------------------------------------------------
const nameSchema = z.string().trim().min(1).max(80);

/** A user may set only their own display name. */
export async function updateMyNameAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor(async (db, actor) => {
    const parsed = nameSchema.safeParse(field(formData, "displayName"));
    if (!parsed.success) throw new DomainError("invalid_input");
    await db.profile.update({ where: { id: actor.profileId }, data: { displayName: parsed.data } });
  });
}
