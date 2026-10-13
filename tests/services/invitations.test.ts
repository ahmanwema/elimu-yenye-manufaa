import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError } from "@/server/authz/policy";
import { DomainError } from "@/server/services/errors";
import {
  acceptInvitation,
  createInvitation,
  hashInvitationToken,
  invitedEmailForToken,
  previewInvitation,
  revokeInvitation,
} from "@/server/services/invitations";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
});

const NEW_USER = "11111111-0000-4000-8000-000000000001";
async function newAuthUser(id = NEW_USER) {
  await pg.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
}

const domainCode = (code: string) => expect.objectContaining({ name: "DomainError", code });

describe("creating invitations", () => {
  it("a Markaz Admin invites a teacher into their own Markaz; only the token hash is stored", async () => {
    const inv = await createInvitation(db, await actor(db, U.adminA), {
      tenantId: T.A,
      email: "  New.Teacher@Example.com ",
      target: "TEACHER",
    });
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inv.email).toBe("new.teacher@example.com");
    const row = (await pg.query<Record<string, unknown>>("SELECT * FROM invitations WHERE id = $1", [inv.id])).rows[0];
    expect(row.token_hash).toBe(hashInvitationToken(inv.token));
    expect(JSON.stringify(row)).not.toContain(inv.token);
  });

  it.each([
    ["into another Markaz", U.adminA, { tenantId: T.B, email: "x@example.com", target: "TEACHER" }],
    ["a Markaz Admin (needs Super Admin approval flow)", U.adminA, { tenantId: T.A, email: "x@example.com", target: "MARKAZ_ADMIN" }],
    ["as a teacher WITHOUT invitation.create", U.teacherA, { tenantId: T.A, email: "x@example.com", target: "STUDENT" }],
    ["as a student", U.studentX, { tenantId: T.A, email: "x@example.com", target: "STUDENT" }],
    ["as a parent", U.parentActive, { tenantId: T.A, email: "x@example.com", target: "STUDENT" }],
    ["after leaving the Markaz", U.studentLeft, { tenantId: T.A, email: "x@example.com", target: "STUDENT" }],
  ])("cannot invite %s — and the database is never touched", async (_label, who, input) => {
    const a = await actor(db, who);
    const spy = spyDb(db);
    await expect(createInvitation(spy.db, a, input)).rejects.toBeInstanceOf(AuthorizationError);
    expect(spy.calls).toEqual([]);
  });

  it("a Super Admin may invite a Markaz Admin (platform scope)", async () => {
    const inv = await createInvitation(db, await actor(db, U.superAdmin), {
      tenantId: T.B,
      email: "admin2@example.com",
      target: "MARKAZ_ADMIN",
    });
    expect(inv.target).toBe("MARKAZ_ADMIN");
  });

  it("rejects a second pending invitation for the same email, Markaz and role", async () => {
    const a = await actor(db, U.adminA);
    const input = { tenantId: T.A, email: "dup@example.com", target: "STUDENT" };
    await createInvitation(db, a, input);
    await expect(createInvitation(db, a, input)).rejects.toEqual(domainCode("conflict"));
  });

  it("rejects malformed input", async () => {
    await expect(
      createInvitation(db, await actor(db, U.adminA), { tenantId: T.A, email: "not-an-email", target: "TEACHER" }),
    ).rejects.toEqual(domainCode("invalid_input"));
  });
});

describe("accepting invitations", () => {
  async function invite(role: "TEACHER" | "STUDENT" = "TEACHER", email = "invitee@example.com", now?: Date) {
    return createInvitation(db, await actor(db, U.adminA), { tenantId: T.A, email, target: role }, now);
  }

  it("grants exactly the invited role in exactly the invited Markaz", async () => {
    const inv = await invite("TEACHER");
    await newAuthUser();
    const result = await acceptInvitation(db, { userId: NEW_USER, email: "Invitee@Example.com" }, { token: inv.token });
    expect(result).toEqual({ tenantId: T.A, target: "TEACHER" });
    const memberships = await db.membership.findMany({ where: { profileId: NEW_USER } });
    expect(memberships).toEqual([expect.objectContaining({ tenantId: T.A, role: "TEACHER", status: "ACTIVE" })]);
    const row = await db.invitation.findUnique({ where: { id: inv.id } });
    expect(row).toMatchObject({ status: "ACCEPTED", acceptedById: NEW_USER });
  });

  it("ignores any tenant, role or email the recipient adds to the request", async () => {
    const inv = await invite("STUDENT");
    await newAuthUser();
    await acceptInvitation(
      db,
      { userId: NEW_USER, email: "invitee@example.com" },
      { token: inv.token, tenantId: T.B, role: "MARKAZ_ADMIN", target: "MARKAZ_ADMIN", email: "attacker@example.com" },
    );
    const memberships = await db.membership.findMany({ where: { profileId: NEW_USER } });
    expect(memberships.map((m) => [m.tenantId, m.role])).toEqual([[T.A, "STUDENT"]]);
    expect(await db.studentAccount.findUnique({ where: { profileId: NEW_USER } })).not.toBeNull();
  });

  it("refuses a signed-in user whose email is not the invited email", async () => {
    const inv = await invite();
    await newAuthUser();
    await expect(
      acceptInvitation(db, { userId: NEW_USER, email: "someone.else@example.com" }, { token: inv.token }),
    ).rejects.toEqual(domainCode("email_mismatch"));
    expect(await db.membership.count({ where: { profileId: NEW_USER } })).toBe(0);
  });

  it("refuses an expired invitation", async () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const inv = await invite("TEACHER", "invitee@example.com", created);
    await newAuthUser();
    const later = new Date("2026-02-01T00:00:00Z");
    await expect(
      acceptInvitation(db, { userId: NEW_USER, email: "invitee@example.com" }, { token: inv.token }, later),
    ).rejects.toEqual(domainCode("expired"));
  });

  it.each([
    ["an unknown token", "A".repeat(43)],
    ["a malformed token", "short"],
    ["a non-string token", 12345],
  ])("refuses %s", async (_label, token) => {
    await newAuthUser();
    await expect(acceptInvitation(db, { userId: NEW_USER, email: "invitee@example.com" }, { token })).rejects.toEqual(
      domainCode("not_found"),
    );
  });

  it("refuses a revoked invitation, and a second use of an accepted one", async () => {
    const revoked = await invite("TEACHER", "r@example.com");
    await revokeInvitation(db, await actor(db, U.adminA), revoked.id);
    await newAuthUser();
    await expect(acceptInvitation(db, { userId: NEW_USER, email: "r@example.com" }, { token: revoked.token })).rejects.toEqual(
      domainCode("not_found"),
    );

    const once = await invite("TEACHER", "invitee@example.com");
    await acceptInvitation(db, { userId: NEW_USER, email: "invitee@example.com" }, { token: once.token });
    await expect(
      acceptInvitation(db, { userId: NEW_USER, email: "invitee@example.com" }, { token: once.token }),
    ).rejects.toEqual(domainCode("not_found"));
  });

  it("two simultaneous acceptances of one invitation: exactly one wins", async () => {
    const inv = await invite();
    await newAuthUser();
    const identity = { userId: NEW_USER, email: "invitee@example.com" };
    const results = await Promise.allSettled([
      acceptInvitation(db, identity, { token: inv.token }),
      acceptInvitation(db, identity, { token: inv.token }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.membership.count({ where: { profileId: NEW_USER } })).toBe(1);
  });

  it("a departed student re-invited to the same Markaz is re-activated, not duplicated", async () => {
    await pg.query("UPDATE auth.users SET email = 'left@example.com' WHERE id = $1", [U.studentLeft]);
    const inv = await invite("STUDENT", "left@example.com");
    await acceptInvitation(db, { userId: U.studentLeft, email: "left@example.com" }, { token: inv.token });
    const rows = await db.membership.findMany({ where: { profileId: U.studentLeft, tenantId: T.A } });
    expect(rows).toEqual([expect.objectContaining({ status: "ACTIVE", endedAt: null })]);
  });
});

describe("revoking and previewing", () => {
  it("another Markaz's admin cannot revoke an invitation", async () => {
    const inv = await createInvitation(db, await actor(db, U.adminA), { tenantId: T.A, email: "a@example.com", target: "TEACHER" });
    await expect(revokeInvitation(db, await actor(db, U.adminB), inv.id)).rejects.toBeInstanceOf(AuthorizationError);
    expect((await db.invitation.findUnique({ where: { id: inv.id } }))?.status).toBe("PENDING");
  });

  it("preview shows a masked email and never the raw address", async () => {
    const inv = await createInvitation(db, await actor(db, U.adminA), { tenantId: T.A, email: "fatma@example.com", target: "STUDENT" });
    expect(await previewInvitation(db, inv.token)).toEqual({
      state: "valid",
      tenantName: "Markaz A",
      target: "STUDENT",
      maskedEmail: "f***@example.com",
    });
    expect(await previewInvitation(db, "nonsense")).toEqual({ state: "invalid" });
    expect(await invitedEmailForToken(db, inv.token)).toBe("fatma@example.com");
    await expect(invitedEmailForToken(db, "B".repeat(43))).rejects.toBeInstanceOf(DomainError);
  });
});
