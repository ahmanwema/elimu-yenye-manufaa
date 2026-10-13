import "server-only";
import { connection } from "next/server";
import { isSupabaseConfigured } from "@/env";
import { getDb } from "@/server/db";
import { createSupabaseServerClient } from "@/server/supabase";
import { loadActor } from "@/server/authz/load-actor";
import type { Actor } from "@/server/authz/policy";
import type { AuthIdentity } from "@/server/services/invitations";

export type CurrentActor =
  | { state: "not-configured" }
  | { state: "signed-out" }
  | { state: "no-profile"; identity: AuthIdentity }
  | { state: "signed-in"; actor: Actor; identity: AuthIdentity };

/**
 * The verified Supabase identity of this request, or null. The user id and email come
 * only from the validated token (getClaims), never from request input.
 */
export async function getAuthIdentity(): Promise<AuthIdentity | null> {
  // Always evaluate per request: never bake auth state into a prerendered page.
  await connection();
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { userId: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

/** Authentication (Supabase Auth) → application identity (Profile) → Actor. Uncached. */
export async function getCurrentActor(): Promise<CurrentActor> {
  await connection();
  if (!isSupabaseConfigured()) return { state: "not-configured" };
  const identity = await getAuthIdentity();
  if (!identity) return { state: "signed-out" };
  const actor = await loadActor(getDb(), identity.userId);
  return actor ? { state: "signed-in", actor, identity } : { state: "no-profile", identity };
}
