// One shared cast of characters for both the pure-policy tests and the database
// (RLS) tests, so both layers are checked against the same scenarios.

export const T = {
  A: "aaaaaaaa-0000-4000-8000-000000000001",
  B: "bbbbbbbb-0000-4000-8000-000000000002",
} as const;

export const U = {
  superAdmin: "00000000-0000-4000-8000-000000000001",
  adminA: "00000000-0000-4000-8000-0000000000a1",
  adminB: "00000000-0000-4000-8000-0000000000b1",
  teacherAB: "00000000-0000-4000-8000-0000000000ab", // teacher in A and B
  teacherA: "00000000-0000-4000-8000-0000000000a2", // teacher in A only
  studentX: "00000000-0000-4000-8000-0000000000c1", // student in A
  studentY: "00000000-0000-4000-8000-0000000000c2", // student in B
  studentLeft: "00000000-0000-4000-8000-0000000000c3", // left A (membership ENDED)
  parentActive: "00000000-0000-4000-8000-0000000000d1", // ACTIVE link → studentX
  parentVerified: "00000000-0000-4000-8000-0000000000d2", // VERIFIED link → studentX
  parentPending: "00000000-0000-4000-8000-0000000000d3", // PENDING link → studentY
  parentRevoked: "00000000-0000-4000-8000-0000000000d4", // REVOKED link → studentX
  parentUnlinked: "00000000-0000-4000-8000-0000000000d5", // no links
  parentPendingA: "00000000-0000-4000-8000-0000000000d6", // PENDING link → studentX, in Markaz A
} as const;

type Role = "MARKAZ_ADMIN" | "TEACHER" | "STUDENT";
type LinkStatus = "PENDING" | "VERIFIED" | "ACTIVE" | "REVOKED";

export const MEMBERSHIPS: { tenantId: string; profileId: string; role: Role; status: "ACTIVE" | "ENDED" }[] = [
  { tenantId: T.A, profileId: U.adminA, role: "MARKAZ_ADMIN", status: "ACTIVE" },
  { tenantId: T.B, profileId: U.adminB, role: "MARKAZ_ADMIN", status: "ACTIVE" },
  { tenantId: T.A, profileId: U.teacherAB, role: "TEACHER", status: "ACTIVE" },
  { tenantId: T.B, profileId: U.teacherAB, role: "TEACHER", status: "ACTIVE" },
  { tenantId: T.A, profileId: U.teacherA, role: "TEACHER", status: "ACTIVE" },
  { tenantId: T.A, profileId: U.studentX, role: "STUDENT", status: "ACTIVE" },
  { tenantId: T.B, profileId: U.studentY, role: "STUDENT", status: "ACTIVE" },
  { tenantId: T.A, profileId: U.studentLeft, role: "STUDENT", status: "ENDED" },
];

export const STUDENTS = [U.studentX, U.studentY, U.studentLeft];
export const PARENTS = [
  U.parentActive,
  U.parentVerified,
  U.parentPending,
  U.parentRevoked,
  U.parentUnlinked,
  U.parentPendingA,
];

// Each link belongs to the Markaz in which it is verified (A46).
export const LINKS: { parent: string; student: string; tenantId: string; status: LinkStatus }[] = [
  { parent: U.parentActive, student: U.studentX, tenantId: T.A, status: "ACTIVE" },
  { parent: U.parentVerified, student: U.studentX, tenantId: T.A, status: "VERIFIED" },
  { parent: U.parentPending, student: U.studentY, tenantId: T.B, status: "PENDING" },
  { parent: U.parentRevoked, student: U.studentX, tenantId: T.A, status: "REVOKED" },
  { parent: U.parentPendingA, student: U.studentX, tenantId: T.A, status: "PENDING" },
];

// Explicit parent_link.verify grants (A47). Never implied by role.
export const GRANTS: { tenantId: string; profileId: string; revoked?: boolean }[] = [
  { tenantId: T.A, profileId: U.adminA }, // Markaz A admin, granted in A only
  { tenantId: T.A, profileId: U.teacherAB }, // teacher in A and B, granted in A only
  { tenantId: T.A, profileId: U.teacherA, revoked: true }, // grant revoked
];
