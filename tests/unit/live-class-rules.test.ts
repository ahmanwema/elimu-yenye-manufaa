import { describe, expect, it } from "vitest";
import { addLocalDays, isValidTimeZone, localDateOf, localWeekday, zonedParts, zonedWallTimeToUtc } from "@/lib/timezone";
import {
  canAdjustAttendance,
  canAssignSubstitute,
  canAuthorWhiteboard,
  canCancelSession,
  canControlMic,
  canControlWhiteboard,
  canCorrectRecordingParticipants,
  canCreateClass,
  canCreateSession,
  canExtendGrace,
  canManageClass,
  canManageEnrollment,
  canOverrideCapacity,
  canReadClass,
  canReadSessionAttendance,
  canReadSessionChat,
  canScreenShare,
  canStartOrEndSession,
  canStartSessionRecording,
  canSubmitPayment,
  canVerifyPayment,
  liveParticipantRole,
  type SessionContext,
} from "@/server/authz/live-class";
import type { Actor } from "@/server/authz/policy";
import { deviceCapabilities } from "@/server/services/live-sessions";
import {
  capacityWithinCeiling,
  computeAttendance,
  DEFAULT_AD_HOC_DURATION_MINUTES,
  effectiveCapacity,
  effectiveEnrollmentState,
  GRACE_PERIOD_DAYS,
  graceDeadline,
  safetyCloseAt,
  SEAT_HOLDING_STATES,
  startAllowedFrom,
  unionDurationMs,
  waitingRoomOpensAt,
} from "@/server/services/live-rules";
import { actorFor } from "../support/actors";
import { T, U } from "../support/fixture";

const DAY = 86_400_000;
const MIN = 60_000;
const t0 = new Date("2026-11-02T06:00:00Z");
const plus = (m: number) => new Date(t0.getTime() + m * MIN);

describe("Markaz time zone (A112): UTC storage, Markaz-local interpretation", () => {
  it("validates IANA zones", () => {
    expect(isValidTimeZone("Africa/Nairobi")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it("09:00 in Nairobi is 06:00 UTC; the same wall time differs by zone (no EAT hard-coding)", () => {
    expect(zonedWallTimeToUtc("2026-11-02", 9 * 60, "Africa/Nairobi").toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-11-02", 9 * 60, "UTC").toISOString()).toBe("2026-11-02T09:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-11-02", 9 * 60, "Asia/Riyadh").toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("handles daylight-saving zones on both sides of a change", () => {
    // Europe/London: GMT in January, BST (UTC+1) in July.
    expect(zonedWallTimeToUtc("2026-01-15", 9 * 60, "Europe/London").toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-07-15", 9 * 60, "Europe/London").toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("local date / weekday arithmetic", () => {
    expect(localWeekday("2026-11-02")).toBe(1); // Monday
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    // 22:30 UTC on Nov 2 is already Nov 3 in Nairobi.
    expect(localDateOf(new Date("2026-11-02T22:30:00Z"), "Africa/Nairobi")).toBe("2026-11-03");
    expect(zonedParts(new Date("2026-11-02T06:00:00Z"), "Africa/Nairobi").hour).toBe(9);
  });
});

describe("session windows (A112–A114)", () => {
  it("students wait and authorized staff start from 15 minutes early", () => {
    expect(waitingRoomOpensAt(t0).getTime()).toBe(t0.getTime() - 15 * MIN);
    expect(startAllowedFrom(t0).getTime()).toBe(t0.getTime() - 15 * MIN);
  });
  it("safety close = scheduled end + 30 minutes", () => {
    expect(safetyCloseAt(plus(60)).getTime()).toBe(plus(90).getTime());
  });
  it("ad hoc default is 60 minutes (a default only)", () => {
    expect(DEFAULT_AD_HOC_DURATION_MINUTES).toBe(60);
  });
});

describe("enrollment lifecycle (A108)", () => {
  const accessUntil = new Date("2026-11-01T00:00:00Z");
  it("default grace is 7 days", () => {
    expect(GRACE_PERIOD_DAYS).toBe(7);
    expect(graceDeadline(accessUntil, null).getTime()).toBe(accessUntil.getTime() + 7 * DAY);
  });
  it("ACTIVE → GRACE when access ends → SUSPENDED after grace", () => {
    const e = { status: "ACTIVE" as const, accessUntil, graceUntil: null };
    expect(effectiveEnrollmentState(e, new Date(accessUntil.getTime() - 1))).toBe("ACTIVE");
    expect(effectiveEnrollmentState(e, new Date(accessUntil.getTime() + DAY))).toBe("GRACE");
    expect(effectiveEnrollmentState(e, new Date(accessUntil.getTime() + 7 * DAY + 1))).toBe("SUSPENDED");
  });
  it("an extended grace date wins; no access period = no expiry", () => {
    const extended = new Date(accessUntil.getTime() + 20 * DAY);
    expect(effectiveEnrollmentState({ status: "GRACE", accessUntil, graceUntil: extended }, new Date(accessUntil.getTime() + 10 * DAY))).toBe("GRACE");
    expect(effectiveEnrollmentState({ status: "ACTIVE", accessUntil: null, graceUntil: null }, new Date("2099-01-01"))).toBe("ACTIVE");
  });
  it("A133: only ACTIVE and GRACE occupy an active seat (SUSPENDED / PENDING_PAYMENT / WAITLISTED / ENDED do not)", () => {
    expect([...SEAT_HOLDING_STATES].sort()).toEqual(["ACTIVE", "GRACE"]);
  });
  it("terminal / waiting states are never upgraded by time", () => {
    for (const status of ["WAITLISTED", "SUSPENDED", "ENDED", "PENDING_PAYMENT"] as const) {
      expect(effectiveEnrollmentState({ status, accessUntil: null, graceUntil: null }, t0)).toBe(status);
    }
  });
});

describe("capacity (A109) — configurable only, no numbers in code", () => {
  it("class value must be at or below the plan ceiling when one exists", () => {
    expect(capacityWithinCeiling(null, 10)).toBe(true);
    expect(capacityWithinCeiling(10, 10)).toBe(true);
    expect(capacityWithinCeiling(11, 10)).toBe(false);
    expect(capacityWithinCeiling(500, null)).toBe(true);
    expect(capacityWithinCeiling(0, null)).toBe(false);
  });
  it("effective capacity: class value, else ceiling, else unlimited", () => {
    expect(effectiveCapacity(5, 10)).toBe(5);
    expect(effectiveCapacity(null, 10)).toBe(10);
    expect(effectiveCapacity(null, null)).toBeNull();
  });
});

describe("attendance computation (A122)", () => {
  const base = { actualStartAt: t0, actualEndAt: plus(60), scheduledStartAt: t0 };
  it("union of intervals: reconnect overlap and a second device never double-count", () => {
    expect(unionDurationMs([{ start: t0, end: plus(30) }, { start: plus(10), end: plus(40) }], t0, plus(60))).toBe(40 * MIN);
    expect(unionDurationMs([{ start: t0, end: plus(60) }, { start: t0, end: plus(60) }], t0, plus(60))).toBe(60 * MIN);
    expect(unionDurationMs([{ start: plus(-10), end: null }], t0, plus(60))).toBe(60 * MIN); // clipped to the session
  });
  // A132: attendance and punctuality are independent — PRESENT never overwrites LATE.
  const att = (start: number, end: number) => {
    const r = computeAttendance({ ...base, intervals: [{ start: plus(start), end: plus(end) }] });
    return [r.status, r.punctuality];
  };
  it(">= 50% + on time = PRESENT + ON_TIME", () => {
    expect(att(0, 30)).toEqual(["PRESENT", "ON_TIME"]);
    expect(att(15, 60)).toEqual(["PRESENT", "ON_TIME"]); // exactly at the threshold is on time
  });
  it(">= 50% + late = PRESENT + LATE (PRESENT does not overwrite LATE)", () => {
    expect(att(16, 60)).toEqual(["PRESENT", "LATE"]);
    expect(att(20, 60)).toEqual(["PRESENT", "LATE"]);
  });
  it("< 50% + on time = ABSENT + ON_TIME", () => {
    expect(att(0, 10)).toEqual(["ABSENT", "ON_TIME"]);
    expect(att(15, 29)).toEqual(["ABSENT", "ON_TIME"]);
  });
  it("< 50% + late = ABSENT + LATE", () => {
    expect(att(40, 60)).toEqual(["ABSENT", "LATE"]);
    expect(att(16, 30)).toEqual(["ABSENT", "LATE"]);
  });
  it("never arrived → ABSENT with no punctuality", () => {
    expect(computeAttendance({ ...base, intervals: [] })).toMatchObject({ status: "ABSENT", punctuality: null, presentSeconds: 0, firstArrivalAt: null });
  });
  it("reports seconds and the first arrival", () => {
    const r = computeAttendance({ ...base, intervals: [{ start: plus(5), end: plus(35) }] });
    expect(r).toMatchObject({ presentSeconds: 1800, sessionSeconds: 3600 });
    expect(r.firstArrivalAt?.getTime()).toBe(plus(5).getTime());
  });
});

describe("device capabilities (A117–A121) — permission state, not transport", () => {
  const student = { sessionLive: true, open: true, role: "STUDENT" as const, teaching: false, removed: false, admission: "ADMITTED" as const, micGranted: true, whiteboardGranted: true };
  it("a granted student publishes and writes only from the PRIMARY device", () => {
    expect(deviceCapabilities({ ...student, mode: "PRIMARY" })).toMatchObject({ publishMic: true, writeWhiteboard: true, screenShare: false });
    expect(deviceCapabilities({ ...student, mode: "VIEW_ONLY" })).toMatchObject({ publishMic: false, writeWhiteboard: false, viewOnly: true });
  });
  it("no grant, waiting for a slot, removed or closed → nothing", () => {
    expect(deviceCapabilities({ ...student, mode: "PRIMARY", micGranted: false, whiteboardGranted: false })).toMatchObject({ publishMic: false, writeWhiteboard: false });
    expect(deviceCapabilities({ ...student, mode: "PRIMARY", admission: "WAITING_FOR_SLOT" })).toMatchObject({ publishMic: false, admitted: false });
    expect(deviceCapabilities({ ...student, mode: "PRIMARY", removed: true }).publishMic).toBe(false);
    expect(deviceCapabilities({ ...student, mode: "PRIMARY", open: false }).publishMic).toBe(false);
    expect(deviceCapabilities({ ...student, mode: "PRIMARY", sessionLive: false }).publishMic).toBe(false);
  });
  it("teaching roles speak, write and screen share; a Markaz Admin by role does none of these", () => {
    const base = { sessionLive: true, open: true, mode: "PRIMARY" as const, removed: false, admission: null, micGranted: false, whiteboardGranted: false };
    expect(deviceCapabilities({ ...base, role: "CO_TEACHER", teaching: true })).toMatchObject({ publishMic: true, writeWhiteboard: true, screenShare: true });
    expect(deviceCapabilities({ ...base, role: "MARKAZ_ADMIN", teaching: false })).toMatchObject({ publishMic: false, writeWhiteboard: false, screenShare: false });
    expect(deviceCapabilities({ ...base, role: "CO_TEACHER", teaching: true, mode: "VIEW_ONLY" }).screenShare).toBe(false);
  });
});

describe("Live Class role/action matrix (pure rules)", () => {
  const SUB = "00000000-0000-4000-8000-00000000aaaa";
  const sub: Actor = { profileId: SUB, isPlatformAdmin: false, memberships: [{ tenantId: T.A, role: "TEACHER", status: "ACTIVE" }], parentLinks: [], permissionGrants: [] };
  const ctx: SessionContext = {
    tenantId: T.A,
    teachers: [
      { teacherProfileId: U.teacherA, role: "PRIMARY" },
      { teacherProfileId: U.teacherAB, role: "CO_TEACHER" },
    ],
    substituteProfileId: SUB,
  };
  const who = {
    primary: actorFor(U.teacherA),
    co: actorFor(U.teacherAB),
    sub,
    admin: actorFor(U.adminA),
    student: actorFor(U.studentX),
    parent: actorFor(U.parentActive),
    otherAdmin: actorFor(U.adminB),
    superAdmin: actorFor(U.superAdmin),
  };
  const row = (fn: (a: Actor) => boolean) => Object.fromEntries(Object.entries(who).map(([k, a]) => [k, fn(a)]));
  const only = (...keys: string[]) => Object.fromEntries(Object.keys(who).map((k) => [k, keys.includes(k)]));

  it.each([
    ["class configuration / capacity / teacher assignment", (a: Actor) => canManageClass(a, ctx), only("admin")],
    ["capacity override", (a: Actor) => canOverrideCapacity(a, ctx), only("admin")],
    ["enrollment", (a: Actor) => canManageEnrollment(a, ctx), only("primary", "co", "admin")],
    ["grace extension", (a: Actor) => canExtendGrace(a, ctx), only("primary", "co", "admin")],
    ["payment submission", (a: Actor) => canSubmitPayment(a, ctx), only("primary", "co", "admin")],
    ["payment verification", (a: Actor) => canVerifyPayment(a, ctx.tenantId), only("admin")],
    ["session create", (a: Actor) => canCreateSession(a, ctx), only("primary", "co", "admin")],
    ["session start / end", (a: Actor) => canStartOrEndSession(a, ctx), only("primary", "co", "sub", "admin")],
    ["session cancel", (a: Actor) => canCancelSession(a, ctx), only("primary", "admin")],
    ["substitute assignment", (a: Actor) => canAssignSubstitute(a, ctx), only("primary", "admin")],
    ["mic control", (a: Actor) => canControlMic(a, ctx), only("primary", "co", "sub", "admin")],
    ["whiteboard grant", (a: Actor) => canControlWhiteboard(a, ctx), only("primary", "co", "sub")],
    ["whiteboard authoring", (a: Actor) => canAuthorWhiteboard(a, ctx), only("primary", "co", "sub")],
    ["screen share", (a: Actor) => canScreenShare(a, ctx), only("primary", "co", "sub")],
    ["attendance read", (a: Actor) => canReadSessionAttendance(a, ctx), only("primary", "co", "sub", "admin")],
    ["attendance adjust", (a: Actor) => canAdjustAttendance(a, ctx), only("primary", "co", "admin")],
    ["recording participant correction", (a: Actor) => canCorrectRecordingParticipants(a, ctx), only("primary", "co", "admin")],
    ["session recording start (teacher author)", (a: Actor) => canStartSessionRecording(a, ctx), only("primary", "co", "sub")],
    ["chat read (student with ACTIVE access)", (a: Actor) => canReadSessionChat(a, ctx, a === who.student ? "ACTIVE" : null), only("primary", "co", "sub", "admin", "student")],
  ])("%s", (_name, fn, expected) => {
    expect(row(fn)).toEqual(expected);
  });

  it("A136 finance authority: payment.verify grant (staff only) or the Markaz Admin role; never a teacher by default", () => {
    const withGrant = (a: Actor, tenantId: string): Actor => ({ ...a, permissionGrants: [...a.permissionGrants, { tenantId, permission: "payment.verify" }] });
    expect(canVerifyPayment(who.primary, T.A)).toBe(false); // teacher by default
    expect(canVerifyPayment(withGrant(who.primary, T.A), T.A)).toBe(true); // finance officer / accountant
    expect(canVerifyPayment(withGrant(who.primary, T.A), T.B)).toBe(false); // tenant-scoped
    expect(canVerifyPayment(withGrant(who.student, T.A), T.A)).toBe(false); // ineligible role: grant is useless
    expect(canVerifyPayment(withGrant(who.superAdmin, T.A), T.A)).toBe(false); // no platform bypass
    const departed: Actor = { ...withGrant(who.primary, T.A), memberships: who.primary.memberships.map((m) => ({ ...m, status: "ENDED" as const })) };
    expect(canVerifyPayment(departed, T.A)).toBe(false);
    expect(canSubmitPayment(withGrant(who.student, T.A), ctx)).toBe(false);
  });

  it("class creation is a Markaz Admin action in their own Markaz only", () => {
    expect(canCreateClass(who.admin, T.A)).toBe(true);
    expect(canCreateClass(who.admin, T.B)).toBe(false);
    expect(canCreateClass(who.primary, T.A)).toBe(false);
    expect(canCreateClass(who.superAdmin, T.A)).toBe(false);
  });

  it("a student's access state gates chat and participation", () => {
    for (const access of ["WAITLISTED", "SUSPENDED", "ENDED", null] as const) {
      expect(canReadSessionChat(who.student, ctx, access)).toBe(false);
      expect(liveParticipantRole(who.student, ctx, access)).toBeNull();
    }
    expect(liveParticipantRole(who.student, ctx, "GRACE")).toBe("STUDENT");
    expect(canReadClass(who.student, ctx, "SUSPENDED")).toBe(true); // sees own state
    expect(canReadClass(who.parent, ctx, null)).toBe(false);
  });

  it("a departed teacher (ENDED membership) keeps nothing; the row is history only", () => {
    const departed: Actor = { ...who.primary, memberships: who.primary.memberships.map((m) => ({ ...m, status: "ENDED" as const })) };
    expect(canStartOrEndSession(departed, ctx)).toBe(false);
    expect(canManageEnrollment(departed, ctx)).toBe(false);
    expect(liveParticipantRole(departed, ctx, null)).toBeNull();
  });

  it("an admin who is also assigned as Co-Teacher gets both kinds of authority; role precedence is teaching first", () => {
    const both: Actor = { ...who.admin, memberships: [...who.admin.memberships, { tenantId: T.A, role: "TEACHER", status: "ACTIVE" }] };
    const withAdmin: SessionContext = { ...ctx, teachers: [...ctx.teachers, { teacherProfileId: U.adminA, role: "CO_TEACHER" }] };
    expect(canScreenShare(both, withAdmin)).toBe(true);
    expect(liveParticipantRole(both, withAdmin, null)).toBe("CO_TEACHER");
    // …but an assignment without an ACTIVE TEACHER membership grants no teaching authority.
    expect(canScreenShare(who.admin, withAdmin)).toBe(false);
  });

  it("a teacher assigned in Markaz A has no authority over a class context of Markaz B", () => {
    const ctxB: SessionContext = { tenantId: T.B, teachers: [{ teacherProfileId: U.teacherA, role: "PRIMARY" }], substituteProfileId: null };
    expect(canStartOrEndSession(who.primary, ctxB)).toBe(false);
    expect(canManageClass(who.admin, ctxB)).toBe(false);
  });
});
