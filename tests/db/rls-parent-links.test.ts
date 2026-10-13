import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";

// Data API (RLS) checks for the parent-link workflow migration (20261013000500).

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
  await seed(db);
  await db.query(
    `INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id) VALUES ($1, $2, 'PARENT_LINK_ACTIVATE', $3)`,
    [T.A, U.teacherA, U.superAdmin],
  );
  await db.query(
    `INSERT INTO parent_link_events (link_id, to_status, actor_id) SELECT id, 'PENDING', parent_profile_id FROM parent_student_links LIMIT 1`,
  );
});

afterAll(async () => {
  await db?.close();
});

const linkCount = (who: string, tenantId: string) =>
  asUser(db, who, async (tx) => (await tx.query("SELECT id FROM parent_student_links WHERE tenant_id = $1", [tenantId])).rows.length);

describe("parent links (RLS) after the workflow migration", () => {
  it("any parent-link permission in a Markaz shows that Markaz's links (activate-only teacher)", async () => {
    expect(await linkCount(U.teacherA, T.A)).toBe(4);
    expect(await linkCount(U.teacherA, T.B)).toBe(0);
  });

  it("a permission in SQL still needs an eligible ACTIVE role, and has no platform-admin bypass", async () => {
    const r = await asUser(db, U.superAdmin, (tx) =>
      tx.query<{ ok: boolean }>("SELECT app.has_tenant_permission($1, 'PARENT_LINK_ACTIVATE') AS ok", [T.A]),
    );
    expect(r.rows[0].ok).toBe(false);
  });

  it("link history (parent_link_events) is server-only", async () => {
    for (const who of [U.adminA, U.parentActive, U.superAdmin]) {
      await expect(asUser(db, who, (tx) => tx.query("SELECT * FROM parent_link_events"))).rejects.toThrow(/permission denied/);
    }
  });

  it("a parent cannot activate their own link through the Data API", async () => {
    await expect(
      asUser(db, U.parentVerified, (tx) =>
        tx.query(
          "UPDATE parent_student_links SET status = 'ACTIVE', activated_by_id = $1, activated_at = now() WHERE parent_profile_id = $1",
          [U.parentVerified],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
