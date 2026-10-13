import { z } from "zod";

// Environment is validated lazily (on first use), so the app can build and the
// public pages can render before any Supabase project is connected.

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverSchema = z.object({
  DATABASE_URL: z.url().refine((v) => v.startsWith("postgres"), "must be a postgres:// URL"),
});

// The canonical public origin used in sign-in emails. Taken from configuration — never
// from the request's Host header, which an attacker can influence.
const siteSchema = z.object({
  SITE_URL: z.url().refine((v) => /^https?:\/\//.test(v), "must be http(s)"),
});

const storageSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

export class EnvError extends Error {}

function parse<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new EnvError(`${label} environment is missing or invalid: ${fields}. See .env.example.`);
  }
  return result.data;
}

// NEXT_PUBLIC_* must be referenced literally so Next.js can inline them in client bundles.
function readPublic() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getPublicEnv(): PublicEnv {
  return parse(publicSchema, readPublic(), "Supabase (public)");
}

export function getServerEnv(): ServerEnv {
  return parse(serverSchema, { DATABASE_URL: process.env.DATABASE_URL }, "Database (server)");
}

export function getSiteUrl(): string {
  return parse(siteSchema, { SITE_URL: process.env.SITE_URL }, "Site").SITE_URL.replace(/\/+$/, "");
}

export function getStorageEnv() {
  return parse(storageSchema, { SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, "Storage (server)");
}

export function isSupabaseConfigured(): boolean {
  return publicSchema.safeParse(readPublic()).success;
}
