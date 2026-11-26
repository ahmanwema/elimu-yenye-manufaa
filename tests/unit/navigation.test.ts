import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "@/i18n/dictionaries";
import { activeNavKey, bottomNav, BOTTOM_NAV_MAX, NAV_KEYS, navForPath, tenantFromPath, type NavItem } from "@/lib/navigation";
import type { Actor, ActorMembership } from "@/server/authz/policy";
import { buildNav, buildNavByTenant } from "@/server/navigation";

// A153: navigation shows what a person's ACTIVE roles lead to. It is never authorization —
// these tests pin what is shown, the pages' own checks are tested elsewhere.

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

function actor(memberships: ActorMembership[] = [], isPlatformAdmin = false): Actor {
  return { profileId: "33333333-3333-4333-8333-333333333333", isPlatformAdmin, memberships, parentLinks: [], permissionGrants: [] };
}
const keys = (items: NavItem[]) => items.map((i) => i.key);

describe("buildNav — what each role sees", () => {
  it("a signed-out visitor gets no navigation", () => {
    expect(buildNav(null, "sw")).toEqual([]);
  });

  it("a student sees home, their classes and account", () => {
    const nav = buildNav(actor([{ tenantId: T1, role: "STUDENT", status: "ACTIVE" }]), "sw");
    expect(keys(nav)).toEqual(["home", "classes", "account"]);
    expect(nav[1].href).toBe(`/sw/markaz/${T1}/classes`);
  });

  it("a parent (no Markaz role) sees home and account only", () => {
    expect(keys(buildNav(actor(), "sw"))).toEqual(["home", "account"]);
  });

  it("a teacher who is also a student elsewhere gets one classes link, for the teaching Markaz", () => {
    const nav = buildNav(
      actor([
        { tenantId: T2, role: "STUDENT", status: "ACTIVE" },
        { tenantId: T1, role: "TEACHER", status: "ACTIVE" },
      ]),
      "sw",
    );
    expect(nav.filter((i) => i.key === "classes").map((i) => i.href)).toEqual([`/sw/markaz/${T1}/classes`]);
  });

  it("a teacher sees their Markaz and classes, but not payments", () => {
    const nav = buildNav(actor([{ tenantId: T1, role: "TEACHER", status: "ACTIVE" }]), "en");
    expect(keys(nav)).toEqual(["home", "markaz", "classes", "account"]);
    expect(nav.find((i) => i.key === "classes")?.href).toBe(`/en/markaz/${T1}/classes`);
  });

  it("a Markaz Admin also sees payments", () => {
    const nav = buildNav(actor([{ tenantId: T1, role: "MARKAZ_ADMIN", status: "ACTIVE" }]), "sw");
    expect(keys(nav)).toEqual(["home", "markaz", "classes", "payments", "account"]);
    expect(nav.find((i) => i.key === "payments")?.href).toBe(`/sw/markaz/${T1}/finance`);
  });

  it("a Finance Officer sees payments but no Markaz or classes", () => {
    const nav = buildNav(actor([{ tenantId: T2, role: "FINANCE_OFFICER", status: "ACTIVE" }]), "ar");
    expect(keys(nav)).toEqual(["home", "payments", "account"]);
    expect(nav[1].href).toBe(`/ar/markaz/${T2}/finance`);
  });

  it("a Super Admin sees the platform page", () => {
    expect(keys(buildNav(actor([], true), "sw"))).toEqual(["home", "platform", "account"]);
  });

  it("an ENDED membership shows nothing for that Markaz", () => {
    const nav = buildNav(
      actor([
        { tenantId: T1, role: "MARKAZ_ADMIN", status: "ENDED" },
        { tenantId: T1, role: "FINANCE_OFFICER", status: "ENDED" },
      ]),
      "sw",
    );
    expect(keys(nav)).toEqual(["home", "account"]);
  });

  it("teaching in one Markaz and verifying payments in another link to the right Markaz each", () => {
    const nav = buildNav(
      actor([
        { tenantId: T1, role: "TEACHER", status: "ACTIVE" },
        { tenantId: T2, role: "FINANCE_OFFICER", status: "ACTIVE" },
      ]),
      "sw",
    );
    expect(nav.find((i) => i.key === "classes")?.href).toBe(`/sw/markaz/${T1}/classes`);
    expect(nav.find((i) => i.key === "payments")?.href).toBe(`/sw/markaz/${T2}/finance`);
  });
});

describe("bottomNav — the phone bar", () => {
  it("keeps everything when it fits", () => {
    const nav = buildNav(actor([{ tenantId: T1, role: "MARKAZ_ADMIN", status: "ACTIVE" }]), "sw");
    expect(bottomNav(nav)).toEqual(nav);
  });

  it("never exceeds the limit, drops home first and keeps account last", () => {
    const nav = buildNav(actor([{ tenantId: T1, role: "MARKAZ_ADMIN", status: "ACTIVE" }], true), "sw");
    expect(nav).toHaveLength(6);
    const bar = bottomNav(nav);
    expect(bar.length).toBeLessThanOrEqual(BOTTOM_NAV_MAX);
    expect(keys(bar)).not.toContain("home");
    expect(bar.at(-1)?.key).toBe("account");
  });

  it("cuts from the middle when even without home it is too long", () => {
    const many: NavItem[] = ["home", "markaz", "classes", "payments", "platform", "markaz", "account"].map((key, i) => ({
      key: key as NavItem["key"],
      href: `/sw/x${i}`,
    }));
    const bar = bottomNav(many);
    expect(bar).toHaveLength(BOTTOM_NAV_MAX);
    expect(bar.at(-1)?.key).toBe("account");
  });
});

describe("activeNavKey", () => {
  const nav = buildNav(actor([{ tenantId: T1, role: "MARKAZ_ADMIN", status: "ACTIVE" }]), "sw");

  it("home is active only on its exact path", () => {
    expect(activeNavKey(nav, "/sw")).toBe("home");
    expect(activeNavKey(nav, "/sw/live/abc")).toBeNull();
  });

  it("the longest matching link wins", () => {
    expect(activeNavKey(nav, `/sw/markaz/${T1}`)).toBe("markaz");
    expect(activeNavKey(nav, `/sw/markaz/${T1}/classes/abc`)).toBe("classes");
    expect(activeNavKey(nav, `/sw/markaz/${T1}/finance`)).toBe("payments");
  });

  it("a prefix that is not on a path boundary does not match", () => {
    expect(activeNavKey(nav, "/sw/accountx")).toBeNull();
  });
});

describe("navigation labels", () => {
  it.each(["sw", "en", "ar"] as const)("%s has a short label for every item", (locale) => {
    for (const key of NAV_KEYS) expect(DICTIONARIES[locale].nav.items[key].length).toBeGreaterThan(0);
    expect(DICTIONARIES[locale].nav.main.length).toBeGreaterThan(0);
  });
});

describe("per-Markaz navigation (F5 switcher)", () => {
  const two = actor([
    { tenantId: T1, role: "TEACHER", status: "ACTIVE" },
    { tenantId: T2, role: "MARKAZ_ADMIN", status: "ACTIVE" },
  ]);

  it("the Markaz in the URL wins when the person qualifies there", () => {
    expect(buildNav(two, "sw").find((i) => i.key === "markaz")?.href).toBe(`/sw/markaz/${T1}`);
    expect(buildNav(two, "sw", T2).find((i) => i.key === "markaz")?.href).toBe(`/sw/markaz/${T2}`);
    expect(buildNav(two, "sw", T2).find((i) => i.key === "payments")?.href).toBe(`/sw/markaz/${T2}/finance`);
  });

  it("a preferred Markaz the person does not belong to is ignored", () => {
    const stranger = "44444444-4444-4444-8444-444444444444";
    expect(buildNav(two, "sw", stranger)).toEqual(buildNav(two, "sw"));
  });

  it("one set per ACTIVE Markaz", () => {
    expect(Object.keys(buildNavByTenant(two, "sw")).sort()).toEqual([T1, T2].sort());
    expect(buildNavByTenant(null, "sw")).toEqual({});
  });

  it("navForPath picks the set for the Markaz in the path, else the default", () => {
    const byTenant = buildNavByTenant(two, "sw");
    const fallback = buildNav(two, "sw");
    expect(navForPath(`/sw/markaz/${T2}/classes`, fallback, byTenant)).toBe(byTenant[T2]);
    expect(navForPath("/sw/account", fallback, byTenant)).toBe(fallback);
    expect(navForPath("/sw/markaz/__proto__", fallback, byTenant)).toBe(fallback);
    expect(navForPath("/sw/markaz/%E0%A4%A", fallback, byTenant)).toBe(fallback);
  });

  it("tenantFromPath reads only the Markaz segment", () => {
    expect(tenantFromPath(`/ar/markaz/${T1}/finance`)).toBe(T1);
    expect(tenantFromPath("/ar/platform")).toBeNull();
  });
});
