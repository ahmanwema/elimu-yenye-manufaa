"use server";

import { redirect } from "next/navigation";
import { getSiteUrl, isSupabaseConfigured } from "@/env";
import { resolveLocale } from "@/i18n/config";
import type { ActionResult } from "@/lib/action-result";
import { getAuthIdentity } from "@/server/auth";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/services/errors";
import {
  createJoinLink,
  joinTokenSchema,
  passwordSchema,
  previewJoinLink,
  redeemDetailsSchema,
  redeemJoinLink,
  revokeJoinLink,
} from "@/server/services/join-links";
import { tenantAdminEmailSchema } from "@/server/services/tenants";
import { createSupabaseServerClient } from "@/server/supabase";
import { createAuthUserWithPassword } from "@/server/supabase-admin";
import { field, runAsActor } from "./run";

// Every export of this file is a public endpoint (tests/unit/auth-safety.test.ts pins the list).
//
// registerWithJoinLinkAction is reachable by someone with NO account at all — that is the whole
// point of a join link — so it validates the token BEFORE it creates anything, and it refuses to
// touch an address that already has an account.

/** Markaz Admin (or Super Admin) issues a link. Returns the URL, shown exactly once. */
export async function createJoinLinkAction(
  _prev: ActionResult<{ link: string }>,
  formData: FormData,
): Promise<ActionResult<{ link: string }>> {
  const locale = resolveLocale(field(formData, "locale"));
  return runAsActor(async (db, actor) => {
    const created = await createJoinLink(db, actor, {
      tenantId: field(formData, "tenantId"),
      role: field(formData, "role"),
      classId: field(formData, "classId"),
      label: field(formData, "label"),
      expiresInDays: field(formData, "expiresInDays"),
      maxUses: field(formData, "maxUses"),
    });
    let origin = "";
    try {
      origin = getSiteUrl();
    } catch {
      // Without SITE_URL the issuer still gets a working relative path to share.
    }
    return { link: `${origin}/${locale}/join/${created.token}` };
  });
}

export async function revokeJoinLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeJoinLink(db, actor, field(formData, "joinLinkId")));
}

export type JoinState = {
  error?: "invalid" | "expired" | "invalid_input" | "weak_password" | "password_mismatch" | "email_taken" | "unavailable";
};

/**
 * Registers the person the link was sent to: their details and a password of their own, no
 * emailed code (owner decision 2026-11-22). The link is what authorizes this, so it is checked
 * first; an address that already has an account is refused rather than taken over.
 */
export async function registerWithJoinLinkAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const locale = resolveLocale(field(formData, "locale"));
  const token = joinTokenSchema.safeParse(field(formData, "token"));
  if (!token.success) return { error: "invalid" };
  if (!isSupabaseConfigured()) return { error: "unavailable" };

  // Nothing is created for anybody until the link itself is known to be usable.
  const preview = await previewJoinLink(getDb(), token.data);
  if (preview.state !== "valid") return { error: "expired" };

  const email = tenantAdminEmailSchema.safeParse(field(formData, "email"));
  const details = redeemDetailsSchema.safeParse({
    displayName: field(formData, "displayName"),
    phone: field(formData, "phone"),
    gender: field(formData, "gender"),
    dateOfBirth: field(formData, "dateOfBirth"),
  });
  if (!email.success || !details.success) return { error: "invalid_input" };
  if (preview.role === "STUDENT" && (!details.data.gender || !details.data.dateOfBirth)) {
    return { error: "invalid_input" };
  }

  const password = passwordSchema.safeParse(field(formData, "password"));
  if (!password.success) return { error: "weak_password" };
  if (password.data !== field(formData, "passwordConfirm")) return { error: "password_mismatch" };

  let created: Awaited<ReturnType<typeof createAuthUserWithPassword>>;
  try {
    created = await createAuthUserWithPassword(email.data, password.data);
  } catch {
    return { error: "unavailable" };
  }
  if (created.state === "exists") return { error: "email_taken" };

  try {
    await redeemJoinLink(getDb(), { token: token.data, profileId: created.userId, details: details.data });
  } catch (error) {
    return { error: error instanceof DomainError ? "expired" : "unavailable" };
  }

  // Sign them straight in: they just chose this password, so there is nothing to prove again.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password: password.data });
  if (error) redirect(`/${locale}/sign-in?joined=1`);
  redirect(`/${locale}/account?joined=1`);
}

/**
 * Adds the membership for someone who is ALREADY signed in and then opens a link — a teacher
 * joining a second Markaz, say. No account is created and no password is touched.
 */
export async function joinAsSignedInAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const locale = resolveLocale(field(formData, "locale"));
  const token = joinTokenSchema.safeParse(field(formData, "token"));
  if (!token.success) return { error: "invalid" };
  const identity = await getAuthIdentity();
  if (!identity) return { error: "invalid" };

  const preview = await previewJoinLink(getDb(), token.data);
  if (preview.state !== "valid") return { error: "expired" };

  const details = redeemDetailsSchema.safeParse({
    displayName: field(formData, "displayName"),
    phone: field(formData, "phone"),
    gender: field(formData, "gender"),
    dateOfBirth: field(formData, "dateOfBirth"),
  });
  if (!details.success) return { error: "invalid_input" };

  try {
    await redeemJoinLink(getDb(), { token: token.data, profileId: identity.userId, details: details.data });
  } catch (error) {
    return { error: error instanceof DomainError ? "expired" : "unavailable" };
  }
  redirect(`/${locale}/account?joined=1`);
}
