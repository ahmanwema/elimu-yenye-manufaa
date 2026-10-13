import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  localeDirection,
  localeFromPathname,
  localeRedirectTarget,
  LOCALES,
  resolveLocale,
  switchLocalePath,
} from "@/i18n/config";
import { DICTIONARIES, format } from "@/i18n/dictionaries";

describe("locale defaults and fallback", () => {
  it("Kiswahili is the default", () => {
    expect(DEFAULT_LOCALE).toBe("sw");
    expect(resolveLocale(undefined)).toBe("sw");
  });

  it.each(["fr", "", "EN", "sw-KE", "../en", 42, null])("invalid locale %j falls back to Kiswahili", (value) => {
    expect(resolveLocale(value)).toBe("sw");
  });

  it("English and Arabic are selectable", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("ar")).toBe("ar");
  });

  it("Arabic is RTL; Kiswahili and English are LTR", () => {
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("sw")).toBe("ltr");
    expect(localeDirection("en")).toBe("ltr");
  });
});

describe("locale routing (proxy) and persistence", () => {
  it("an unprefixed path goes to Kiswahili when nothing is remembered", () => {
    expect(localeRedirectTarget("/", "", undefined)).toBe("/sw");
    expect(localeRedirectTarget("/account", "?x=1", undefined)).toBe("/sw/account?x=1");
  });

  it("a remembered English choice persists across visits", () => {
    expect(localeRedirectTarget("/", "", "en")).toBe("/en");
  });

  it("a remembered Arabic choice persists across visits", () => {
    expect(localeRedirectTarget("/account", "", "ar")).toBe("/ar/account");
  });

  it("a tampered cookie falls back to Kiswahili", () => {
    expect(localeRedirectTarget("/", "", "javascript:alert(1)")).toBe("/sw");
  });

  it("an already-prefixed path is left alone", () => {
    for (const l of LOCALES) expect(localeRedirectTarget(`/${l}/sign-in`, "", "sw")).toBeNull();
  });

  it("switching language keeps the page", () => {
    expect(switchLocalePath("/en/account", "ar")).toBe("/ar/account");
    expect(switchLocalePath("/sw", "en")).toBe("/en");
    expect(localeFromPathname("/ar/markaz/x")).toBe("ar");
    expect(localeFromPathname("/arabic")).toBeNull();
  });
});

describe("dictionaries", () => {
  const flatten = (obj: object, prefix = ""): [string, string][] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : flatten(v as object, `${prefix}${k}.`),
    );
  const keysOf = (l: (typeof LOCALES)[number]) => flatten(DICTIONARIES[l]).map(([k]) => k).sort();

  it("every locale has exactly the same keys (also enforced by the type checker)", () => {
    expect(keysOf("sw")).toEqual(keysOf("en"));
    expect(keysOf("ar")).toEqual(keysOf("en"));
  });

  it("no string is empty, and placeholders match across languages", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    const en = Object.fromEntries(flatten(DICTIONARIES.en));
    for (const l of LOCALES) {
      for (const [key, value] of flatten(DICTIONARIES[l])) {
        expect(value.trim(), `${l}.${key}`).not.toBe("");
        expect(placeholders(value), `${l}.${key}`).toBe(placeholders(en[key]));
      }
    }
  });

  it("Kiswahili and Arabic are real translations, not copies of English", () => {
    const en = Object.fromEntries(flatten(DICTIONARIES.en));
    const same = (l: "sw" | "ar") => flatten(DICTIONARIES[l]).filter(([k, v]) => v === en[k]).map(([k]) => k);
    // Only proper names / language names may be identical.
    const allowed = ["meta.title", "home.title", "languages.sw", "languages.en", "languages.ar", "markaz.title"];
    expect(same("sw").filter((k) => !allowed.includes(k))).toEqual([]);
    expect(same("ar").filter((k) => !allowed.includes(k))).toEqual([]);
  });

  it("format fills placeholders and leaves unknown ones visible", () => {
    expect(format("Hi {name} {x}", { name: "Ali" })).toBe("Hi Ali {x}");
  });
});
