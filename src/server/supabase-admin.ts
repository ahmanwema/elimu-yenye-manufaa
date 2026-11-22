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

/**
 * Same as `ensureAuthUserForInvitation`, but returns the account's id — which is also the
 * `profiles.id`, because the auth.users trigger bootstraps the profile row.
 *
 * Used by the two onboarding paths that must then write rows FOR that person: creating a Markaz
 * with its first Markaz Admin, and redeeming a shareable join link. Like the invitation path it
 * is called only after the request has been authorized (a Super Admin's action) or the token has
 * been validated server-side, and it never confirms the email: signing in with the emailed code
 * is what proves ownership. Idempotent — an existing account is returned untouched.
 */
export async function ensureAuthUserForEmail(email: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: false });
  if (!error && data.user) return data.user.id;
  if (error && error.status !== 422 && !/already/i.test(error.message)) {
    throw new Error("Auth: could not prepare account");
  }
  // Already registered: find the existing account. listUsers is the only lookup the admin API
  // offers; it is paged, so walk until the address turns up or the pages run out.
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (listError) throw new Error("Auth: could not prepare account");
    const found = list.users.find((u) => u.email?.toLowerCase() === wanted);
    if (found) return found.id;
    if (list.users.length < 1000) break;
  }
  throw new Error("Auth: could not prepare account");
}
