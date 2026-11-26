import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme";

// A156: the boot script runs before first paint. It may only apply "light" or "dark", and must
// never throw (private mode, blocked storage).

function run(stored: string | null, storageThrows = false) {
  const documentElement = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("blocked");
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  new Function("localStorage", "document", THEME_BOOT_SCRIPT)(localStorage, { documentElement });
  return documentElement.dataset.theme;
}

describe("theme boot script", () => {
  it("applies a saved light or dark choice", () => {
    expect(run("light")).toBe("light");
    expect(run("dark")).toBe("dark");
  });

  it("ignores anything else, so the system preference applies", () => {
    expect(run(null)).toBeUndefined();
    expect(run("purple")).toBeUndefined();
    expect(run('"><script>')).toBeUndefined();
  });

  it("does not throw when storage is blocked", () => {
    expect(() => run(null, true)).not.toThrow();
  });
});
