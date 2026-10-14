import type { PGlite } from "@electric-sql/pglite";
import { expect } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { CORRECTION_CLIP_BUCKET } from "@/server/storage/object-storage";
import type { FakeStorage } from "../db/prisma";
import { T, U } from "./fixture";
import { buildM4a } from "./m4a";

// Extra cast for media tests, added on top of the shared fixture in each test database only
// (never in the shared seed, so other suites are unaffected).

export const M = {
  departedTeacher: "00000000-0000-4000-8000-0000000000e1", // was a TEACHER in A (ENDED)
  adminA2: "00000000-0000-4000-8000-0000000000e2", // a second Markaz Admin of A
} as const;

/** The approved policy (A81: minor = under 18). Kept as a named constant for readability. */
export const TEST_POLICY = { minorAgeThresholdYears: 18 } as const;
export const MINOR_DOB = "2015-03-01";
export const ADULT_DOB = "1990-03-01";

export async function seedMedia(pg: PGlite) {
  for (const id of Object.values(M)) await pg.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  await pg.query(
    `INSERT INTO memberships (tenant_id, profile_id, role, status, ended_at) VALUES
       ($1, $2, 'TEACHER', 'ENDED', now()),
       ($1, $3, 'MARKAZ_ADMIN', 'ACTIVE', NULL)`,
    [T.A, M.departedTeacher, M.adminA2],
  );
  // studentX also studies in Markaz B (cross-Markaz parent visibility).
  await pg.query(`INSERT INTO memberships (tenant_id, profile_id, role, status) VALUES ($1, $2, 'STUDENT', 'ACTIVE')`, [T.B, U.studentX]);
}

/** Owner-path DOB: entered by the student and (by default) verified by adminA (A82). */
export async function setDob(pg: PGlite, studentProfileId: string, dob: string, verified = true) {
  await pg.query(
    `UPDATE student_accounts SET date_of_birth = $2, date_of_birth_entered_by_id = $1, date_of_birth_entered_at = now(),
       date_of_birth_verified_by_id = CASE WHEN $3 THEN $4::uuid END, date_of_birth_verified_at = CASE WHEN $3 THEN now() END
     WHERE profile_id = $1`,
    [studentProfileId, dob, verified, U.adminA],
  );
}

/** Owner-path Option C entitlement (A90) — tests of recordings need it ENABLED. */
export async function enableOptionCFor(pg: PGlite, tenantId: string) {
  await pg.query(
    `INSERT INTO recording_entitlements (tenant_id, status, requested_by_id, requested_at, enabled_by_id, enabled_at)
     VALUES ($1, 'ENABLED', $2, now(), $3, now())`,
    [tenantId, U.adminA, U.superAdmin],
  );
}

/** Owner-path adult self-consent (A83). */
export async function insertSelfConsent(pg: PGlite, studentProfileId: string) {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO recording_consents (student_profile_id, method, recorded_by_id, granted_at) VALUES ($1, 'SELF_ONLINE', $1, now()) RETURNING id`,
    [studentProfileId],
  );
  return rows[0].id;
}

/** Live guardian consent from parentActive (owner-path, bypassing the service). */
export async function insertGuardianConsent(pg: PGlite, studentProfileId: string, guardian: string = U.parentActive) {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO recording_consents (student_profile_id, method, guardian_profile_id, recorded_by_id, granted_at)
     VALUES ($1, 'GUARDIAN_ONLINE', $2, $2, now()) RETURNING id`,
    [studentProfileId, guardian],
  );
  return rows[0].id;
}

export async function insertCorrection(pg: PGlite, tenantId: string, studentProfileId: string, teacherProfileId: string) {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO corrections (tenant_id, student_profile_id, teacher_profile_id, captured_at, note)
     VALUES ($1, $2, $3, now(), 'test note') RETURNING id`,
    [tenantId, studentProfileId, teacherProfileId],
  );
  return rows[0].id;
}

/** Simulates the browser upload of an M4A file to the clip's own object. */
export async function uploadM4a(db: PrismaClient, storage: FakeStorage, clipId: string, durationMs = 2500) {
  const clip = await db.correctionAudioClip.findUniqueOrThrow({ where: { id: clipId } });
  expect(clip.storageBucket).toBe(CORRECTION_CLIP_BUCKET);
  storage.put(clip.storageBucket, clip.storageObjectKey, buildM4a({ durationMs }));
  return clip;
}
