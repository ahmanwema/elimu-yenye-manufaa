import { describe, expect, it } from "vitest";
import type { SessionLike } from "@/lib/student-dashboard";
import { sessionTone, upcomingSessions } from "@/lib/teacher-dashboard";

const s = (id: string, status: SessionLike["status"], iso: string): SessionLike => ({ id, status, scheduledStartAt: new Date(iso) });
const NOW = new Date("2026-11-26T12:00:00Z");

describe("upcomingSessions", () => {
  const list = [
    s("in3days", "SCHEDULED", "2026-11-29T08:00:00Z"),
    s("live-old", "LIVE", "2026-11-20T08:00:00Z"),
    s("in1h", "SCHEDULED", "2026-11-26T13:00:00Z"),
    s("in8days", "SCHEDULED", "2026-12-04T13:00:00Z"),
    s("yesterday", "SCHEDULED", "2026-11-25T13:00:00Z"),
    s("ended", "ENDED", "2026-11-26T13:00:00Z"),
    s("cancelled", "CANCELLED", "2026-11-27T13:00:00Z"),
  ];

  it("live first, then scheduled within the window by start time", () => {
    expect(upcomingSessions(list, NOW).map((x) => x.id)).toEqual(["live-old", "in1h", "in3days"]);
  });

  it("the window is adjustable", () => {
    expect(upcomingSessions(list, NOW, 30).map((x) => x.id)).toContain("in8days");
    expect(upcomingSessions(list, NOW, 0).map((x) => x.id)).toEqual(["live-old"]);
  });
});

describe("sessionTone", () => {
  it("maps every status", () => {
    expect(sessionTone("LIVE")).toBe("danger");
    expect(sessionTone("SCHEDULED")).toBe("info");
    expect(sessionTone("CANCELLED")).toBe("warning");
    expect(sessionTone("ENDED")).toBe("muted");
  });
});
