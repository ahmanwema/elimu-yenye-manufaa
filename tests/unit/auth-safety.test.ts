import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { classifyOtpError, otpCodeSchema } from "@/server/otp";

describe("post-sign-in redirect safety", () => {
  it.each([
    ["/sw/account", "/sw/account"],
    ["/ar/markaz/abc?tab=links#x", "/ar/markaz/abc?tab=links#x"],
  ])("keeps a same-origin path %s", (input, expected) => {
    expect(safeRedirectPath(input, "/fallback")).toBe(expected);
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/%0a/evil.example".replace("%0a", "\n"),
    " /sw/account",
    "sw/account",
    "",
    "x".repeat(3000),
  ])("rejects %j", (input) => {
    expect(safeRedirectPath(input, "/fallback")).toBe("/fallback");
  });

  it.each([undefined, null, 42, ["/sw"], { href: "/sw" }])("rejects non-string %j", (input) => {
    expect(safeRedirectPath(input, "/fallback")).toBe("/fallback");
  });
});

describe("OTP handling", () => {
  it("only rate limiting is surfaced; unknown-account errors look like success (no email enumeration)", () => {
    expect(classifyOtpError({ status: 429, code: "over_email_send_rate_limit" })).toBe("rate_limited");
    expect(classifyOtpError({ status: 422, code: "otp_disabled" })).toBe("ok");
    expect(classifyOtpError({ status: 400, code: "signup_disabled" })).toBe("ok");
    expect(classifyOtpError(null)).toBe("ok");
  });

  it("accepts only numeric codes of plausible length", () => {
    expect(otpCodeSchema.safeParse("123456").success).toBe(true);
    expect(otpCodeSchema.safeParse("12345").success).toBe(false);
    expect(otpCodeSchema.safeParse("abcdef").success).toBe(false);
  });
});

describe("server action surface", () => {
  // Every export of a "use server" file is a public endpoint. Only intended actions may be
  // exported — in particular nothing that can create an account for an arbitrary email.
  const dir = join(process.cwd(), "src", "server", "actions");
  const allowed: Record<string, string[]> = {
    "auth.ts": ["requestSignInCode", "verifySignInCode", "signOut"],
    "invitations.ts": ["sendInviteCode", "verifyInviteCode", "acceptInvite", "createInvite", "revokeInvite"],
    "workspace.ts": [
      "requestLinkAction",
      "createLinkAction",
      "verifyLinkAction",
      "activateLinkAction",
      "revokeLinkAction",
      "withdrawMyLinkAction",
      "requestAppointmentAction",
      "reviewAppointmentAction",
      "grantPermissionAction",
      "revokePermissionAction",
      "updateMyNameAction",
    ],
    // Recording & correction media (2026-10-14). The worker-only functions (finalize extracted
    // clip, recording media register/finalize, purge, abandoned-upload cleanup, anchor
    // removal) must NEVER appear here.
    "media.ts": [
      "recordDateOfBirthAction",
      "giveGuardianConsentAction",
      "recordOfflineConsentAction",
      "withdrawConsentAction",
      "createCorrectionAction",
      "registerClipUploadAction",
      "finalizeClipUploadAction",
      "clipPlaybackAction",
      "requestMediaDeletionAction",
      "approveMediaDeletionAction",
      "createRecordingAction",
      "submitRecordingAction",
      "approveRecordingAction",
      "revokeRecordingApprovalAction",
      "recordingPlaybackAction",
    ],
  };

  it.each(readdirSync(dir).filter((f) => readFileSync(join(dir, f), "utf8").startsWith('"use server"')))(
    "%s exports only its intended actions",
    (file) => {
      const source = readFileSync(join(dir, file), "utf8");
      const exported = [...source.matchAll(/^export (?:async function|function|const|let|class) (\w+)/gm)].map((m) => m[1]);
      expect(exported.sort()).toEqual([...(allowed[file] ?? [])].sort());
      expect(source).not.toMatch(/shouldCreateUser:\s*true/);
    },
  );

  it("OTP never creates accounts; only the invitation flow creates one, via the admin API", () => {
    const otp = readFileSync(join(process.cwd(), "src", "server", "otp.ts"), "utf8");
    expect(otp).toMatch(/shouldCreateUser: false/);
    expect(otp).not.toMatch(/shouldCreateUser:\s*(true|createUser)/);
    const sources = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8"));
    const creators = sources.filter((s) => s.includes("ensureAuthUserForInvitation("));
    expect(creators).toHaveLength(1);
    const invite = readFileSync(join(dir, "invitations.ts"), "utf8");
    // The account is created only after the token was validated by invitedEmailForToken().
    expect(invite.indexOf("invitedEmailForToken(getDb(), token)")).toBeLessThan(invite.indexOf("ensureAuthUserForInvitation(email)"));
  });
});
