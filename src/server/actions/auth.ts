"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabaseConfigured } from "@/env";
import { resolveLocale } from "@/i18n/config";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { classifyOtpError, otpCodeSchema, sendOtp } from "@/server/otp";
import { createSupabaseServerClient } from "@/server/supabase";
import { field } from "./run";

// Email OTP / magic link (A45). No passwords, no social or phone sign-in.
// Sign-in never creates an account: accounts are created only for a validated invitation
// (src/server/actions/invitations.ts → ensureAuthUserForInvitation).

export type SignInState =
  | { step: "email"; error?: "invalid_email" | "rate_limited" | "unavailable" }
  | { step: "code"; email: string; error?: "invalid_code" | "rate_limited" | "unavailable" };

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
