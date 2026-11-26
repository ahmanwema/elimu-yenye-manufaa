import { describe, expect, it } from "vitest";
import { attendanceTone, dayKey, enrollmentTone, monthGrid, pickNextSession, type SessionLike } from "@/lib/student-dashboard";

const at = (iso: string) => new Date(iso);
const s = (id: string, status: SessionLike["status"], iso: string): SessionLike => ({ id, status, scheduledStartAt: at(iso) });
const NOW = at("2026-11-26T12:00:00Z");

describe("pickNextSession", () => {
  it("a live session wins over anything scheduled", () => {
    expect(pickNextSession([s("a", "SCHEDULED", "2026-11-26T13:00:00Z"), s("b", "LIVE", "2026-11-26T11:00:00Z")], NOW)?.id).toBe("b");
  });

  it("otherwise the earliest future scheduled session", () => {
    const list = [s("late", "SCHEDULED", "2026-11-29T08:00:00Z"), s("soon", "SCHEDULED", "2026-11-27T08:00:00Z"), s("past", "SCHEDULED", "2026-11-25T08:00:00Z")];
    expect(pickNextSession(list, NOW)?.id).toBe("soon");
  });

  it("ended, cancelled and past sessions are never next", () => {
    expect(pickNextSession([s("e", "ENDED", "2026-11-27T08:00:00Z"), s("c", "CANCELLED", "2026-11-27T08:00:00Z"), s("p", "SCHEDULED", "2026-11-20T08:00:00Z")], NOW)).toBeNull();
  });
});

describe("attendanceTone", () => {
  it("keeps attendance and punctuality apart but colours a late arrival as late", () => {
    expect(attendanceTone("PRESENT", "ON_TIME")).toBe("present");
    expect(attendanceTone("PRESENT", null)).toBe("present");
    expect(attendanceTone("PRESENT", "LATE")).toBe("late");
    expect(attendanceTone("LATE", null)).toBe("late");
    expect(attendanceTone("ABSENT", "LATE")).toBe("absent");
  });
});

describe("dayKey", () => {
  it("uses the Markaz time zone, UTC when none is set", () => {
    const d = at("2026-11-26T22:30:00Z");
    expect(dayKey(d, null)).toBe("2026-11-26");
    expect(dayKey(d, "Africa/Dar_es_Salaam")).toBe("2026-11-27");
  });
});

describe("monthGrid", () => {
  it("November 2026 starts on a Sunday and fills whole weeks", () => {
    const weeks = monthGrid(2026, 10, [], "2026-11-26");
    expect(weeks[0][0]?.day).toBe(1);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(weeks.flat().find((c) => c?.today)?.day).toBe(26);
  });

  it("pads the first week when the month starts mid-week", () => {
    const weeks = monthGrid(2026, 11, [], "x"); // December 2026 starts on a Tuesday
    expect(weeks[0].slice(0, 2)).toEqual([null, null]);
    expect(weeks[0][2]?.day).toBe(1);
  });

  it("the most serious tone of a day wins", () => {
    const weeks = monthGrid(2026, 10, [
      { key: "2026-11-03", tone: "present" },
      { key: "2026-11-03", tone: "absent" },
      { key: "2026-11-03", tone: "late" },
      { key: "2026-11-04", tone: "present" },
    ], "x");
    const cells = weeks.flat();
    expect(cells.find((c) => c?.day === 3)?.tone).toBe("absent");
    expect(cells.find((c) => c?.day === 4)?.tone).toBe("present");
    expect(cells.find((c) => c?.day === 5)?.tone).toBeNull();
  });
});

describe("enrollmentTone", () => {
  it("maps every enrollment state to a badge colour", () => {
    expect(enrollmentTone("ACTIVE")).toBe("success");
    expect(enrollmentTone("GRACE")).toBe("warning");
    expect(enrollmentTone("PENDING_PAYMENT")).toBe("accent");
    expect(enrollmentTone("WAITLISTED")).toBe("info");
    expect(enrollmentTone("SUSPENDED")).toBe("danger");
    expect(enrollmentTone("ENDED")).toBe("muted");
  });
});
