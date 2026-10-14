import { z } from "zod";

// Pure authorization rules. No I/O, so every rule is unit-testable and the same rules
// are mirrored by the RLS policies in prisma/migrations/*_rls.
//
// Inputs that come from a request (tenant IDs, student IDs) are untrusted and are
// validated here; a malformed or foreign ID is simply "not authorized".

export const TENANT_ROLES = ["MARKAZ_ADMIN", "TEACHER", "STUDENT"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export type ActorMembership = {
  tenantId: string;
  role: TenantRole;
  status: "ACTIVE" | "ENDED";
};

export type ActorParentLink = {
  studentProfileId: string;
  status: "PENDING" | "VERIFIED" | "ACTIVE" | "REVOKED";
};

/** A live (un-revoked) explicit permission grant. */
export type ActorPermissionGrant = {
  tenantId: string;
  permission: GrantablePermission;
};

/** Everything authorization needs to know about the caller, loaded fresh per request. */
export type Actor = {
  profileId: string;
  isPlatformAdmin: boolean;
  memberships: readonly ActorMembership[];
  parentLinks: readonly ActorParentLink[];
  permissionGrants: readonly ActorPermissionGrant[];
};

// ---------------------------------------------------------------------------------
// 1. Role-derived permissions. Implied by an ACTIVE role in that exact tenant.
// ---------------------------------------------------------------------------------

export type RolePermission =
  | "tenant.read"
  | "tenant.members.read"
  | "tenant.roster.read"
  | "tenant.invitations.manage"
  | "tenant.parent_links.read"
  | "tenant.admin_appointment.request";

// Markaz Admin = full tenant administrator for documented capabilities (A40).
// Teacher: basic roster of their Markaz (A51). Student: their Markaz only.
const ROLE_PERMISSIONS: Record<TenantRole, readonly RolePermission[]> = {
  MARKAZ_ADMIN: [
    "tenant.read",
    "tenant.members.read",
    "tenant.roster.read",
    "tenant.invitations.manage",
    "tenant.parent_links.read",
    "tenant.admin_appointment.request",
  ],
  TEACHER: ["tenant.read", "tenant.roster.read"],
  STUDENT: ["tenant.read"],
};

// Super Admin acts at platform scope, but only for these. It does NOT request Markaz
// Admin appointments (it approves them) and gets no grantable permission implicitly.
const PLATFORM_ADMIN_ROLE_PERMISSIONS: readonly RolePermission[] = [
  "tenant.read",
  "tenant.members.read",
  "tenant.roster.read",
  "tenant.invitations.manage",
  "tenant.parent_links.read",
];

// ---------------------------------------------------------------------------------
// 2. Explicit (grantable) permissions. NEVER implied by a role (A47). Effective only
//    with a live grant in that tenant AND an eligible ACTIVE role in that tenant.
//    Mirrors app.has_tenant_permission() in SQL.
// ---------------------------------------------------------------------------------

export const GRANTABLE_PERMISSIONS = [
  "parent_link.create",
  "parent_link.verify",
  "parent_link.activate",
  "parent_link.revoke",
  "invitation.create",
] as const;
export type GrantablePermission = (typeof GRANTABLE_PERMISSIONS)[number];

// A46/A55–A60: every explicit permission may be held only by a MARKAZ_ADMIN or TEACHER.
const STAFF: readonly TenantRole[] = ["MARKAZ_ADMIN", "TEACHER"];
export const GRANTABLE_PERMISSION_ROLES: Record<GrantablePermission, readonly TenantRole[]> = {
  "parent_link.create": STAFF,
  "parent_link.verify": STAFF,
  "parent_link.activate": STAFF,
  "parent_link.revoke": STAFF,
  "invitation.create": STAFF,
};

export type GrantablePermissionDb =
  | "PARENT_LINK_CREATE"
  | "PARENT_LINK_VERIFY"
  | "PARENT_LINK_ACTIVATE"
  | "PARENT_LINK_REVOKE"
  | "INVITATION_CREATE";

/** Database enum ↔ application name. */
export const GRANTABLE_PERMISSION_DB: Record<GrantablePermission, GrantablePermissionDb> = {
  "parent_link.create": "PARENT_LINK_CREATE",
  "parent_link.verify": "PARENT_LINK_VERIFY",
  "parent_link.activate": "PARENT_LINK_ACTIVATE",
  "parent_link.revoke": "PARENT_LINK_REVOKE",
  "invitation.create": "INVITATION_CREATE",
};

export const GRANTABLE_PERMISSION_FROM_DB = Object.fromEntries(
  Object.entries(GRANTABLE_PERMISSION_DB).map(([app, db]) => [db, app]),
) as Record<GrantablePermissionDb, GrantablePermission>;

export class AuthorizationError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthorizationError";
  }
}

const idSchema = z.uuid();

export function isValidId(value: unknown): value is string {
  return idSchema.safeParse(value).success;
}

export function activeRolesIn(actor: Actor, tenantId: string): TenantRole[] {
  return actor.memberships.filter((m) => m.tenantId === tenantId && m.status === "ACTIVE").map((m) => m.role);
}

export function hasActiveRole(actor: Actor, tenantId: string, role: TenantRole): boolean {
  return activeRolesIn(actor, tenantId).includes(role);
}

/**
 * Role-derived tenant permission. Decided only by the actor's own ACTIVE membership in
 * that exact tenant — never by a role held in another Markaz (A28) and never by a role
 * claimed by the client.
 */
export function hasTenantPermission(actor: Actor, tenantId: unknown, permission: RolePermission): boolean {
  if (!isValidId(tenantId)) return false;
  if (actor.isPlatformAdmin && PLATFORM_ADMIN_ROLE_PERMISSIONS.includes(permission)) return true;
  return activeRolesIn(actor, tenantId).some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function requireTenantPermission(actor: Actor, tenantId: unknown, permission: RolePermission): string {
  if (!hasTenantPermission(actor, tenantId, permission)) throw new AuthorizationError();
  return tenantId as string;
}

/** Explicit permission check. No platform-admin bypass, no role-only shortcut. */
export function hasGrantedPermission(actor: Actor, tenantId: unknown, permission: GrantablePermission): boolean {
  if (!isValidId(tenantId)) return false;
  const granted = actor.permissionGrants.some((g) => g.tenantId === tenantId && g.permission === permission);
  if (!granted) return false;
  const eligible = GRANTABLE_PERMISSION_ROLES[permission];
  return activeRolesIn(actor, tenantId).some((role) => eligible.includes(role));
}

export function requireGrantedPermission(actor: Actor, tenantId: unknown, permission: GrantablePermission): string {
  if (!hasGrantedPermission(actor, tenantId, permission)) throw new AuthorizationError();
  return tenantId as string;
}

/** What an invitation creates on acceptance: a tenant membership role, or a Parent account. */
export const INVITE_TARGETS = ["MARKAZ_ADMIN", "TEACHER", "STUDENT", "PARENT"] as const;
export type InviteTarget = (typeof INVITE_TARGETS)[number];

/**
 * Which targets may an actor invite into a tenant?
 * - Super Admin: any, including MARKAZ_ADMIN (platform scope).
 * - Markaz Admin (by role, A40/A61): TEACHER, STUDENT, PARENT in their own Markaz. Never
 *   MARKAZ_ADMIN — that requires a Super Admin-approved request (A52).
 * - Teacher: only with explicit invitation.create in that Markaz (A59) — STUDENT, PARENT.
 * - Everyone else: nothing.
 */
export function invitableTargets(actor: Actor, tenantId: unknown): InviteTarget[] {
  if (!isValidId(tenantId)) return [];
  if (actor.isPlatformAdmin) return [...INVITE_TARGETS];
  const targets = new Set<InviteTarget>();
  if (hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) ["TEACHER", "STUDENT", "PARENT"].forEach((t) => targets.add(t as InviteTarget));
  if (hasActiveRole(actor, tenantId, "TEACHER") && hasGrantedPermission(actor, tenantId, "invitation.create")) {
    targets.add("STUDENT");
    targets.add("PARENT");
  }
  return INVITE_TARGETS.filter((t) => targets.has(t));
}

/**
 * May the actor remove a live grant? Super Admin: any. Markaz Admin: grants in their own
 * Markaz held by someone who is not an ACTIVE Markaz Admin there (i.e. Teacher grants,
 * including those of teachers who have since left), never their own.
 */
export function canRevokePermission(
  actor: Actor,
  input: { tenantId: string; holderProfileId: string; holderActiveRoles: readonly TenantRole[] },
): boolean {
  if (actor.isPlatformAdmin) return true;
  return (
    hasActiveRole(actor, input.tenantId, "MARKAZ_ADMIN") &&
    !input.holderActiveRoles.includes("MARKAZ_ADMIN") &&
    input.holderProfileId !== actor.profileId
  );
}

/**
 * May the actor assign an explicit permission to a grantee in a tenant? (A58, A62)
 * - Super Admin: any grantable permission, in any Markaz, to an eligible grantee.
 * - Markaz Admin: any of the five grantable permissions, ONLY in their own Markaz, ONLY to
 *   someone who is an ACTIVE Teacher there, and never to themselves. Grantable permissions
 *   are all tenant-scoped, so there is no path to platform/global privileges.
 * - Teachers and everyone else: never.
 */
export function canAssignPermission(
  actor: Actor,
  input: { tenantId: unknown; permission: GrantablePermission; granteeProfileId: string; granteeActiveRoles: readonly TenantRole[] },
): boolean {
  const { tenantId, permission, granteeProfileId, granteeActiveRoles } = input;
  if (!isValidId(tenantId)) return false;
  const eligible = granteeActiveRoles.some((r) => GRANTABLE_PERMISSION_ROLES[permission].includes(r));
  if (!eligible) return false;
  if (actor.isPlatformAdmin) return true;
  return (
    GRANTABLE_PERMISSIONS.includes(permission) &&
    hasActiveRole(actor, tenantId, "MARKAZ_ADMIN") &&
    granteeActiveRoles.includes("TEACHER") &&
    granteeProfileId !== actor.profileId
  );
}

// ---------------------------------------------------------------------------------
// 3. Parent access (A41, A48). Only ACTIVE grants anything.
// ---------------------------------------------------------------------------------

export function hasActiveParentLink(actor: Actor, studentProfileId: string): boolean {
  return actor.parentLinks.some((l) => l.studentProfileId === studentProfileId && l.status === "ACTIVE");
}

/** Student-data categories that exist (or will exist). Used as the authorization contract. */
export const STUDENT_DATA_CATEGORIES = [
  "progress",
  "attendance",
  "assessments",
  "submissions",
  "corrections",
  "approved_recordings",
  "teacher_private_notes",
  "admin_notes",
] as const;
export type StudentDataCategory = (typeof STUDENT_DATA_CATEGORIES)[number];

/** What an ACTIVE-linked Parent may see (A41). Everything else is excluded. */
export const PARENT_VISIBLE_CATEGORIES: readonly StudentDataCategory[] = [
  "progress",
  "attendance",
  "assessments",
  "submissions",
  "corrections",
  "approved_recordings",
];

/**
 * Parent-side contract for categories whose features do not exist yet. Each future
 * feature must call this (and mirror it in RLS) rather than re-deciding the rule.
 * Note: "approved_recordings" also requires the recording itself to be approved —
 * what that means is open (OQ23); this only answers the relationship half.
 */
export function parentMaySee(actor: Actor, studentProfileId: unknown, category: StudentDataCategory): boolean {
  if (!isValidId(studentProfileId)) return false;
  return PARENT_VISIBLE_CATEGORIES.includes(category) && hasActiveParentLink(actor, studentProfileId);
}

// ---------------------------------------------------------------------------------
// 4. Student records.
// ---------------------------------------------------------------------------------

/**
 * May the actor read a student's account record (basic account, not private data)?
 * - the student themself (regardless of membership — A32);
 * - a Parent with an ACTIVE link (A41);
 * - a Markaz Admin of a Markaz where the student is an ACTIVE member;
 * - a platform admin.
 */
export function canReadStudentAccount(
  actor: Actor,
  studentProfileId: unknown,
  studentActiveTenantIds: readonly string[],
): boolean {
  if (!isValidId(studentProfileId)) return false;
  if (actor.profileId === studentProfileId) return true;
  if (actor.isPlatformAdmin) return true;
  if (hasActiveParentLink(actor, studentProfileId)) return true;
  return studentActiveTenantIds.some((t) => hasActiveRole(actor, t, "MARKAZ_ADMIN"));
}

/**
 * Future hook for DETAILED student data (A51). Classes/enrollments do not exist yet,
 * so the default resolver says "teaches nobody" and teachers get no detailed access.
 * When classes exist, supply a resolver backed by class assignments.
 */
export type ClassAssignmentResolver = (input: {
  tenantId: string;
  teacherProfileId: string;
  studentProfileId: string;
}) => boolean;

export const NO_CLASSES_YET: ClassAssignmentResolver = () => false;

/**
 * Detailed (non-private) student data within one Markaz: the student, a Markaz Admin of
 * that Markaz, or a Teacher of that Markaz who teaches the student. Private categories
 * (corrections, teacher-private notes, admin notes) have their own rules and are NOT
 * unlocked by this.
 */
export function canReadStudentDetail(
  actor: Actor,
  input: { tenantId: unknown; studentProfileId: unknown; studentIsActiveInTenant: boolean },
  teaches: ClassAssignmentResolver = NO_CLASSES_YET,
): boolean {
  const { tenantId, studentProfileId } = input;
  if (!isValidId(tenantId) || !isValidId(studentProfileId)) return false;
  if (actor.profileId === studentProfileId) return true;
  if (!input.studentIsActiveInTenant) return false;
  if (hasActiveRole(actor, tenantId, "MARKAZ_ADMIN")) return true;
  return (
    hasActiveRole(actor, tenantId, "TEACHER") &&
    teaches({ tenantId, teacherProfileId: actor.profileId, studentProfileId })
  );
}

// ---------------------------------------------------------------------------------
// 5. Correction & recording media (owner decisions 2026-10-14, A66–A80).
// ---------------------------------------------------------------------------------

/**
 * ALLOW_AUDITED = allowed only if the mandatory audit event is written first (Super Admin
 * support/audit access, A66). Callers must never treat it as plain ALLOW.
 */
export type MediaReadAccess = "DENY" | "ALLOW" | "ALLOW_AUDITED";

type CorrectionRef = { tenantId: string; studentProfileId: string; teacherProfileId: string };

/**
 * Correction (and correction-media) read access (A66, superseding A17's "student + teacher"):
 * - the student, always — also after leaving the Markaz (A32);
 * - a parent with an ACTIVE link — across ALL of the child's Markaz, by decision;
 * - the authoring teacher only while an ACTIVE teacher of that Markaz (departed → denied;
 *   the history belongs to the Markaz);
 * - a Markaz Admin of THAT Markaz (never another Markaz's);
 * - a Super Admin — audited.
 */
export function correctionReadAccess(actor: Actor, correction: CorrectionRef): MediaReadAccess {
  if (actor.profileId === correction.studentProfileId) return "ALLOW";
  if (hasActiveParentLink(actor, correction.studentProfileId)) return "ALLOW";
  if (actor.profileId === correction.teacherProfileId && hasActiveRole(actor, correction.tenantId, "TEACHER")) return "ALLOW";
  if (hasActiveRole(actor, correction.tenantId, "MARKAZ_ADMIN")) return "ALLOW";
  if (actor.isPlatformAdmin) return "ALLOW_AUDITED";
  return "DENY";
}

/**
 * Plain (un-audited) correction visibility. Mirrors the RLS policy corrections_select, which
 * deliberately has no Super Admin branch: a Data API read could not write the audit event.
 */
export function canReadCorrection(actor: Actor, correction: CorrectionRef): boolean {
  return correctionReadAccess(actor, correction) === "ALLOW";
}

/** Only the correction's own teacher, while an ACTIVE teacher of that Markaz, adds audio. */
export function isActiveAuthoringTeacher(actor: Actor, item: { tenantId: string; teacherProfileId: string }): boolean {
  return actor.profileId === item.teacherProfileId && hasActiveRole(actor, item.tenantId, "TEACHER");
}

/**
 * Staff access to a full recording (A77): the authoring teacher while active, a Markaz Admin
 * of that Markaz, a Super Admin (audited). Parent access has extra gates (approval, ACTIVE
 * link, consent) and is decided in src/server/services/recordings.ts. Student access to full
 * recordings is NOT decided and therefore not granted.
 */
export function recordingStaffAccess(actor: Actor, recording: { tenantId: string; teacherProfileId: string }): MediaReadAccess {
  if (isActiveAuthoringTeacher(actor, recording)) return "ALLOW";
  if (hasActiveRole(actor, recording.tenantId, "MARKAZ_ADMIN")) return "ALLOW";
  if (actor.isPlatformAdmin) return "ALLOW_AUDITED";
  return "DENY";
}

/** Deletion may be REQUESTED by the authoring teacher (while active) or a Markaz Admin (A73). */
export function canRequestMediaDeletion(actor: Actor, target: { tenantId: string; teacherProfileId: string }): boolean {
  return isActiveAuthoringTeacher(actor, target) || hasActiveRole(actor, target.tenantId, "MARKAZ_ADMIN");
}

/**
 * Final deletion approval: a Markaz Admin of that Markaz only — never a teacher (A73).
 * INTERIM (owner decision pending): whether an admin may approve their OWN request is not
 * decided, so it is refused (the narrowest reading). Another admin must approve.
 */
export function canApproveMediaDeletion(actor: Actor, request: { tenantId: string; requestedById: string }): boolean {
  return hasActiveRole(actor, request.tenantId, "MARKAZ_ADMIN") && actor.profileId !== request.requestedById;
}

/**
 * Recording approval and revocation: a Markaz Admin of that Markaz (A78/A79); the teacher is
 * never the final approver. INTERIM (owner decision pending, same question as deletion): a
 * person who is both the recording's author and a Markaz Admin may not approve it.
 */
export function canApproveRecording(actor: Actor, recording: { tenantId: string; teacherProfileId: string }): boolean {
  return hasActiveRole(actor, recording.tenantId, "MARKAZ_ADMIN") && actor.profileId !== recording.teacherProfileId;
}

export function canRevokeRecordingApproval(actor: Actor, recording: { tenantId: string }): boolean {
  return hasActiveRole(actor, recording.tenantId, "MARKAZ_ADMIN");
}

/** Verified offline consent is recorded by a Markaz Admin of that Markaz (A71). */
export function canRecordOfflineConsent(actor: Actor, tenantId: unknown): boolean {
  return isValidId(tenantId) && hasActiveRole(actor, tenantId, "MARKAZ_ADMIN");
}
