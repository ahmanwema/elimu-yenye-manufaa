import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/server/authz/policy";
import { getTenant, listMyTenants, listTenantMembers } from "@/server/data/tenants";
import { getStudentAccount } from "@/server/data/students";
import { actorFor, activeTenantsOf } from "../support/actors";
import { T, U } from "../support/fixture";

// These tests prove the data layer authorizes BEFORE it queries, and that queries
// are scoped to the authorized id — the guarantees we rely on because Prisma
// bypasses RLS.

function fakeDb() {
  return {
    tenant: {
      findUnique: vi.fn(async () => ({ id: T.A, name: "Markaz A", slug: "a" })),
      findMany: vi.fn(async () => [
        { id: T.A, name: "Markaz A", slug: "a" },
        { id: T.B, name: "Markaz B", slug: "b" },
      ]),
    },
    membership: {
      findMany: vi.fn(async (args: { where: { profileId?: string } }) =>
        args.where.profileId ? activeTenantsOf(args.where.profileId).map((tenantId) => ({ tenantId })) : [],
      ),
    },
    studentAccount: {
      findUnique: vi.fn(async (args: { where: { profileId: string } }) => ({
        profileId: args.where.profileId,
        createdAt: new Date(),
        profile: { displayName: null },
      })),
    },
  };
}

type Db = Parameters<typeof getTenant>[0] & Parameters<typeof getStudentAccount>[0];
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;

describe("tenant data access", () => {
  it("Markaz A admin reads Markaz A, scoped by the authorized id", async () => {
    const db = fakeDb();
    await getTenant(asDb(db), actorFor(U.adminA), T.A);
    expect(db.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: T.A } }));
  });

  it("Markaz A admin is denied Markaz B and the database is never queried", async () => {
    const db = fakeDb();
    await expect(getTenant(asDb(db), actorFor(U.adminA), T.B)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listTenantMembers(asDb(db), actorFor(U.adminA), T.B)).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
    expect(db.membership.findMany).not.toHaveBeenCalled();
  });

  it("a teacher cannot list members, even in their own Markaz", async () => {
    const db = fakeDb();
    await expect(listTenantMembers(asDb(db), actorFor(U.teacherAB), T.A)).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.membership.findMany).not.toHaveBeenCalled();
  });

  it("member listing is filtered by the authorized tenant only", async () => {
    const db = fakeDb();
    await listTenantMembers(asDb(db), actorFor(U.adminA), T.A);
    expect(db.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: T.A } }));
  });

  it("listMyTenants only asks for tenants with an ACTIVE membership", async () => {
    const db = fakeDb();
    await listMyTenants(asDb(db), actorFor(U.teacherAB));
    expect(db.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [T.A, T.B] } } }),
    );
  });

  it("listMyTenants does not query at all for a departed student", async () => {
    const db = fakeDb();
    expect(await listMyTenants(asDb(db), actorFor(U.studentLeft))).toEqual([]);
    expect(db.tenant.findMany).not.toHaveBeenCalled();
  });
});

describe("student data access", () => {
  it("Student X is denied Student Y's account and it is never read", async () => {
    const db = fakeDb();
    await expect(getStudentAccount(asDb(db), actorFor(U.studentX), U.studentY)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.studentAccount.findUnique).not.toHaveBeenCalled();
  });

  it("an unlinked parent is denied", async () => {
    const db = fakeDb();
    await expect(getStudentAccount(asDb(db), actorFor(U.parentUnlinked), U.studentX)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("an ACTIVE-linked parent is allowed", async () => {
    const db = fakeDb();
    await expect(getStudentAccount(asDb(db), actorFor(U.parentActive), U.studentX)).resolves.toMatchObject({
      profileId: U.studentX,
    });
  });

  it("a malformed id is rejected before any query", async () => {
    const db = fakeDb();
    await expect(getStudentAccount(asDb(db), actorFor(U.superAdmin), "x' OR 1=1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.membership.findMany).not.toHaveBeenCalled();
  });
});
