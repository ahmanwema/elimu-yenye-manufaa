import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, parentMaySee } from "@/server/authz/policy";
import {
  acceptInvitation,
  createInvitation,
  INVITATION_TTL_DAYS,
  INVITATION_TTL_MS,
  invitedEmailForToken,
  listPendingInvitations,
  previewInvitation,
  revokeInvitation,
} from "@/server/services/invitations";
import { asUser } from "../db/harness";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";

let pg: PGlite;
let db: PrismaClient;
const NEW = "22222222-0000-4000-8000-000000000001";

async function grant(tenantId: string, profileId: string, permission: string) {
  await pg.query(
    `INSERT INTO tenant_permission_grants (tenant_id, profile_id, permission, granted_by_id) VALUES ($1, $2, $3::"TenantPermission", $4)`,
    [tenantId, profileId, permission, U.superAdmin],
  );
}

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await pg.query("INSERT INTO auth.users (id, email) VALUES ($1, 'new@example.com')", [NEW]);
});

const invite = async (who: string, input: Record<string, unknown>, now?: Date) =>
  createInvitation(db, await actor(db, who), { email: "new@example.com", tenantId: T.A, ...input }, now);
const accept = (token: string, now?: Date) => acceptInvitation(db, { userId: NEW, email: "new@example.com" }, { token }, now);

describe("teacher invitations (A59)", () => {
  it("a teacher WITH invitation.create invites a student or a parent in their own Markaz", async () => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    expect((await invite(U.teacherA, { target: "STUDENT" })).target).toBe("STUDENT");
    expect((await invite(U.teacherA, { target: "PARENT", email: "p@example.com" })).target).toBe("PARENT");
  });

  it.each([
    ["a Teacher", "TEACHER", T.A],
    ["a Markaz Admin", "MARKAZ_ADMIN", T.A],
    ["anyone into another Markaz", "STUDENT", T.B],
  ])("a teacher with invitation.create cannot invite %s", async (_l, target, tenantId) => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    const a = await actor(db, U.teacherA);
    const spy = spyDb(db);
    await expect(createInvitation(spy.db, a, { email: "x@example.com", tenantId, target })).rejects.toBeInstanceOf(AuthorizationError);
    expect(spy.calls).toEqual([]);
  });

  it("the grant is per Markaz: a grant in A gives nothing in B", async () => {
    await grant(T.A, U.teacherAB, "INVITATION_CREATE");
    await expect(invite(U.teacherAB, { tenantId: T.B, target: "STUDENT" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a teacher lists and revokes only the invitations they issued", async () => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    const mine = await invite(U.teacherA, { target: "STUDENT", email: "mine@example.com" });
    const admins = await invite(U.adminA, { target: "STUDENT", email: "admins@example.com" });
    const list = await listPendingInvitations(db, await actor(db, U.teacherA), T.A);
    expect(list.map((i) => i.id)).toEqual([mine.id]);
    await expect(revokeInvitation(db, await actor(db, U.teacherA), admins.id)).rejects.toBeInstanceOf(AuthorizationError);
    await revokeInvitation(db, await actor(db, U.teacherA), mine.id);
  });

  it("acceptance of a teacher-issued invitation still grants only the stored role and Markaz", async () => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    const inv = await invite(U.teacherA, { target: "STUDENT" });
    await acceptInvitation(db, { userId: NEW, email: "new@example.com" }, { token: inv.token, role: "MARKAZ_ADMIN", target: "TEACHER", tenantId: T.B });
    const rows = await db.membership.findMany({ where: { profileId: NEW } });
    expect(rows.map((m) => [m.tenantId, m.role])).toEqual([[T.A, "STUDENT"]]);
  });
});

describe("parent invitations (A61)", () => {
  it("a Markaz Admin invites a parent: acceptance onboards a Parent account and nothing else", async () => {
    const inv = await invite(U.adminA, { target: "PARENT" });
    expect(await accept(inv.token)).toEqual({ tenantId: T.A, target: "PARENT" });
    expect(await db.parentAccount.findUnique({ where: { profileId: NEW } })).not.toBeNull();
    expect(await db.membership.count({ where: { profileId: NEW } })).toBe(0);
    expect(await db.parentStudentLink.count({ where: { parentProfileId: NEW } })).toBe(0);
  });

  it("a proposed child becomes a PENDING request — never access", async () => {
    await grant(T.A, U.teacherA, "INVITATION_CREATE");
    await grant(T.A, U.teacherA, "PARENT_LINK_CREATE");
    const inv = await invite(U.teacherA, { target: "PARENT", proposedStudentId: U.studentX });
    await accept(inv.token);
    const link = await db.parentStudentLink.findFirstOrThrow({ where: { parentProfileId: NEW } });
    expect(link).toMatchObject({ status: "PENDING", tenantId: T.A, initiatedBy: "STAFF", requestedById: U.teacherA });
    expect(parentMaySee(await actor(db, NEW), U.studentX, "progress")).toBe(false);
    const visible = await asUser(pg, NEW, (tx) => tx.query("SELECT 1 FROM student_accounts"));
    expect(visible.rows).toEqual([]);
  });

  it("proposing a child needs parent_link.create as well as the right to invite", async () => {
    await expect(invite(U.adminA, { target: "PARENT", proposedStudentId: U.studentX })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a proposed child must be an ACTIVE student of that Markaz, and only for PARENT invitations", async () => {
    await grant(T.A, U.adminA, "INVITATION_CREATE");
    await grant(T.A, U.adminA, "PARENT_LINK_CREATE");
    await expect(invite(U.adminA, { target: "PARENT", proposedStudentId: U.studentY })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(invite(U.adminA, { target: "STUDENT", proposedStudentId: U.studentX })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("a teacher without invitation.create cannot invite a parent", async () => {
    await expect(invite(U.teacherA, { target: "PARENT" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("duplicate pending parent invitations are rejected (NULL role handled)", async () => {
    await invite(U.adminA, { target: "PARENT" });
    await expect(invite(U.adminA, { target: "PARENT" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("the database refuses a PARENT invitation with a role, or a MEMBERSHIP one without", async () => {
    const insert = (kind: string, role: string | null) =>
      pg.query(
        `INSERT INTO invitations (token_hash, email, tenant_id, kind, role, invited_by_id, expires_at)
         VALUES (md5(random()::text), 'z@example.com', $1, $2::"InvitationKind", $3::"TenantRole", $4, now() + interval '1 day')`,
        [T.A, kind, role, U.adminA],
      );
    await expect(insert("PARENT", "STUDENT")).rejects.toThrow(/invitations_kind_fields/);
    await expect(insert("MEMBERSHIP", null)).rejects.toThrow(/invitations_kind_fields/);
  });
});

describe("invitation lifetime = exactly 7 days (A60)", () => {
  const created = new Date("2026-10-01T08:00:00.000Z");

  it("is a fixed 7 days", async () => {
    expect(INVITATION_TTL_DAYS).toBe(7);
    const inv = await invite(U.adminA, { target: "STUDENT" }, created);
    expect(inv.expiresAt.getTime() - created.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("is valid 1 ms before the 7 days end, and expired at exactly 7 days", async () => {
    const inv = await invite(U.adminA, { target: "STUDENT" }, created);
    const lastValid = new Date(created.getTime() + INVITATION_TTL_MS - 1);
    const boundary = new Date(created.getTime() + INVITATION_TTL_MS);
    expect((await previewInvitation(db, inv.token, lastValid)).state).toBe("valid");
    expect((await previewInvitation(db, inv.token, boundary)).state).toBe("expired");
    await expect(invitedEmailForToken(db, inv.token, boundary)).rejects.toMatchObject({ code: "expired" });
    await expect(accept(inv.token, boundary)).rejects.toMatchObject({ code: "expired" });
    await accept(inv.token, lastValid);
  });

  it("stays single-use inside the window", async () => {
    const inv = await invite(U.adminA, { target: "STUDENT" }, created);
    const t = new Date(created.getTime() + 60_000);
    await accept(inv.token, t);
    await expect(accept(inv.token, t)).rejects.toMatchObject({ code: "not_found" });
  });
});
