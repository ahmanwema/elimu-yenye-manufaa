import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvError, getPublicEnv, getServerEnv, isSupabaseConfigured } from "@/env";

afterEach(() => vi.unstubAllEnvs());

describe("environment validation", () => {
  it("reports Supabase as not configured when variables are absent", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => getPublicEnv()).toThrow(EnvError);
  });

  it("accepts a valid public configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "https://example.com");
    expect(() => getServerEnv()).toThrow(EnvError);
  });

  it("never echoes secret values in the error", () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:supersecret@host/db");
    expect(() => getServerEnv()).toThrow(/DATABASE_URL/);
    try {
      getServerEnv();
    } catch (e) {
      expect(String(e)).not.toContain("supersecret");
    }
  });
});
