"use server";

import { redirect } from "next/navigation";
import { getSiteUrl, isSupabaseConfigured } from "@/env";
import { resolveLocale } from "@/i18n/config";
import type { ActionResult } from "@/lib/action-result";
import { getAuthIdentity } from "@/server/auth";
import { getDb } from "@/server/db";
import { createSupabaseServerClient } from "@/server/supabase";
import { acceptInvitation, createInvitation, invitedEmailForToken, revokeInvitation } from "@/server/services/invitations";
import { DomainError } from "@/server/services/errors";
import { otpCodeSchema, sendOtp } from "@/server/otp";
import { ensureAuthUserForInvitation } from "@/server/supabase-admin";
import { field, runAsActor, toResultCode } from "./run";

export type InviteSignInState =
  | { step: "send"; error?: "invalid" | "expired" | "rate_limited" | "unavailable" }
  | { step: "code"; error?: "invalid_code" | "rate_limited" | "unavailable" };

// The client sends only the token. The email address the code goes to is read from the
// invitation on the server — the recipient cannot redirect it to another address.
export async function sendInviteCode(_prev: InviteSignInState, formData: FormData): Promise<InviteSignInState> {
  const locale = resolveLocale(field(formData, "locale"));
  const token = field(formData, "token");
  if (!isSupabaseConfigured()) return { step: "send", error: "unavailable" };
  let email: string;
  try {
    email = await invitedEmailForToken(getDb(), token);
  } catch (error) {
    return { step: "send", error: error instanceof DomainError && error.code === "expired" ? "expired" : "invalid" };
  }
  try {
    // The only place an account may be created (invite-first, A45): for the invited email
    // of a token that was just validated, via the server-side admin API.
    await ensureAuthUserForInvitation(email);
    const result = await sendOtp(email, `/${locale}/invite/${token}`);
    if (result === "rate_limited") return { step: "send", error: "rate_limited" };
  } catch {
    return { step: "send", error: "unavailable" };
  }
  return { step: "code" };
}

export async function verifyInviteCode(_prev: InviteSignInState, formData: FormData): Promise<InviteSignInState> {
  const locale = resolveLocale(field(formData, "locale"));
  const token = field(formData, "token");
  const code = otpCodeSchema.safeParse(field(formData, "code"));
  if (!code.success) return { step: "code", error: "invalid_code" };
  let email: string;
  try {
    email = await invitedEmailForToken(getDb(), token);
  } catch {
    return { step: "send", error: "invalid" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code.data, type: "email" });
  if (error) return { step: "code", error: "invalid_code" };
  redirect(`/${locale}/invite/${token}`);
}

export async function acceptInvite(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = resolveLocale(field(formData, "locale"));
  const identity = await getAuthIdentity();
  if (!identity) return { status: "error", code: "forbidden" };
  try {
    await acceptInvitation(getDb(), identity, { token: field(formData, "token") });
  } catch (error) {
    return { status: "error", code: toResultCode(error) };
  }
  redirect(`/${locale}/account?joined=1`);
}

export async function createInvite(
  _prev: ActionResult<{ link: string; email: string }>,
  formData: FormData,
): Promise<ActionResult<{ link: string; email: string }>> {
  const locale = resolveLocale(field(formData, "locale"));
  return runAsActor(async (db, actor) => {
    // Target and proposed child are re-authorized by the service (invitableTargets,
    // parent_link.create); the form only expresses what the inviter wants.
    const invitation = await createInvitation(db, actor, {
      tenantId: field(formData, "tenantId"),
      email: field(formData, "email"),
      target: field(formData, "target"),
      proposedStudentId: field(formData, "proposedStudentId"),
    });
    let origin = "";
    try {
      origin = getSiteUrl();
    } catch {
      // Without SITE_URL the inviter still gets a working relative path.
    }
    return { link: `${origin}/${locale}/invite/${invitation.token}`, email: invitation.email };
  });
}

export async function revokeInvite(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAsActor((db, actor) => revokeInvitation(db, actor, field(formData, "invitationId")));
}
