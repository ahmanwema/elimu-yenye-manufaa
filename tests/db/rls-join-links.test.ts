import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createTestDatabase } from "./harness";
import { seed } from "./seed";
import { T, U } from "../support/fixture";

// The join-link tables are SERVER-ONLY (2026-11-22), like the twelve Live Class tables.
//
// A join link is a credential: its row holds the token hash, the remaining uses and the Markaz
// it opens, and join_link_uses says which person came in through which link. Nobody reaches
// either table through the Data API — not an anonymous visitor, not a student, not a teacher,
// and not even the Markaz Admin who issued the link. Everything goes through the server's own
// authorization layer (canManageJoinLinks, and token validation for redemption).
//
// Note the visitor redeeming a link has no account at all while redeeming, so no policy could
// express that path in the first place: it is necessarily server-side.

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
  await seed(db);
  // Insert a link and a use as the owner (as a migration or the server's Prisma role would).
  await db.query(
    `INSERT INTO join_links (id, tenant_id, token_hash, label, expires_at, created_by_id)
     VALUES ('11111111-0000-4000-8000-000000000001', $1, 'hash-not-a-real-token', 'WhatsApp group',
             now() + interval '30 days', $2)`,
    [T.A, U.adminA],
  );
  await db.query(
    `INSERT INTO join_link_uses (join_link_id, tenant_id, profile_id)
     VALUES ('11111111-0000-4000-8000-000000000001', $1, $2)`,
    [T.A, U.studentX],
  );
});

const TABLES = ["join_links", "join_link_uses"] as const;

describe("join-link tables are unreachable through the Data API", () => {
  it.each(TABLES)("anon cannot read %s", async (table) => {
    await expect(asAnon(db, (tx) => tx.query(`SELECT * FROM ${table}`))).rejects.toThrow();
  });

  it.each(TABLES)("anon cannot write to %s", async (table) => {
    await expect(
      asAnon(db, (tx) => tx.query(`INSERT INTO ${table} DEFAULT VALUES`)),
    ).rejects.toThrow();
  });

  it.each([
    ["the Markaz Admin who issued the link", U.adminA],
    ["a Teacher of that Markaz", U.teacherAB],
    ["a Student of that Markaz", U.studentX],
    ["an admin of another Markaz", U.adminB],
    ["a Super Admin", U.superAdmin],
  ])("%s cannot read join_links", async (_label, userId) => {
    await expect(asUser(db, userId, (tx) => tx.query("SELECT * FROM join_links"))).rejects.toThrow();
  });

  it.each([
    ["the Markaz Admin who issued the link", U.adminA],
    ["the student who used it", U.studentX],
    ["a Super Admin", U.superAdmin],
  ])("%s cannot read join_link_uses", async (_label, userId) => {
    await expect(asUser(db, userId, (tx) => tx.query("SELECT * FROM join_link_uses"))).rejects.toThrow();
  });

  it.each(TABLES)("no authenticated user can delete from %s to cover their tracks", async (table) => {
    await expect(asUser(db, U.adminA, (tx) => tx.query(`DELETE FROM ${table}`))).rejects.toThrow();
  });

  it("the token hash never leaves the server: both tables have RLS enabled and no policy", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean; policies: number }>(
      `SELECT c.relname, c.relrowsecurity,
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
      [[...TABLES]],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.policies).toBe(0);
    }
  });
});

describe("a join link can only point at a class of its own Markaz", () => {
  it("the database refuses a class from another Markaz", async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO classes (tenant_id, name, status, created_by_id)
       VALUES ($1, 'Class of B', 'ACTIVE', $2) RETURNING id`,
      [T.B, U.adminB],
    );
    await expect(
      db.query(
        `INSERT INTO join_links (tenant_id, class_id, token_hash, label, expires_at, created_by_id)
         VALUES ($1, $2, 'another-hash', 'Wrong Markaz', now() + interval '1 day', $3)`,
        [T.A, rows[0].id, U.adminA],
      ),
    ).rejects.toThrow(/same tenant/);
  });
});
