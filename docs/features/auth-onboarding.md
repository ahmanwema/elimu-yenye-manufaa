# Feature: Sign-in & Invite-first Onboarding

Status: **APPROVED** direction (A45) — **IMPLEMENTED locally 2026-10-13** (Phase 2A). Not yet run against a real Supabase project.

## Purpose

Let people sign in without a password, and let accounts come into existence only through an authorized invitation, so nobody can give themselves a role.

## Sign-in (existing accounts)

1. `/{locale}/sign-in` — the user enters an email address.
2. The server calls Supabase `signInWithOtp` with **`shouldCreateUser: false`**. Unknown addresses are reported exactly like known ones ("if an account exists, we sent a code"), so the form cannot reveal who has an account. Only rate limiting is surfaced.
3. The user enters the code, **or** opens the magic link → `/auth/confirm` (supports both `token_hash` and PKCE `code` links).
4. The destination after sign-in is untrusted input and is reduced to a same-origin path (`src/lib/safe-redirect.ts`).
5. Sign-out: `/{locale}/account` → "Sign out".

The origin used in emails comes from `SITE_URL` (configuration), never from the request's Host header.

## Invitations (new accounts and new memberships)

| Who | May invite | Into |
|---|---|---|
| Super Admin | MARKAZ_ADMIN, TEACHER, STUDENT | any Markaz (platform scope) |
| Markaz Admin | TEACHER, STUDENT | their own Markaz only |
| Teacher, Student, Parent | nobody | — (teacher invitations: open question 27) |

Flow:

1. The inviter enters an email address and a role on `/{locale}/markaz/{id}`. The server creates the invitation and shows the link **once**: 256-bit random token, only its SHA-256 hash stored, 7-day engineering default (OQ28), single use.
2. The recipient opens `/{locale}/invite/{token}` and sees the Markaz, the role and a masked email.
3. "Send a sign-in code" — the server reads the invited address from the invitation (the client sends only the token) and calls `signInWithOtp` with `shouldCreateUser: true`. **This is the only code path that can create an auth account.**
4. Once signed in, the server checks that the session's email equals the invited email. "Accept" then:
   - marks the invitation ACCEPTED with a conditional update (one winner on a race);
   - creates the student account if the role is STUDENT;
   - creates the membership, or re-activates an ENDED one.

   Tenant and role come only from the invitation row.
5. Markaz Admins and Super Admins can cancel a pending invitation.

## 2026-10-13 update — teacher and parent invitations (A59–A61)

- **Who may invite:**

  | Inviter | Targets |
  |---|---|
  | Super Admin | any target |
  | Markaz Admin | TEACHER, STUDENT, PARENT in own Markaz |
  | Teacher with `invitation.create` | STUDENT, PARENT in that Markaz |

  Teachers see and cancel only their own invitations.
- **PARENT invitation:** acceptance creates (or reuses) a Parent account and nothing else — no membership, no access.
- **Optional proposed child:** needs `parent_link.create` too (OQ32). On acceptance it becomes a **PENDING** link initiated by STAFF, which still needs verify → activate.
- **Lifetime is exactly 7 days (A60)**, and invitations remain single-use.

## 2026-10-13 (4th) — account creation and Supabase settings

- **Supabase "Allow new users to sign up" must be OFF.** No code path relies on it: OTP never creates users, and the invitation flow creates the invited account server-side through the admin API (secret key, server-only) after validating the token.
- Parent invitations proposing a child need `invitation.create` + `parent_link.create` (A63).
- Supabase project `elimu-yenye-manufaa` is the **development** environment (A65). Configure only development URLs (e.g. `http://localhost:3000` and `http://localhost:3000/auth/confirm`).

## Not implemented (open)

- ~~Parent invitations / link requests (OQ29)~~ — implemented 2026-10-13.
- ~~Teacher-issued invitations (OQ27)~~ — implemented 2026-10-13.
- Sending invitation emails: the inviter shares the link; Supabase sends only the sign-in code.
- Invitation-redemption rate limiting beyond token entropy and Supabase's own OTP limits — see security.md §3.1.

## Supabase configuration (development project, verified 2026-10-13)

- "Allow new users to sign up" **OFF** (verified `disable_signup=true`); Email provider ON.
- Site URL `http://localhost:3000`; redirect URL `http://localhost:3000/auth/confirm`.
- Verified on real Supabase:
  - `/auth/confirm` with a magic-link token sets the session cookie and redirects safely;
  - the code path (`verifyOtp`) works;
  - unknown-email OTP is refused without creating a user;
  - a direct sign-up is refused with `signup_disabled`.
- Not verified automatically: delivery of the email to a real inbox. Supabase's built-in mailer only sends to project team addresses and is rate-limited; production needs custom SMTP (later decision).

## Supabase configuration needed later (original note, kept for history)

- Email OTP enabled; email templates include `{{ .Token }}`, and the magic-link template points at `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}` (or uses the default PKCE link).
- `SITE_URL` added to the redirect allow-list.
- Public sign-ups: keep enabled only as far as needed for `shouldCreateUser: true` from the invite flow. Evaluate disabling them and creating invited users with the admin API instead (a configuration decision to verify against the real project).

## Tests

`tests/services/invitations.test.ts`, `tests/unit/auth-safety.test.ts` (redirect safety, OTP error handling, server-action export surface).

## 2026-10-19 update — Finance Officer invitations (A140)

- New invitation target **FINANCE_OFFICER** (a real non-teaching Markaz role). Who may invite: a Markaz Admin in their own Markaz, or a Super Admin. A Teacher with `invitation.create` still invites only STUDENT and PARENT.
- Acceptance creates exactly an ACTIVE `FINANCE_OFFICER` membership in the invited Markaz (no registration number, no teaching role). Ending the membership removes all finance authority immediately; payment records and their audit trail remain.
