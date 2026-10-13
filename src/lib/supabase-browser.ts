"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/env";

// Browser client. Only ever holds the publishable key; all reads it performs are
// subject to Row Level Security. Never import the database client into client code.
export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
