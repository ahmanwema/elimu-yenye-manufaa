import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AuthorizationError, canManageJoinLinks } from "@/server/authz/policy";
import { DomainError } from "@/server/services/errors";
import { createJoinLink, listJoinLinks, previewJoinLink, redeemJoinLink, revokeJoinLink } from "@/server/services/join-links";
import { actor, createTestPrisma, spyDb } from "../db/prisma";
import { T, U } from "../support/fixture";
import { createClass } from "@/server/services/classes";
import { L, NOW, seedLive } from "../support/live";

// Shareable join links (owner decisions 2026-11-22). One link, many students, forwarded over
// WhatsApp. It creates accounts, so the tests below are mostly about its limits: who may issue
// one, how it refuses, and that concurrent redemptions cannot exceed its ceiling.

let pg: PGlite;
let db: PrismaClient;
const as = (id: string) => actor(db, id);
const DAY = 86_400_000;
const DETAILS = { displayName: "Amina Juma", phone: "+255700000001", gender: "FEMALE", dateOfBirth: "2008-05-04" };

/** A class of a given Markaz, optionally paid. The shared helper is Markaz A only. */
async function makeClass(opts: { tenantId: string; paymentRequired?: boolean }): Promise<string> {
  const isA = opts.tenantId === T.A;
  return createClass(
    db,
    await as(isA ? U.adminA : U.adminB),
    {
      tenantId: opts.tenantId,
      name: "Tajwid 1",
      primaryTeacherProfileId: isA ? U.teacherA : L.teacherB,
      enrollmentCapacity: null,
      liveCapacity: null,
      paymentRequired: opts.paymentRequired ?? false,
    },
    { now: NOW },
  );
}

/** A profile with an auth account but no membership — someone arriving from a shared link. */
async function newcomer(): Promise<string> {
  const id = randomUUID();
  await pg.query("INSERT INTO auth.users (id) VALUES ($1)", [id]);
  return id;
}

async function link(overrides: Record<string, unknown> = {}) {
  return createJoinLink(
    db,
    await as(U.adminA),
    { tenantId: T.A, label: "WhatsApp group", expiresInDays: 30, ...overrides },
    NOW,
  );
}

beforeEach(async () => {
  ({ pg, db } = await createTestPrisma());
  await seedLive(pg);
});

describe("createJoinLink", () => {
  it("returns the raw token once and stores only its hash", async () => {
    const created = await link();
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await db.joinLink.findUnique({ where: { id: created.id }, select: { tokenHash: true } });
    expect(row?.tokenHash).not.toContain(created.token);
  });

  it("records a JOIN_LINK_CREATED audit event", async () => {
    const created = await link();
    const events = await db.auditEvent.findMany({ where: { action: "JOIN_LINK_CREATED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: U.adminA, tenantId: T.A, targetType: "JOIN_LINK", targetId: created.id });
  });

  it.each([
    ["a Teacher", U.teacherAB],
    ["a Student", U.studentX],
    ["an admin of another Markaz", U.adminB],
  ])("denies %s, and never reaches the database", async (_label, profileId) => {
    const caller = await as(profileId);
    const spy = spyDb(db);
    await expect(
      createJoinLink(spy.db, caller, { tenantId: T.A, label: "Nope", expiresInDays: 30 }, NOW),
    ).rejects.toThrow(AuthorizationError);
    expect(spy.calls).toEqual([]);
  });

  it("a Teacher with invitation.create still cannot issue one (A59 covers named invitations only)", () => {
    const teacher = {
      profileId: U.teacherA,
      isPlatformAdmin: false,
      memberships: [{ tenantId: T.A, role: "TEACHER" as const, status: "ACTIVE" as const }],
      parentLinks: [],
      permissionGrants: [{ tenantId: T.A, permission: "invitation.create" as const }],
    };
    expect(canManageJoinLinks(teacher, T.A)).toBe(false);
  });

  it("refuses a class belonging to another Markaz", async () => {
    const classId = await makeClass({ tenantId: T.B });
    await expect(link({ classId })).rejects.toThrow(DomainError);
  });

  it.each([
    ["no label", { label: "  " }],
    ["a lifetime beyond 90 days", { expiresInDays: 365 }],
    ["a zero lifetime", { expiresInDays: 0 }],
    ["a zero use limit", { maxUses: 0 }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(link(overrides)).rejects.toThrow(DomainError);
  });
});

describe("previewJoinLink", () => {
  it("shows the Markaz name and nothing else", async () => {
    const created = await link();
    expect(await previewJoinLink(db, created.token, NOW)).toEqual({
      state: "valid",
      tenantName: "Markaz A",
      className: null,
    });
  });

  it("names the class when the link points at one", async () => {
    const classId = await makeClass({ tenantId: T.A });
    const created = await link({ classId });
    const preview = await previewJoinLink(db, created.token, NOW);
    expect(preview.state).toBe("valid");
    expect(preview.state === "valid" && preview.className).toBeTruthy();
  });

  it.each([
    ["an unknown token", async () => "A".repeat(43)],
    ["a malformed token", async () => "too-short"],
  ])("refuses %s", async (_label, make) => {
    expect(await previewJoinLink(db, await make(), NOW)).toEqual({ state: "invalid" });
  });

  it("refuses cancelled, expired and full links identically, so the state cannot be probed", async () => {
    const revoked = await link();
    await revokeJoinLink(db, await as(U.adminA), revoked.id, NOW);

    const expired = await link({ expiresInDays: 1 });
    const afterExpiry = new Date(NOW.getTime() + 2 * DAY);

    const full = await link({ maxUses: 1 });
    await redeemJoinLink(db, { token: full.token, profileId: await newcomer(), details: DETAILS }, NOW);

    expect(await previewJoinLink(db, revoked.token, NOW)).toEqual({ state: "invalid" });
    expect(await previewJoinLink(db, expired.token, afterExpiry)).toEqual({ state: "invalid" });
    expect(await previewJoinLink(db, full.token, NOW)).toEqual({ state: "invalid" });
  });
});

describe("redeemJoinLink", () => {
  it("creates the student account, the ACTIVE membership and the details typed in", async () => {
    const created = await link();
    const joiner = await newcomer();
    await redeemJoinLink(db, { token: created.token, profileId: joiner, details: DETAILS }, NOW);

    const profile = await db.profile.findUnique({ where: { id: joiner }, select: { displayName: true, phone: true } });
    expect(profile).toEqual({ displayName: "Amina Juma", phone: "+255700000001" });

    const account = await db.studentAccount.findUnique({ where: { profileId: joiner } });
    expect(account?.gender).toBe("FEMALE");
    expect(account?.dateOfBirthEnteredById).toBe(joiner);
    // A82: a self-entered date is never trusted until a Markaz Admin verifies it.
    expect(account?.dateOfBirthVerifiedAt).toBeNull();

    const membership = await db.membership.findFirst({ where: { tenantId: T.A, profileId: joiner, role: "STUDENT" } });
    expect(membership?.status).toBe("ACTIVE");
  });

  it("the student can then sign in normally — no second link is ever needed", async () => {
    const created = await link();
    const joiner = await newcomer();
    await redeemJoinLink(db, { token: created.token, profileId: joiner, details: DETAILS }, NOW);
    const loaded = await as(joiner);
    expect(loaded.memberships).toContainEqual({ tenantId: T.A, role: "STUDENT", status: "ACTIVE" });
  });

  it("enrols the student when the link names a paid class, awaiting payment", async () => {
    const classId = await makeClass({ tenantId: T.A, paymentRequired: true });
    const created = await link({ classId });
    const joiner = await newcomer();
    await redeemJoinLink(db, { token: created.token, profileId: joiner, details: DETAILS }, NOW);

    const enrollment = await db.classEnrollment.findFirst({ where: { classId, studentProfileId: joiner } });
    expect(enrollment?.status).toBe("PENDING_PAYMENT");
  });

  it("is idempotent for the same person and consumes only one use", async () => {
    const created = await link({ maxUses: 5 });
    const joiner = await newcomer();
    await redeemJoinLink(db, { token: created.token, profileId: joiner, details: DETAILS }, NOW);
    await redeemJoinLink(db, { token: created.token, profileId: joiner, details: DETAILS }, NOW);

    expect(await db.joinLinkUse.count({ where: { joinLinkId: created.id } })).toBe(1);
    const row = await db.joinLink.findUnique({ where: { id: created.id }, select: { useCount: true } });
    expect(row?.useCount).toBe(1);
  });

  it("never exceeds its ceiling, even when redemptions race", async () => {
    const created = await link({ maxUses: 3 });
    const joiners = await Promise.all([newcomer(), newcomer(), newcomer(), newcomer(), newcomer()]);
    const results = await Promise.allSettled(
      joiners.map((profileId) => redeemJoinLink(db, { token: created.token, profileId, details: DETAILS }, NOW)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const row = await db.joinLink.findUnique({ where: { id: created.id }, select: { useCount: true } });
    expect(row?.useCount).toBe(3);
    expect(await db.membership.count({ where: { tenantId: T.A, profileId: { in: joiners }, role: "STUDENT" } })).toBe(3);
  });

  it.each([
    ["a cancelled link", async () => {
      const l = await link();
      await revokeJoinLink(db, await as(U.adminA), l.id, NOW);
      return { token: l.token, now: NOW };
    }],
    ["an expired link", async () => {
      const l = await link({ expiresInDays: 1 });
      return { token: l.token, now: new Date(NOW.getTime() + 2 * DAY) };
    }],
  ])("refuses %s and creates nothing", async (_label, make) => {
    const { token, now } = await make();
    const joiner = await newcomer();
    await expect(redeemJoinLink(db, { token, profileId: joiner, details: DETAILS }, now)).rejects.toThrow(DomainError);
    expect(await db.membership.count({ where: { profileId: joiner } })).toBe(0);
  });

  it.each([
    ["a name that is too short", { displayName: "A" }],
    ["no phone number", { phone: "" }],
    ["an unknown gender", { gender: "OTHER" }],
    ["a date of birth in the future", { dateOfBirth: "2099-01-01" }],
  ])("rejects %s and creates nothing", async (_label, bad) => {
    const created = await link();
    const joiner = await newcomer();
    await expect(
      redeemJoinLink(db, { token: created.token, profileId: joiner, details: { ...DETAILS, ...bad } }, NOW),
    ).rejects.toThrow(DomainError);
    expect(await db.membership.count({ where: { profileId: joiner } })).toBe(0);
    const row = await db.joinLink.findUnique({ where: { id: created.id }, select: { useCount: true } });
    expect(row?.useCount).toBe(0);
  });

  it("a link for Markaz A never places a student in Markaz B", async () => {
    const created = await link();
    const joiner = await newcomer();
    await redeemJoinLink(db, { token: created.token, profileId: joiner, details: DETAILS }, NOW);
    expect(await db.membership.count({ where: { tenantId: T.B, profileId: joiner } })).toBe(0);
  });
});

describe("listJoinLinks and revokeJoinLink", () => {
  it("lists the Markaz's links without any token hash", async () => {
    await link();
    const rows = await listJoinLinks(db, await as(U.adminA), T.A);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("tokenHash");
  });

  it("denies a Teacher both listing and revoking", async () => {
    const created = await link();
    await expect(listJoinLinks(db, await as(U.teacherAB), T.A)).rejects.toThrow(AuthorizationError);
    await expect(revokeJoinLink(db, await as(U.teacherAB), created.id, NOW)).rejects.toThrow(AuthorizationError);
  });

  it("refuses to cancel a link twice", async () => {
    const created = await link();
    await revokeJoinLink(db, await as(U.adminA), created.id, NOW);
    await expect(revokeJoinLink(db, await as(U.adminA), created.id, NOW)).rejects.toThrow(DomainError);
  });
});
