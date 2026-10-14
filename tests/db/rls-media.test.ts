import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDatabase } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";
import { insertCorrection, insertGuardianConsent, M, MINOR_DOB, seedMedia, setDob } from "../support/media";

// Data API (RLS) view of the recording & correction media tables (2026-10-14).
let db: PGlite;

const SERVER_ONLY = ["recording_consents", "recordings", "recording_participants", "recording_segments", "media_deletion_requests", "audit_events"];
const EVERYONE = [U.superAdmin, U.adminA, U.adminB, U.teacherA, U.teacherAB, U.studentX, U.parentActive, M.departedTeacher];

beforeAll(async () => {
  db = await createTestDatabase();
  await seed(db);
  await seedMedia(db);
  await setDob(db, U.studentX, MINOR_DOB);
  const consentId = await insertGuardianConsent(db, U.studentX);
  const correctionId = await insertCorrection(db, T.A, U.studentX, U.teacherA);
  await db.query("INSERT INTO correction_anchors (correction_id, tenant_id, kind, snapshot) VALUES ($1, $2, 'PAGE', '{\"label\":\"p\"}')", [correctionId, T.A]);
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO recordings (tenant_id, teacher_profile_id) VALUES ($1, $2) RETURNING id",
    [T.A, U.teacherA],
  );
  await db.query(
    "INSERT INTO recording_participants (recording_id, tenant_id, student_profile_id, audio_included, eligibility, consent_id) VALUES ($1, $2, $3, true, 'CONSENTED', $4)",
    [rows[0].id, T.A, U.studentX, consentId],
  );
  await db.query("INSERT INTO audit_events (actor_id, tenant_id, action, target_type, target_id) VALUES ($1, $2, 'RECORDING_SUBMITTED', 'RECORDING', $3)", [U.teacherA, T.A, rows[0].id]);
});

const count = (who: string, sql: string) => asUser(db, who, async (tx) => (await tx.query(sql)).rows.length);

describe("server-only media tables", () => {
  it.each(SERVER_ONLY)("%s is not readable through the Data API by anyone — not even a Super Admin", async (table) => {
    for (const who of EVERYONE) {
      await expect(count(who, `SELECT 1 FROM ${table}`), `${who}`).rejects.toThrow(/permission denied/);
    }
    await expect(asAnon(db, (tx) => tx.query(`SELECT 1 FROM ${table}`))).rejects.toThrow(/permission denied/);
  });

  it("no Data API writes to consent, recordings or the audit trail", async () => {
    await expect(
      asUser(db, U.parentActive, (tx) =>
        tx.query("INSERT INTO recording_consents (student_profile_id, method, guardian_profile_id, recorded_by_id, granted_at) VALUES ($1, 'GUARDIAN_ONLINE', $2, $2, now())", [U.studentX, U.parentActive]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, U.teacherA, (tx) => tx.query("UPDATE corrections SET note = 'x'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, U.adminA, (tx) => tx.query("DELETE FROM correction_audio_clips"))).rejects.toThrow(/permission denied/);
  });
});

describe("date of birth stays server-only", () => {
  it("the student account row is visible to its readers, but never the DOB columns", async () => {
    expect(await count(U.studentX, "SELECT profile_id, created_at FROM student_accounts")).toBe(1);
    expect(await count(U.parentActive, "SELECT profile_id FROM student_accounts")).toBe(1);
    for (const who of [U.studentX, U.parentActive, U.adminA, U.superAdmin]) {
      await expect(count(who, "SELECT date_of_birth FROM student_accounts")).rejects.toThrow(/permission denied/);
      await expect(count(who, "SELECT * FROM student_accounts")).rejects.toThrow(/permission denied/);
    }
  });
});

describe("anchors follow their correction", () => {
  it("visible to exactly the correction's readers", async () => {
    for (const who of [U.studentX, U.teacherA, U.adminA, U.parentActive]) expect(await count(who, "SELECT id FROM correction_anchors"), who).toBe(1);
    for (const who of [U.adminB, U.teacherAB, U.studentY, U.parentVerified, U.superAdmin, M.departedTeacher]) {
      expect(await count(who, "SELECT id FROM correction_anchors"), who).toBe(0);
    }
  });
});
