import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getStorageEnv } from "@/env";

// Server-only Supabase admin client (secret key). Used for exactly two things:
//   1. creating the auth user for a VALID invitation (public sign-ups stay disabled), and
//   2. minting signed Storage URLs after the app has authorized the request.
// Never import this from client code; never expose its key.
export function createSupabaseAdminClient() {
  return createClient(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, getStorageEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Ensures an auth user exists for an invited email. Called ONLY after the invitation token
 * has been validated server-side. Idempotent: an existing account is left untouched.
 * The email is NOT marked confirmed here; signing in with the emailed code proves ownership.
 */
export async function ensureAuthUserForInvitation(email: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: false });
  if (!error) return;
  // "already registered" is the expected idempotent case; anything else is a real failure.
  if (error.status === 422 || /already/i.test(error.message)) return;
  throw new Error("Auth: could not prepare invited account");
}
