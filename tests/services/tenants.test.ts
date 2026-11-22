import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, canCreateTenant } from "@/server/authz/policy";
import { DomainError } from "@/server/services/errors";
import { createTenant, listTenants } from "@/server/services/tenants";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

// Creating a Markaz (owner decision 2026-11-22, Stage 1 of self-service onboarding).
// Super Admin only; the first Markaz Admin is established at creation time, because
// invite-first onboarding (A45) cannot start a Markaz that has nobody to invite from.

let pg: PGlite;
let db: PrismaClient;
const as = (id: string) => actor(db, id);
const NOW = new Date("2026-11-22T09:00:00.000Z");

/** A profile with no membership anywhere — the person a new Markaz is opened for. */
async function freshProfile(): Promise<string> {
  const id = randomUUID();
  await pg.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  return id;
}

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
});

describe("createTenant", () => {
  it("creates the Markaz and its first ACTIVE Markaz Admin", async () => {
    const admin = await freshProfile();
    const tenant = await createTenant(
      db,
      await as(U.superAdmin),
      { name: "Home Madrasa", slug: "home-madrasa", adminProfileId: admin },
      NOW,
    );

    expect(tenant.name).toBe("Home Madrasa");
    expect(tenant.slug).toBe("home-madrasa");

    const memberships = await db.membership.findMany({ where: { tenantId: tenant.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ profileId: admin, role: "MARKAZ_ADMIN", status: "ACTIVE" });
  });

  it("gives that person the TEACHER role too, but only when asked (one-person Madrasa)", async () => {
    const admin = await freshProfile();
    const tenant = await createTenant(
      db,
      await as(U.superAdmin),
      { name: "Home Madrasa", slug: "home-madrasa", adminProfileId: admin, alsoTeacher: true },
      NOW,
    );
    const roles = (await db.membership.findMany({ where: { tenantId: tenant.id }, select: { role: true } }))
      .map((m) => m.role)
      .sort();
    expect(roles).toEqual(["MARKAZ_ADMIN", "TEACHER"]);
  });

  it("the new admin can immediately act as a Markaz Admin there, with no invitation", async () => {
    const admin = await freshProfile();
    const tenant = await createTenant(
      db,
      await as(U.superAdmin),
      { name: "Home Madrasa", slug: "home-madrasa", adminProfileId: admin },
      NOW,
    );
    const loaded = await as(admin);
    expect(loaded.memberships).toContainEqual({ tenantId: tenant.id, role: "MARKAZ_ADMIN", status: "ACTIVE" });
  });

  it("records one TENANT_CREATED audit event naming the first admin", async () => {
    const admin = await freshProfile();
    const tenant = await createTenant(
      db,
      await as(U.superAdmin),
      { name: "Home Madrasa", slug: "home-madrasa", adminProfileId: admin },
      NOW,
    );
    const events = await db.auditEvent.findMany({ where: { action: "TENANT_CREATED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: U.superAdmin,
      tenantId: tenant.id,
      targetType: "TENANT",
      targetId: tenant.id,
    });
    expect(events[0].metadata).toMatchObject({ slug: "home-madrasa", firstAdminId: admin });
  });

  it("creates a Markaz with NO administrator, for the link-based flow", async () => {
    const tenant = await createTenant(db, await as(U.superAdmin), { name: "Home Madrasa", slug: "home-madrasa" }, NOW);
    expect(await db.membership.count({ where: { tenantId: tenant.id } })).toBe(0);
    const events = await db.auditEvent.findMany({ where: { action: "TENANT_CREATED" } });
    expect(events[0].metadata).toMatchObject({ slug: "home-madrasa", firstAdminId: null });
  });

  it("refuses a duplicate code and leaves nothing behind", async () => {
    const first = await freshProfile();
    const second = await freshProfile();
    await createTenant(db, await as(U.superAdmin), { name: "One", slug: "shared-code", adminProfileId: first }, NOW);
    await expect(
      createTenant(db, await as(U.superAdmin), { name: "Two", slug: "shared-code", adminProfileId: second }, NOW),
    ).rejects.toThrow(DomainError);
    expect(await db.tenant.count({ where: { slug: "shared-code" } })).toBe(1);
    expect(await db.membership.count({ where: { profileId: second } })).toBe(0);
  });

  it.each([
    ["an empty name", { name: "   ", slug: "ok-code" }],
    ["a code with spaces", { name: "Fine", slug: "not a code" }],
    ["a code in upper case with underscores", { name: "Fine", slug: "Home_Madrasa" }],
    ["a code that is too short", { name: "Fine", slug: "ab" }],
    ["a code with a doubled hyphen", { name: "Fine", slug: "home--madrasa" }],
    ["a code with a trailing hyphen", { name: "Fine", slug: "home-" }],
  ])("rejects %s", async (_label, fields) => {
    const admin = await freshProfile();
    await expect(
      createTenant(db, await as(U.superAdmin), { ...fields, adminProfileId: admin }, NOW),
    ).rejects.toThrow(DomainError);
    expect(await db.tenant.count()).toBe(2); // only the two fixture Markaz
  });

  it("refuses an admin profile that does not exist", async () => {
    await expect(
      createTenant(db, await as(U.superAdmin), { name: "Ghost", slug: "ghost", adminProfileId: randomUUID() }, NOW),
    ).rejects.toThrow(DomainError);
    expect(await db.tenant.count()).toBe(2);
  });

  it.each([
    ["a Markaz Admin", U.adminA],
    ["a Teacher", U.teacherAB],
    ["a Student", U.studentX],
  ])("denies %s, and never reaches the database", async (_label, profileId) => {
    const admin = await freshProfile();
    const caller = await as(profileId);
    const spy = spyDb(db);
    await expect(
      createTenant(spy.db, caller, { name: "Nope", slug: "nope", adminProfileId: admin }, NOW),
    ).rejects.toThrow(AuthorizationError);
    expect(spy.calls).toEqual([]);
    expect(await db.tenant.count()).toBe(2);
  });

  it("no tenant role grants it, in any Markaz", () => {
    for (const id of [U.adminA, U.adminB, U.teacherAB, U.teacherA, U.studentX]) {
      expect(canCreateTenant({ profileId: id, isPlatformAdmin: false, memberships: [], parentLinks: [], permissionGrants: [] })).toBe(false);
    }
    expect(canCreateTenant({ profileId: U.superAdmin, isPlatformAdmin: true, memberships: [], parentLinks: [], permissionGrants: [] })).toBe(true);
  });
});

describe("listTenants", () => {
  it("lists every Markaz for a Super Admin", async () => {
    const tenants = await listTenants(db, await as(U.superAdmin));
    expect(tenants.map((t) => t.id).sort()).toEqual([T.A, T.B].sort());
  });

  it("denies a Markaz Admin — it is a platform-wide listing", async () => {
    await expect(listTenants(db, await as(U.adminA))).rejects.toThrow(AuthorizationError);
  });
});
