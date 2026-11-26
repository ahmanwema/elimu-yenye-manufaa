import { describe, expect, it } from "vitest";
import { countOpenJoinLinks, isOpenJoinLink } from "@/lib/admin-dashboard";

const NOW = new Date("2026-11-26T12:00:00Z");
const link = (over: Partial<Parameters<typeof isOpenJoinLink>[0]> = {}) => ({
  status: "ACTIVE" as const,
  expiresAt: new Date("2026-12-01T00:00:00Z"),
  maxUses: 10 as number | null,
  useCount: 3,
  ...over,
});

describe("open join links", () => {
  it("active, unexpired and with uses left is open", () => {
    expect(isOpenJoinLink(link(), NOW)).toBe(true);
    expect(isOpenJoinLink(link({ maxUses: null, useCount: 999 }), NOW)).toBe(true);
  });

  it("revoked, expired or used up is not", () => {
    expect(isOpenJoinLink(link({ status: "REVOKED" }), NOW)).toBe(false);
    expect(isOpenJoinLink(link({ expiresAt: NOW }), NOW)).toBe(false);
    expect(isOpenJoinLink(link({ useCount: 10 }), NOW)).toBe(false);
  });

  it("counts only open links", () => {
    expect(countOpenJoinLinks([link(), link({ status: "REVOKED" }), link({ useCount: 10 })], NOW)).toBe(1);
  });
});
