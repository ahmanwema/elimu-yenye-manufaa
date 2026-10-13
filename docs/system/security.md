# Security

Status: **PROPOSED** approach to satisfy the **APPROVED** requirements in brief Part 9. See [../../DECISIONS.md](../../DECISIONS.md) A22.

## 1. Principle

Authentication proves *who*; it never implies *what they may access*. Every access decision is re-checked at the authorization layer — primarily Postgres RLS, backed by API-level checks for logic RLS cannot express (e.g. invitation-link rate limiting, cross-service checks against the RTC provider).

## 2. Multi-tenant authorization

- Postgres RLS on every tenant-scoped table, policies driven by JWT custom claims (tenant memberships + role) — see [database.md](database.md) §3 and [tenancy.md](tenancy.md).
- `service_role` key never reaches any client; used only from trusted server contexts.
- Automated tests must assert cross-tenant reads/writes are rejected, not just that same-tenant access works (see [../testing/security-tests.md](../testing/security-tests.md)).

### 2.1 Prisma, Supabase and RLS — where enforcement actually happens (IMPLEMENTED 2026-10-13)

There are two ways data is read, and they are protected differently. This must not be blurred.

| Path | Who uses it | Database role | Protected by |
|---|---|---|---|
| **Prisma** (server only: Server Components, Server Actions, route handlers) | `src/server/*` | The connection role in `DATABASE_URL` — on Supabase this role **bypasses RLS** | The **server-side authorization layer** (`src/server/authz/policy.ts`) called by every data-access function in `src/server/data/*` *before* it queries, plus tenant-scoped `where` clauses. RLS does **not** protect this path. |
| **Supabase Data API** (supabase-js / PostgREST with a user JWT) | Browser or server Supabase client | `authenticated` / `anon` | **RLS** policies in `prisma/migrations/20261013000100_supabase_auth_rls`. Read-only; there are no write policies, and `anon` has no privileges. |

Rules that follow:

- All writes go through the server (Prisma + authz). The Data API cannot write application tables.
- RLS and the TypeScript policy implement the **same rules** and are tested against the **same fixture** (`tests/support/fixture.ts`), so a drift between them shows up as a failing test.
- Authorization is computed from a fresh `Actor` on every request (`loadActor`) and is never cached, so revoking a membership or a parent link takes effect on the next request.
- The user id comes only from the verified Supabase token (`auth.getClaims()`), never from request input. Tenant and student ids from requests are validated as UUIDs; a foreign or malformed id is "not authorized", and not-found and not-authorized look the same to the caller.
- **Recommended before production** (not done — needs a live database): connect Prisma with a dedicated least-privilege database role rather than `postgres`, per Supabase's Prisma guidance. Optionally run Prisma queries under the `authenticated` role with JWT claims set per transaction, so RLS also guards server traffic — an architectural option to evaluate, not adopted now.
- Proxy (`src/proxy.ts`) only refreshes the session cookie; it is not an authorization layer.

## 3. Invitation-link security (for A2 — join without manual approval)

Requirements for the invitation mechanism (PROPOSED):

- Links are opaque tokens (not guessable sequential IDs), scoped to exactly one teacher or Markaz + a specific role.
- Expiry and optional max-redemption-count are enforced server-side at redemption time, not just at link-generation time.
- Redemption is rate-limited per IP/account to prevent brute-force enumeration of valid tokens.
- A redeemed link creates a membership row with exactly the scope encoded in the token — never an elevated role.
- Revocation: a teacher/admin can invalidate an unredeemed link at any time; already-redeemed memberships are not retroactively affected by revoking the link itself (removing a student is a separate action).

### 3.1 Implemented invitation security (2026-10-13)

- 256-bit random token (base64url), shown to the inviter once. Only its **SHA-256 hash** is stored, so a leaked database row cannot be turned into a working link.
- Acceptance takes the token only. Tenant, role and email come from the stored row, and the signed-in email must equal the invited email.
- Single use is enforced with a conditional update, so exactly one acceptance wins a race. Expiry and status are re-checked at acceptance time.
- Invitation tables are **not readable through the Data API** (no grant), which keeps hashes and emails server-only.
- At most one pending invitation per (Markaz, email, role), enforced by a partial unique index.
- Brute force: 256-bit tokens make guessing infeasible. Per-IP rate limiting of invitation pages is **not** implemented; Supabase's own OTP rate limits apply to code sending.
- The invite token appears in the URL path. `Referrer-Policy: strict-origin-when-cross-origin` stops it leaking to other sites, and invite pages are `noindex`.

### 3.2 Implemented sign-in security (2026-10-13)

- Email OTP / magic link only (A45). Plain sign-in uses `shouldCreateUser: false`; only the invitation flow can create an account. A test pins the server-action export surface, because **every export of a "use server" file is a public endpoint**.
- Unknown-email errors look like success (no account enumeration); only rate limiting is shown.
- Redirect targets are reduced to same-origin paths with the WHATWG URL parser (`src/lib/safe-redirect.ts`). Email links use `SITE_URL` from configuration, never the Host header.

### 3.3 Storage authorization (2026-10-13)

- Buckets are private. Object keys are server-generated, random, and carry no tenant/student/teacher ids. Who may read an object is decided from **database rows** (`correction_audio_clips` → `corrections`) by the server, which then mints a 5-minute signed URL. A key or path from the client is never used for authorization.
- The Supabase secret key is server-only and used only to mint signed URLs after authorization.

### 3.4 Parent-link and invitation security (2026-10-13)

- **No self-escalation:** a parent cannot verify or activate; staff cannot verify or activate a link they are party to; a teacher cannot assign permissions; a Markaz Admin cannot assign anything except `parent_link.verify`, only to their own Teachers, never to themselves.
- **No cross-tenant action:** every staff transition checks the permission in the link's own Markaz; grants in another Markaz are irrelevant (tested).
- **Atomic transitions:** a conditional update on the expected state plus an event row, in one transaction. Racing or illegal transitions change nothing. The database CHECK independently refuses states without their audit fields.
- **Parent self-request** never reveals whether a Markaz code, child email or link exists: the same response for every input (OQ33).
- **Invitations:** the target, Markaz and any proposed child are stored at creation, re-authorized there, and never read from the recipient. A proposed child yields only a PENDING request (A61). Exactly 7 days (A60): valid until 1 ms before `expires_at`, expired at `expires_at`.
- **History:** `parent_link_events` is append-only and not readable through the Data API.

### 3.5 Account creation and self-request hardening (2026-10-13)

- **Public sign-ups disabled by design:** `signInWithOtp` always uses `shouldCreateUser: false`. Invited accounts are created by the server through the Supabase admin API (`ensureAuthUserForInvitation`) only after the invitation token has been validated. So the Supabase project setting "allow new users to sign up" can and must be **off**, which closes the direct-to-Supabase sign-up bypass. Tests pin this.
- **Registration numbers** are identifiers, not secrets: random (not sequential or guessable), 8 characters, immutable. Using one only creates a PENDING request that staff must verify and activate.
- **Self-request is non-enumerating:** success, unknown Markaz, unknown or mismatched email or number, wrong Markaz, departed student and existing relationship all return the identical result (tested). Residual: response *timing* may differ slightly between paths (LOW; add constant-time padding if this becomes a concern).

### 3.6 Findings from real Supabase verification (2026-10-13)

| Finding | Severity | Cause | Fix |
|---|---|---|---|
| SECURITY DEFINER `public.handle_new_auth_user` was executable by `anon`/`authenticated` | LOW (trigger functions cannot be called directly) | Supabase grants EXECUTE on new public-schema functions to the API roles explicitly; `REVOKE ... FROM PUBLIC` does not remove that | Migration 0800 revokes it; the PGlite stand-in now copies Supabase's default function grants, so tests catch this class of issue |
| Sign-up test passed for the wrong reason | MEDIUM (test validity) | Supabase rejects `@example.com` in public auth flows | Tests now require `disable_signup=true` and the specific `signup_disabled` / `otp_disabled` errors |
| Public sign-ups were enabled in the project | HIGH until fixed | Dashboard default | Disabled by the owner; verified (`disable_signup=true`) |

Everything else matched the PGlite results: RLS for tenants, students, parents (only ACTIVE), roster, server-only tables, write refusal, no platform-admin bypass in SQL; Storage keys not readable by path, publicly or with a user JWT.

## 4. Recording consent & private annotation leakage

- Lesson recording must have a clear consent/notice model — ~~OPEN QUESTION~~ **APPROVED 2026-10-05 (A30)**: (1) general consent during enrollment/account setup **and** (2) a clear notice when recording begins; general consent alone is not sufficient UX. This applies to any recorded audio, including Option B correction clips (A29). Retention/deletion: see §7. Still open: consent on behalf of minors (open question 17).
- Because private per-student corrections must never leak to other students (A17), and because recordings/screen-shares are broadcast to the whole class, the architecture keeps private-annotation data **out of** any shared broadcast/recording stream entirely — it lives in a separate, visibility-scoped data channel/table that is only ever rendered to the correction's owner + the teacher. This is why [architecture.md](architecture.md) treats whiteboard-op-log recording and audio recording as separate concerns rather than "record the screen." See [../features/student-corrections.md](../features/student-corrections.md).

## 5. Role-based permissions & access revocation

- Permission grants (e.g. whiteboard write access) are checked server-side at the moment of the write operation, not only at session start — so a mid-class revocation takes effect immediately (A16).
- Removing a student from a teacher/Markaz revokes their membership row and, by RLS, all further access to that tenant's data going forward; historical records of their own past submissions remain visible to them per normal student self-access rules unless explicitly deleted.
  - **2026-10-05 (A32):** approved as business direction — a departed Student keeps their own personal submissions/corrections; restricted/licensed Markaz content may be removed. Implementation consequence: RLS for a student's *own* records cannot depend only on an active membership row, because that row is revoked on departure. Open edge cases: items 19 and 20 in [../roadmap/open-questions.md](../roadmap/open-questions.md).
- **Multi-Markaz Teachers (A28):** a Teacher's permissions must be evaluated against the specific Markaz membership in play, never a union across all their memberships.

## 6. Audit logs

Sensitive actions requiring an audit trail (PROPOSED list, to be finalized with the owner): recording start/stop, whiteboard write-permission grants/revocations, role changes, data exports, invitation-link creation/revocation, payment refunds. Audit entries are append-only and readable by Super Admin (and, scoped to their own tenant, by Teacher/Markaz Admin for their own actions).

## 7. Data retention & backups

- Database backups: rely on Supabase's managed backup capability at whatever tier is provisioned; explicit retention/restore-testing policy is an **OPEN QUESTION** pending infrastructure approval.
- Recording retention period — ~~OPEN QUESTION~~ **business direction APPROVED 2026-10-05 (A31)**: recordings remain available until an authorized user deletes them, subject to the project's retention/deletion policy. **Not approved / still implementation details** (open question 16): who is an authorized deleter; soft vs hard delete; grace period; archival; storage garbage collection; legal hold. Interaction to resolve: deleting a recording must not silently destroy a departed student's retained correction context (A32) — depends on open question 15. Storage: Supabase Storage (A38); correction-storage choice: A29 ([../features/student-corrections.md](../features/student-corrections.md)).

## 8. Child protection considerations

Given the student population includes minors:

- Minimize personally identifying information collected at self-registration; parental linkage (model decided 2026-10-05: separate Parent account type, A27 — see [roles-permissions.md](roles-permissions.md) §3; verification method still open) should not require exposing a child's contact details to the platform, if avoidable.
- Recording consent (§4) is especially important where minors are recorded. A30 fixes the two-step shape (enrollment consent + start-of-recording notice), but *who* consents for a minor still needs explicit legal/owner guidance appropriate to the jurisdictions served, which is outside this document's authority to decide (open question 17).
- Teacher-to-student private messaging is **not** in the confirmed feature set (chat is classroom-question-only, per A13) — this should stay a deliberate boundary, not an accidental omission, when chat is implemented.

## 9. What this document does not do

It does not implement any of the above. It does not select a specific audit-log schema or backup-retention number — those require owner sign-off (see [../../DECISIONS.md](../../DECISIONS.md) §2 authorization boundaries).
