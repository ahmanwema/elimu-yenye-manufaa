"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabaseConfigured } from "@/env";
import { resolveLocale } from "@/i18n/config";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { classifyOtpError, otpCodeSchema, sendOtp } from "@/server/otp";
import { createSupabaseServerClient } from "@/server/supabase";
import { field } from "./run";

// Two ways in, both of which never create an account.
//
//   1. Email + PASSWORD (owner decision 2026-11-22, superseding A45's "passwords are not the
//      primary login method"). This is now the primary route, because it is the only one that
//      works without an SMTP provider: Supabase's built-in mailer reaches only project team
//      addresses, so an emailed code never arrives for a real student or teacher. A password is
//      set once, when registering through a join link.
//   2. Email OTP / magic link (A45), kept as the alternative and ready for the day SMTP exists.
//
// No social or phone sign-in. Accounts are created only by a validated invitation or a valid
// join link; neither path below can bring one into existence.

export type SignInState =
  | { step: "email"; error?: "invalid_email" | "rate_limited" | "unavailable" }
  | { step: "code"; email: string; error?: "invalid_code" | "rate_limited" | "unavailable" };

export type PasswordSignInState = { error?: "invalid_credentials" | "rate_limited" | "unavailable" };

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export async function requestSignInCode(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const locale = resolveLocale(field(formData, "locale"));
  const parsed = emailSchema.safeParse(field(formData, "email"));
  if (!parsed.success) return { step: "email", error: "invalid_email" };
  if (!isSupabaseConfigured()) return { step: "email", error: "unavailable" };
  const next = safeRedirectPath(field(formData, "next"), `/${locale}/account`);
  try {
    const result = await sendOtp(parsed.data, next);
    if (result === "rate_limited") return { step: "email", error: "rate_limited" };
  } catch {
    return { step: "email", error: "unavailable" };
  }
  return { step: "code", email: parsed.data };
}

export async function verifySignInCode(prev: SignInState, formData: FormData): Promise<SignInState> {
  const locale = resolveLocale(field(formData, "locale"));
  const email = emailSchema.safeParse(field(formData, "email"));
  const code = otpCodeSchema.safeParse(field(formData, "code"));
  if (!email.success) return { step: "email", error: "invalid_email" };
  if (!code.success) return { step: "code", email: email.data, error: "invalid_code" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
  if (error) {
    const kind = classifyOtpError(error);
    return { step: "code", email: email.data, error: kind === "rate_limited" ? "rate_limited" : "invalid_code" };
  }
  redirect(safeRedirectPath(field(formData, "next"), `/${locale}/account`));
}

export async function signOut(formData: FormData) {
  const locale = resolveLocale(field(formData, "locale"));
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect(`/${locale}`);
}

/**
 * Email + password sign-in. A failure is always reported as `invalid_credentials`, whether the
 * address is unknown or the password is wrong, so this cannot be used to discover who has an
 * account. Supabase applies its own rate limiting on top.
 */
export async function signInWithPassword(_prev: PasswordSignInState, formData: FormData): Promise<PasswordSignInState> {
  const locale = resolveLocale(field(formData, "locale"));
  const email = emailSchema.safeParse(field(formData, "email"));
  const password = field(formData, "password");
  if (!email.success || !password) return { error: "invalid_credentials" };
  if (!isSupabaseConfigured()) return { error: "unavailable" };
  const next = safeRedirectPath(field(formData, "next"), `/${locale}/account`);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) {
    return { error: error.status === 429 ? "rate_limited" : "invalid_credentials" };
  }
  redirect(next);
}
