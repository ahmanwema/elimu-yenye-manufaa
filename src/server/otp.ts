import "server-only";
import { z } from "zod";
import { getSiteUrl } from "@/env";
import { createSupabaseServerClient } from "@/server/supabase";

// OTP helpers. Deliberately NOT in a "use server" file: every export of such a file is a
// publicly callable endpoint.
//
// OTP NEVER creates accounts (shouldCreateUser is always false), so the Supabase project can
// keep public sign-ups DISABLED. Invited accounts are created server-side through the admin
// API, only after the invitation token is validated (src/server/supabase-admin.ts).

export const otpCodeSchema = z.string().trim().regex(/^\d{6,10}$/);

type OtpError = { status?: number; code?: string } | null;

/** Rate limiting is the only failure surfaced; everything else looks like success. */
export function classifyOtpError(error: OtpError): "ok" | "rate_limited" {
  if (!error) return "ok";
  if (error.status === 429 || (error.code ?? "").includes("rate_limit")) return "rate_limited";
  // E.g. "signups not allowed" for an unknown email: reported as sent, so the form
  // cannot be used to discover which emails have accounts.
  return "ok";
}

export async function sendOtp(email: string, nextPath: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(nextPath)}`,
    },
  });
  return classifyOtpError(error);
}
