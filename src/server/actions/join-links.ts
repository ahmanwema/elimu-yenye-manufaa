"use server";

import { redirect } from "next/navigation";
import { getSiteUrl, isSupabaseConfigured } from "@/env";
import { resolveLocale } from "@/i18n/config";
import type { ActionResult } from "@/lib/action-result";
import { getDb } from "@/server/db";
import { otpCodeSchema, sendOtp } from "@/server/otp";
import { createSupabaseServerClient } from "@/server/supabase";
import { DomainError } from "@/server/services/errors";
import {
  createJoinLink,
  joinTokenSchema,
  previewJoinLink,
  redeemDetailsSchema,
  redeemJoinLink,
  revokeJoinLink,
} from "@/server/services/join-links";
import { tenantAdminEmailSchema } from "@/server/services/tenants";
import { ensureAuthUserForEmail } from "@/server/supabase-admin";
import { field, runAsActor } from "./run";

// Every export of this file is a public endpoint (tests/unit/auth-safety.test.ts pins the list).
//
// Two of them are reachable by people with NO account at all — that is the point of a join
// link — so each one validates the token server-side BEFORE it does anything, and the address
// an account is prepared for is the one the visitor typed on a link that already proved valid.

export type JoinState =
  | { step: "details"; error?: "invalid" | "expired" | "rate_limited" | "unavailable" | "invalid_input" }
  | { step: "code"; email: string; error?: "invalid_code" | "rate_limited" | "unavailable" };

/** Markaz Admin issues a link. Returns the full URL and the raw token, shown exactly once. */
export async function createJoinLinkAction(
  _prev: ActionResult<{ link: string }>,
  formData: FormData,
): Promise<ActionResult<{ link: string }>> {
  const locale = resolveLocale(field(formData, "locale"));
  return runAsActor(async (db, actor) => {
    const created = await createJoinLink(db, actor, {
      tenantId: field(formData, "tenantId"),
      classId: field(formData, "classId"),
      label: field(formData, "label"),
      expiresInDays: field(formData, "expiresInDays"),
      maxUses: field(formData, "maxUses"),
    });
    let origin = "";
    try {
      origin = getSiteUrl();
    } catch {
      // Without SITE_URL the admin still gets a working relative path to share.
    }
    return { link: `${origin}/${locale}/join/${created.token}` };
  });
}

export async function revokeJoinLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeJoinLink(db, actor, field(formData, "joinLinkId")));
}

/**
 * Step 1 of joining: the visitor's details and email. Prepares the account for THAT address and
 * emails a code. The link is validated first, so this cannot be used to create accounts at will.
 */
export async function startJoinAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const locale = resolveLocale(field(formData, "locale"));
  const token = joinTokenSchema.safeParse(field(formData, "token"));
  if (!token.success) return { step: "details", error: "invalid" };
  const email = tenantAdminEmailSchema.safeParse(field(formData, "email"));
  const details = redeemDetailsSchema.safeParse({
    displayName: field(formData, "displayName"),
    phone: field(formData, "phone"),
    gender: field(formData, "gender"),
    dateOfBirth: field(formData, "dateOfBirth"),
  });
  if (!email.success || !details.success) return { step: "details", error: "invalid_input" };
  if (!isSupabaseConfigured()) return { step: "details", error: "unavailable" };

  // The link must be usable before anything is created for anybody.
  const preview = await previewJoinLink(getDb(), token.data);
  if (preview.state !== "valid") return { step: "details", error: "expired" };

  try {
    await ensureAuthUserForEmail(email.data);
    const result = await sendOtp(email.data, `/${locale}/join/${token.data}`);
    if (result === "rate_limited") return { step: "details", error: "rate_limited" };
  } catch {
    return { step: "details", error: "unavailable" };
  }
  return { step: "code", email: email.data };
}

/** Step 2: the emailed code proves the address, then the link is redeemed. */
export async function finishJoinAction(prev: JoinState, formData: FormData): Promise<JoinState> {
  const locale = resolveLocale(field(formData, "locale"));
  const token = joinTokenSchema.safeParse(field(formData, "token"));
  const email = tenantAdminEmailSchema.safeParse(field(formData, "email"));
  const code = otpCodeSchema.safeParse(field(formData, "code"));
  const details = redeemDetailsSchema.safeParse({
    displayName: field(formData, "displayName"),
    phone: field(formData, "phone"),
    gender: field(formData, "gender"),
    dateOfBirth: field(formData, "dateOfBirth"),
  });
  if (!token.success || !email.success || !details.success) return { step: "details", error: "invalid" };
  if (!code.success) return { step: "code", email: email.data, error: "invalid_code" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: "email" });
  if (error || !data.user) return { step: "code", email: email.data, error: "invalid_code" };

  try {
    await redeemJoinLink(getDb(), { token: token.data, profileId: data.user.id, details: details.data });
  } catch (error) {
    if (error instanceof DomainError) return { step: "details", error: "expired" };
    return { step: "details", error: "unavailable" };
  }
  redirect(`/${locale}/account?joined=1`);
}
