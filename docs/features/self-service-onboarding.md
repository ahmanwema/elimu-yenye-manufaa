# Self-service onboarding — implementation plan (PROPOSED)

**Status: PROPOSED. Nothing here is approved.** Written 2026-11-22 at the project owner's request
("Home Madrasa": a teacher opens a Markaz, students join through a link shared on WhatsApp, pay,
and an admin activates them for a period). No code has been written. See [DECISIONS.md](../../DECISIONS.md) §2
for the authorization this plan still needs.

## 1. What the owner asked for

1. A Markaz called **Home Madrasa** exists.
2. A **teacher opens an account** and runs it.
3. **Students join through a shareable link** — WhatsApp preferred, email acceptable.
4. The student **fills in their own details and email** on that link.
5. The student is then **told to pay**.
6. When the payment is seen, **an admin activates them for the planned period**.

## 2. What already exists (verified in code, 2026-11-22)

Steps 4–6 are essentially built. The gap is only the front door.

| Need | State | Where |
|---|---|---|
| Enrollment awaiting payment | **Exists** — `ClassEnrollmentStatus.PENDING_PAYMENT` | `prisma/schema.prisma` |
| Student submits payment evidence | **Exists** — `submitPaymentEvidence`, a reference only, never the evidence itself | `src/server/services/enrollments.ts` |
| Admin verifies, access runs for a period | **Exists** — `verifyPayment` sets VERIFIED, flips `PENDING_PAYMENT → ACTIVE`, writes `accessUntil` from the submission's `periodEnd` | `src/server/services/enrollments.ts:343` |
| Grace after the period | **Exists** — `graceUntil`, `extendGrace` | A131–A139 |
| Who may verify | **Exists** — `canVerifyPayment`: ACTIVE Markaz Admin **or** Finance Officer, by role; never a Teacher (A140) | `src/server/authz/live-class.ts:126` |
| Invitations by email, with roles | **Exists** — Markaz Admin may invite TEACHER / STUDENT / FINANCE_OFFICER / PARENT | `src/server/authz/policy.ts:198` |
| Account creation without public sign-ups | **Exists** — `ensureAuthUserForInvitation` creates the auth user server-side only after a token validates (A45) | `src/server/actions/invitations.ts` |
| Classes, schedules, capacity, waitlist, FIFO, sessions | **Exists** | A101–A140 |

## 3. What does not exist

**3.1 There is no way to create a Markaz. At all.**
No server action, no service, no UI — the platform page handles Option C, appointment requests,
permissions and capacity only. The one tenant in the development project was inserted with raw SQL,
because the application has no path at all for three rows: the tenant, its first Markaz Admin
membership, and the platform-admin row. **This blocks Home Madrasa before anything else.**

**3.2 A teacher cannot open their own account.**
Onboarding is invite-first (A45) and public sign-ups are disabled (A65): an auth account is created
only for a validated invitation token. For a brand-new Markaz nobody exists to issue that invitation,
so the cycle cannot start. The first Markaz Admin must therefore be established at creation time.

**3.3 There is no shareable join link.**
Every invitation is bound to one email address, single-purpose, 7-day lifetime (A60). Nothing in the
schema or services represents "one link, many students, share it on WhatsApp". This is the feature
the owner actually asked for, and it is new work: a new table, new services, new UI, new RLS.

**3.4 Self-registration is approved in principle but not in mechanism.**
A2 and A18 already approve that students self-register and join via invitation links without
requiring manual teacher approval to join. A45 later tightened onboarding to invite-first. A
shareable join link is consistent with A2's intent but needs its own decision, because it changes
who may cause an account to be created.

## 4. Proposed staging

Smallest safe increment first. Each stage is independently useful and independently authorizable.

### Stage 1 — Markaz creation (closes 3.1 and 3.2)

Create a Markaz, its first Markaz Admin, and that admin's auth account, in one authorized operation.

- `createTenant(db, actor, { name, slug, adminEmail })` in a new `src/server/services/tenants.ts`.
- Creates the tenant, creates the auth user for `adminEmail` via the admin API, creates the profile,
  and creates one ACTIVE `MARKAZ_ADMIN` membership. Writes an audit event.
- Reuses the existing account-creation path; public sign-ups stay disabled.
- UI: a form on `/{locale}/platform`, visible to Super Admins only.
- **Who may call it is an owner decision — see §6, Q1.** This plan assumes Super Admin only, as the
  narrowest rule that unblocks Home Madrasa today.
- For Home Madrasa the same person is both Markaz Admin and Teacher: after Stage 1 the new admin
  invites themselves as TEACHER through the existing flow, or the service grants both memberships.
  **See §6, Q5 — this has a real consequence for payment separation.**

No migration needed: `tenants` and `memberships` already exist.

### Stage 2 — Shareable join links (closes 3.3; this is the WhatsApp flow)

- New table `class_join_links`: `id`, `tenant_id`, `class_id` (nullable = join the Markaz rather than
  a class), `token_hash`, `label`, `created_by_id`, `created_at`, `expires_at`, `max_uses` (nullable),
  `use_count`, `status` (ACTIVE / REVOKED / EXPIRED). Server-only, deny-by-default RLS, like the
  other twelve Live Class tables.
- New table `class_join_link_uses` recording which profile used which link and when, so a link can be
  audited and abuse traced — or `audit_events` only (**§6, Q4**).
- Services: `createJoinLink`, `listJoinLinks`, `revokeJoinLink`, `previewJoinLink`, `redeemJoinLink`.
- The token is never stored, only its hash, exactly as invitations do today.
- Public page `/{locale}/join/{token}`: shows the Markaz and class name, collects the student's name
  and email, sends an OTP to that email, and on verification creates the account, the STUDENT
  membership and a `PENDING_PAYMENT` enrollment. It then shows the Markaz's payment instructions.
- Rate limiting and abuse controls are mandatory, since this link creates accounts: per-link
  `max_uses`, per-link expiry, revocation, and a per-IP and per-email throttle on redemption.

Migration: one additive migration (migration 22).

### Stage 3 — Payment and activation (mostly wiring)

- A student-facing page to submit a payment reference against their pending enrollment.
- The admin and finance view already exists at `/{locale}/markaz/{id}/finance`; confirm it lists
  submissions originating from join-link enrollments.
- No new business rules: A107 (manual verification only) and A140 (never a Teacher) stand.

### Stage 4 — Open teacher self-registration (only if the owner wants it)

Any teacher, uninvited, creates their own Markaz. This is the real multi-tenant product (A2), but it
is also the largest change to the trust model: it lets anyone with an email create a tenant. It needs
its own decision on abuse, verification and limits, and should not ride along with Stages 1–3.

## 5. Acceptance criteria

**Stage 1**
- A Super Admin creates a Markaz and its first Markaz Admin in one operation; that admin can sign in
  with no prior invitation and reach `/{locale}/markaz/{id}`.
- Nobody who is not a Super Admin can create a Markaz; the attempt is denied server-side, not hidden.
- Public sign-ups remain disabled throughout.
- The slug is unique; a duplicate name or slug fails cleanly.
- An audit event records who created the tenant and who became its first admin.

**Stage 2**
- A Markaz Admin creates a join link; the raw token is shown exactly once and never stored.
- An unauthenticated visitor opening a valid link sees the Markaz and class name and nothing else —
  no roster, no student data, no other class.
- Redeeming creates exactly one account, one STUDENT membership and one `PENDING_PAYMENT`
  enrollment, and is idempotent for the same email.
- A revoked, expired or exhausted link is refused, and all three are refused identically so the
  link's state cannot be probed.
- A link for Markaz A can never place a student in Markaz B.
- A student who joins has no access to class content until payment is verified.

**Stage 3**
- A student with a `PENDING_PAYMENT` enrollment submits a payment reference and sees it as submitted.
- A Markaz Admin or Finance Officer verifies it; the enrollment becomes ACTIVE with `accessUntil`
  equal to the period end. A Teacher attempting the same is denied (A140).
- Rejection leaves the enrollment pending and tells the student why.

## 6. Owner decisions needed before implementation

| # | Question | Why it matters |
|---|---|---|
| Q1 | Who may create a Markaz: Super Admin only, an approval queue, or anyone? | Decides Stage 1's authorization rule and whether Stage 4 happens at all. The narrowest option unblocks Home Madrasa today. |
| Q2 | Does a join link scope to a **class** or to the whole **Markaz**? | Changes the table, the page and what the student lands in. |
| Q3 | Link limits: expiry, maximum uses, revocable by whom? | This link creates accounts; without limits a forwarded WhatsApp message is an open door. |
| Q4 | What does the student fill in: name and email only, or also phone and date of birth? | Date of birth drives the recording-consent rules (A66+). Collecting it later is more work. |
| Q5 | In a one-person Madrasa the teacher is also the Markaz Admin, so by `canVerifyPayment` they verify their own students' payments. Acceptable, or must a second person always verify? | A140 created the Finance Officer precisely to separate teaching from payment. A one-person Markaz collapses that separation. |
| Q6 | Does joining via link ever grant access before payment (a trial), or is `PENDING_PAYMENT` always the landing state? | A2 says students join without requiring manual teacher approval; a payment gate is a different gate, but the owner should say so explicitly. |
| Q7 | Email delivery: Supabase's built-in mailer only sends to project team addresses and is rate-limited. Which SMTP provider? | Without this, no real student can receive a code, and Stage 2 cannot be used by anyone outside the project team. |
| Q8 | Does Home Madrasa run in the development project, or does this finally require a production environment? | A65 says the development project is not production. Real students mean real personal data. |

## 7. Tests to be written

Mirroring the existing suites; all run on PGlite, no external database.

- `tests/services/tenants.test.ts` — creation, uniqueness, authorization denial, first-admin membership, audit row.
- `tests/services/join-links.test.ts` — create, preview, redeem, idempotency, refusal when revoked,
  expired or exhausted, cross-tenant refusal, `use_count` accounting under concurrency.
- `tests/db/join-links-rls.test.ts` — deny-by-default on the new tables, as the other Live Class tables are tested.
- `tests/unit/auth-safety.test.ts` — extended to pin the new server-action export surface.
- Extension of the existing enrollment and payment tests for a join-link-originated enrollment.
- A real-DEV suite addition only once the owner authorizes another DEV run.

## 8. Explicitly out of scope

No RTC vendor work (A35 undecided), no payment gateway (manual verification only, A107), no scheduled
jobs (OQ59), no production environment, no deployment, no change to the recording or correction
policy, and no change to existing Live Class rules.
